import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { fakeSupabase } from '@/lib/cmr/__testing__/fakeSupabase'

/**
 * Middleware gate for SN Cash Ledger: the cmr. host requires a session, and every /cmr path
 * (except /cmr/no-access) requires a cmr_access grant — platform admins included.
 */

const state = vi.hoisted(() => ({
  user: null as null | { id: string },
  profile: null as null | Record<string, unknown>,
  service: null as unknown,
}))

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    from: () => ({
      select: () => ({ eq: () => ({ single: async () => ({ data: state.profile, error: null }) }) }),
    }),
  }),
}))
vi.mock('@supabase/supabase-js', () => ({ createClient: () => state.service }))

import { middleware } from './middleware'

const ADMIN = '00000000-0000-4000-8000-00000000a0a0'
const adminProfile = { role: 'admin', must_change_password: false, field_access: false, billing_role: null }

const hit = (url: string) => middleware(new NextRequest(url, { headers: { host: new URL(url).host } }))
const loc = (res: Response) => res.headers.get('location')

function signedIn(grants: { user_id: string; role: string }[]) {
  state.user = { id: ADMIN }
  state.profile = adminProfile
  state.service = fakeSupabase({ cmr_access: grants }).client
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service'
  state.user = null
  state.profile = null
  state.service = null
})
afterEach(() => { delete process.env.SUPABASE_SERVICE_ROLE_KEY })

describe('middleware — cmr. host routing', () => {
  it('cmr host root → /cmr', async () => {
    expect(loc(await hit('https://cmr.safetynetworkteams.com/'))).toBe('https://cmr.safetynetworkteams.com/cmr')
  })
  it('no session on /cmr → /login', async () => {
    expect(loc(await hit('https://cmr.safetynetworkteams.com/cmr'))).toBe('https://cmr.safetynetworkteams.com/login')
  })
  it('a dashboards path on the cmr host goes to the dashboards host', async () => {
    expect(loc(await hit('https://cmr.safetynetworkteams.com/dashboard'))).toBe('https://dashboards.safetynetworkteams.com/dashboard')
  })
  it('/cmr on another staff host goes to the cmr host', async () => {
    expect(loc(await hit('https://billing.safetynetworkteams.com/cmr/access'))).toBe('https://cmr.safetynetworkteams.com/cmr/access')
  })
  it('a signed-in user on /login of the cmr host lands on /cmr', async () => {
    signedIn([{ user_id: ADMIN, role: 'controller' }])
    expect(loc(await hit('https://cmr.safetynetworkteams.com/login'))).toBe('https://cmr.safetynetworkteams.com/cmr')
  })
})

describe('middleware — cmr grant gate (no admin inheritance)', () => {
  it('platform admin with NO grant is bounced to /cmr/no-access', async () => {
    signedIn([])
    expect(loc(await hit('https://cmr.safetynetworkteams.com/cmr'))).toBe('https://cmr.safetynetworkteams.com/cmr/no-access')
    expect(loc(await hit('https://cmr.safetynetworkteams.com/cmr/access'))).toBe('https://cmr.safetynetworkteams.com/cmr/no-access')
  })
  it('…and can see the no-access page itself (no loop)', async () => {
    signedIn([])
    expect(loc(await hit('https://cmr.safetynetworkteams.com/cmr/no-access'))).toBeNull()
  })
  it('a granted user passes (and is not role-bounced)', async () => {
    signedIn([{ user_id: ADMIN, role: 'viewer' }])
    state.profile = { ...adminProfile, role: 'tech' } // a role with no dashboard/billing prefixes
    const res = await hit('https://cmr.safetynetworkteams.com/cmr/priorities')
    expect(loc(res)).toBeNull()
  })
  it('fails closed without the service key', async () => {
    signedIn([{ user_id: ADMIN, role: 'controller' }])
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
    expect(loc(await hit('https://cmr.safetynetworkteams.com/cmr'))).toBe('https://cmr.safetynetworkteams.com/cmr/no-access')
  })
  it('fails closed when the grant read errors', async () => {
    state.user = { id: ADMIN }
    state.profile = adminProfile
    state.service = fakeSupabase({ cmr_access: [{ user_id: ADMIN, role: 'controller' }] }, { failTables: ['cmr_access'] }).client
    expect(loc(await hit('https://cmr.safetynetworkteams.com/cmr'))).toBe('https://cmr.safetynetworkteams.com/cmr/no-access')
  })
  it('an unrecognised role value in the grant is not access', async () => {
    signedIn([{ user_id: ADMIN, role: 'admin' }])
    expect(loc(await hit('https://cmr.safetynetworkteams.com/cmr'))).toBe('https://cmr.safetynetworkteams.com/cmr/no-access')
  })
  it('the gate also applies on the …vercel.app fallback host', async () => {
    signedIn([])
    expect(loc(await hit('https://safety-network-dashboard.vercel.app/cmr'))).toBe('https://safety-network-dashboard.vercel.app/cmr/no-access')
  })
})
