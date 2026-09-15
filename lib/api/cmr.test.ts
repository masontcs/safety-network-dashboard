import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeSupabase, fakeRouteClient } from '@/lib/cmr/__testing__/fakeSupabase'

/**
 * LOCKS THE CMR ACCESS RULE: explicit grant only, NO admin inheritance.
 * A platform admin without a cmr_access row must be denied. If a later phase adds a
 * "role === 'admin'" shortcut to getCmrContext, the first test here goes red. Don't weaken it.
 */

const server = vi.hoisted(() => ({
  routeClient: null as unknown,
  serviceClient: null as unknown,
}))
vi.mock('@/lib/supabase/server', () => ({
  createRouteClient: () => server.routeClient,
  createServerClient: () => server.routeClient,
  createServiceClient: () => server.serviceClient,
}))

import { getCmrContext, guardCmr, guardCmrController } from '@/lib/api/cmr'

const ADMIN = '00000000-0000-4000-8000-00000000a0a0'
const CONTROLLER = '00000000-0000-4000-8000-00000000c0c0'
const REQUESTER = '00000000-0000-4000-8000-00000000e0e0'
const VIEWER = '00000000-0000-4000-8000-00000000f0f0'

const profiles = [
  { id: ADMIN, role: 'admin', display_name: 'Ada Admin', is_active: true },
  { id: CONTROLLER, role: 'executive', display_name: 'Cora Controller', is_active: true },
  { id: REQUESTER, role: 'admin', display_name: 'Rex Requester', is_active: true },
  { id: VIEWER, role: 'sales', display_name: 'Vi Viewer', is_active: true },
]

function setup(userId: string | null, grants: { user_id: string; role: string }[], opts = {}) {
  const fake = fakeSupabase({ user_profiles: profiles, cmr_access: grants }, opts)
  server.routeClient = fakeRouteClient(userId)
  server.serviceClient = fake.client
  return fake
}

beforeEach(() => {
  server.routeClient = null
  server.serviceClient = null
})

describe('getCmrContext — explicit grant only (no admin inheritance)', () => {
  it('DENIES a platform admin who has no cmr_access row', async () => {
    setup(ADMIN, [{ user_id: CONTROLLER, role: 'controller' }])
    const ctx = await getCmrContext()
    expect(ctx.ok).toBe(false)
    if (ctx.ok) return
    expect(ctx.status).toBe(403)
    expect(ctx.response.status).toBe(403)
    expect((await ctx.response.json()).code).toBe('FORBIDDEN')
  })

  it('ALLOWS a user with a controller grant', async () => {
    setup(CONTROLLER, [{ user_id: CONTROLLER, role: 'controller' }])
    const ctx = await getCmrContext()
    expect(ctx).toEqual({ ok: true, userId: CONTROLLER, role: 'controller', displayName: 'Cora Controller' })
  })

  it('a platform admin with a REQUESTER grant is a requester — admin never elevates', async () => {
    setup(REQUESTER, [{ user_id: REQUESTER, role: 'requester' }])
    const ctx = await getCmrContext()
    expect(ctx.ok && ctx.role).toBe('requester')
    if (!ctx.ok) return
    expect(guardCmrController(ctx)?.status).toBe(403)
    expect(guardCmr(ctx)).toBeNull()
  })

  it('allows a viewer grant with role viewer', async () => {
    setup(VIEWER, [{ user_id: VIEWER, role: 'viewer' }])
    const ctx = await getCmrContext()
    expect(ctx.ok && ctx.role).toBe('viewer')
  })

  it('never consults user_profiles.role when deciding access', async () => {
    const fake = setup(ADMIN, [])
    await getCmrContext()
    const profileReads = fake.calls.filter((c) => c.table === 'user_profiles')
    for (const c of profileReads) expect(c.columns ?? '').not.toMatch(/\brole\b/)
  })

  it('returns 401 with no session', async () => {
    const fake = setup(null, [{ user_id: CONTROLLER, role: 'controller' }])
    const ctx = await getCmrContext()
    expect(ctx.ok).toBe(false)
    if (!ctx.ok) expect(ctx.status).toBe(401)
    expect(fake.calls).toHaveLength(0)
  })

  it('fails CLOSED when the grant read errors', async () => {
    setup(CONTROLLER, [{ user_id: CONTROLLER, role: 'controller' }], { failTables: ['cmr_access'] })
    const ctx = await getCmrContext()
    expect(ctx.ok).toBe(false)
    if (!ctx.ok) expect(ctx.status).toBe(500)
  })

  it('denies a grant with an unrecognised role value', async () => {
    setup(ADMIN, [{ user_id: ADMIN, role: 'admin' }])
    const ctx = await getCmrContext()
    expect(ctx.ok).toBe(false)
    if (!ctx.ok) expect(ctx.status).toBe(403)
  })

  it('denies a deactivated user even with a controller grant', async () => {
    const fake = fakeSupabase({
      user_profiles: [{ id: CONTROLLER, role: 'admin', display_name: 'Gone', is_active: false }],
      cmr_access: [{ user_id: CONTROLLER, role: 'controller' }],
    })
    server.routeClient = fakeRouteClient(CONTROLLER)
    server.serviceClient = fake.client
    const ctx = await getCmrContext()
    expect(ctx.ok).toBe(false)
    if (!ctx.ok) expect(ctx.status).toBe(403)
  })
})

describe('guardCmr / guardCmrController', () => {
  it('controller passes both', () => {
    expect(guardCmr({ role: 'controller' })).toBeNull()
    expect(guardCmrController({ role: 'controller' })).toBeNull()
  })
  it('requester and viewer pass read, fail controller', () => {
    for (const role of ['requester', 'viewer'] as const) {
      expect(guardCmr({ role })).toBeNull()
      expect(guardCmrController({ role })?.status).toBe(403)
    }
  })
  it('anything else fails both', () => {
    const role = 'admin' as unknown as 'viewer'
    expect(guardCmr({ role })?.status).toBe(403)
    expect(guardCmrController({ role })?.status).toBe(403)
  })
})
