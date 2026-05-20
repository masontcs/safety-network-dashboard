import { NextResponse } from 'next/server'
import { getAccessContext, guardArAdminOnly } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'

export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
): Promise<Response> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response

    const supabase = createServiceClient()
    const { data: rows } = await supabase
      .from('ar_customer_assignments')
      .select('user_id, assigned_at')
      .eq('customer_id', params.id)

    const userIds = (rows ?? []).map((r) => r.user_id as string)
    const { data: profiles } = userIds.length > 0
      ? await supabase.from('user_profiles').select('id, display_name, role').in('id', userIds)
      : { data: [] }

    const profileMap = new Map((profiles ?? []).map((p) => [p.id as string, p]))

    const assignments = (rows ?? []).map((r) => {
      const prof = profileMap.get(r.user_id as string)
      return {
        userId:      r.user_id,
        displayName: prof?.display_name ?? '—',
        role:        prof?.role ?? '—',
        assignedAt:  r.assigned_at,
      }
    })

    return NextResponse.json({ assignments })
  } catch (err) {
    console.error('AR assignment GET error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
): Promise<Response> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const guard = guardArAdminOnly(ctx.access.role)
    if (guard) return guard

    const body = await request.json()
    const userId = body?.userId as string | undefined
    if (!userId) return NextResponse.json({ error: 'userId is required' }, { status: 400 })

    const supabase = createServiceClient()

    // Verify the user being assigned has an AR-eligible role
    const { data: prof } = await supabase
      .from('user_profiles')
      .select('id, display_name, role')
      .eq('id', userId)
      .single()
    if (!prof) return NextResponse.json({ error: 'User not found' }, { status: 404 })
    if (!['ar_team', 'ar_manager', 'office_team'].includes(prof.role as string)) {
      return NextResponse.json({ error: 'User must be an AR team member, AR manager, or Office Team member' }, { status: 400 })
    }

    const { error } = await supabase
      .from('ar_customer_assignments')
      .upsert({ customer_id: params.id, user_id: userId, assigned_by: ctx.access.userId },
               { onConflict: 'customer_id,user_id', ignoreDuplicates: true })
    if (error) return NextResponse.json({ error: 'Failed to assign' }, { status: 500 })

    return NextResponse.json({
      assignment: {
        userId:      prof.id,
        displayName: prof.display_name,
        role:        prof.role,
      },
    })
  } catch (err) {
    console.error('AR assignment POST error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
