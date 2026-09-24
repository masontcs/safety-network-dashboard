import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * The two public legal pages (/privacy, /terms) must render for ANY request — no session, any
 * host — because they are the privacy-policy and EULA URLs on the company's QuickBooks Online
 * developer app and Intuit fetches them anonymously.
 *
 * Two independent guarantees are asserted here:
 *   1. the middleware `config.matcher` allow-list does not catch either path, so the middleware
 *      never runs on them in production; and
 *   2. even when the middleware IS invoked on them, it short-circuits before any auth check.
 */

const state = vi.hoisted(() => ({
  user: null as null | { id: string },
  profile: null as null | Record<string, unknown>,
}))

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    from: () => ({
      select: () => ({ eq: () => ({ single: async () => ({ data: state.profile, error: null }) }) }),
    }),
  }),
}))
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({}) }))

import { middleware, config } from './middleware'

const LEGAL_PATHS = ['/privacy', '/terms']
const HOSTS = [
  'https://dashboards.safetynetworkteams.com',
  'https://billing.safetynetworkteams.com',
  'https://cmr.safetynetworkteams.com',
  'https://portal.safetynetworkteams.com',
  'https://safety-network-dashboard.vercel.app',
]

const hit = (url: string) => middleware(new NextRequest(url, { headers: { host: new URL(url).host } }))
const loc = (res: Response) => res.headers.get('location')

/** Turn one Next matcher entry into a RegExp (it supports `:param*` / `:param` segments). */
function matcherRegex(entry: string): RegExp {
  const body = entry
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\/:[A-Za-z]+\*/g, '(?:/.*)?')
    .replace(/:[A-Za-z]+/g, '[^/]+')
  return new RegExp(`^${body}$`)
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service'
  state.user = null
  state.profile = null
})

describe('legal pages — the middleware matcher does not catch them', () => {
  for (const path of LEGAL_PATHS) {
    it(`${path} matches no entry in config.matcher`, () => {
      const caught = config.matcher.filter((entry) => matcherRegex(entry).test(path))
      expect(caught).toEqual([])
    })
  }

  it('the matcher regex helper is sound (it still catches the paths it should)', () => {
    const catches = (path: string) => config.matcher.some((e) => matcherRegex(e).test(path))
    expect(catches('/login')).toBe(true)
    expect(catches('/cmr/priorities')).toBe(true)
    expect(catches('/billing')).toBe(true)
  })
})

describe('legal pages — public even when the middleware runs', () => {
  for (const path of LEGAL_PATHS) {
    for (const origin of HOSTS) {
      it(`unauthenticated ${origin}${path} renders (no login redirect)`, async () => {
        const res = await hit(`${origin}${path}`)
        expect(loc(res)).toBeNull()
        expect(res.status).toBe(200)
      })
    }

    it(`a signed-in user on ${path} is not bounced to a role home`, async () => {
      state.user = { id: '00000000-0000-4000-8000-00000000a0a0' }
      state.profile = { role: 'admin', must_change_password: false, field_access: false, billing_role: null }
      expect(loc(await hit(`https://dashboards.safetynetworkteams.com${path}`))).toBeNull()
    })

    it(`a user forced to change their password still reaches ${path}`, async () => {
      state.user = { id: '00000000-0000-4000-8000-00000000a0a0' }
      state.profile = { role: 'admin', must_change_password: true, field_access: false, billing_role: null }
      expect(loc(await hit(`https://dashboards.safetynetworkteams.com${path}`))).toBeNull()
    })
  }

  it('a non-legal path on the dashboards host is still gated', async () => {
    expect(loc(await hit('https://dashboards.safetynetworkteams.com/dashboard')))
      .toBe('https://dashboards.safetynetworkteams.com/login')
  })
})
