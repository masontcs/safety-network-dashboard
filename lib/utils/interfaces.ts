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

export type InterfaceKey = 'dashboards' | 'billing'

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
 * Field-only roles: real accounts with ZERO web access. They belong to the tech
 * app and must never resolve a dashboard or billing page.
 */
export const FIELD_ROLES: readonly Role[] = ['tech'] as const

export const canUseDashboards = (role: Role): boolean => DASHBOARD_ROLES.includes(role)
export const canUseBilling = (role: Role): boolean => BILLING_ROLES.includes(role)
export const isFieldRole = (role: Role): boolean => FIELD_ROLES.includes(role)

/**
 * Which interfaces this role may switch between — drives the sidebar switcher.
 * A role with one interface sees a plain brand block; a role with none sees nothing.
 */
export function interfacesFor(role: Role): InterfaceKey[] {
  const keys: InterfaceKey[] = []
  if (canUseDashboards(role)) keys.push('dashboards')
  if (canUseBilling(role)) keys.push('billing')
  return keys
}

/** Path prefixes a role may visit. Empty = no web access at all. */
export function allowedPrefixesFor(role: Role): string[] {
  const prefixes: string[] = []
  if (canUseDashboards(role)) prefixes.push(...DASHBOARD_PREFIXES[role])
  if (canUseBilling(role)) prefixes.push('/billing')
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
  tech:             [], // field role — no web access
}
