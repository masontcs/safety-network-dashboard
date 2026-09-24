import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeSupabase, fakeRouteClient } from '@/lib/cmr/__testing__/fakeSupabase'

/**
 * /api/wh/access — managing the Western Highways allow-list is ADMIN ONLY on every method.
 *
 * The two rules that pull in opposite directions, both asserted here:
 *   • a WH GRANT does not let you manage the list — a granted executive gets 403;
 *   • being an ADMIN does let you manage it even with no grant of your own, so an admin can
 *     never lock themselves out of administering WH.
 */

const server = vi.hoisted(() => ({ routeClient: null as unknown, serviceClient: null as unknown }))
vi.mock('@/lib/supabase/server', () => ({
  createRouteClient: () => server.routeClient,
  createServerClient: () => server.routeClient,
  createServiceClient: () => server.serviceClient,
}))
const audit = vi.hoisted(() => ({ logAudit: vi.fn(async (_p: unknown) => {}) }))
vi.mock('@/lib/audit/log', () => ({ logAudit: audit.logAudit, getClientIp: () => null }))

import * as route from './route'
import { GET, POST, DELETE } from './route'

const ADMIN = '00000000-0000-4000-8000-0000000000a1'
const MASON = '00000000-0000-4000-8000-00000000ff01'
const JORDAN = '00000000-0000-4000-8000-00000000ff02'
const RUSS = '00000000-0000-4000-8000-00000000ff03'
const PAULA = '00000000-0000-4000-8000-00000000ff04'
const EXEC_OFF_LIST = '00000000-0000-4000-8000-0000000000e1'
const SALES = '00000000-0000-4000-8000-0000000000b1'
const INACTIVE = '00000000-0000-4000-8000-0000000000d1'

const SEEDED = [MASON, JORDAN, RUSS, PAULA]

function world(userId: string | null, grants: string[] = SEEDED) {
  const fake = fakeSupabase(
    {
      user_profiles: [
        { id: ADMIN, role: 'admin', display_name: 'Ada Admin', username: 'ada', is_active: true, billing_role: null, qb_export_enabled: false, qb_config_enabled: false },
        { id: MASON, role: 'admin', display_name: 'Mason Doty', username: 'mason', is_active: true, billing_role: null, qb_export_enabled: false, qb_config_enabled: false },
        { id: JORDAN, role: 'executive', display_name: 'Jordan Johnson', username: 'jordan', is_active: true, billing_role: null, qb_export_enabled: false, qb_config_enabled: false },
        { id: RUSS, role: 'executive', display_name: 'Russ Johnson', username: 'russ', is_active: true, billing_role: null, qb_export_enabled: false, qb_config_enabled: false },
        { id: PAULA, role: 'executive', display_name: 'Paula Lofgren', username: 'paula', is_active: true, billing_role: null, qb_export_enabled: false, qb_config_enabled: false },
        { id: EXEC_OFF_LIST, role: 'executive', display_name: 'Eve Exec', username: 'eve', is_active: true, billing_role: null, qb_export_enabled: false, qb_config_enabled: false },
        { id: SALES, role: 'sales', display_name: 'Sal Sales', username: 'sal', is_active: true, billing_role: null, qb_export_enabled: false, qb_config_enabled: false },
        { id: INACTIVE, role: 'executive', display_name: 'Old Timer', username: 'old', is_active: false, billing_role: null, qb_export_enabled: false, qb_config_enabled: false },
      ],
      user_branch_assignments: [{ user_id: SALES, branch_id: 'b1' }],
      wh_access: grants.map((id, i) => ({ user_id: id, granted_by: MASON, granted_at: `2026-09-24T1${i}:00:00Z` })),
    },
  )
  server.routeClient = fakeRouteClient(userId)
  server.serviceClient = fake.client
  return fake
}

const req = (method: string, body?: unknown, qs = '') =>
  new Request(`https://dashboards.safetynetworkteams.com/api/wh/access${qs}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

const writes = (fake: ReturnType<typeof world>) => fake.calls.filter((c) => c.op !== 'select')

beforeEach(() => { audit.logAudit.mockClear() })

describe('/api/wh/access — only an admin may manage the list', () => {
  const denied: [string, string][] = [
    ['an executive ON the WH allow-list', JORDAN],
    ['an executive off it', EXEC_OFF_LIST],
    ['a sales user', SALES],
  ]
  for (const [label, uid] of denied) {
    it(`${label}: GET / POST / DELETE all 403, nothing written, nothing audited`, async () => {
      const fake = world(uid)
      const g = await GET()
      const p = await POST(req('POST', { userId: SALES }))
      const d = await DELETE(req('DELETE', undefined, `?userId=${JORDAN}`))
      expect([g.status, p.status, d.status]).toEqual([403, 403, 403])
      expect((await p.json()).code).toBe('FORBIDDEN')
      expect(writes(fake)).toHaveLength(0)
      expect(fake.tables.wh_access.map((r) => r.user_id).sort()).toEqual([...SEEDED].sort())
      expect(audit.logAudit).not.toHaveBeenCalled()
    })
  }

  it('no session: 401 on every method', async () => {
    const fake = world(null)
    expect((await GET()).status).toBe(401)
    expect((await POST(req('POST', { userId: SALES }))).status).toBe(401)
    expect((await DELETE(req('DELETE', undefined, `?userId=${JORDAN}`))).status).toBe(401)
    expect(writes(fake)).toHaveLength(0)
  })

  it('an admin with NO WH grant of their own still manages the list', async () => {
    const fake = world(ADMIN, SEEDED) // ADMIN is deliberately not in wh_access
    expect(fake.tables.wh_access.some((r) => r.user_id === ADMIN)).toBe(false)
    expect((await GET()).status).toBe(200)
    expect((await POST(req('POST', { userId: SALES }))).status).toBe(201)
  })
})

describe('/api/wh/access — the admin screen', () => {
  it('GET lists the allow-list with names and who granted it, plus addable candidates', async () => {
    world(ADMIN)
    const res = await GET()
    expect(res.status).toBe(200)
    const { data } = await res.json()
    expect(data.grants.map((g: { displayName: string }) => g.displayName))
      .toEqual(['Mason Doty', 'Jordan Johnson', 'Russ Johnson', 'Paula Lofgren'])
    expect(data.grants[0]).toMatchObject({ userId: MASON, role: 'admin', isActive: true, grantedByName: 'Mason Doty' })
    const ids = data.candidates.map((c: { id: string }) => c.id)
    expect(ids).toEqual(expect.arrayContaining([ADMIN, EXEC_OFF_LIST, SALES]))
    for (const seeded of SEEDED) expect(ids).not.toContain(seeded)
    expect(ids).not.toContain(INACTIVE) // deactivated users are not offered
  })

  it('the four seeded people resolve to the four grants', async () => {
    const fake = world(ADMIN)
    const names = fake.tables.wh_access
      .map((g) => fake.tables.user_profiles.find((p) => p.id === g.user_id)?.display_name)
      .sort()
    expect(names).toEqual(['Jordan Johnson', 'Mason Doty', 'Paula Lofgren', 'Russ Johnson'])
  })

  it('POST grants access, records granted_by and audits it', async () => {
    const fake = world(ADMIN)
    const res = await POST(req('POST', { userId: SALES }))
    expect(res.status).toBe(201)
    expect(fake.tables.wh_access.find((r) => r.user_id === SALES)).toMatchObject({ granted_by: ADMIN })
    expect(audit.logAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'wh.access.grant', resourceId: SALES, resourceType: 'wh_access', resourceLabel: 'Sal Sales',
    }))
  })

  it('POST on someone already listed changes nothing and audits nothing', async () => {
    const fake = world(ADMIN)
    const res = await POST(req('POST', { userId: RUSS }))
    expect(res.status).toBe(200)
    expect((await res.json()).data.changed).toBe(false)
    expect(writes(fake)).toHaveLength(0)
    expect(audit.logAudit).not.toHaveBeenCalled()
  })

  it('POST validates its input and writes nothing', async () => {
    const fake = world(ADMIN)
    expect((await POST(req('POST', { userId: 'not-a-uuid' }))).status).toBe(400)
    expect((await POST(req('POST', {}))).status).toBe(400)
    expect((await POST(req('POST', { userId: '00000000-0000-4000-8000-000000000999' }))).status).toBe(404)
    expect((await POST(req('POST', { userId: INACTIVE }))).status).toBe(400)
    expect(writes(fake)).toHaveLength(0)
  })

  it('DELETE revokes, audits, and 404s the second time', async () => {
    const fake = world(ADMIN)
    const res = await DELETE(req('DELETE', undefined, `?userId=${PAULA}`))
    expect(res.status).toBe(200)
    expect(fake.tables.wh_access.some((r) => r.user_id === PAULA)).toBe(false)
    expect(audit.logAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'wh.access.revoke', resourceId: PAULA, resourceLabel: 'Paula Lofgren',
    }))
    expect((await DELETE(req('DELETE', undefined, `?userId=${PAULA}`))).status).toBe(404)
  })

  it('an admin may remove their own grant — there is no last-controller rule here', async () => {
    const fake = world(MASON, SEEDED)
    expect((await DELETE(req('DELETE', undefined, `?userId=${MASON}`))).status).toBe(200)
    expect(fake.tables.wh_access.some((r) => r.user_id === MASON)).toBe(false)
  })

  it('route file exports only HTTP handlers + dynamic (BUG-019)', () => {
    const allowed = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'dynamic'])
    for (const k of Object.keys(route)) expect(allowed.has(k), k).toBe(true)
    expect(Object.keys(route).sort()).toEqual(['DELETE', 'GET', 'POST', 'dynamic'])
    expect((route as { dynamic?: string }).dynamic).toBe('force-dynamic')
  })
})
