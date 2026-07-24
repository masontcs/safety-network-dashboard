import { NextResponse } from 'next/server'
import { createServerClient, createServiceClient } from '@/lib/supabase/server'

/**
 * Customer-portal access context.
 *
 * Portal users are EXTERNAL auth users with no user_profiles row. The session is read
 * with the anon client (getUser validates the token server-side), then the portal
 * account is resolved with the service client. EVERY downstream query must scope to
 * `customerId` / `profileIds` returned here — those come from the account row, never
 * from the request, so one customer can never address another's data.
 */

export interface PortalContext {
  accountId: string
  customerId: string
  customerName: string
  email: string
  name: string | null
  role: 'owner' | 'member'
  /** Profile ids for this customer that are opted into the portal. Scope reads to these. */
  profileIds: string[]
  profiles: { id: string; name: string; code: string }[]
}

export type PortalResult =
  | { ok: true; ctx: PortalContext }
  | { ok: false; response: NextResponse }

function deny(status = 401, error = 'Not signed in to the portal.') {
  return NextResponse.json({ success: false, error, code: 'PORTAL_UNAUTHORIZED' }, { status })
}

export async function getPortalContext(): Promise<PortalResult> {
  const supabase = createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, response: deny() }

  const svc = createServiceClient()

  // Link-on-first-login: a provisioned account may have a null auth_user_id until the
  // person authenticates. Match by auth_user_id first, else by verified email, and
  // stamp the id so subsequent lookups are direct.
  let { data: acct } = await svc
    .from('billing_portal_accounts')
    .select('id, customer_id, email, name, role, is_active, auth_user_id')
    .eq('auth_user_id', user.id)
    .eq('is_active', true)
    .maybeSingle()

  if (!acct && user.email) {
    const { data: byEmail } = await svc
      .from('billing_portal_accounts')
      .select('id, customer_id, email, name, role, is_active, auth_user_id')
      .ilike('email', user.email)
      .eq('is_active', true)
      .is('auth_user_id', null)
      .maybeSingle()
    if (byEmail) {
      await svc.from('billing_portal_accounts')
        .update({ auth_user_id: user.id, last_login_at: new Date().toISOString() })
        .eq('id', byEmail.id)
      acct = { ...byEmail, auth_user_id: user.id }
    }
  }

  if (!acct) return { ok: false, response: deny(403, 'No portal access for this account.') }

  const [{ data: cust }, { data: profs }] = await Promise.all([
    svc.from('billing_customers').select('name').eq('id', acct.customer_id).maybeSingle(),
    svc.from('billing_profiles')
      .select('id, name, code')
      .eq('customer_id', acct.customer_id)
      .eq('portal_enabled', true)
      .eq('is_active', true)
      .order('name'),
  ])

  const profiles = (profs ?? []) as { id: string; name: string; code: string }[]
  return {
    ok: true,
    ctx: {
      accountId: acct.id,
      customerId: acct.customer_id,
      customerName: cust?.name ?? 'Your account',
      email: acct.email,
      name: acct.name,
      role: acct.role,
      profileIds: profiles.map((p) => p.id),
      profiles,
    },
  }
}
