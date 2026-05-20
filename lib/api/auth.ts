import { NextResponse } from 'next/server'
import { createRouteClient, createServiceClient } from '@/lib/supabase/server'
import type { UserAccess } from '@/lib/utils/access'
import type { Role } from '@/lib/supabase/database.types'

type AccessResult =
  | { ok: true; access: UserAccess }
  | { ok: false; response: NextResponse }

// ── Role sets ──────────────────────────────────────────────────────────────────

const NO_PAYROLL_ROLES: Role[] = ['ar_manager', 'ar_team', 'office_team', 'project_manager', 'sales']
const NO_FUEL_ROLES:    Role[] = ['ar_manager', 'ar_team', 'office_team', 'project_manager', 'sales']
const NO_REVENUE_ROLES: Role[] = ['ar_manager', 'ar_team', 'office_team']

// ── Guard helpers ──────────────────────────────────────────────────────────────

export function isAdminRole(role: Role): boolean {
  return role === 'admin'
}

// Full platform admin only
export function guardAdminOnly(role: Role): NextResponse | null {
  if (role === 'admin') return null
  return NextResponse.json(
    { success: false, error: 'Admin access required.', code: 'FORBIDDEN' },
    { status: 403 }
  )
}

// AR administrative operations (status changes, imports, exclusions, merges)
export function guardArAdminOnly(role: Role): NextResponse | null {
  if (role === 'admin' || role === 'ar_manager') return null
  return NextResponse.json(
    { success: false, error: 'AR admin access required.', code: 'FORBIDDEN' },
    { status: 403 }
  )
}

export function guardPayrollAccess(role: Role): NextResponse | null {
  if (NO_PAYROLL_ROLES.includes(role)) {
    return NextResponse.json({ success: false, error: 'Access denied.', code: 'FORBIDDEN' }, { status: 403 })
  }
  return null
}

export function guardFuelAccess(role: Role): NextResponse | null {
  if (NO_FUEL_ROLES.includes(role)) {
    return NextResponse.json({ success: false, error: 'Access denied.', code: 'FORBIDDEN' }, { status: 403 })
  }
  return null
}

export function guardRevenueAccess(role: Role): NextResponse | null {
  if (NO_REVENUE_ROLES.includes(role)) {
    return NextResponse.json({ success: false, error: 'Access denied.', code: 'FORBIDDEN' }, { status: 403 })
  }
  return null
}

// ── Access context ─────────────────────────────────────────────────────────────

export async function getAccessContext(): Promise<AccessResult> {
  const routeClient = createRouteClient()
  const { data: { user }, error: authError } = await routeClient.auth.getUser()

  if (authError || !user) {
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, error: 'Unauthorized.', code: 'UNAUTHORIZED' },
        { status: 401 }
      ),
    }
  }

  const supabase = createServiceClient()

  const { data: profile, error: profileError } = await supabase
    .from('user_profiles')
    .select('id, role, display_name')
    .eq('id', user.id)
    .single()

  if (profileError || !profile) {
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, error: 'User profile not found.', code: 'NOT_FOUND' },
        { status: 404 }
      ),
    }
  }

  const role = profile.role as Role
  const displayName = (profile as unknown as { display_name: string | null }).display_name ?? ''

  // Roles with null branchIds — either full access or customer-scoped (handled per AR route)
  if (role === 'admin' || role === 'executive' || role === 'ar_manager' || role === 'ar_team' || role === 'office_team') {
    return { ok: true, access: { userId: user.id, role, displayName, branchIds: null } }
  }

  // sales, project_manager, district_manager, branch_manager: branch-scoped via assignments
  const { data: assignments, error: assignError } = await supabase
    .from('user_branch_assignments')
    .select('branch_id')
    .eq('user_id', user.id)

  if (assignError) {
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, error: 'Failed to load branch assignments.', code: 'INTERNAL_ERROR' },
        { status: 500 }
      ),
    }
  }

  const branchIds = (assignments ?? []).map((a) => a.branch_id)

  return { ok: true, access: { userId: user.id, role, displayName, branchIds } }
}

// ── AR team customer scope helper ──────────────────────────────────────────────

export async function getArTeamCustomerIds(userId: string): Promise<string[]> {
  const supabase = createServiceClient()
  const { data } = await supabase
    .from('ar_customer_assignments')
    .select('customer_id')
    .eq('user_id', userId)
  return (data ?? []).map((r) => r.customer_id as string)
}
