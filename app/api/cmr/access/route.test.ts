import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeSupabase, fakeRouteClient } from '@/lib/cmr/__testing__/fakeSupabase'

/**
 * /api/cmr/access is Controller-only on EVERY method. A platform admin with no grant, a
 * Requester and a Viewer all get 403 and cause no writes.
 */

const server = vi.hoisted(() => ({ routeClient: null as unknown, serviceClient: null as unknown }))
vi.mock('@/lib/supabase/server', () => ({
  createRouteClient: () => server.routeClient,
  createServerClient: () => server.routeClient,
  createServiceClient: () => server.serviceClient,
}))
const audit = vi.hoisted(() => ({ logAudit: vi.fn(async () => {}) }))
vi.mock('@/lib/audit/log', () => ({ logAudit: audit.logAudit, getClientIp: () => null }))

import { GET, POST, DELETE } from './route'

const ADMIN = '00000000-0000-4000-8000-00000000a0a0'
const CONTROLLER = '00000000-0000-4000-8000-00000000c0c0'
const REQUESTER = '00000000-0000-4000-8000-00000000e0e0'
const VIEWER = '00000000-0000-4000-8000-00000000f0f0'
const NEWBIE = '00000000-0000-4000-8000-00000000b0b0'
const INACTIVE = '00000000-0000-4000-8000-00000000d0d0'

type GrantSeed = { user_id: string; role: string; created_by: string | null; created_at: string }

function world(userId: string | null, grants: GrantSeed[] = [
  { user_id: CONTROLLER, role: 'controller', created_by: CONTROLLER, created_at: '2026-09-15T10:00:00Z' },
  { user_id: REQUESTER, role: 'requester', created_by: CONTROLLER, created_at: '2026-09-15T11:00:00Z' },
  { user_id: VIEWER, role: 'viewer', created_by: CONTROLLER, created_at: '2026-09-15T11:30:00Z' },
]) {
  const fake = fakeSupabase(
    {
      user_profiles: [
        { id: ADMIN, role: 'admin', display_name: 'Ada Admin', username: 'ada', is_active: true },
        { id: CONTROLLER, role: 'executive', display_name: 'Cora Controller', username: 'cora', is_active: true },
        { id: REQUESTER, role: 'executive', display_name: 'Rex Requester', username: 'rex', is_active: true },
        { id: VIEWER, role: 'sales', display_name: 'Vi Viewer', username: 'vi', is_active: true },
        { id: NEWBIE, role: 'sales', display_name: 'Nell New', username: 'nell', is_active: true },
        { id: INACTIVE, role: 'sales', display_name: 'Old Timer', username: 'old', is_active: false },
      ],
      cmr_access: grants,
    },
    { authUsers: [{ id: CONTROLLER, email: 'cora@example.com' }, { id: NEWBIE, email: 'nell@example.com' }] },
  )
  server.routeClient = fakeRouteClient(userId)
  server.serviceClient = fake.client
  return fake
}

const req = (method: string, body?: unknown, qs = '') =>
  new Request(`https://cmr.safetynetworkteams.com/api/cmr/access${qs}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

const writes = (fake: ReturnType<typeof world>) => fake.calls.filter((c) => c.op !== 'select')

beforeEach(() => { audit.logAudit.mockClear() })

describe('/api/cmr/access — denied callers (403, no writes)', () => {
  const cases: [string, string][] = [
    ['platform admin with NO grant', ADMIN],
    ['requester', REQUESTER],
    ['viewer', VIEWER],
  ]
  for (const [label, uid] of cases) {
    it(`${label}: GET / POST / DELETE all 403`, async () => {
      const fake = world(uid)
      const g = await GET()
      const p = await POST(req('POST', { userId: uid, role: 'controller' }))
      const d = await DELETE(req('DELETE', undefined, `?userId=${CONTROLLER}`))
      expect([g.status, p.status, d.status]).toEqual([403, 403, 403])
      expect((await p.json()).code).toBe('FORBIDDEN')
      expect(writes(fake)).toHaveLength(0)
      expect(fake.tables.cmr_access.find((r) => r.user_id === uid)?.role ?? null).not.toBe('controller')
      expect(audit.logAudit).not.toHaveBeenCalled()
    })
  }

  it('no session: 401 on every method', async () => {
    world(null)
    expect((await GET()).status).toBe(401)
    expect((await POST(req('POST', { userId: NEWBIE, role: 'viewer' }))).status).toBe(401)
    expect((await DELETE(req('DELETE', undefined, `?userId=${VIEWER}`))).status).toBe(401)
  })
})

describe('/api/cmr/access — controller', () => {
  it('GET lists grants (with names/emails) and only active, ungranted candidates', async () => {
    world(CONTROLLER)
    const res = await GET()
    expect(res.status).toBe(200)
    const { data } = await res.json()
    expect(data.grants.map((g: { userId: string }) => g.userId)).toEqual([CONTROLLER, REQUESTER, VIEWER])
    expect(data.grants[0]).toMatchObject({ displayName: 'Cora Controller', email: 'cora@example.com', role: 'controller', createdByName: 'Cora Controller' })
    const ids = data.candidates.map((c: { id: string }) => c.id)
    expect(ids).toEqual(expect.arrayContaining([ADMIN, NEWBIE]))
    expect(ids).not.toContain(CONTROLLER)
    expect(ids).not.toContain(INACTIVE)
  })

  it('POST grants a new user and records created_by', async () => {
    const fake = world(CONTROLLER)
    const res = await POST(req('POST', { userId: NEWBIE, role: 'requester' }))
    expect(res.status).toBe(201)
    expect(fake.tables.cmr_access.find((r) => r.user_id === NEWBIE)).toMatchObject({ role: 'requester', created_by: CONTROLLER })
    expect(audit.logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'cmr.access.grant', resourceId: NEWBIE }))
  })

  it('POST changes an existing role', async () => {
    const fake = world(CONTROLLER)
    const res = await POST(req('POST', { userId: VIEWER, role: 'requester' }))
    expect(res.status).toBe(200)
    expect(fake.tables.cmr_access.find((r) => r.user_id === VIEWER)?.role).toBe('requester')
    expect(audit.logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'cmr.access.update' }))
  })

  it('POST validates input', async () => {
    const fake = world(CONTROLLER)
    expect((await POST(req('POST', { userId: NEWBIE, role: 'admin' }))).status).toBe(400)
    expect((await POST(req('POST', { userId: 'not-a-uuid', role: 'viewer' }))).status).toBe(400)
    expect((await POST(req('POST', { userId: '00000000-0000-4000-8000-000000000999', role: 'viewer' }))).status).toBe(404)
    expect((await POST(req('POST', { userId: INACTIVE, role: 'viewer' }))).status).toBe(400)
    expect(writes(fake)).toHaveLength(0)
  })

  it('refuses to demote or remove the LAST controller (409)', async () => {
    const fake = world(CONTROLLER)
    expect((await POST(req('POST', { userId: CONTROLLER, role: 'viewer' }))).status).toBe(409)
    expect((await DELETE(req('DELETE', undefined, `?userId=${CONTROLLER}`))).status).toBe(409)
    expect(writes(fake)).toHaveLength(0)
  })

  it('allows removing a controller when another controller remains', async () => {
    const fake = world(CONTROLLER, [
      { user_id: CONTROLLER, role: 'controller', created_by: null, created_at: '2026-09-15T10:00:00Z' },
      { user_id: ADMIN, role: 'controller', created_by: CONTROLLER, created_at: '2026-09-15T10:05:00Z' },
    ])
    const res = await DELETE(req('DELETE', undefined, `?userId=${ADMIN}`))
    expect(res.status).toBe(200)
    expect(fake.tables.cmr_access.map((r) => r.user_id)).toEqual([CONTROLLER])
  })

  it('DELETE revokes a grant', async () => {
    const fake = world(CONTROLLER)
    const res = await DELETE(req('DELETE', undefined, `?userId=${REQUESTER}`))
    expect(res.status).toBe(200)
    expect(fake.tables.cmr_access.some((r) => r.user_id === REQUESTER)).toBe(false)
    expect(audit.logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'cmr.access.revoke', resourceId: REQUESTER }))
    expect((await DELETE(req('DELETE', undefined, `?userId=${REQUESTER}`))).status).toBe(404)
  })
})
