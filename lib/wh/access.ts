import { NextResponse } from 'next/server'
import type { Role } from '@/lib/supabase/database.types'

/**
 * Who may reach Western Highways.
 *
 * WH is a separate company whose A/R and A/P are mostly intercompany transfers between the
 * Safety Network entities — an executive-level view of the group's internal position, not
 * branch-level operating data. It is gated on existing roles, the way the SN dashboards are:
 * there is no wh_access grant table, and no role inherits WH from anywhere else.
 *
 * ALLOW-LIST, deliberately, and the same list for reading and for uploading. A role that is
 * not named here gets nothing, so adding a role to the platform never silently hands it WH.
 * This module is the single source: the /wh layout, every /api/wh route, the sidebar item and
 * the middleware path allow-list all resolve through it.
 */
export const WH_ROLES: readonly Role[] = ['admin', 'executive'] as const

/** May open the WH section and read its A/R and A/P. */
export function canViewWh(role: Role): boolean {
  return WH_ROLES.includes(role)
}

/**
 * May upload a WH report. The same list as canViewWh today: WH's only writers are the two
 * roles that can see it at all. Kept as its own function so narrowing uploads later is a
 * one-line change that the route guards pick up automatically.
 */
export function canUploadWh(role: Role): boolean {
  return WH_ROLES.includes(role)
}

/** 403 unless the caller may read WH. Call after getAccessContext. */
export function guardWhAccess(role: Role): NextResponse | null {
  if (canViewWh(role)) return null
  return NextResponse.json(
    { success: false, error: 'Western Highways access required.', code: 'FORBIDDEN' },
    { status: 403 },
  )
}

/** 403 unless the caller may upload a WH report. Call after guardWhAccess. */
export function guardWhUpload(role: Role): NextResponse | null {
  if (canUploadWh(role)) return null
  return NextResponse.json(
    { success: false, error: 'You are not allowed to upload Western Highways reports.', code: 'FORBIDDEN' },
    { status: 403 },
  )
}
