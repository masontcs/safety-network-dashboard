import { NextResponse } from 'next/server'
import { createRouteClient, createServiceClient } from '@/lib/supabase/server'
import type { UserAccess } from '@/lib/utils/access'
import type { Role } from '@/lib/supabase/database.types'
import { DASHBOARD_ROLES, BILLING_ROLES, isFieldRole, canBillingArea, type BillingArea } from '@/lib/utils/interfaces'

type AccessResult =
  | { ok: true; access: UserAccess }
  | { ok: false; response: NextResponse }

// ── Valid roles — used for runtime validation of DB values ─────────────────────
//
// DASHBOARD roles only, from the single source of truth in lib/utils/interfaces.
// Field roles ('tech') are deliberately absent: they must never reach a dashboard or
// billing API. getAccessContext rejects them outright and /api/tech/* requires
// role === 'tech'. Two disjoint sets.
// Everyone who may reach a desktop (dashboard OR billing) API. Field roles ('tech') stay
// out — they use /api/tech/* only. Billing roles are branch-scoped like dashboard users.
const VALID_ROLES: readonly Role[] = [...new Set([...DASHBOARD_ROLES, ...BILLING_ROLES])]

// ── Role sets ──────────────────────────────────────────────────────────────────
//
// ALLOW-lists, deliberately. These were previously deny-lists
// (`if (NO_PAYROLL_ROLES.includes(role)) deny; else allow`) which FAIL OPEN: any role
// not named was granted access, so adding a role silently handed it payroll, fuel and
// revenue data. Inverted so a role gets nothing unless it's listed here. Membership is
// identical to the old behaviour — this changes nothing for existing roles.

const PAYROLL_ROLES: Role[] = ['admin', 'executive', 'district_manager', 'branch_manager']
const FUEL_ROLES:    Role[] = ['admin', 'executive', 'district_manager', 'branch_manager']
const REVENUE_ROLES: Role[] = ['admin', 'executive', 'district_manager', 'branch_manager', 'project_manager', 'sales']

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

/**
 * Billing area guard — the permission boundary for the billing interface. Admin and Billing
 * Manager pass everything; a Dispatcher / Biller pass only their areas. Use in each billing
 * route with the area it belongs to, e.g. guardBillingArea(role, 'invoices').
 */
export function guardBillingArea(role: Role, area: BillingArea): NextResponse | null {
  if (canBillingArea(role, area)) return null
  return NextResponse.json(
    { success: false, error: 'You do not have access to this billing area.', code: 'FORBIDDEN' },
    { status: 403 }
  )
}

// Admin or executive — used for allocation management, data explorer, etc.
export function guardAdminOrExecutive(role: Role): NextResponse | null {
  if (role === 'admin' || role === 'executive') return null
  return NextResponse.json(
    { success: false, error: 'Admin or executive access required.', code: 'FORBIDDEN' },
    { status: 403 }
  )
}

// AR administrative operations (status changes, imports, exclusions, merges)
// admin + executive + ar_manager all have full AR admin rights
export function guardArAdminOnly(role: Role): NextResponse | null {
  if (role === 'admin' || role === 'executive' || role === 'ar_manager') return null
  return NextResponse.json(
    { success: false, error: 'AR admin access required.', code: 'FORBIDDEN' },
    { status: 403 }
  )
}

const deny = () =>
  NextResponse.json({ success: false, error: 'Access denied.', code: 'FORBIDDEN' }, { status: 403 })

export function guardPayrollAccess(role: Role): NextResponse | null {
  return PAYROLL_ROLES.includes(role) ? null : deny()
}

export function guardFuelAccess(role: Role): NextResponse | null {
  return FUEL_ROLES.includes(role) ? null : deny()
}

export function guardRevenueAccess(role: Role): NextResponse | null {
  return REVENUE_ROLES.includes(role) ? null : deny()
}

// ── Access context ─────────────────────────────────────────────────────────────

export async function getAccessContext(): Promise<AccessResult> {
  const routeClient = createRouteClient()

  // Performance: getClaims() verifies the JWT's signature + expiry LOCALLY when
  // the project uses asymmetric JWT signing keys, instead of getUser()'s network
  // round-trip to the Auth server on EVERY request. Since all ~100 API routes
  // funnel through this helper, that hop was a per-click latency floor across
  // both interfaces.
  //
  // Trade-off: a session is trusted until its token expires (<= 1h) rather than
  // being revalidated server-side each call — fine for an internal tool. If the
  // project has NOT migrated to asymmetric keys, getClaims() falls back to a
  // network verify, so this change is safe either way (no speedup until the
  // "JWT Signing Keys" migration is enabled in Supabase Auth settings).
  const { data: claimsData, error: authError } = await routeClient.auth.getClaims()
  const userId = claimsData?.claims?.sub as string | undefined

  if (authError || !userId) {
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
    .eq('id', userId)
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

  // Field roles are legitimate accounts with NO web access — reject them here so they
  // can never reach a role guard at all.
  if (isFieldRole(profile.role as Role)) {
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, error: 'This is a field technician account. Please use the tech app.', code: 'FORBIDDEN' },
        { status: 403 }
      ),
    }
  }

  if (!VALID_ROLES.includes(profile.role as Role)) {
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, error: 'Unrecognized user role.', code: 'FORBIDDEN' },
        { status: 401 }
      ),
    }
  }
  const role = profile.role as Role
  const displayName = (profile as unknown as { display_name: string | null }).display_name ?? ''

  // Roles with null branchIds — either full access or customer-scoped (handled per AR route)
  if (role === 'admin' || role === 'executive' || role === 'ar_manager' || role === 'ar_team' || role === 'office_team') {
    return { ok: true, access: { userId, role, displayName, branchIds: null } }
  }

  // sales, project_manager, district_manager, branch_manager: branch-scoped via assignments
  const { data: assignments, error: assignError } = await supabase
    .from('user_branch_assignments')
    .select('branch_id')
    .eq('user_id', userId)

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

  return { ok: true, access: { userId, role, displayName, branchIds } }
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
