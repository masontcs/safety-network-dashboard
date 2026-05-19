import { NextResponse } from 'next/server'
import { getAccessContext } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'

const ALLOWED_ROLES = ['admin', 'executive', 'ar_manager', 'district_manager', 'branch_manager']

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
): Promise<Response> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    if (!ALLOWED_ROLES.includes(ctx.access.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const userId = body?.userId
    if (!userId || typeof userId !== 'string') {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 })
    }

    const supabase = createServiceClient()
    const { branchIds } = ctx.access

    // Branch/district managers can only assign PMs from their own branches
    if (branchIds !== null) {
      const { data: pmBranches } = await supabase
        .from('user_branch_assignments')
        .select('branch_id')
        .eq('user_id', userId)
        .in('branch_id', branchIds)

      if (!pmBranches || pmBranches.length === 0) {
        return NextResponse.json({ error: 'That user is not in your branch' }, { status: 403 })
      }
    }

    const { error } = await supabase
      .from('ar_customer_pm_assignments')
      .insert({ customer_id: params.id, user_id: userId })

    if (error) {
      if (error.code === '23505') return NextResponse.json({ error: 'Already assigned' }, { status: 409 })
      return NextResponse.json({ error: 'Failed to assign PM' }, { status: 500 })
    }

    const { data: profile } = await supabase
      .from('user_profiles')
      .select('display_name, role')
      .eq('id', userId)
      .single()

    return NextResponse.json({
      pm: { userId, displayName: profile?.display_name ?? '—', role: profile?.role ?? '—' },
    })
  } catch (err) {
    console.error('AR PM assign error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
