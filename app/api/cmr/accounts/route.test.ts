import { describe, it, expect, vi, beforeEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import { fakeSupabase, fakeRouteClient } from '@/lib/cmr/__testing__/fakeSupabase'

/**
 * /api/cmr/accounts (+ /reorder) access rules and behaviour.
 *   • no grant (platform admin included) → 403 on EVERY method, incl. GET
 *   • requester / viewer → GET 200; POST / PATCH / reorder 403 with no writes and no audit
 *   • controller → create / rename / retype / deactivate / reactivate / reorder, each audited
 *   • there is no DELETE handler at all (accounts are deactivated, never deleted)
 */

const server = vi.hoisted(() => ({ routeClient: null as unknown, serviceClient: null as unknown }))
vi.mock('@/lib/supabase/server', () => ({
  createRouteClient: () => server.routeClient,
  createServerClient: () => server.routeClient,
  createServiceClient: () => server.serviceClient,
}))
const audit = vi.hoisted(() => ({ logAudit: vi.fn(async (_p: unknown) => {}) }))
vi.mock('@/lib/audit/log', () => ({ logAudit: audit.logAudit, getClientIp: () => null }))

import * as accountsRoute from './route'
import * as reorderRoute from './reorder/route'
const { GET, POST, PATCH } = accountsRoute
const REORDER = reorderRoute.POST

const ADMIN = '00000000-0000-4000-8000-00000000a0a0'
const CONTROLLER = '00000000-0000-4000-8000-00000000c0c0'
const REQUESTER = '00000000-0000-4000-8000-00000000e0e0'
const VIEWER = '00000000-0000-4000-8000-00000000f0f0'

const A = {
  TCS: '10000000-0000-4000-8000-000000000001',
  SIGNS: '10000000-0000-4000-8000-000000000002',
  STS: '10000000-0000-4000-8000-000000000003',
  OLD: '10000000-0000-4000-8000-000000000004',
}

type Row = Record<string, unknown>

const seedAccounts = (): Row[] => [
  { id: A.SIGNS, name: 'Signs', account_type: null, active: true, sort_order: 1, created_by: CONTROLLER, created_at: '2026-09-15T10:00:00Z' },
  { id: A.TCS, name: 'TCS', account_type: 'Checking', active: true, sort_order: 0, created_by: CONTROLLER, created_at: '2026-09-15T10:00:00Z' },
  { id: A.OLD, name: 'Old Payroll', account_type: 'Payroll', active: false, sort_order: 3, created_by: CONTROLLER, created_at: '2026-09-15T10:00:00Z' },
  { id: A.STS, name: 'STS', account_type: null, active: true, sort_order: 2, created_by: CONTROLLER, created_at: '2026-09-15T10:00:00Z' },
]

const key = (r: Row) => String(r.name).trim().toLowerCase()

function world(userId: string | null, accounts: Row[] = seedAccounts()) {
  const fake = fakeSupabase(
    {
      user_profiles: [
        { id: ADMIN, role: 'admin', display_name: 'Ada Admin', is_active: true },
        { id: CONTROLLER, role: 'executive', display_name: 'Cora Controller', is_active: true },
        { id: REQUESTER, role: 'admin', display_name: 'Rex Requester', is_active: true },
        { id: VIEWER, role: 'sales', display_name: 'Vi Viewer', is_active: true },
      ],
      cmr_access: [
        { user_id: CONTROLLER, role: 'controller' },
        { user_id: REQUESTER, role: 'requester' },
        { user_id: VIEWER, role: 'viewer' },
      ],
      cmr_accounts: accounts,
    },
    {
      defaults: { cmr_accounts: () => ({ id: randomUUID(), active: true, sort_order: 0, account_type: null }) },
      // Mirrors cmr_accounts_active_name_uniq: lower(btrim(name)) unique WHERE active.
      unique: {
        cmr_accounts: (row, others) =>
          row.active && others.some((o) => o.active && o.id !== row.id && key(o) === key(row))
            ? 'duplicate key value violates unique constraint "cmr_accounts_active_name_uniq"'
            : null,
      },
      // Mirrors cmr_reorder_accounts(p_ids): sort_order = 0-based position.
      rpc: {
        cmr_reorder_accounts: (args, tables) => {
          const ids = args.p_ids as string[]
          ids.forEach((id, i) => {
            const r = tables.cmr_accounts.find((x) => x.id === id)
            if (r) r.sort_order = i
          })
          return null
        },
      },
    },
  )
  server.routeClient = fakeRouteClient(userId)
  server.serviceClient = fake.client
  return fake
}

const url = 'https://cmr.safetynetworkteams.com/api/cmr/accounts'
const req = (method: string, body?: unknown, path = '') =>
  new Request(url + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  })

const writes = (fake: ReturnType<typeof world>) => fake.calls.filter((c) => c.op !== 'select')
const orderOf = (fake: ReturnType<typeof world>) =>
  [...fake.tables.cmr_accounts].sort((a, b) => Number(a.sort_order) - Number(b.sort_order)).map((r) => r.name)
const auditCalls = () => audit.logAudit.mock.calls.map((c) => c[0] as { action: string; resourceId?: string; metadata?: Record<string, unknown> })

const ALL_IDS = [A.TCS, A.SIGNS, A.STS, A.OLD]

beforeEach(() => { audit.logAudit.mockClear() })

describe('/api/cmr/accounts — access', () => {
  it('has no DELETE handler (deactivate only)', () => {
    expect('DELETE' in accountsRoute).toBe(false)
    expect('DELETE' in reorderRoute).toBe(false)
  })

  it('platform admin with NO grant: 403 on GET, POST, PATCH and reorder — no writes', async () => {
    const fake = world(ADMIN)
    const statuses = [
      (await GET()).status,
      (await POST(req('POST', { name: 'New' }))).status,
      (await PATCH(req('PATCH', { id: A.TCS, active: false }))).status,
      (await REORDER(req('POST', { ids: [...ALL_IDS].reverse() }, '/reorder'))).status,
    ]
    expect(statuses).toEqual([403, 403, 403, 403])
    expect(writes(fake)).toHaveLength(0)
    expect(fake.calls.some((c) => c.table === 'cmr_accounts')).toBe(false)
    expect(audit.logAudit).not.toHaveBeenCalled()
  })

  for (const [label, uid] of [['requester', REQUESTER], ['viewer', VIEWER]] as const) {
    it(`${label}: GET 200 (read-only), POST / PATCH / reorder 403 with no writes`, async () => {
      const fake = world(uid)
      const g = await GET()
      expect(g.status).toBe(200)
      const { data } = await g.json()
      expect(data.canEdit).toBe(false)
      expect(data.accounts).toHaveLength(4)

      const p = await POST(req('POST', { name: 'Sneaky' }))
      const u = await PATCH(req('PATCH', { id: A.TCS, name: 'Hacked', active: false }))
      const r = await REORDER(req('POST', { ids: [...ALL_IDS].reverse() }, '/reorder'))
      expect([p.status, u.status, r.status]).toEqual([403, 403, 403])
      expect((await p.json()).code).toBe('FORBIDDEN')
      expect(writes(fake)).toHaveLength(0)
      expect(fake.tables.cmr_accounts.find((a) => a.id === A.TCS)).toMatchObject({ name: 'TCS', active: true })
      expect(audit.logAudit).not.toHaveBeenCalled()
    })
  }

  it('no session: 401 on every method', async () => {
    world(null)
    expect((await GET()).status).toBe(401)
    expect((await POST(req('POST', { name: 'X' }))).status).toBe(401)
    expect((await PATCH(req('PATCH', { id: A.TCS, active: false }))).status).toBe(401)
    expect((await REORDER(req('POST', { ids: ALL_IDS }, '/reorder'))).status).toBe(401)
  })
})

describe('/api/cmr/accounts — controller', () => {
  it('GET lists every account (inactive included) in sort order', async () => {
    world(CONTROLLER)
    const res = await GET()
    expect(res.status).toBe(200)
    const { data } = await res.json()
    expect(data.canEdit).toBe(true)
    expect(data.accounts.map((a: { name: string }) => a.name)).toEqual(['TCS', 'Signs', 'STS', 'Old Payroll'])
    expect(data.accounts[3]).toMatchObject({ id: A.OLD, active: false, accountType: 'Payroll', sortOrder: 3 })
  })

  it('POST creates an account at the end, trims input, records created_by, audits', async () => {
    const fake = world(CONTROLLER)
    const res = await POST(req('POST', { name: '  Holdings   LLC ', accountType: ' Operating ' }))
    expect(res.status).toBe(201)
    const { data } = await res.json()
    expect(data.account).toMatchObject({ name: 'Holdings LLC', accountType: 'Operating', active: true, sortOrder: 4 })
    const row = fake.tables.cmr_accounts.find((r) => r.name === 'Holdings LLC')
    expect(row).toMatchObject({ created_by: CONTROLLER, sort_order: 4, account_type: 'Operating' })
    expect(auditCalls()).toEqual([
      expect.objectContaining({ action: 'cmr.account.create', resourceId: row?.id, metadata: { after: expect.objectContaining({ name: 'Holdings LLC' }) } }),
    ])
  })

  it('POST with a blank type stores null', async () => {
    const fake = world(CONTROLLER)
    expect((await POST(req('POST', { name: 'JFT', accountType: '   ' }))).status).toBe(201)
    expect(fake.tables.cmr_accounts.find((r) => r.name === 'JFT')?.account_type).toBeNull()
  })

  it('POST rejects a case-insensitive duplicate of an ACTIVE account (409)', async () => {
    const fake = world(CONTROLLER)
    const res = await POST(req('POST', { name: ' tcs ' }))
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('DUPLICATE_NAME')
    expect(writes(fake)).toHaveLength(0)
    expect(audit.logAudit).not.toHaveBeenCalled()
  })

  it('POST maps a DB unique violation (race) to 409', async () => {
    const fake = world(CONTROLLER)
    // Another tab creates "INC" between our read and our insert.
    const origFrom = fake.client.from
    let raced = false
    fake.client.from = (t: string) => {
      const q = origFrom(t)
      if (t === 'cmr_accounts' && !raced) {
        const origInsert = q.insert.bind(q)
        q.insert = (row: Record<string, unknown>) => {
          raced = true
          fake.tables.cmr_accounts.push({ id: randomUUID(), name: 'INC', active: true, sort_order: 9 })
          return origInsert(row)
        }
      }
      return q
    }
    const res = await POST(req('POST', { name: 'INC' }))
    expect(res.status).toBe(409)
    expect(audit.logAudit).not.toHaveBeenCalled()
  })

  it('POST allows reusing the name of an INACTIVE account', async () => {
    const fake = world(CONTROLLER)
    expect((await POST(req('POST', { name: 'old payroll' }))).status).toBe(201)
    expect(fake.tables.cmr_accounts.filter((r) => key(r) === 'old payroll')).toHaveLength(2)
  })

  it('POST validates input', async () => {
    const fake = world(CONTROLLER)
    expect((await POST(req('POST', {}))).status).toBe(400)
    expect((await POST(req('POST', { name: '   ' }))).status).toBe(400)
    expect((await POST(req('POST', { name: 'x'.repeat(61) }))).status).toBe(400)
    expect((await POST(req('POST', { name: 'Ok', accountType: 'y'.repeat(41) }))).status).toBe(400)
    expect((await POST(req('POST', { name: 'Ok', accountType: 5 }))).status).toBe(400)
    expect((await POST(req('POST', 'not json'))).status).toBe(400)
    expect((await POST(req('POST', ['TCS']))).status).toBe(400)
    expect(writes(fake)).toHaveLength(0)
  })

  it('PATCH renames and audits before → after', async () => {
    const fake = world(CONTROLLER)
    const res = await PATCH(req('PATCH', { id: A.SIGNS, name: 'SN Signs' }))
    expect(res.status).toBe(200)
    expect((await res.json()).data).toMatchObject({ changed: true, account: { name: 'SN Signs' } })
    expect(fake.tables.cmr_accounts.find((r) => r.id === A.SIGNS)?.name).toBe('SN Signs')
    expect(auditCalls()).toEqual([
      expect.objectContaining({ action: 'cmr.account.rename', resourceId: A.SIGNS, metadata: { before: { name: 'Signs' }, after: { name: 'SN Signs' } } }),
    ])
  })

  it('PATCH may change only the letter case of its own name', async () => {
    world(CONTROLLER)
    expect((await PATCH(req('PATCH', { id: A.TCS, name: 'Tcs' }))).status).toBe(200)
  })

  it('PATCH sets and clears the type, audited as retype', async () => {
    const fake = world(CONTROLLER)
    expect((await PATCH(req('PATCH', { id: A.STS, accountType: 'Payroll' }))).status).toBe(200)
    expect(fake.tables.cmr_accounts.find((r) => r.id === A.STS)?.account_type).toBe('Payroll')
    expect((await PATCH(req('PATCH', { id: A.STS, accountType: '' }))).status).toBe(200)
    expect(fake.tables.cmr_accounts.find((r) => r.id === A.STS)?.account_type).toBeNull()
    expect(auditCalls().map((c) => [c.action, c.metadata])).toEqual([
      ['cmr.account.retype', { before: { accountType: null }, after: { accountType: 'Payroll' } }],
      ['cmr.account.retype', { before: { accountType: 'Payroll' }, after: { accountType: null } }],
    ])
  })

  it('PATCH deactivates and reactivates (row kept), each audited', async () => {
    const fake = world(CONTROLLER)
    expect((await PATCH(req('PATCH', { id: A.TCS, active: false }))).status).toBe(200)
    expect(fake.tables.cmr_accounts.find((r) => r.id === A.TCS)?.active).toBe(false)
    expect(fake.tables.cmr_accounts).toHaveLength(4)
    expect((await PATCH(req('PATCH', { id: A.TCS, active: true }))).status).toBe(200)
    expect(fake.tables.cmr_accounts.find((r) => r.id === A.TCS)?.active).toBe(true)
    expect(fake.calls.some((c) => c.op === 'delete')).toBe(false)
    expect(auditCalls().map((c) => [c.action, c.resourceId, c.metadata])).toEqual([
      ['cmr.account.deactivate', A.TCS, { before: { active: true }, after: { active: false } }],
      ['cmr.account.activate', A.TCS, { before: { active: false }, after: { active: true } }],
    ])
  })

  it('PATCH refuses to reactivate when an active account now has that name (409)', async () => {
    const fake = world(CONTROLLER)
    expect((await POST(req('POST', { name: 'OLD PAYROLL' }))).status).toBe(201)
    audit.logAudit.mockClear()
    const res = await PATCH(req('PATCH', { id: A.OLD, active: true }))
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('DUPLICATE_NAME')
    expect(fake.tables.cmr_accounts.find((r) => r.id === A.OLD)?.active).toBe(false)
    expect(audit.logAudit).not.toHaveBeenCalled()
  })

  it('PATCH refuses a rename onto another active account (409)', async () => {
    const fake = world(CONTROLLER)
    expect((await PATCH(req('PATCH', { id: A.STS, name: 'signs' }))).status).toBe(409)
    expect(fake.tables.cmr_accounts.find((r) => r.id === A.STS)?.name).toBe('STS')
  })

  it('PATCH with nothing actually different is a no-op (no write, no audit)', async () => {
    const fake = world(CONTROLLER)
    const res = await PATCH(req('PATCH', { id: A.TCS, name: 'TCS', accountType: 'Checking', active: true }))
    expect(res.status).toBe(200)
    expect((await res.json()).data.changed).toBe(false)
    expect(writes(fake)).toHaveLength(0)
    expect(audit.logAudit).not.toHaveBeenCalled()
  })

  it('PATCH validates input and 404s an unknown id', async () => {
    const fake = world(CONTROLLER)
    expect((await PATCH(req('PATCH', { id: 'nope', active: false }))).status).toBe(400)
    expect((await PATCH(req('PATCH', { id: A.TCS }))).status).toBe(400)
    expect((await PATCH(req('PATCH', { id: A.TCS, active: 'no' }))).status).toBe(400)
    expect((await PATCH(req('PATCH', { id: A.TCS, name: '' }))).status).toBe(400)
    expect((await PATCH(req('PATCH', { id: '10000000-0000-4000-8000-000000000999', active: false }))).status).toBe(404)
    expect(writes(fake)).toHaveLength(0)
  })

  it('reorder rewrites sort_order in one call and audits before → after names', async () => {
    const fake = world(CONTROLLER)
    const ids = [A.STS, A.TCS, A.OLD, A.SIGNS]
    const res = await REORDER(req('POST', { ids }, '/reorder'))
    expect(res.status).toBe(200)
    expect(orderOf(fake)).toEqual(['STS', 'TCS', 'Old Payroll', 'Signs'])
    expect(fake.calls.filter((c) => c.op === 'rpc')).toEqual([
      expect.objectContaining({ table: 'cmr_reorder_accounts', payload: { p_ids: ids } }),
    ])
    expect(auditCalls()).toEqual([
      expect.objectContaining({
        action: 'cmr.account.reorder',
        metadata: { before: ['TCS', 'Signs', 'STS', 'Old Payroll'], after: ['STS', 'TCS', 'Old Payroll', 'Signs'], ids },
      }),
    ])
    // GET reflects the new order
    const { data } = await (await GET()).json()
    expect(data.accounts.map((a: { id: string }) => a.id)).toEqual(ids)
  })

  it('reorder with the unchanged order is a no-op', async () => {
    const fake = world(CONTROLLER)
    const res = await REORDER(req('POST', { ids: ALL_IDS }, '/reorder'))
    expect(res.status).toBe(200)
    expect((await res.json()).data.changed).toBe(false)
    expect(writes(fake)).toHaveLength(0)
    expect(audit.logAudit).not.toHaveBeenCalled()
  })

  it('reorder refuses a list that is not exactly the current set (409 STALE)', async () => {
    const fake = world(CONTROLLER)
    const missing = await REORDER(req('POST', { ids: [A.TCS, A.SIGNS, A.STS] }, '/reorder'))
    expect(missing.status).toBe(409)
    expect((await missing.json()).code).toBe('STALE')
    const extra = await REORDER(req('POST', { ids: [...ALL_IDS, '10000000-0000-4000-8000-000000000999'] }, '/reorder'))
    expect(extra.status).toBe(409)
    const swapped = await REORDER(req('POST', { ids: [A.TCS, A.SIGNS, A.STS, '10000000-0000-4000-8000-000000000999'] }, '/reorder'))
    expect(swapped.status).toBe(409)
    expect(writes(fake)).toHaveLength(0)
  })

  it('reorder validates input', async () => {
    const fake = world(CONTROLLER)
    expect((await REORDER(req('POST', {}, '/reorder'))).status).toBe(400)
    expect((await REORDER(req('POST', { ids: [] }, '/reorder'))).status).toBe(400)
    expect((await REORDER(req('POST', { ids: ['x'] }, '/reorder'))).status).toBe(400)
    expect((await REORDER(req('POST', { ids: [A.TCS, A.TCS, A.STS, A.OLD] }, '/reorder'))).status).toBe(400)
    expect((await REORDER(req('POST', 'garbage', '/reorder'))).status).toBe(400)
    expect(writes(fake)).toHaveLength(0)
  })
})
