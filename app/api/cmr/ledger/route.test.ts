import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import { fakeSupabase, fakeRouteClient } from '@/lib/cmr/__testing__/fakeSupabase'

/**
 * /api/cmr/ledger (+ /adjustments, /pending, and their /reorder) — access rules and behaviour.
 *   • no grant (platform admin included) → 403 on EVERY method, incl. GET; nothing read
 *   • requester / viewer → GET 200 (canEdit false); every write 403, no writes, no audit
 *   • no session → 401 everywhere
 *   • controller → beginning cash, signed adjustments (incl. warn note), pending items across
 *     accounts, deletes, reorders — each audited with before → after
 *   • balance = beginning + Σ signed adjustments − Σ pending, with per-account subtotals
 *   • AM and PM are independent; ledgers are created on demand (upsert on date+period)
 *   • pending amount ≥ 0 and active-account-only
 */

const server = vi.hoisted(() => ({ routeClient: null as unknown, serviceClient: null as unknown }))
vi.mock('@/lib/supabase/server', () => ({
  createRouteClient: () => server.routeClient,
  createServerClient: () => server.routeClient,
  createServiceClient: () => server.serviceClient,
}))
const audit = vi.hoisted(() => ({ logAudit: vi.fn(async (_p: unknown) => {}) }))
vi.mock('@/lib/audit/log', () => ({ logAudit: audit.logAudit, getClientIp: () => null }))
vi.mock('@/lib/utils/date', async (orig) => ({
  ...(await orig<typeof import('@/lib/utils/date')>()),
  pacificToday: () => '2026-09-16',
}))

import * as ledgerRoute from './route'
import * as adjRoute from './adjustments/route'
import * as adjReorderRoute from './adjustments/reorder/route'
import * as pendRoute from './pending/route'
import * as pendReorderRoute from './pending/reorder/route'

const ADMIN = '00000000-0000-4000-8000-00000000a0a0'
const CONTROLLER = '00000000-0000-4000-8000-00000000c0c0'
const REQUESTER = '00000000-0000-4000-8000-00000000e0e0'
const VIEWER = '00000000-0000-4000-8000-00000000f0f0'
const STRANGER = '00000000-0000-4000-8000-00000000d0d0'

const ACC = {
  TCS: '10000000-0000-4000-8000-000000000001',
  INC: '10000000-0000-4000-8000-000000000002',
  OLD: '10000000-0000-4000-8000-000000000003',
}
const L_AM = '30000000-0000-4000-8000-000000000001'
const L_PM = '30000000-0000-4000-8000-000000000002'
const ADJ = {
  WIRES: '40000000-0000-4000-8000-000000000001',
  HOLD: '40000000-0000-4000-8000-000000000002',
  ROLLUP: '40000000-0000-4000-8000-000000000003',
}
const P = {
  FERG: '50000000-0000-4000-8000-000000000001',
  SUN: '50000000-0000-4000-8000-000000000002',
  ADP: '50000000-0000-4000-8000-000000000003',
  PAID: '50000000-0000-4000-8000-000000000004',
  REQ: '50000000-0000-4000-8000-000000000005',
}

type Row = Record<string, unknown>

const adj = (over: Row): Row => ({
  daily_ledger_id: L_AM,
  note: null,
  warn_note: null,
  kind: 'manual',
  sort_order: 0,
  created_by: CONTROLLER,
  created_at: '2026-09-16T14:00:00Z',
  ...over,
})
const pend = (over: Row): Row => ({
  daily_ledger_id: L_AM,
  account_id: ACC.TCS,
  status: 'pending',
  original_date: '2026-09-16',
  effective_date: '2026-09-16',
  paid_at: null,
  paid_by: null,
  source: 'manual',
  source_ref_id: null,
  notes: null,
  sort_order: 0,
  created_by: CONTROLLER,
  created_at: '2026-09-16T14:00:00Z',
  ...over,
})

function seed() {
  return {
    cmr_daily_ledger: [
      { id: L_AM, ledger_date: '2026-09-16', period: 'am', beginning_cash_cents: 48_230_000, created_by: CONTROLLER, created_at: '2026-09-16T14:00:00Z', updated_at: '2026-09-16T14:14:00Z' },
      { id: L_PM, ledger_date: '2026-09-16', period: 'pm', beginning_cash_cents: 100_000, created_by: CONTROLLER, created_at: '2026-09-16T20:00:00Z', updated_at: '2026-09-16T20:00:00Z' },
    ],
    cmr_ledger_adjustments: [
      adj({ id: ADJ.HOLD, description: 'Payroll hold', amount_cents: -2_200_000, warn_note: 'Cover by 2:00 PM', sort_order: 1 }),
      adj({ id: ADJ.WIRES, description: 'Wires from prior week', amount_cents: 3_800_000, sort_order: 0 }),
      // A stored roll-up row must never be listed or summed (the roll-up is derived).
      adj({ id: ADJ.ROLLUP, description: 'Stale rollup', amount_cents: -999_999, kind: 'pending_rollup', sort_order: 2 }),
    ],
    cmr_pending_items: [
      pend({ id: P.SUN, payee: 'Sunbelt Rentals', amount_cents: 10_200_000, sort_order: 1 }),
      pend({ id: P.FERG, payee: 'Ferguson Enterprises', amount_cents: 21_000_000, sort_order: 0 }),
      pend({ id: P.ADP, payee: 'ADP payroll run', amount_cents: 17_752_000, account_id: ACC.INC }),
      pend({ id: P.PAID, payee: 'Already paid', amount_cents: 500, account_id: ACC.INC, status: 'paid', sort_order: 1, daily_ledger_id: L_PM }),
      pend({ id: P.REQ, payee: 'From a request', amount_cents: 700, source: 'request', source_ref_id: randomUUID(), daily_ledger_id: L_PM }),
    ],
  }
}

function world(userId: string | null, tables: Record<string, Row[]> = seed(), opts: { failTables?: string[] } = {}) {
  const fake = fakeSupabase(
    {
      user_profiles: [
        { id: ADMIN, role: 'admin', display_name: 'Ada Admin', is_active: true },
        { id: CONTROLLER, role: 'executive', display_name: 'Cora Controller', is_active: true },
        { id: REQUESTER, role: 'admin', display_name: 'Rex Requester', is_active: true },
        { id: VIEWER, role: 'sales', display_name: 'Vi Viewer', is_active: true },
        { id: STRANGER, role: 'executive', display_name: 'Sam Stranger', is_active: true },
      ],
      cmr_access: [
        { user_id: CONTROLLER, role: 'controller' },
        { user_id: REQUESTER, role: 'requester' },
        { user_id: VIEWER, role: 'viewer' },
      ],
      cmr_accounts: [
        { id: ACC.TCS, name: 'TCS', account_type: 'Checking', active: true, sort_order: 0 },
        { id: ACC.INC, name: 'INC', account_type: 'Payroll', active: true, sort_order: 1 },
        { id: ACC.OLD, name: 'Old Payroll', account_type: null, active: false, sort_order: 2 },
      ],
      ...tables,
    },
    {
      failTables: opts.failTables,
      defaults: {
        cmr_daily_ledger: () => ({ id: randomUUID(), updated_at: '2026-09-16T15:00:00Z' }),
        cmr_ledger_adjustments: () => ({ id: randomUUID(), kind: 'manual', note: null, warn_note: null }),
        cmr_pending_items: () => ({ id: randomUUID(), paid_at: null, paid_by: null, source_ref_id: null, notes: null }),
      },
      // Mirrors unique (ledger_date, period).
      unique: {
        cmr_daily_ledger: (c, others) =>
          others.some((o) => o.ledger_date === c.ledger_date && o.period === c.period)
            ? 'duplicate key value violates unique constraint "cmr_daily_ledger_date_period_key"'
            : null,
      },
      // Mirror the reorder RPCs: sort_order = 0-based position, scoped to the ledger.
      rpc: {
        cmr_reorder_ledger_adjustments: (args, t) => {
          ;(args.p_ids as string[]).forEach((id, i) => {
            const r = t.cmr_ledger_adjustments.find((x) => x.id === id && x.daily_ledger_id === args.p_ledger_id)
            if (r) r.sort_order = i
          })
          return null
        },
        cmr_reorder_pending_items: (args, t) => {
          ;(args.p_ids as string[]).forEach((id, i) => {
            const r = t.cmr_pending_items.find((x) => x.id === id && x.daily_ledger_id === args.p_ledger_id)
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

const base = 'https://cmr.safetynetworkteams.com/api/cmr/ledger'
const req = (method: string, path = '', body?: unknown) =>
  new Request(base + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  })

const api = {
  get: (qs = '') => ledgerRoute.GET(req('GET', qs)),
  begin: (body: unknown) => ledgerRoute.PUT(req('PUT', '', body)),
  addAdj: (body: unknown) => adjRoute.POST(req('POST', '/adjustments', body)),
  editAdj: (body: unknown) => adjRoute.PATCH(req('PATCH', '/adjustments', body)),
  delAdj: (id: string) => adjRoute.DELETE(req('DELETE', `/adjustments?id=${id}`)),
  orderAdj: (body: unknown) => adjReorderRoute.POST(req('POST', '/adjustments/reorder', body)),
  addPend: (body: unknown) => pendRoute.POST(req('POST', '/pending', body)),
  editPend: (body: unknown) => pendRoute.PATCH(req('PATCH', '/pending', body)),
  delPend: (id: string) => pendRoute.DELETE(req('DELETE', `/pending?id=${id}`)),
  orderPend: (body: unknown) => pendReorderRoute.POST(req('POST', '/pending/reorder', body)),
}

const AM = { date: '2026-09-16', period: 'am' }
const PM = { date: '2026-09-16', period: 'pm' }

/** One call of every write, for the access tests. */
const everyWrite = () => [
  api.begin({ ...AM, beginningCashCents: 1 }),
  api.addAdj({ ...AM, description: 'Hacked', amountCents: 1 }),
  api.editAdj({ id: ADJ.WIRES, amountCents: 1 }),
  api.delAdj(ADJ.WIRES),
  api.orderAdj({ ...AM, ids: [ADJ.HOLD, ADJ.WIRES] }),
  api.addPend({ ...AM, accountId: ACC.TCS, payee: 'Hacked', amountCents: 1 }),
  api.editPend({ id: P.FERG, amountCents: 1 }),
  api.delPend(P.FERG),
  api.orderPend({ ...AM, accountId: ACC.TCS, ids: [P.SUN, P.FERG] }),
]

const writes = (fake: ReturnType<typeof world>) => fake.calls.filter((c) => c.op !== 'select')
type AuditArg = { action: string; resourceId?: string; resourceType?: string; resourceLabel?: string; userRole?: string; metadata?: Record<string, unknown> }
const auditCalls = () => audit.logAudit.mock.calls.map((c) => c[0] as AuditArg)
const bodyOf = async (r: Response) => (await r.json()) as { success: boolean; data?: any; error?: string; code?: string } // eslint-disable-line @typescript-eslint/no-explicit-any
const viewOf = async (qs = '?date=2026-09-16&period=am') => (await bodyOf(await api.get(qs))).data

beforeEach(() => { audit.logAudit.mockClear() })
afterEach(() => { vi.restoreAllMocks() })

// ── access ──────────────────────────────────────────────────────────────────

describe('/api/cmr/ledger — access', () => {
  it('route files export only HTTP handlers + dynamic (BUG-019)', () => {
    const allowed = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'dynamic'])
    for (const mod of [ledgerRoute, adjRoute, adjReorderRoute, pendRoute, pendReorderRoute]) {
      for (const k of Object.keys(mod)) expect(allowed.has(k), k).toBe(true)
      expect((mod as { dynamic?: string }).dynamic).toBe('force-dynamic')
    }
    expect('DELETE' in ledgerRoute).toBe(false) // a ledger itself is never deleted from the app
  })

  it('platform admin / stranger with NO grant: 403 on GET and every write — nothing read or written', async () => {
    for (const uid of [ADMIN, STRANGER]) {
      const fake = world(uid)
      const statuses = [(await api.get()).status, ...(await Promise.all(everyWrite())).map((r) => r.status)]
      expect(statuses).toEqual(Array(10).fill(403))
      expect(writes(fake)).toHaveLength(0)
      expect(fake.calls.some((c) => c.table.startsWith('cmr_') && c.table !== 'cmr_access')).toBe(false)
    }
    expect(audit.logAudit).not.toHaveBeenCalled()
  })

  for (const [label, uid] of [['requester', REQUESTER], ['viewer', VIEWER]] as const) {
    it(`${label}: GET 200 read-only (full data); every write 403 with no writes`, async () => {
      const fake = world(uid)
      const g = await api.get('?date=2026-09-16&period=am')
      expect(g.status).toBe(200)
      const { data } = await bodyOf(g)
      expect(data.canEdit).toBe(false)
      expect(data.adjustments).toHaveLength(2)
      expect(data.pending).toHaveLength(2)
      expect(data.totals.currentBalanceCents).toBe(48_230_000 + 1_600_000 - 48_952_000)

      const results = await Promise.all(everyWrite())
      expect(results.map((r) => r.status)).toEqual(Array(9).fill(403))
      for (const r of results) expect((await bodyOf(r)).code).toBe('FORBIDDEN')
      expect(writes(fake)).toHaveLength(0)
      expect(fake.tables.cmr_daily_ledger).toHaveLength(2)
      expect(fake.tables.cmr_ledger_adjustments.find((a) => a.id === ADJ.WIRES)).toMatchObject({ amount_cents: 3_800_000, sort_order: 0 })
      expect(fake.tables.cmr_pending_items).toHaveLength(5)
      expect(audit.logAudit).not.toHaveBeenCalled()
    })
  }

  it('no session: 401 on GET and every write', async () => {
    const fake = world(null)
    const statuses = [(await api.get()).status, ...(await Promise.all(everyWrite())).map((r) => r.status)]
    expect(statuses).toEqual(Array(10).fill(401))
    expect(writes(fake)).toHaveLength(0)
  })

  it('fails closed (500, no data) when the grant lookup errors', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const fake = world(CONTROLLER, seed(), { failTables: ['cmr_access'] })
    const r = await api.get()
    expect(r.status).toBe(500)
    expect((await bodyOf(r)).data).toBeUndefined()
    expect(fake.calls.some((c) => c.table === 'cmr_daily_ledger')).toBe(false)
  })

  it('controller: GET says canEdit', async () => {
    world(CONTROLLER)
    expect((await viewOf()).canEdit).toBe(true)
  })
})

// ── GET: the view + the math ────────────────────────────────────────────────

describe('GET /api/cmr/ledger — view and balance math', () => {
  it('beginning + Σ signed adjustments − Σ pending, with per-account subtotals', async () => {
    world(REQUESTER)
    const v = await viewOf()
    expect(v.ledger).toMatchObject({ id: L_AM, ledgerDate: '2026-09-16', period: 'am', beginningCashCents: 48_230_000, exists: true })
    // Ordered, manual only (the stored roll-up row is ignored), signed.
    expect(v.adjustments.map((a: { description: string; amountCents: number; warnNote: string | null }) => [a.description, a.amountCents, a.warnNote])).toEqual([
      ['Wires from prior week', 3_800_000, null],
      ['Payroll hold', -2_200_000, 'Cover by 2:00 PM'],
    ])
    expect(v.totals).toEqual({
      beginningCashCents: 48_230_000,
      adjustmentsTotalCents: 1_600_000,
      pendingRollupCents: 48_952_000,
      currentBalanceCents: 48_230_000 + 1_600_000 - 48_952_000,
    })
    expect(v.totals.currentBalanceCents).toBe(878_000)
    expect(v.pending.map((g: { accountName: string; accountType: string; subtotalCents: number; items: { payee: string }[] }) => [
      g.accountName, g.accountType, g.subtotalCents, g.items.map((i) => i.payee),
    ])).toEqual([
      ['TCS', 'Checking', 31_200_000, ['Ferguson Enterprises', 'Sunbelt Rentals']],
      ['INC', 'Payroll', 17_752_000, ['ADP payroll run']],
    ])
    expect(v.pending.reduce((s: number, g: { subtotalCents: number }) => s + g.subtotalCents, 0)).toBe(v.totals.pendingRollupCents)
    expect(v.accounts.map((a: { name: string; active: boolean }) => [a.name, a.active])).toEqual([['TCS', true], ['INC', true], ['Old Payroll', false]])
    expect(v.today).toBe('2026-09-16')
  })

  it('defaults to Pacific today + AM', async () => {
    world(VIEWER)
    const v = await viewOf('')
    expect(v.ledger).toMatchObject({ ledgerDate: '2026-09-16', period: 'am', id: L_AM })
  })

  it('AM and PM are independent snapshots', async () => {
    world(VIEWER)
    const pm = await viewOf('?date=2026-09-16&period=pm')
    expect(pm.ledger.id).toBe(L_PM)
    expect(pm.adjustments).toEqual([])
    expect(pm.pending.map((g: { accountName: string }) => g.accountName)).toEqual(['TCS', 'INC'])
    expect(pm.totals).toEqual({ beginningCashCents: 100_000, adjustmentsTotalCents: 0, pendingRollupCents: 1_200, currentBalanceCents: 98_800 })
  })

  it('a date with no ledger is a virtual empty one (and reading creates nothing)', async () => {
    const fake = world(CONTROLLER)
    const v = await viewOf('?date=2026-09-17&period=pm')
    expect(v.ledger).toEqual({ id: null, ledgerDate: '2026-09-17', period: 'pm', beginningCashCents: 0, exists: false, updatedAt: null })
    expect(v.adjustments).toEqual([])
    expect(v.pending).toEqual([])
    expect(v.totals.currentBalanceCents).toBe(0)
    expect(writes(fake)).toHaveLength(0)
  })

  it('rejects a bad date or period', async () => {
    world(CONTROLLER)
    for (const qs of ['?date=2026-02-30', '?date=09/16/2026', '?period=noon', '?date=2026-09-16&period=AM']) {
      const r = await api.get(qs)
      expect(r.status, qs).toBe(400)
    }
  })
})

// ── beginning cash + create on demand ───────────────────────────────────────

describe('PUT /api/cmr/ledger — beginning cash', () => {
  it('updates an existing ledger and audits before → after', async () => {
    const fake = world(CONTROLLER)
    const r = await api.begin({ ...AM, beginningCashCents: 50_000_000 })
    expect(r.status).toBe(200)
    expect((await bodyOf(r)).data).toMatchObject({ changed: true, ledger: { id: L_AM, beginningCashCents: 50_000_000 } })
    expect(fake.tables.cmr_daily_ledger.find((l) => l.id === L_AM)!.beginning_cash_cents).toBe(50_000_000)
    expect(fake.tables.cmr_daily_ledger).toHaveLength(2)
    expect(auditCalls()).toEqual([
      expect.objectContaining({
        action: 'cmr.ledger.beginning_cash',
        resourceType: 'cmr_daily_ledger',
        resourceId: L_AM,
        resourceLabel: '2026-09-16 AM',
        userRole: 'cmr:controller',
        metadata: { ledgerDate: '2026-09-16', period: 'am', before: { beginningCashCents: 48_230_000 }, after: { beginningCashCents: 50_000_000 } },
      }),
    ])
    // PM untouched.
    expect(fake.tables.cmr_daily_ledger.find((l) => l.id === L_PM)!.beginning_cash_cents).toBe(100_000)
  })

  it('creates the ledger on demand via an upsert on (ledger_date, period), then sets it', async () => {
    const fake = world(CONTROLLER)
    const r = await api.begin({ date: '2026-09-17', period: 'am', beginningCashCents: -12_345 })
    expect(r.status).toBe(200)
    const upserts = fake.calls.filter((c) => c.op === 'upsert')
    expect(upserts).toHaveLength(1)
    expect(upserts[0]).toMatchObject({ table: 'cmr_daily_ledger', payload: { ledger_date: '2026-09-17', period: 'am', created_by: CONTROLLER } })
    const created = fake.tables.cmr_daily_ledger.filter((l) => l.ledger_date === '2026-09-17')
    expect(created).toHaveLength(1)
    expect(created[0]).toMatchObject({ period: 'am', beginning_cash_cents: -12_345, created_by: CONTROLLER })
    expect(auditCalls().map((a) => a.action)).toEqual(['cmr.ledger.create', 'cmr.ledger.beginning_cash'])
    expect(auditCalls()[1].metadata).toMatchObject({ before: { beginningCashCents: 0 }, after: { beginningCashCents: -12_345 } })

    // Setting the PM for the same day makes a SEPARATE row.
    await api.begin({ date: '2026-09-17', period: 'pm', beginningCashCents: 7 })
    expect(fake.tables.cmr_daily_ledger.filter((l) => l.ledger_date === '2026-09-17').map((l) => [l.period, l.beginning_cash_cents])).toEqual([
      ['am', -12_345],
      ['pm', 7],
    ])
    expect((await viewOf('?date=2026-09-17&period=am')).totals.currentBalanceCents).toBe(-12_345)
  })

  it('no change → no write; $0 on an unsaved ledger does not create one', async () => {
    const fake = world(CONTROLLER)
    const same = await bodyOf(await api.begin({ ...AM, beginningCashCents: 48_230_000 }))
    expect(same.data.changed).toBe(false)
    const zero = await bodyOf(await api.begin({ date: '2026-09-20', period: 'am', beginningCashCents: 0 }))
    expect(zero.data).toMatchObject({ changed: false, ledger: { id: null, exists: false } })
    expect(writes(fake)).toHaveLength(0)
    expect(audit.logAudit).not.toHaveBeenCalled()
  })

  it('validates date, period and whole cents', async () => {
    const fake = world(CONTROLLER)
    for (const body of [
      { ...AM, beginningCashCents: 1.5 },
      { ...AM, beginningCashCents: '100' },
      { ...AM },
      { ...AM, beginningCashCents: 100_000_000_000 },
      { date: '2026-13-01', period: 'am', beginningCashCents: 1 },
      { date: '2026-09-16', period: 'noon', beginningCashCents: 1 },
      'not json',
    ]) {
      expect((await api.begin(body)).status).toBe(400)
    }
    expect(writes(fake)).toHaveLength(0)
  })

  it('an existing row is never duplicated: a racing create resolves to the same (date, period) row', async () => {
    const fake = world(CONTROLLER)
    // Two first writes for a new day, back to back.
    await api.addAdj({ date: '2026-09-18', period: 'pm', description: 'A', amountCents: 1 })
    await api.addPend({ date: '2026-09-18', period: 'pm', accountId: ACC.TCS, payee: 'B', amountCents: 2 })
    const rows = fake.tables.cmr_daily_ledger.filter((l) => l.ledger_date === '2026-09-18')
    expect(rows).toHaveLength(1)
    expect(auditCalls().filter((a) => a.action === 'cmr.ledger.create')).toHaveLength(1)
    // An upsert that hits an existing key with ignoreDuplicates returns nothing and writes nothing.
    const again = await (fake.client.from('cmr_daily_ledger') as unknown as {
      upsert: (r: Row, o: unknown) => { select: (c: string) => Promise<{ data: unknown }> }
    })
      .upsert({ ledger_date: '2026-09-18', period: 'pm', beginning_cash_cents: 0 }, { onConflict: 'ledger_date,period', ignoreDuplicates: true })
      .select('id')
    expect(again.data).toEqual([])
    expect(fake.tables.cmr_daily_ledger.filter((l) => l.ledger_date === '2026-09-18')).toHaveLength(1)
  })
})

// ── adjustments ─────────────────────────────────────────────────────────────

describe('/api/cmr/ledger/adjustments', () => {
  it('adds signed lines (incl. a warn note) at the end; balance follows', async () => {
    const fake = world(CONTROLLER)
    const r1 = await api.addAdj({ ...AM, description: '  Pending deposit —  bank sweep ', amountCents: 5_240_000, warnNote: 'Not available until Thu', note: 'Sweep\nfrom savings' })
    expect(r1.status).toBe(201)
    const a1 = (await bodyOf(r1)).data.adjustment
    expect(a1).toMatchObject({ description: 'Pending deposit — bank sweep', amountCents: 5_240_000, warnNote: 'Not available until Thu', note: 'Sweep\nfrom savings', sortOrder: 2 })
    const row = fake.tables.cmr_ledger_adjustments.find((a) => a.id === a1.id)!
    expect(row).toMatchObject({ daily_ledger_id: L_AM, kind: 'manual', created_by: CONTROLLER })

    const r2 = await api.addAdj({ ...AM, description: 'Bank fee', amountCents: -2_500 })
    expect((await bodyOf(r2)).data.adjustment).toMatchObject({ amountCents: -2_500, warnNote: null, note: null, sortOrder: 3 })

    const v = await viewOf()
    expect(v.adjustments.map((a: { description: string }) => a.description)).toEqual(['Wires from prior week', 'Payroll hold', 'Pending deposit — bank sweep', 'Bank fee'])
    expect(v.totals.adjustmentsTotalCents).toBe(3_800_000 - 2_200_000 + 5_240_000 - 2_500)
    expect(v.totals.currentBalanceCents).toBe(48_230_000 + 6_837_500 - 48_952_000)

    const created = auditCalls().filter((a) => a.action === 'cmr.ledger.adjustment.create')
    expect(created).toHaveLength(2)
    expect(created[0]).toMatchObject({
      resourceType: 'cmr_ledger_adjustments',
      resourceId: a1.id,
      metadata: { ledgerId: L_AM, ledgerDate: '2026-09-16', period: 'am', before: null, after: { description: 'Pending deposit — bank sweep', amountCents: 5_240_000, note: 'Sweep\nfrom savings', warnNote: 'Not available until Thu' } },
    })
    // Adding lines bumps the ledger's updated_at.
    expect(fake.tables.cmr_daily_ledger.find((l) => l.id === L_AM)!.updated_at).not.toBe('2026-09-16T14:14:00Z')
  })

  it('first line on an empty day creates that ledger (and only that period)', async () => {
    const fake = world(CONTROLLER)
    const r = await api.addAdj({ date: '2026-09-19', period: 'pm', description: 'Wire in', amountCents: 100 })
    expect(r.status).toBe(201)
    const l = fake.tables.cmr_daily_ledger.filter((x) => x.ledger_date === '2026-09-19')
    expect(l.map((x) => x.period)).toEqual(['pm'])
    expect(l[0].beginning_cash_cents).toBe(0)
    expect(auditCalls().map((a) => a.action)).toEqual(['cmr.ledger.create', 'cmr.ledger.adjustment.create'])
    expect((await viewOf('?date=2026-09-19&period=am')).ledger.exists).toBe(false)
    expect((await viewOf('?date=2026-09-19&period=pm')).totals.currentBalanceCents).toBe(100)
  })

  it('edits only what changed, audited before → after; no-op edits write nothing', async () => {
    const fake = world(CONTROLLER)
    const r = await api.editAdj({ id: ADJ.HOLD, amountCents: -2_000_000, warnNote: '', note: 'Reduced' })
    expect(r.status).toBe(200)
    expect((await bodyOf(r)).data).toMatchObject({ changed: true, adjustment: { amountCents: -2_000_000, warnNote: null, note: 'Reduced', description: 'Payroll hold' } })
    expect(fake.tables.cmr_ledger_adjustments.find((a) => a.id === ADJ.HOLD)).toMatchObject({ amount_cents: -2_000_000, warn_note: null, note: 'Reduced' })
    expect(auditCalls()).toEqual([
      expect.objectContaining({
        action: 'cmr.ledger.adjustment.update',
        resourceId: ADJ.HOLD,
        metadata: {
          ledgerId: L_AM,
          ledgerDate: '2026-09-16',
          period: 'am',
          before: { amountCents: -2_200_000, note: null, warnNote: 'Cover by 2:00 PM' },
          after: { amountCents: -2_000_000, note: 'Reduced', warnNote: null },
        },
      }),
    ])

    audit.logAudit.mockClear()
    const n = fake.calls.length
    const same = await bodyOf(await api.editAdj({ id: ADJ.HOLD, description: 'Payroll hold', amountCents: -2_000_000 }))
    expect(same.data.changed).toBe(false)
    expect(fake.calls.slice(n).filter((c) => c.op !== 'select')).toHaveLength(0)
    expect(audit.logAudit).not.toHaveBeenCalled()
  })

  it('deletes a line (hard delete) with an audit row holding the full before', async () => {
    const fake = world(CONTROLLER)
    const r = await api.delAdj(ADJ.HOLD)
    expect(r.status).toBe(200)
    expect(fake.tables.cmr_ledger_adjustments.some((a) => a.id === ADJ.HOLD)).toBe(false)
    expect(auditCalls()).toEqual([
      expect.objectContaining({
        action: 'cmr.ledger.adjustment.delete',
        resourceId: ADJ.HOLD,
        resourceLabel: 'Payroll hold',
        metadata: expect.objectContaining({
          ledgerDate: '2026-09-16',
          period: 'am',
          before: { description: 'Payroll hold', amountCents: -2_200_000, note: null, warnNote: 'Cover by 2:00 PM' },
          after: null,
        }),
      }),
    ])
    expect((await viewOf()).totals.adjustmentsTotalCents).toBe(3_800_000)
    expect((await api.delAdj(ADJ.HOLD)).status).toBe(404)
  })

  it('a stored roll-up row is locked (409) — it can be neither edited nor deleted', async () => {
    const fake = world(CONTROLLER)
    expect((await api.editAdj({ id: ADJ.ROLLUP, amountCents: 1 })).status).toBe(409)
    expect((await api.delAdj(ADJ.ROLLUP)).status).toBe(409)
    expect(writes(fake)).toHaveLength(0)
  })

  it('validates input', async () => {
    const fake = world(CONTROLLER)
    const bad = [
      api.addAdj({ ...AM, description: '   ', amountCents: 1 }),
      api.addAdj({ ...AM, description: 'x'.repeat(121), amountCents: 1 }),
      api.addAdj({ ...AM, description: 'x', amountCents: 1.25 }),
      api.addAdj({ ...AM, description: 'x' }),
      api.addAdj({ ...AM, description: 'x', amountCents: 1, warnNote: 'w'.repeat(81) }),
      api.addAdj({ ...AM, description: 'x', amountCents: 1, note: 'n'.repeat(501) }),
      api.addAdj({ date: 'today', period: 'am', description: 'x', amountCents: 1 }),
      api.addAdj({ description: 'x', amountCents: 1 }),
      api.editAdj({ id: 'nope', amountCents: 1 }),
      api.editAdj({ id: ADJ.WIRES }),
      api.editAdj({ id: ADJ.WIRES, description: '' }),
      api.delAdj('nope'),
    ]
    expect((await Promise.all(bad)).map((r) => r.status)).toEqual(Array(12).fill(400))
    expect((await api.editAdj({ id: randomUUID(), amountCents: 1 })).status).toBe(404)
    expect(writes(fake)).toHaveLength(0)
  })

  it('reorders the full set atomically; a stale set is refused (409)', async () => {
    const fake = world(CONTROLLER)
    const r = await api.orderAdj({ ...AM, ids: [ADJ.HOLD, ADJ.WIRES] })
    expect(r.status).toBe(200)
    expect((await bodyOf(r)).data.changed).toBe(true)
    expect(fake.calls.filter((c) => c.op === 'rpc')).toEqual([
      expect.objectContaining({ table: 'cmr_reorder_ledger_adjustments', payload: { p_ledger_id: L_AM, p_ids: [ADJ.HOLD, ADJ.WIRES] } }),
    ])
    expect((await viewOf()).adjustments.map((a: { id: string }) => a.id)).toEqual([ADJ.HOLD, ADJ.WIRES])
    expect(auditCalls()).toEqual([
      expect.objectContaining({
        action: 'cmr.ledger.adjustment.reorder',
        resourceId: L_AM,
        metadata: expect.objectContaining({ before: ['Wires from prior week', 'Payroll hold'], after: ['Payroll hold', 'Wires from prior week'] }),
      }),
    ])

    // Same order again → no write.
    expect((await bodyOf(await api.orderAdj({ ...AM, ids: [ADJ.HOLD, ADJ.WIRES] }))).data.changed).toBe(false)
    // Missing / extra / duplicate / other-ledger ids → STALE or 400.
    for (const ids of [[ADJ.HOLD], [ADJ.HOLD, ADJ.WIRES, ADJ.ROLLUP], [ADJ.HOLD, ADJ.HOLD]]) {
      const s = await api.orderAdj({ ...AM, ids })
      expect(s.status).toBe(409)
      expect((await bodyOf(s)).code).toBe('STALE')
    }
    expect((await api.orderAdj({ ...PM, ids: [ADJ.HOLD, ADJ.WIRES] })).status).toBe(409)
    expect((await api.orderAdj({ date: '2026-01-01', period: 'am', ids: [ADJ.HOLD] })).status).toBe(409)
    expect((await api.orderAdj({ ...AM, ids: [] })).status).toBe(400)
    expect((await api.orderAdj({ ...AM, ids: ['x'] })).status).toBe(400)
    expect(fake.calls.filter((c) => c.op === 'rpc')).toHaveLength(1)
  })
})

// ── pending items ───────────────────────────────────────────────────────────

describe('/api/cmr/ledger/pending', () => {
  it('adds items across ≥2 accounts; subtotals, roll-up and balance follow', async () => {
    const fake = world(CONTROLLER)
    const r1 = await api.addPend({ ...AM, accountId: ACC.INC, payee: ' Blue  Diamond ', amountCents: 1_840_000, notes: 'before 3pm' })
    expect(r1.status).toBe(201)
    const i1 = (await bodyOf(r1)).data.item
    expect(i1).toMatchObject({ payee: 'Blue Diamond', amountCents: 1_840_000, accountName: 'INC', status: 'pending', source: 'manual', notes: 'before 3pm', sortOrder: 1 })
    expect(fake.tables.cmr_pending_items.find((p) => p.id === i1.id)).toMatchObject({
      daily_ledger_id: L_AM,
      account_id: ACC.INC,
      status: 'pending',
      source: 'manual',
      source_ref_id: null,
      original_date: '2026-09-16',
      effective_date: '2026-09-16',
      created_by: CONTROLLER,
    })
    // The insert names effective_date — never the reserved word current_date.
    const insert = fake.calls.find((c) => c.table === 'cmr_pending_items' && c.op === 'insert')!.payload as Row
    expect(insert).toHaveProperty('effective_date', '2026-09-16')
    expect(insert).not.toHaveProperty('current_date')
    const r2 = await api.addPend({ ...AM, accountId: ACC.TCS, payee: 'Teichert', amountCents: 725_000 })
    expect((await bodyOf(r2)).data.item).toMatchObject({ accountName: 'TCS', sortOrder: 2 })
    // A zero amount is allowed (≥ 0).
    expect((await api.addPend({ ...AM, accountId: ACC.TCS, payee: 'TBD', amountCents: 0 })).status).toBe(201)

    const v = await viewOf()
    expect(v.pending.map((g: { accountName: string; subtotalCents: number; items: { payee: string }[] }) => [g.accountName, g.subtotalCents, g.items.map((i) => i.payee)])).toEqual([
      ['TCS', 31_200_000 + 725_000, ['Ferguson Enterprises', 'Sunbelt Rentals', 'Teichert', 'TBD']],
      ['INC', 17_752_000 + 1_840_000, ['ADP payroll run', 'Blue Diamond']],
    ])
    expect(v.totals.pendingRollupCents).toBe(48_952_000 + 2_565_000)
    expect(v.totals.currentBalanceCents).toBe(48_230_000 + 1_600_000 - (48_952_000 + 2_565_000))
    expect(auditCalls().filter((a) => a.action === 'cmr.ledger.pending.create').map((a) => a.metadata?.after)).toEqual([
      { accountId: ACC.INC, accountName: 'INC', payee: 'Blue Diamond', amountCents: 1_840_000, notes: 'before 3pm' },
      { accountId: ACC.TCS, accountName: 'TCS', payee: 'Teichert', amountCents: 725_000, notes: null },
      { accountId: ACC.TCS, accountName: 'TCS', payee: 'TBD', amountCents: 0, notes: null },
    ])
  })

  it('amount must be ≥ 0 whole cents; account must exist and be ACTIVE', async () => {
    const fake = world(CONTROLLER)
    expect((await api.addPend({ ...AM, accountId: ACC.TCS, payee: 'X', amountCents: -1 })).status).toBe(400)
    expect((await api.addPend({ ...AM, accountId: ACC.TCS, payee: 'X', amountCents: 0.5 })).status).toBe(400)
    expect((await api.addPend({ ...AM, accountId: ACC.TCS, payee: 'X', amountCents: 100_000_000_000 })).status).toBe(400)
    expect((await api.addPend({ ...AM, accountId: ACC.TCS, payee: '  ', amountCents: 1 })).status).toBe(400)
    expect((await api.addPend({ ...AM, accountId: ACC.TCS, payee: 'p'.repeat(81), amountCents: 1 })).status).toBe(400)
    expect((await api.addPend({ ...AM, accountId: 'TCS', payee: 'X', amountCents: 1 })).status).toBe(400)
    expect((await api.addPend({ ...AM, payee: 'X', amountCents: 1 })).status).toBe(400)
    expect((await api.addPend({ ...AM, accountId: randomUUID(), payee: 'X', amountCents: 1 })).status).toBe(404)
    const inactive = await api.addPend({ ...AM, accountId: ACC.OLD, payee: 'X', amountCents: 1 })
    expect(inactive.status).toBe(409)
    expect((await bodyOf(inactive)).code).toBe('ACCOUNT_INACTIVE')
    expect((await api.editPend({ id: P.FERG, amountCents: -5 })).status).toBe(400)
    expect((await api.editPend({ id: P.FERG, accountId: ACC.OLD })).status).toBe(409)
    // Nothing written — not even an on-demand ledger for a rejected first write.
    expect(writes(fake)).toHaveLength(0)
    expect((await api.addPend({ date: '2026-09-21', period: 'am', accountId: ACC.OLD, payee: 'X', amountCents: 1 })).status).toBe(409)
    expect(fake.tables.cmr_daily_ledger).toHaveLength(2)
  })

  it('edits (incl. moving to another active account → end of that group), audited before → after', async () => {
    const fake = world(CONTROLLER)
    const r = await api.editPend({ id: P.FERG, accountId: ACC.INC, amountCents: 20_000_000, notes: 'split' })
    expect(r.status).toBe(200)
    expect((await bodyOf(r)).data.item).toMatchObject({ accountName: 'INC', amountCents: 20_000_000, notes: 'split', payee: 'Ferguson Enterprises' })
    expect(fake.tables.cmr_pending_items.find((p) => p.id === P.FERG)).toMatchObject({ account_id: ACC.INC, sort_order: 1, amount_cents: 20_000_000 })
    expect(auditCalls()).toEqual([
      expect.objectContaining({
        action: 'cmr.ledger.pending.update',
        resourceType: 'cmr_pending_items',
        resourceId: P.FERG,
        metadata: {
          ledgerId: L_AM,
          ledgerDate: '2026-09-16',
          period: 'am',
          before: { accountId: ACC.TCS, accountName: 'TCS', amountCents: 21_000_000, notes: null },
          after: { accountId: ACC.INC, accountName: 'INC', amountCents: 20_000_000, notes: 'split' },
        },
      }),
    ])
    const v = await viewOf()
    expect(v.pending.map((g: { accountName: string; subtotalCents: number }) => [g.accountName, g.subtotalCents])).toEqual([
      ['TCS', 10_200_000],
      ['INC', 37_752_000],
    ])
  })

  it('an item on a since-deactivated account can still be edited in place (account unchanged)', async () => {
    const t = seed()
    t.cmr_pending_items.push(pend({ id: randomUUID(), payee: 'Legacy', amount_cents: 1, account_id: ACC.OLD }))
    const fake = world(CONTROLLER, t)
    const id = fake.tables.cmr_pending_items.find((p) => p.payee === 'Legacy')!.id as string
    expect((await api.editPend({ id, payee: 'Legacy 2', accountId: ACC.OLD })).status).toBe(200)
  })

  it('deletes a manual item (hard delete) with a full-before audit row', async () => {
    const fake = world(CONTROLLER)
    expect((await api.delPend(P.SUN)).status).toBe(200)
    expect(fake.tables.cmr_pending_items.some((p) => p.id === P.SUN)).toBe(false)
    expect(auditCalls()).toEqual([
      expect.objectContaining({
        action: 'cmr.ledger.pending.delete',
        resourceId: P.SUN,
        metadata: expect.objectContaining({
          before: { accountId: ACC.TCS, accountName: 'TCS', payee: 'Sunbelt Rentals', amountCents: 10_200_000, notes: null },
          after: null,
        }),
      }),
    ])
    expect((await viewOf()).totals.pendingRollupCents).toBe(48_952_000 - 10_200_000)
    expect((await api.delPend(P.SUN)).status).toBe(404)
  })

  it('paid / pushed items and request / recurring items are not editable or deletable here (409)', async () => {
    const fake = world(CONTROLLER)
    for (const id of [P.PAID, P.REQ]) {
      const e = await api.editPend({ id, payee: 'x' })
      expect(e.status).toBe(409)
      expect((await bodyOf(e)).code).toBe('NOT_EDITABLE')
      expect((await api.delPend(id)).status).toBe(409)
    }
    expect(writes(fake)).toHaveLength(0)
  })

  it('reorders within ONE account group; the set must match that group exactly', async () => {
    const fake = world(CONTROLLER)
    const r = await api.orderPend({ ...AM, accountId: ACC.TCS, ids: [P.SUN, P.FERG] })
    expect(r.status).toBe(200)
    expect(fake.calls.filter((c) => c.op === 'rpc')).toEqual([
      expect.objectContaining({ table: 'cmr_reorder_pending_items', payload: { p_ledger_id: L_AM, p_ids: [P.SUN, P.FERG] } }),
    ])
    expect((await viewOf()).pending[0].items.map((i: { id: string }) => i.id)).toEqual([P.SUN, P.FERG])
    expect(auditCalls()).toEqual([
      expect.objectContaining({
        action: 'cmr.ledger.pending.reorder',
        resourceLabel: '2026-09-16 AM · TCS',
        metadata: expect.objectContaining({ accountId: ACC.TCS, before: ['Ferguson Enterprises', 'Sunbelt Rentals'], after: ['Sunbelt Rentals', 'Ferguson Enterprises'] }),
      }),
    ])
    // Cross-group or partial lists are stale.
    for (const body of [
      { ...AM, accountId: ACC.TCS, ids: [P.SUN] },
      { ...AM, accountId: ACC.TCS, ids: [P.SUN, P.FERG, P.ADP] },
      { ...AM, accountId: ACC.INC, ids: [P.SUN, P.FERG] },
      { ...PM, accountId: ACC.TCS, ids: [P.SUN, P.FERG] },
    ]) {
      expect((await api.orderPend(body)).status).toBe(409)
    }
    expect((await api.orderPend({ ...AM, ids: [P.SUN, P.FERG] })).status).toBe(400)
    expect(fake.calls.filter((c) => c.op === 'rpc')).toHaveLength(1)
  })
})

// ── the acceptance walk-through ─────────────────────────────────────────────

describe('controller walk-through on a fresh day (acceptance)', () => {
  it('beginning cash, signed adjustments incl. a warn note, pending across 2 accounts; AM/PM independent; every mutation audited', async () => {
    const fake = world(CONTROLLER, { cmr_daily_ledger: [], cmr_ledger_adjustments: [], cmr_pending_items: [] })
    const D = { date: '2026-10-05', period: 'am' }

    expect((await api.begin({ ...D, beginningCashCents: 48_230_000 })).status).toBe(200)
    expect((await api.addAdj({ ...D, description: 'Wires from prior week', amountCents: 3_800_000 })).status).toBe(201)
    expect((await api.addAdj({ ...D, description: 'Pending deposit', amountCents: 5_240_000, warnNote: 'Not available until Thu' })).status).toBe(201)
    expect((await api.addAdj({ ...D, description: 'Payroll hold', amountCents: -2_200_000, warnNote: 'Cover by 2:00 PM' })).status).toBe(201)
    expect((await api.addPend({ ...D, accountId: ACC.TCS, payee: 'Ferguson', amountCents: 21_000_000 })).status).toBe(201)
    expect((await api.addPend({ ...D, accountId: ACC.TCS, payee: 'Sunbelt', amountCents: 10_200_000 })).status).toBe(201)
    expect((await api.addPend({ ...D, accountId: ACC.INC, payee: 'ADP', amountCents: 17_752_000 })).status).toBe(201)
    // PM gets its own, different numbers.
    expect((await api.begin({ date: '2026-10-05', period: 'pm', beginningCashCents: 1_000 })).status).toBe(200)
    expect((await api.addPend({ date: '2026-10-05', period: 'pm', accountId: ACC.INC, payee: 'PM only', amountCents: 400 })).status).toBe(201)

    const am = await viewOf('?date=2026-10-05&period=am')
    expect(am.totals).toEqual({ beginningCashCents: 48_230_000, adjustmentsTotalCents: 6_840_000, pendingRollupCents: 48_952_000, currentBalanceCents: 6_118_000 })
    expect(am.pending.map((g: { accountName: string; subtotalCents: number }) => [g.accountName, g.subtotalCents])).toEqual([['TCS', 31_200_000], ['INC', 17_752_000]])
    expect(am.adjustments.filter((a: { warnNote: string | null }) => a.warnNote).map((a: { warnNote: string }) => a.warnNote)).toEqual(['Not available until Thu', 'Cover by 2:00 PM'])

    const pm = await viewOf('?date=2026-10-05&period=pm')
    expect(pm.totals).toEqual({ beginningCashCents: 1_000, adjustmentsTotalCents: 0, pendingRollupCents: 400, currentBalanceCents: 600 })
    expect(pm.ledger.id).not.toBe(am.ledger.id)
    expect(fake.tables.cmr_daily_ledger.map((l) => l.period)).toEqual(['am', 'pm'])

    expect(auditCalls().map((a) => a.action)).toEqual([
      'cmr.ledger.create',
      'cmr.ledger.beginning_cash',
      'cmr.ledger.adjustment.create',
      'cmr.ledger.adjustment.create',
      'cmr.ledger.adjustment.create',
      'cmr.ledger.pending.create',
      'cmr.ledger.pending.create',
      'cmr.ledger.pending.create',
      'cmr.ledger.create',
      'cmr.ledger.beginning_cash',
      'cmr.ledger.pending.create',
    ])
    expect(auditCalls().every((a) => a.userRole === 'cmr:controller')).toBe(true)
  })
})
