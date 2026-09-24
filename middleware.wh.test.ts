import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { fakeSupabase } from '@/lib/cmr/__testing__/fakeSupabase'

/**
 * Middleware gate for Western Highways: /wh needs a session AND a wh_access row — never a role.
 *
 * WH was previously reachable by the admin/executive role through allowedPrefixesFor. That is
 * gone: '/wh' is in no role's prefixes, and this branch is what lets the granted people in. The
 * "admin with no grant" case below is the regression test for the old behaviour.
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

const USER = '00000000-0000-4000-8000-00000000a0a0'
const DASH = 'https://dashboards.safetynetworkteams.com'

const hit = (url: string) => middleware(new NextRequest(url, { headers: { host: new URL(url).host } }))
const loc = (res: Response) => res.headers.get('location')

function signedIn(role: string, grants: { user_id: string }[], opts: { failTables?: string[] } = {}) {
  state.user = { id: USER }
  state.profile = { role, must_change_password: false, field_access: false, billing_role: null }
  state.service = fakeSupabase({ wh_access: grants }, opts).client
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

describe('middleware — /wh is an explicit grant, not a role', () => {
  it('no session on /wh → /login', async () => {
    expect(loc(await hit(`${DASH}/wh`))).toBe(`${DASH}/login`)
  })

  it('a platform ADMIN with no grant is bounced to their home', async () => {
    signedIn('admin', [])
    expect(loc(await hit(`${DASH}/wh`))).toBe(`${DASH}/dashboard`)
    expect(loc(await hit(`${DASH}/wh/ar`))).toBe(`${DASH}/dashboard`)
    expect(loc(await hit(`${DASH}/wh/import`))).toBe(`${DASH}/dashboard`)
  })

  it('an EXECUTIVE with no grant is bounced too — the role WH used to be gated on', async () => {
    signedIn('executive', [])
    expect(loc(await hit(`${DASH}/wh/ap`))).toBe(`${DASH}/dashboard`)
  })

  it('a granted user passes, whatever their role', async () => {
    for (const role of ['admin', 'executive', 'sales', 'ar_team']) {
      signedIn(role, [{ user_id: USER }])
      expect(loc(await hit(`${DASH}/wh/ar`)), `granted ${role}`).toBeNull()
    }
  })

  it('a grant does not widen anything else — /admin still needs the admin role', async () => {
    signedIn('sales', [{ user_id: USER }])
    expect(loc(await hit(`${DASH}/admin/users`))).toBe(`${DASH}/dashboard`)
  })

  it('fails closed without the service key', async () => {
    signedIn('admin', [{ user_id: USER }])
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
    expect(loc(await hit(`${DASH}/wh`))).toBe(`${DASH}/dashboard`)
  })

  it('fails closed when the grant read errors', async () => {
    signedIn('admin', [{ user_id: USER }], { failTables: ['wh_access'] })
    expect(loc(await hit(`${DASH}/wh`))).toBe(`${DASH}/dashboard`)
  })

  it('a granted user whose role home is not /dashboard still reaches /wh', async () => {
    signedIn('ar_manager', [{ user_id: USER }])
    expect(loc(await hit(`${DASH}/wh/ar`))).toBeNull()
    // …and without the grant they go to /ar, their own home, not /dashboard.
    signedIn('ar_manager', [])
    expect(loc(await hit(`${DASH}/wh/ar`))).toBe(`${DASH}/ar`)
  })
})
