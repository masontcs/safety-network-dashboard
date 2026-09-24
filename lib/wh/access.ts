import { NextResponse } from 'next/server'
import { redirect } from 'next/navigation'
import { createRouteClient, createServerClient, createServiceClient } from '@/lib/supabase/server'
import type { Role } from '@/lib/supabase/database.types'

/**
 * Who may reach Western Highways — the gate for every /wh page and every /api/wh route.
 *
 * EXPLICIT GRANT ONLY. WH access is "there is a wh_access row for this user", and nothing else.
 * user_profiles.role is never consulted: a platform admin or an executive with no wh_access row
 * is DENIED, exactly like anyone else. This replaces the original admin/executive role gate,
 * which handed the section to all six people who held one of those roles.
 *
 * It is the CMR model (lib/api/cmr.ts) applied to WH, with one simplification: WH has no roles
 * within the grant — a row grants reading AND uploading. Managing the list is a separate,
 * admin-only screen (/admin/wh-access, app/api/wh/access) and is NOT implied by having a row
 * here; conversely an admin manages the list whether or not they are on it.
 *
 * Every path FAILS CLOSED: no session, no row, or a read error all mean no access. The three
 * independent gates are the middleware's /wh branch, the /wh layout (and each page), and each
 * /api/wh route — none of them trusts the others.
 *
 * NOTE: wh_access is service-role only (RLS on, no policies), so the grant is always read with
 * the service client, server-side. It is not in the generated database types yet, hence the
 * narrow casts — the same pattern the WH import routes use for wh_ar_* / wh_ap_*.
 */

export interface WhAccess {
  userId: string
  /** The platform role, carried for audit entries and for admin-only checks — NEVER for the gate. */
  role: Role
  displayName: string
}

export type WhContext =
  | ({ ok: true } & WhAccess)
  | { ok: false; status: 401 | 403 | 500; response: NextResponse }

const fail = (status: 401 | 403 | 500, error: string, code: string): WhContext => ({
  ok: false,
  status,
  response: NextResponse.json({ success: false, error, code }, { status }),
})

/**
 * Is there a wh_access row for this user? The raw grant check, for callers that only need the
 * boolean (the middleware has its own copy because it cannot import server-only helpers; the
 * dashboard shell uses this one to decide whether the nav item exists at all).
 *
 * Fails CLOSED: any error is "no".
 */
export async function hasWhGrant(userId: string): Promise<boolean> {
  try {
    const supabase = createServiceClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
      .from('wh_access')
      .select('user_id')
      .eq('user_id', userId)
      .maybeSingle()
    if (error) {
      console.error('WH grant read failed:', error)
      return false
    }
    return !!data
  } catch (err) {
    console.error('WH grant read threw:', err)
    return false
  }
}

/**
 * The gate for /api/wh/* routes: session → grant → active profile. Returns the caller on
 * success, or the response to return as-is.
 *
 *   no session            → 401 UNAUTHORIZED
 *   no wh_access row      → 403 FORBIDDEN   (admins and executives included)
 *   deactivated profile   → 403 FORBIDDEN
 *   grant/profile unread  → 500 INTERNAL_ERROR (fail closed — never "allowed")
 */
export async function getWhContext(): Promise<WhContext> {
  // getClaims() verifies the session JWT locally with the project's asymmetric signing keys —
  // the same door getAccessContext and getCmrContext use.
  const routeClient = createRouteClient()
  const { data: claimsData, error: authError } = await routeClient.auth.getClaims()
  const userId = claimsData?.claims?.sub as string | undefined
  if (authError || !userId) return fail(401, 'Unauthorized.', 'UNAUTHORIZED')

  const supabase = createServiceClient()
  const [grantRes, profileRes] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).from('wh_access').select('user_id').eq('user_id', userId).maybeSingle(),
    supabase.from('user_profiles').select('role, display_name, is_active').eq('id', userId).maybeSingle(),
  ])

  // Fail CLOSED on any read error — never fall through to "allowed".
  if (grantRes.error || profileRes.error) {
    return fail(500, 'Could not verify Western Highways access.', 'INTERNAL_ERROR')
  }

  if (!grantRes.data) return fail(403, 'You do not have access to Western Highways.', 'FORBIDDEN')

  const profile = profileRes.data as { role: Role; display_name: string | null; is_active: boolean | null } | null
  if (!profile || profile.is_active === false) {
    return fail(403, 'You do not have access to Western Highways.', 'FORBIDDEN')
  }

  return { ok: true, userId, role: profile.role, displayName: profile.display_name ?? '' }
}

export type WhPageContext =
  | { ok: true; userId: string; role: Role; displayName: string }
  | { ok: false; reason: 'no-session' | 'no-access' }

/**
 * The same gate for a server component. Pages redirect rather than render a 403: a signed-in
 * user without the grant goes to their own home, which does not confirm that the section
 * exists — the posture the /wh layout already had, and what the middleware does too.
 * Use with `whPageRedirect` (below) so every page bounces the same way.
 */
export async function getWhPageContext(): Promise<WhPageContext> {
  const supabase = createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, reason: 'no-session' }

  const svc = createServiceClient()
  const [grantRes, profileRes] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (svc as any).from('wh_access').select('user_id').eq('user_id', user.id).maybeSingle(),
    svc.from('user_profiles').select('role, display_name, is_active').eq('id', user.id).maybeSingle(),
  ])

  if (grantRes.error || profileRes.error) return { ok: false, reason: 'no-access' } // fail closed
  if (!grantRes.data) return { ok: false, reason: 'no-access' }

  const profile = profileRes.data as { role: Role; display_name: string | null; is_active: boolean | null } | null
  if (!profile || profile.is_active === false) return { ok: false, reason: 'no-access' }

  return { ok: true, userId: user.id, role: profile.role, displayName: profile.display_name ?? '' }
}

/** Where a page sends someone the WH gate turned away. Never returns. */
export function whPageRedirect(reason: 'no-session' | 'no-access'): never {
  redirect(reason === 'no-session' ? '/login' : '/dashboard')
}
