import { NextResponse } from 'next/server'
import { getAccessContext } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'

// GET /api/ar/ar-users
// Returns all users with AR-eligible roles (ar_team, ar_manager, office_team)
// for populating the "Assign AR Team Member" dropdown on the customer detail page.
// Accessible to admin, executive, ar_manager, and ar_team.
export async function GET(): Promise<Response> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response

    const { role } = ctx.access
    const allowed = ['admin', 'executive', 'ar_manager', 'ar_team']
    if (!allowed.includes(role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const supabase = createServiceClient()
    const { data: profiles, error } = await supabase
      .from('user_profiles')
      .select('id, display_name, role')
      .in('role', ['ar_team', 'ar_manager', 'office_team'])
      .order('display_name')

    if (error) return NextResponse.json({ error: 'Failed to load AR users' }, { status: 500 })

    return NextResponse.json({
      users: (profiles ?? []).map((p) => ({
        id:          p.id as string,
        displayName: p.display_name as string,
        role:        p.role as string,
      })),
    })
  } catch (err) {
    console.error('AR users GET error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
