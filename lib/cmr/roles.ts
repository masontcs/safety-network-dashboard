import type { CmrRole } from '@/lib/supabase/database.types'

/**
 * SN Cash Ledger (CMR) roles and navigation — the single source of truth shared by the
 * server guards (lib/api/cmr), the middleware, and the sidebar.
 *
 * Access is EXPLICIT-GRANT ONLY. A CMR role comes from a cmr_access row and nothing else —
 * never from user_profiles.role. A platform admin with no row gets nothing.
 *
 * Dependency-free (no next/server) so client components and the middleware can import it.
 */

export type { CmrRole }

export const CMR_ROLES: readonly CmrRole[] = ['controller', 'requester', 'viewer'] as const

export function isCmrRole(v: unknown): v is CmrRole {
  return typeof v === 'string' && (CMR_ROLES as readonly string[]).includes(v)
}

export const CMR_ROLE_LABEL: Record<CmrRole, string> = {
  controller: 'Controller',
  requester: 'Requester',
  viewer: 'Viewer',
}

export const CMR_ROLE_DESCRIPTION: Record<CmrRole, string> = {
  controller: 'Full read and write. Manages the ledger, vendors, accounts and access.',
  requester: 'Reads everything. Can only submit vendor payment requests.',
  viewer: 'Reads everything. Cannot change anything.',
}

/** Only a Controller may change anything outside of submitting a vendor request. */
export const isCmrController = (role: CmrRole): boolean => role === 'controller'

export type CmrNavIcon = 'ledger' | 'priorities' | 'rollup' | 'recurring' | 'requests' | 'accounts' | 'access' | 'help'

export interface CmrNavItem {
  href: string
  label: string
  icon: CmrNavIcon
}

export interface CmrNavGroup {
  label: string
  items: CmrNavItem[]
}

const LEDGER: CmrNavGroup = {
  label: 'Ledger',
  items: [
    { href: '/cmr', label: 'Daily ledger', icon: 'ledger' },
    { href: '/cmr/priorities', label: 'Weekly priorities', icon: 'priorities' },
    { href: '/cmr/rollup', label: 'Weekly rollup', icon: 'rollup' },
  ],
}

const VENDORS: CmrNavGroup = {
  label: 'Vendors',
  items: [
    { href: '/cmr/recurring', label: 'Recurring', icon: 'recurring' },
    { href: '/cmr/requests', label: 'Requests', icon: 'requests' },
  ],
}

const SETTINGS: CmrNavGroup = {
  label: 'Settings',
  items: [
    { href: '/cmr/accounts', label: 'Accounts', icon: 'accounts' },
    { href: '/cmr/access', label: 'Access', icon: 'access' },
  ],
}

/** Path prefixes only a Controller may open (also enforced by the (controller) layout). */
export const CMR_CONTROLLER_PATHS: readonly string[] = SETTINGS.items.map((i) => i.href)

/**
 * The sidebar for a role. Requesters and Viewers get the read views (plus Requests, where a
 * Requester submits); Settings is Controller-only. An unknown role gets nothing (fail closed).
 */
export function cmrNavFor(role: CmrRole): CmrNavGroup[] {
  if (role === 'controller') return [LEDGER, VENDORS, SETTINGS]
  if (role === 'requester' || role === 'viewer') return [LEDGER, VENDORS]
  return []
}

/** The in-app "How to use" page. Every CMR role may read it; it lives under (secure). */
export const CMR_HELP_HREF = '/cmr/help'

const HELP: CmrNavGroup = {
  label: 'Help',
  items: [{ href: CMR_HELP_HREF, label: 'How to use', icon: 'help' }],
}

/**
 * What the sidebar actually renders: the role's sections (cmrNavFor, unchanged) with the Help
 * group at the bottom, below Settings. Still fails closed — an unknown role gets nothing.
 */
export function cmrSidebarFor(role: CmrRole): CmrNavGroup[] {
  const groups = cmrNavFor(role)
  return groups.length ? [...groups, HELP] : []
}
