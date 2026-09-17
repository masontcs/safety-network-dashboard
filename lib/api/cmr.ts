import { NextResponse } from 'next/server'
import { createRouteClient, createServiceClient } from '@/lib/supabase/server'
import { isCmrRole, type CmrRole } from '@/lib/cmr/roles'

/**
 * SN Cash Ledger (CMR) access context — the gate for every /cmr page and /api/cmr route.
 *
 * EXPLICIT GRANT ONLY. The caller's CMR role comes from their cmr_access row and nothing else.
 * user_profiles.role is never consulted: a platform admin with no cmr_access row is DENIED,
 * exactly like anyone else. This is the opposite of billing (where admin passes everything)
 * and is easy to undo by accident — lib/api/cmr.test.ts locks it. Do not add a role shortcut.
 */

export interface CmrAccess {
  userId: string
  role: CmrRole
  displayName: string
}

export type CmrContext =
  | ({ ok: true } & CmrAccess)
  | { ok: false; status: 401 | 403 | 500; response: NextResponse }

const fail = (status: 401 | 403 | 500, error: string, code: string): CmrContext => ({
  ok: false,
  status,
  response: NextResponse.json({ success: false, error, code }, { status }),
})

export async function getCmrContext(): Promise<CmrContext> {
  // getClaims() verifies the session JWT (locally with asymmetric signing keys) — same as
  // getAccessContext in lib/api/auth.
  const routeClient = createRouteClient()
  const { data: claimsData, error: authError } = await routeClient.auth.getClaims()
  const userId = claimsData?.claims?.sub as string | undefined
  if (authError || !userId) return fail(401, 'Unauthorized.', 'UNAUTHORIZED')

  // cmr_access is service-role only (RLS on, no policies), so the grant is read server-side.
  const supabase = createServiceClient()
  const [grantRes, profileRes] = await Promise.all([
    supabase.from('cmr_access').select('role').eq('user_id', userId).maybeSingle(),
    supabase.from('user_profiles').select('display_name, is_active').eq('id', userId).maybeSingle(),
  ])

  // Fail CLOSED on any read error — never fall through to "allowed".
  if (grantRes.error || profileRes.error) return fail(500, 'Could not verify Cash Ledger access.', 'INTERNAL_ERROR')

  const grant = grantRes.data as { role: unknown } | null
  if (!grant || !isCmrRole(grant.role)) {
    return fail(403, 'You do not have access to Cash Ledger.', 'FORBIDDEN')
  }

  const profile = profileRes.data as { display_name: string | null; is_active: boolean | null } | null
  if (!profile || profile.is_active === false) {
    return fail(403, 'You do not have access to Cash Ledger.', 'FORBIDDEN')
  }

  return { ok: true, userId, role: grant.role, displayName: profile.display_name ?? '' }
}

const forbidden = (error: string) =>
  NextResponse.json({ success: false, error, code: 'FORBIDDEN' }, { status: 403 })

/** Any CMR role (controller, requester, viewer) — read access. */
export function guardCmr(access: { role: CmrRole }): NextResponse | null {
  return isCmrRole(access.role) ? null : forbidden('You do not have access to Cash Ledger.')
}

/** Controller only — every write except a Requester's vendor request, and access management. */
export function guardCmrController(access: { role: CmrRole }): NextResponse | null {
  return access.role === 'controller' ? null : forbidden('Only a Cash Ledger Controller can do this.')
}

/**
 * Controller OR Requester — submitting, editing and withdrawing a vendor request, the ONLY
 * write a non-Controller can make anywhere in Cash Ledger. A Viewer is read-only and is
 * refused here.
 *
 * This guard is about the KIND of write, not about whose row it is. A Requester may only touch
 * their OWN request and only while it is still queued; the route enforces that ownership /
 * status check separately, after this guard. Placing and declining stay guardCmrController.
 */
export function guardCmrCanRequest(access: { role: CmrRole }): NextResponse | null {
  return access.role === 'controller' || access.role === 'requester'
    ? null
    : forbidden('Only a Cash Ledger Controller or Requester can submit vendor requests.')
}
