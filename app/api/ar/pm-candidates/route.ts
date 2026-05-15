import { NextResponse } from 'next/server'
import { getAccessContext } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import type { Role } from '@/lib/supabase/database.types'

const PM_ROLES: Role[] = ['project_manager', 'branch_manager']
const ALLOWED_ROLES: Role[] = ['admin', 'ar_manager', 'district_manager', 'branch_manager']

export async function GET(): Promise<Response> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    if (!ALLOWED_ROLES.includes(ctx.access.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const supabase = createServiceClient()
    const { branchIds } = ctx.access

    // For branch/district managers, scope candidates to their own branches
    if (branchIds !== null) {
      const { data: assignments } = await supabase
        .from('user_branch_assignments')
        .select('user_id')
        .in('branch_id', branchIds)

      const userIds = [...new Set((assignments ?? []).map((a) => a.user_id as string))]
      if (userIds.length === 0) return NextResponse.json({ users: [] })

      const { data } = await supabase
        .from('user_profiles')
        .select('id, display_name, role')
        .in('id', userIds)
        .in('role', PM_ROLES)
        .order('display_name')

      return NextResponse.json({
        users: (data ?? []).map((u) => ({ id: u.id as string, displayName: u.display_name as string, role: u.role as string })),
      })
    }

    // Admin / ar_manager — all PM-eligible users
    const { data } = await supabase
      .from('user_profiles')
      .select('id, display_name, role')
      .in('role', PM_ROLES)
      .order('display_name')

    return NextResponse.json({
      users: (data ?? []).map((u) => ({ id: u.id as string, displayName: u.display_name as string, role: u.role as string })),
    })
  } catch (err) {
    console.error('PM candidates GET error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
