import type { Role } from '@/lib/supabase/database.types'

/**
 * THE single source of truth for which interfaces a role may see or reach.
 *
 * This app hosts more than one interface (Dashboards, Billing) and will host a
 * field tech app. A user must never be able to see, reach, or even learn of the
 * existence of an interface they haven't been granted.
 *
 * Rules:
 *  1. **Allow-lists only.** Never write "everyone except X". A role that isn't
 *     listed gets NOTHING — a new role must be granted access explicitly, and
 *     forgetting to list it fails CLOSED.
 *  2. **One source.** Page gates (middleware), layout gates, and the sidebar
 *     switcher all read from here. Encoding access in more than one place is how
 *     the UI ends up advertising a door the server won't open.
 *  3. **Absence is invisibility.** `interfacesFor` drives the switcher, so a role
 *     without an interface never sees it offered.
 *
 * This module is intentionally dependency-free (no next/server) so the server,
 * the middleware, and client components can all share it.
 */

export type InterfaceKey = 'dashboards' | 'billing' | 'field'

/** Roles that may reach the Dashboards interface. */
export const DASHBOARD_ROLES: readonly Role[] = [
  'admin', 'executive', 'district_manager', 'branch_manager',
  'ar_manager', 'ar_team', 'office_team', 'project_manager', 'sales',
] as const

/**
 * Roles that may reach the Billing interface.
 * Billing roles aren't defined yet, so it's admin-only. Widening this is the one
 * place to do it — the middleware, the /billing layout and the switcher all follow.
 */
export const BILLING_ROLES: readonly Role[] = ['admin'] as const

/**
 * Field-only roles. They reach ONLY the mobile tech web app at /tech (a money-blind
 * capture tool) and must never resolve a dashboard or billing page. The /tech app is
 * served here for now; a native app can follow, hitting the same /api/tech/* endpoints.
 */
export const FIELD_ROLES: readonly Role[] = ['tech'] as const

export const canUseDashboards = (role: Role): boolean => DASHBOARD_ROLES.includes(role)
export const canUseBilling = (role: Role): boolean => BILLING_ROLES.includes(role)
export const isFieldRole = (role: Role): boolean => FIELD_ROLES.includes(role)

/**
 * Field-app access is a CAPABILITY, not a role: a pure tech has it via their role, and a
 * hybrid (a desktop user who also works in the field) has it via the `field_access` flag on
 * their profile (set when they're linked to a technician record). Either grants /tech.
 */
export const hasFieldAccess = (role: Role, fieldAccess = false): boolean => isFieldRole(role) || fieldAccess

/**
 * Which interfaces this user may switch between — drives the sidebar switcher.
 * A user with one interface sees a plain brand block; with none, nothing.
 */
export function interfacesFor(role: Role, fieldAccess = false): InterfaceKey[] {
  const keys: InterfaceKey[] = []
  if (canUseDashboards(role)) keys.push('dashboards')
  if (canUseBilling(role)) keys.push('billing')
  if (hasFieldAccess(role, fieldAccess)) keys.push('field')
  return keys
}

/** Path prefixes a user may visit. Empty = no web access at all. */
export function allowedPrefixesFor(role: Role, fieldAccess = false): string[] {
  const prefixes: string[] = []
  if (canUseDashboards(role)) prefixes.push(...DASHBOARD_PREFIXES[role])
  if (canUseBilling(role)) prefixes.push('/billing')
  // The tech app is reachable by field roles AND hybrids (field_access) — the one place
  // a desktop user may also step into /tech.
  if (hasFieldAccess(role, fieldAccess)) prefixes.push('/tech')
  return prefixes
}

/** Dashboard sub-areas per role. Only consulted when canUseDashboards(role). */
const DASHBOARD_PREFIXES: Record<Role, string[]> = {
  admin:            ['/dashboard', '/admin', '/fuel', '/ar'],
  executive:        ['/dashboard', '/executive', '/fuel', '/ar'],
  district_manager: ['/dashboard', '/district', '/fuel', '/ar'],
  branch_manager:   ['/dashboard', '/manager', '/fuel', '/ar'],
  ar_manager:       ['/ar'],
  ar_team:          ['/ar'],
  office_team:      ['/ar'],
  project_manager:  ['/dashboard', '/ar'],
  sales:            ['/dashboard', '/ar'],
  tech:             [], // field role — dashboards none; /tech is granted via isFieldRole in allowedPrefixesFor
}
