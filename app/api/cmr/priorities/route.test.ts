import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import { fakeSupabase, fakeRouteClient } from '@/lib/cmr/__testing__/fakeSupabase'

/**
 * /api/cmr/priorities (+ /reorder) — access rules and behaviour.
 *   • no grant (platform admin included) → 403 on EVERY method, incl. GET; nothing read
 *   • requester / viewer → GET 200 (canEdit false); every write 403, no writes, no audit
 *   • no session → 401 everywhere
 *   • week math: ?week= any day → that Sunday; default = this week (Pacific); weeks are isolated
 *   • totals: needed = Σ open, paid/resolved, total, counts — zero-amount tasks included
 *   • controller → create (with / without amount), edit, flag, resolve, pay (stamps paid_at /
 *     paid_by), reopen (clears them), delete, reorder — each audited with before → after
 *   • status 'carried' is refused; carried rows are locked
 */

const server = vi.hoisted(() => ({ routeClient: null as unknown, serviceClient: null as unknown }))
vi.mock('@/lib/supabase/server', () => ({
  createRouteClient: () => server.routeClient,
  createServerClient: () => server.routeClient,
  createServiceClient: () => server.serviceClient,
}))
const audit = vi.hoisted(() => ({ logAudit: vi.fn(async (_p: unknown) => {}) }))
vi.mock('@/lib/audit/log', () => ({ logAudit: audit.logAudit, getClientIp: () => null }))
// Wednesday Sep 16 2026 (Pacific) → this week starts Sunday Sep 13.
vi.mock('@/lib/utils/date', async (orig) => ({
  ...(await orig<typeof import('@/lib/utils/date')>()),
  pacificToday: () => '2026-09-16',
}))

import * as route from './route'
import * as reorderRoute from './reorder/route'

const ADMIN = '00000000-0000-4000-8000-00000000a0a0'
const CONTROLLER = '00000000-0000-4000-8000-00000000c0c0'
const REQUESTER = '00000000-0000-4000-8000-00000000e0e0'
const VIEWER = '00000000-0000-4000-8000-00000000f0f0'
const STRANGER = '00000000-0000-4000-8000-00000000d0d0'

const W = { THIS: '2026-09-13', NEXT: '2026-09-20', PREV: '2026-09-06' }
const P = {
  CDTFA: '60000000-0000-4000-8000-000000000001',
  LOAN: '60000000-0000-4000-8000-000000000002',
  CALL: '60000000-0000-4000-8000-000000000003',
  PAID: '60000000-0000-4000-8000-000000000004',
  DONE: '60000000-0000-4000-8000-000000000005',
  NEXTWK: '60000000-0000-4000-8000-000000000006',
  CARRIED: '60000000-0000-4000-8000-000000000007',
}

type Row = Record<string, unknown>

const pr = (over: Row): Row => ({
  week_start: W.THIS,
  amount_cents: 0,
  due_date: null,
  notes: null,
  is_top_priority: false,
  status: 'open',
  carried_from_id: null,
  paid_at: null,
  paid_by: null,
  sort_order: 0,
  created_by: CONTROLLER,
  created_at: '2026-09-14T15:00:00Z',
  ...over,
})

function seed(): Record<string, Row[]> {
  return {
    cmr_weekly_priorities: [
      pr({ id: P.LOAN, description: 'Equipment loan — Wells Fargo', amount_cents: 3_200_000, due_date: '2026-09-19', sort_order: 1 }),
      pr({ id: P.CDTFA, description: 'CDTFA sales tax', amount_cents: 6_450_000, due_date: '2026-09-17', is_top_priority: true, sort_order: 0 }),
      pr({ id: P.CALL, description: 'Call Sunbelt about the credit hold', amount_cents: 0, is_top_priority: true, sort_order: 2, notes: 'Ask for Dana' }),
      pr({ id: P.PAID, description: 'Fuel card', amount_cents: 1_000_000, status: 'paid', paid_at: '2026-09-15T16:02:00Z', paid_by: CONTROLLER, sort_order: 3 }),
      pr({ id: P.DONE, description: 'Insurance audit', amount_cents: 250_000, status: 'resolved', sort_order: 4 }),
      pr({ id: P.NEXTWK, week_start: W.NEXT, description: 'Next week only', amount_cents: 777, sort_order: 0 }),
      pr({ id: P.CARRIED, week_start: W.PREV, description: 'Carried last week', amount_cents: 500, status: 'carried', sort_order: 0 }),
    ],
  }
}

function world(userId: string | null, tables: Record<string, Row[]> = seed(), opts: { failTables?: string[] } = {}) {
  const fake = fakeSupabase(
    {
      user_profiles: [
        { id: ADMIN, role: 'admin', display_name: 'Ada Admin', is_active: true },
        { id: CONTROLLER, role: 'executive', display_name: 'Mason Doty', is_active: true },
        { id: REQUESTER, role: 'admin', display_name: 'Rex Requester', is_active: true },
        { id: VIEWER, role: 'sales', display_name: 'Vi Viewer', is_active: true },
        { id: STRANGER, role: 'executive', display_name: 'Sam Stranger', is_active: true },
      ],
      cmr_access: [
        { user_id: CONTROLLER, role: 'controller' },
        { user_id: REQUESTER, role: 'requester' },
        { user_id: VIEWER, role: 'viewer' },
      ],
      ...tables,
    },
    {
      failTables: opts.failTables,
      defaults: {
        cmr_weekly_priorities: () => ({ id: randomUUID(), carried_from_id: null, paid_at: null, paid_by: null }),
      },
      // Mirror the DB checks that matter here (Sunday week_start; paid ⇔ paid_at).
      unique: {
        cmr_weekly_priorities: (c) => {
          const [y, m, d] = String(c.week_start).split('-').map(Number)
          if (new Date(Date.UTC(y, m - 1, d)).getUTCDay() !== 0) return 'violates check constraint "cmr_weekly_priorities_week_start_sunday"'
          if ((c.status === 'paid') !== (c.paid_at != null)) return 'violates check constraint "cmr_weekly_priorities_paid_at_chk"'
          if (c.status !== 'paid' && c.paid_by != null) return 'violates check constraint "cmr_weekly_priorities_paid_by_chk"'
          return null
        },
      },
      // Mirror the reorder RPC: sort_order = 0-based position, scoped to the week.
      rpc: {
        cmr_reorder_weekly_priorities: (args, t) => {
          ;(args.p_ids as string[]).forEach((id, i) => {
            const r = t.cmr_weekly_priorities.find((x) => x.id === id && x.week_start === args.p_week_start)
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

const base = 'https://cmr.safetynetworkteams.com/api/cmr/priorities'
const req = (method: string, path = '', body?: unknown) =>
  new Request(base + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  })

const api = {
  get: (qs = '') => route.GET(req('GET', qs)),
  add: (body: unknown) => route.POST(req('POST', '', body)),
  edit: (body: unknown) => route.PATCH(req('PATCH', '', body)),
  del: (id: string) => route.DELETE(req('DELETE', `?id=${id}`)),
  order: (body: unknown) => reorderRoute.POST(req('POST', '/reorder', body)),
}

const THIS_IDS = [P.CDTFA, P.LOAN, P.CALL, P.PAID, P.DONE]

/** One call of every write, for the access tests. */
const everyWrite = () => [
  api.add({ weekStart: W.THIS, description: 'Hacked', amountCents: 1 }),
  api.edit({ id: P.CDTFA, amountCents: 1 }),
  api.edit({ id: P.CDTFA, isTopPriority: false }),
  api.edit({ id: P.CDTFA, status: 'paid' }),
  api.edit({ id: P.PAID, status: 'open' }),
  api.del(P.CDTFA),
  api.order({ weekStart: W.THIS, ids: [...THIS_IDS].reverse() }),
]

const writes = (fake: ReturnType<typeof world>) => fake.calls.filter((c) => c.op !== 'select')
type AuditArg = { action: string; resourceId?: string; resourceType?: string; resourceLabel?: string; userRole?: string; metadata?: Record<string, any> } // eslint-disable-line @typescript-eslint/no-explicit-any
const auditCalls = () => audit.logAudit.mock.calls.map((c) => c[0] as AuditArg)
const bodyOf = async (r: Response) => (await r.json()) as { success: boolean; data?: any; error?: string; code?: string } // eslint-disable-line @typescript-eslint/no-explicit-any
const viewOf = async (qs = '') => (await bodyOf(await api.get(qs))).data
const rowOf = (fake: ReturnType<typeof world>, id: string) => fake.tables.cmr_weekly_priorities.find((r) => r.id === id)

beforeEach(() => { audit.logAudit.mockClear() })
afterEach(() => { vi.restoreAllMocks() })

// ── access ──────────────────────────────────────────────────────────────────

describe('/api/cmr/priorities — access', () => {
  it('route files export only HTTP handlers + dynamic (BUG-019)', () => {
    const allowed = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'dynamic'])
    for (const mod of [route, reorderRoute]) {
      for (const k of Object.keys(mod)) expect(allowed.has(k), k).toBe(true)
      expect((mod as { dynamic?: string }).dynamic).toBe('force-dynamic')
    }
    expect(Object.keys(route).sort()).toEqual(['DELETE', 'GET', 'PATCH', 'POST', 'dynamic'])
    expect(Object.keys(reorderRoute).sort()).toEqual(['POST', 'dynamic'])
  })

  it('platform admin / stranger with NO grant: 403 on GET and every write — nothing read or written', async () => {
    for (const uid of [ADMIN, STRANGER]) {
      const fake = world(uid)
      const statuses = [(await api.get()).status, ...(await Promise.all(everyWrite())).map((r) => r.status)]
      expect(statuses).toEqual(Array(8).fill(403))
      expect(writes(fake)).toHaveLength(0)
      expect(fake.calls.some((c) => c.table === 'cmr_weekly_priorities')).toBe(false)
    }
    expect(audit.logAudit).not.toHaveBeenCalled()
  })

  for (const [label, uid] of [['requester', REQUESTER], ['viewer', VIEWER]] as const) {
    it(`${label}: GET 200 read-only (full data); every write 403 with no writes`, async () => {
      const fake = world(uid)
      const g = await api.get(`?week=${W.THIS}`)
      expect(g.status).toBe(200)
      const { data } = await bodyOf(g)
      expect(data.canEdit).toBe(false)
      expect(data.priorities).toHaveLength(5)
      expect(data.totals.neededCents).toBe(9_650_000)

      const before = JSON.stringify(fake.tables.cmr_weekly_priorities)
      const results = await Promise.all(everyWrite())
      expect(results.map((r) => r.status)).toEqual(Array(7).fill(403))
      for (const r of results) expect((await bodyOf(r)).code).toBe('FORBIDDEN')
      expect(writes(fake)).toHaveLength(0)
      expect(JSON.stringify(fake.tables.cmr_weekly_priorities)).toBe(before)
      expect(audit.logAudit).not.toHaveBeenCalled()
    })
  }

  it('no session: 401 on GET and every write', async () => {
    const fake = world(null)
    const statuses = [(await api.get()).status, ...(await Promise.all(everyWrite())).map((r) => r.status)]
    expect(statuses).toEqual(Array(8).fill(401))
    expect(writes(fake)).toHaveLength(0)
  })

  it('fails closed (500, no data) when the grant lookup errors', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const fake = world(CONTROLLER, seed(), { failTables: ['cmr_access'] })
    const r = await api.get()
    expect(r.status).toBe(500)
    expect((await bodyOf(r)).data).toBeUndefined()
    expect(fake.calls.some((c) => c.table === 'cmr_weekly_priorities')).toBe(false)
  })

  it('controller: GET says canEdit', async () => {
    world(CONTROLLER)
    expect((await viewOf()).canEdit).toBe(true)
  })
})

// ── GET: week math + totals ─────────────────────────────────────────────────

describe('GET /api/cmr/priorities — weeks and totals', () => {
  it('defaults to this week (Pacific): Sunday Sep 13 – Saturday Sep 19', async () => {
    world(VIEWER)
    const v = await viewOf()
    expect(v).toMatchObject({ weekStart: W.THIS, weekEnd: '2026-09-19', today: '2026-09-16', thisWeekStart: W.THIS })
  })

  it('?week= any day of a week resolves to its Sunday', async () => {
    world(VIEWER)
    for (const d of ['2026-09-13', '2026-09-16', '2026-09-19']) {
      expect((await viewOf(`?week=${d}`)).weekStart).toBe(W.THIS)
    }
    expect((await viewOf('?week=2026-09-20')).weekStart).toBe(W.NEXT)
    expect((await viewOf('?week=2026-09-12')).weekStart).toBe(W.PREV)
  })

  it('a bad ?week= is a 400', async () => {
    world(VIEWER)
    for (const q of ['?week=2026-02-30', '?week=soon', '?week=09/16/2026']) {
      const r = await api.get(q)
      expect(r.status).toBe(400)
    }
  })

  it('returns the week in order with totals — zero-amount tasks included', async () => {
    world(REQUESTER)
    const v = await viewOf(`?week=${W.THIS}`)
    expect(v.priorities.map((p: { id: string }) => p.id)).toEqual(THIS_IDS)
    expect(v.priorities[0]).toMatchObject({ description: 'CDTFA sales tax', amountCents: 6_450_000, dueDate: '2026-09-17', isTopPriority: true, status: 'open' })
    expect(v.priorities[2]).toMatchObject({ amountCents: 0, notes: 'Ask for Dana', isTopPriority: true })
    expect(v.priorities[3]).toMatchObject({ status: 'paid', paidAt: '2026-09-15T16:02:00Z', paidBy: CONTROLLER, paidByName: 'Mason Doty' })
    expect(v.totals).toEqual({
      neededCents: 9_650_000, // CDTFA + loan (+ the $0 call)
      paidResolvedCents: 1_250_000, // fuel card + insurance audit
      totalCents: 10_900_000,
      count: 5,
      openCount: 3,
      topPriorityCount: 2,
      openTopPriorityCount: 2,
    })
  })

  it('weeks are isolated: a priority in one week never appears in the next or previous', async () => {
    world(VIEWER)
    const next = await viewOf(`?week=${W.NEXT}`)
    expect(next.priorities.map((p: { id: string }) => p.id)).toEqual([P.NEXTWK])
    expect(next.totals).toMatchObject({ neededCents: 777, totalCents: 777, count: 1 })
    const prev = await viewOf(`?week=${W.PREV}`)
    expect(prev.priorities.map((p: { id: string }) => p.id)).toEqual([P.CARRIED])
    const empty = await viewOf('?week=2026-10-01')
    expect(empty.priorities).toEqual([])
    expect(empty.totals.totalCents).toBe(0)
    const cur = await viewOf()
    expect(cur.priorities.some((p: { id: string }) => p.id === P.NEXTWK || p.id === P.CARRIED)).toBe(false)
  })
})

// ── POST ────────────────────────────────────────────────────────────────────

describe('POST /api/cmr/priorities', () => {
  it('creates with an amount at the end of the week, normalising any day to its Sunday; audited', async () => {
    const fake = world(CONTROLLER)
    const r = await api.add({ date: '2026-09-18', description: '  Payroll   taxes ', amountCents: 4_125_050, dueDate: '2026-09-18', notes: 'EFTPS', isTopPriority: true })
    expect(r.status).toBe(201)
    const { data } = await bodyOf(r)
    expect(data.priority).toMatchObject({ weekStart: W.THIS, description: 'Payroll taxes', amountCents: 4_125_050, dueDate: '2026-09-18', notes: 'EFTPS', isTopPriority: true, status: 'open', sortOrder: 5, paidAt: null })
    const row = rowOf(fake, data.priority.id)!
    expect(row).toMatchObject({ week_start: W.THIS, created_by: CONTROLLER, status: 'open' })

    const [a] = auditCalls()
    expect(a).toMatchObject({ action: 'cmr.priority.create', resourceType: 'cmr_weekly_priorities', resourceId: data.priority.id, resourceLabel: 'Payroll taxes', userRole: 'cmr:controller' })
    expect(a.metadata).toMatchObject({ weekStart: W.THIS, before: null, after: { description: 'Payroll taxes', amountCents: 4_125_050, isTopPriority: true, status: 'open', weekStart: W.THIS } })

    // Totals follow.
    const v = await viewOf()
    expect(v.totals.neededCents).toBe(9_650_000 + 4_125_050)
    expect(v.priorities.at(-1).id).toBe(data.priority.id)
  })

  it('amount is optional: omitted or null → a $0 task', async () => {
    const fake = world(CONTROLLER)
    const a = await bodyOf(await api.add({ weekStart: W.THIS, description: 'Call the bank' }))
    const b = await bodyOf(await api.add({ weekStart: W.THIS, description: 'Chase the refund', amountCents: null, dueDate: '' }))
    expect(a.data.priority).toMatchObject({ amountCents: 0, dueDate: null, notes: null, isTopPriority: false })
    expect(b.data.priority).toMatchObject({ amountCents: 0, dueDate: null })
    expect(rowOf(fake, a.data.priority.id)!.amount_cents).toBe(0)
    const v = await viewOf()
    expect(v.totals).toMatchObject({ neededCents: 9_650_000, openCount: 5, count: 7 })
  })

  it('a new week gets its own order (sort 0) and does not touch other weeks', async () => {
    const fake = world(CONTROLLER)
    const r = await bodyOf(await api.add({ weekStart: '2026-10-04', description: 'October rent' }))
    expect(r.data.priority).toMatchObject({ weekStart: '2026-10-04', sortOrder: 0 })
    expect((await viewOf('?week=2026-10-07')).priorities).toHaveLength(1)
    expect((await viewOf()).priorities).toHaveLength(5)
    expect(fake.tables.cmr_weekly_priorities).toHaveLength(8)
  })

  it('validates: description, amount, due date, week, flag; refuses a status or carried link', async () => {
    const fake = world(CONTROLLER)
    const bad = [
      { weekStart: W.THIS, description: '   ' },
      { weekStart: W.THIS, description: 'x'.repeat(121) },
      { weekStart: W.THIS, description: 'Neg', amountCents: -100 },
      { weekStart: W.THIS, description: 'Float', amountCents: 10.5 },
      { weekStart: W.THIS, description: 'Str', amountCents: '100' },
      { weekStart: W.THIS, description: 'Huge', amountCents: 100_000_000_000 },
      { weekStart: W.THIS, description: 'Due', dueDate: '2026-02-30' },
      { weekStart: 'someday', description: 'Week' },
      { description: 'No week' },
      { weekStart: W.THIS, description: 'Flag', isTopPriority: 'yes' },
      { weekStart: W.THIS, description: 'Notes', notes: 'n'.repeat(501) },
      { weekStart: W.THIS, description: 'Pre-paid', status: 'paid' },
      { weekStart: W.THIS, description: 'Carried', status: 'carried' },
      { weekStart: W.THIS, description: 'Linked', carriedFromId: P.CARRIED },
    ]
    for (const b of bad) {
      const r = await api.add(b)
      expect(r.status, JSON.stringify(b)).toBe(400)
    }
    expect((await api.add('not json')).status).toBe(400)
    expect(writes(fake)).toHaveLength(0)
    expect(audit.logAudit).not.toHaveBeenCalled()
  })
})

// ── PATCH ───────────────────────────────────────────────────────────────────

describe('PATCH /api/cmr/priorities', () => {
  it('edits fields (amount can be cleared to $0); audits only what changed', async () => {
    const fake = world(CONTROLLER)
    const r = await api.edit({ id: P.LOAN, description: 'Equipment loan', amountCents: null, dueDate: null, notes: 'Autopay?' })
    expect(r.status).toBe(200)
    const { data } = await bodyOf(r)
    expect(data).toMatchObject({ changed: true, priority: { description: 'Equipment loan', amountCents: 0, dueDate: null, notes: 'Autopay?' } })
    expect(rowOf(fake, P.LOAN)).toMatchObject({ description: 'Equipment loan', amount_cents: 0, due_date: null, notes: 'Autopay?', status: 'open' })
    expect(auditCalls()).toHaveLength(1)
    expect(auditCalls()[0]).toMatchObject({
      action: 'cmr.priority.update',
      resourceId: P.LOAN,
      metadata: {
        weekStart: W.THIS,
        before: { description: 'Equipment loan — Wells Fargo', amountCents: 3_200_000, dueDate: '2026-09-19', notes: null },
        after: { description: 'Equipment loan', amountCents: 0, dueDate: null, notes: 'Autopay?' },
      },
    })
    expect((await viewOf()).totals.neededCents).toBe(6_450_000)
  })

  it('an unchanged PATCH writes nothing and audits nothing', async () => {
    const fake = world(CONTROLLER)
    const r = await bodyOf(await api.edit({ id: P.CDTFA, description: 'CDTFA  sales tax', amountCents: 6_450_000, isTopPriority: true, status: 'open' }))
    expect(r.data.changed).toBe(false)
    expect(writes(fake)).toHaveLength(0)
    expect(audit.logAudit).not.toHaveBeenCalled()
  })

  it('toggles the top-priority flag (flag / unflag audited)', async () => {
    const fake = world(CONTROLLER)
    await api.edit({ id: P.CDTFA, isTopPriority: false })
    await api.edit({ id: P.LOAN, isTopPriority: true })
    expect(rowOf(fake, P.CDTFA)!.is_top_priority).toBe(false)
    expect(rowOf(fake, P.LOAN)!.is_top_priority).toBe(true)
    expect(auditCalls().map((a) => [a.action, a.resourceId, a.metadata?.before, a.metadata?.after])).toEqual([
      ['cmr.priority.unflag', P.CDTFA, { isTopPriority: true }, { isTopPriority: false }],
      ['cmr.priority.flag', P.LOAN, { isTopPriority: false }, { isTopPriority: true }],
    ])
  })

  it('resolve → reopen: status only, no paid stamp; needed total follows', async () => {
    const fake = world(CONTROLLER)
    await api.edit({ id: P.LOAN, status: 'resolved' })
    expect(rowOf(fake, P.LOAN)).toMatchObject({ status: 'resolved', paid_at: null, paid_by: null })
    let v = await viewOf()
    expect(v.totals).toMatchObject({ neededCents: 6_450_000, paidResolvedCents: 1_250_000 + 3_200_000, openCount: 2 })

    await api.edit({ id: P.LOAN, status: 'open' })
    expect(rowOf(fake, P.LOAN)!.status).toBe('open')
    v = await viewOf()
    expect(v.totals.neededCents).toBe(9_650_000)

    expect(auditCalls().map((a) => [a.action, a.metadata?.before, a.metadata?.after])).toEqual([
      ['cmr.priority.resolve', { status: 'open', paidAt: null, paidBy: null }, { status: 'resolved', paidAt: null, paidBy: null }],
      ['cmr.priority.reopen', { status: 'resolved', paidAt: null, paidBy: null }, { status: 'open', paidAt: null, paidBy: null }],
    ])
  })

  it('pay stamps paid_at + paid_by (the controller); unpay clears them', async () => {
    const fake = world(CONTROLLER)
    const t0 = Date.now()
    const r = await bodyOf(await api.edit({ id: P.CDTFA, status: 'paid' }))
    const row = { ...rowOf(fake, P.CDTFA)! } // snapshot — the live row changes on unpay
    expect(row.status).toBe('paid')
    expect(row.paid_by).toBe(CONTROLLER)
    expect(Date.parse(String(row.paid_at))).toBeGreaterThanOrEqual(t0 - 1000)
    expect(r.data.priority).toMatchObject({ status: 'paid', paidBy: CONTROLLER, paidByName: 'Mason Doty', paidAt: row.paid_at })

    let v = await viewOf()
    expect(v.totals).toMatchObject({ neededCents: 3_200_000, paidResolvedCents: 1_250_000 + 6_450_000, openTopPriorityCount: 1, topPriorityCount: 2 })
    expect(v.priorities[0]).toMatchObject({ paidByName: 'Mason Doty' })

    const u = await bodyOf(await api.edit({ id: P.CDTFA, status: 'open' }))
    expect(rowOf(fake, P.CDTFA)).toMatchObject({ status: 'open', paid_at: null, paid_by: null })
    expect(u.data.priority).toMatchObject({ status: 'open', paidAt: null, paidBy: null, paidByName: null })
    v = await viewOf()
    expect(v.totals.neededCents).toBe(9_650_000)

    const [pay, reopen] = auditCalls()
    expect(pay).toMatchObject({ action: 'cmr.priority.pay', resourceId: P.CDTFA, resourceLabel: 'CDTFA sales tax' })
    expect(pay.metadata).toEqual({
      weekStart: W.THIS,
      before: { status: 'open', paidAt: null, paidBy: null },
      after: { status: 'paid', paidAt: row.paid_at, paidBy: CONTROLLER },
    })
    expect(reopen).toMatchObject({ action: 'cmr.priority.reopen' })
    expect(reopen.metadata).toEqual({
      weekStart: W.THIS,
      before: { status: 'paid', paidAt: row.paid_at, paidBy: CONTROLLER },
      after: { status: 'open', paidAt: null, paidBy: null },
    })
  })

  it('paid → resolved clears the stamp; resolved → paid stamps it; paid → paid keeps the original', async () => {
    const fake = world(CONTROLLER)
    expect((await bodyOf(await api.edit({ id: P.PAID, status: 'paid' }))).data.changed).toBe(false)
    expect(rowOf(fake, P.PAID)).toMatchObject({ paid_at: '2026-09-15T16:02:00Z', paid_by: CONTROLLER })

    await api.edit({ id: P.PAID, status: 'resolved' })
    expect(rowOf(fake, P.PAID)).toMatchObject({ status: 'resolved', paid_at: null, paid_by: null })
    await api.edit({ id: P.DONE, status: 'paid' })
    expect(rowOf(fake, P.DONE)).toMatchObject({ status: 'paid', paid_by: CONTROLLER })
    expect(rowOf(fake, P.DONE)!.paid_at).toEqual(expect.any(String))
    expect(auditCalls().map((a) => a.action)).toEqual(['cmr.priority.resolve', 'cmr.priority.pay'])
  })

  it('one PATCH can edit, flag and pay — three audit entries, one write', async () => {
    const fake = world(CONTROLLER)
    await api.edit({ id: P.LOAN, amountCents: 3_300_000, isTopPriority: true, status: 'paid' })
    expect(fake.calls.filter((c) => c.op === 'update')).toHaveLength(1)
    expect(auditCalls().map((a) => a.action)).toEqual(['cmr.priority.update', 'cmr.priority.flag', 'cmr.priority.pay'])
    expect(auditCalls()[0].metadata).toMatchObject({ before: { amountCents: 3_200_000 }, after: { amountCents: 3_300_000 } })
  })

  it("refuses status 'carried' (Phase 6) and moving weeks — nothing written", async () => {
    const fake = world(CONTROLLER)
    const c = await api.edit({ id: P.CDTFA, status: 'carried' })
    expect(c.status).toBe(400)
    expect((await bodyOf(c)).code).toBe('CARRY_NOT_AVAILABLE')
    const m = await api.edit({ id: P.CDTFA, weekStart: W.NEXT })
    expect(m.status).toBe(400)
    expect((await bodyOf(m)).code).toBe('CARRY_NOT_AVAILABLE')
    expect((await api.edit({ id: P.CDTFA, carriedFromId: P.LOAN })).status).toBe(400)
    expect((await api.edit({ id: P.CDTFA, status: 'pushed' })).status).toBe(400)
    expect(rowOf(fake, P.CDTFA)).toMatchObject({ status: 'open', week_start: W.THIS })
    expect(writes(fake)).toHaveLength(0)
    expect(audit.logAudit).not.toHaveBeenCalled()
  })

  it('a carried row is locked (409) for edits and deletes', async () => {
    const fake = world(CONTROLLER)
    for (const r of [await api.edit({ id: P.CARRIED, status: 'open' }), await api.edit({ id: P.CARRIED, description: 'x' }), await api.del(P.CARRIED)]) {
      expect(r.status).toBe(409)
      expect((await bodyOf(r)).code).toBe('NOT_EDITABLE')
    }
    expect(writes(fake)).toHaveLength(0)
  })

  it('validates input; unknown id is 404', async () => {
    const fake = world(CONTROLLER)
    for (const b of [
      { id: 'nope', description: 'x' },
      { id: P.CDTFA },
      { id: P.CDTFA, description: '' },
      { id: P.CDTFA, amountCents: -1 },
      { id: P.CDTFA, dueDate: 'tomorrow' },
      { id: P.CDTFA, isTopPriority: 1 },
      { id: P.CDTFA, status: 'done' },
    ]) {
      expect((await api.edit(b)).status, JSON.stringify(b)).toBe(400)
    }
    const nf = await api.edit({ id: randomUUID(), description: 'Ghost' })
    expect(nf.status).toBe(404)
    expect(writes(fake)).toHaveLength(0)
  })
})

// ── DELETE ──────────────────────────────────────────────────────────────────

describe('DELETE /api/cmr/priorities', () => {
  it('hard-deletes and audits the full before snapshot', async () => {
    const fake = world(CONTROLLER)
    const r = await api.del(P.CDTFA)
    expect(r.status).toBe(200)
    expect(rowOf(fake, P.CDTFA)).toBeUndefined()
    const [a] = auditCalls()
    expect(a).toMatchObject({ action: 'cmr.priority.delete', resourceId: P.CDTFA, resourceLabel: 'CDTFA sales tax' })
    expect(a.metadata).toMatchObject({
      weekStart: W.THIS,
      before: { description: 'CDTFA sales tax', amountCents: 6_450_000, dueDate: '2026-09-17', isTopPriority: true, status: 'open', weekStart: W.THIS },
      after: null,
    })
    const v = await viewOf()
    expect(v.totals).toMatchObject({ neededCents: 3_200_000, count: 4, topPriorityCount: 1 })
  })

  it('bad / unknown id', async () => {
    const fake = world(CONTROLLER)
    expect((await api.del('x')).status).toBe(400)
    expect((await api.del(randomUUID())).status).toBe(404)
    expect(writes(fake)).toHaveLength(0)
  })
})

// ── reorder ─────────────────────────────────────────────────────────────────

describe('POST /api/cmr/priorities/reorder', () => {
  it('rewrites the week order atomically (week-scoped RPC) and audits before → after', async () => {
    const fake = world(CONTROLLER)
    const next = [P.LOAN, P.CDTFA, P.DONE, P.CALL, P.PAID]
    const r = await api.order({ weekStart: '2026-09-17', ids: next })
    expect(r.status).toBe(200)
    expect((await bodyOf(r)).data.changed).toBe(true)
    const rpc = fake.calls.find((c) => c.op === 'rpc')!
    expect(rpc).toMatchObject({ table: 'cmr_reorder_weekly_priorities', payload: { p_week_start: W.THIS, p_ids: next } })
    expect((await viewOf()).priorities.map((p: { id: string }) => p.id)).toEqual(next)
    expect(rowOf(fake, P.NEXTWK)!.sort_order).toBe(0)

    const [a] = auditCalls()
    expect(a).toMatchObject({ action: 'cmr.priority.reorder', resourceLabel: 'Week of Sep 13 – 19' })
    expect(a.metadata).toMatchObject({
      weekStart: W.THIS,
      before: ['CDTFA sales tax', 'Equipment loan — Wells Fargo', 'Call Sunbelt about the credit hold', 'Fuel card', 'Insurance audit'],
      after: ['Equipment loan — Wells Fargo', 'CDTFA sales tax', 'Insurance audit', 'Call Sunbelt about the credit hold', 'Fuel card'],
      ids: next,
    })
  })

  it('same order → no write, no audit', async () => {
    const fake = world(CONTROLLER)
    const r = await bodyOf(await api.order({ weekStart: W.THIS, ids: THIS_IDS }))
    expect(r.data.changed).toBe(false)
    expect(writes(fake)).toHaveLength(0)
    expect(audit.logAudit).not.toHaveBeenCalled()
  })

  it('a stale or foreign set is 409 STALE; malformed is 400', async () => {
    const fake = world(CONTROLLER)
    for (const ids of [THIS_IDS.slice(1), [...THIS_IDS, P.NEXTWK], [P.NEXTWK, ...THIS_IDS.slice(1)]]) {
      const r = await api.order({ weekStart: W.THIS, ids })
      expect(r.status).toBe(409)
      expect((await bodyOf(r)).code).toBe('STALE')
    }
    for (const b of [{ weekStart: W.THIS, ids: [] }, { weekStart: W.THIS, ids: ['x'] }, { weekStart: W.THIS, ids: [P.CDTFA, P.CDTFA] }, { ids: THIS_IDS }]) {
      expect((await api.order(b)).status, JSON.stringify(b)).toBe(400)
    }
    expect(writes(fake)).toHaveLength(0)
  })
})
