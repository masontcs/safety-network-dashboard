import { NextResponse } from 'next/server'
import { getAccessContext, guardAdminOnly } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
): Promise<Response> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const guard = guardAdminOnly(ctx.access.role)
    if (guard) return guard

    const body = await request.json()
    const userId = body?.userId
    if (!userId || typeof userId !== 'string') {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 })
    }

    const supabase = createServiceClient()
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
