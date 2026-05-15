import { NextResponse } from 'next/server'
import { getAccessContext, guardArAdminOnly } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'

export async function GET(): Promise<Response> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const guard = guardArAdminOnly(ctx.access.role)
    if (guard) return guard

    const supabase = createServiceClient()
    const { data } = await supabase
      .from('user_profiles')
      .select('id, display_name')
      .eq('role', 'ar_team')
      .order('display_name')

    return NextResponse.json({
      users: (data ?? []).map((u) => ({ id: u.id as string, displayName: u.display_name as string })),
    })
  } catch (err) {
    console.error('AR team-members GET error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
