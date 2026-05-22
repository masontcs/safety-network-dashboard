import { NextResponse } from 'next/server'
import { getAccessContext, guardArAdminOnly } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'

// GET /api/ar/team-members
// Returns all users who have at least one ar_customer_assignment, sorted by name.
// Used to populate the "Assigned to" dropdown on the AR dashboard.
// Restricted to admin / executive / ar_manager.
export async function GET(): Promise<Response> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const guard = guardArAdminOnly(ctx.access.role)
    if (guard) return guard

    const supabase = createServiceClient()

    // Distinct user_ids that have at least one customer assignment
    const { data: assignments, error } = await supabase
      .from('ar_customer_assignments')
      .select('user_id')

    if (error) return NextResponse.json({ error: 'Failed to load assignments' }, { status: 500 })

    const userIds = [...new Set((assignments ?? []).map((a) => a.user_id as string))]
    if (userIds.length === 0) return NextResponse.json({ members: [] })

    const { data: profiles } = await supabase
      .from('user_profiles')
      .select('id, display_name')
      .in('id', userIds)
      .order('display_name')

    return NextResponse.json({
      members: (profiles ?? []).map((p) => ({
        id:          p.id as string,
        displayName: p.display_name as string,
      })),
    })
  } catch (err) {
    console.error('AR team-members GET error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
