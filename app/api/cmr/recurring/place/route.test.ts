import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fakeSupabase, fakeRouteClient } from '@/lib/cmr/__testing__/fakeSupabase'

/**
 * Phase 7 — accepting a DUE recurring vendor, and the rollup that surfaces it.
 *
 *   • CONTROLLER ONLY: requester / viewer / no-grant / platform admin → 403 on accept and
 *     nothing written; all of them still READ the rollup (200, canEdit false); no session → 401
 *   • accepting into PENDING writes a source = 'recurring' item pointing at the vendor, and
 *     accepting into a PRIORITY writes source_recurring_id — either way the vendor drops off
 *     "due" on the very next rollup read
 *   • the same occurrence can't be accepted twice: the second attempt is refused with
 *     ALREADY_HANDLED and writes nothing
 *   • a vendor that is urgent, inactive, on hold or without a schedule is refused
 *   • the amount entered is the last amount sent when there is one, and it is remembered
 *   • each accept is audited as cmr.recurring.place
 *   • the by-frequency totals and the account filter come out of the one rollup response
 */

const server = vi.hoisted(() => ({ routeClient: null as unknown, serviceClient: null as unknown }))
vi.mock('@/lib/supabase/server', () => ({
  createRouteClient: () => server.routeClient,
  createServerClient: () => server.routeClient,
  createServiceClient: () => server.serviceClient,
}))
const audit = vi.hoisted(() => ({ logAudit: vi.fn(async (_p: unknown) => {}) }))
vi.mock('@/lib/audit/log', () => ({ logAudit: audit.logAudit, getClientIp: () => null }))
// Sun 2026-09-13 … Sat 2026-09-19 is "this week" for every test below.
vi.mock('@/lib/utils/date', async (orig) => ({
  ...(await orig<typeof import('@/lib/utils/date')>()),
  pacificToday: () => '2026-09-16',
}))

import * as placeRoute from './route'
import * as rollupRoute from '../../rollup/route'
import { rollupRecurringTotals, dueThisWeek, type CmrRollupView } from '@/lib/cmr/rollup'

const ADMIN = '00000000-0000-4000-8000-00000000a0a0'
const CONTROLLER = '00000000-0000-4000-8000-00000000c0c0'
const REQUESTER = '00000000-0000-4000-8000-00000000e0e0'
const VIEWER = '00000000-0000-4000-8000-00000000f0f0'
const STRANGER = '00000000-0000-4000-8000-00000000d0d0'

const ACC = {
  TCS: '10000000-0000-4000-8000-000000000001',
  STS: '10000000-0000-4000-8000-000000000002',
  OLD: '10000000-0000-4000-8000-000000000003',
}
const V = {
  WEEKLY: '20000000-0000-4000-8000-000000000001',
  MONTHLY: '20000000-0000-4000-8000-000000000002',
  QUARTERLY: '20000000-0000-4000-8000-000000000003',
  ANNUAL: '20000000-0000-4000-8000-000000000004',
  URGENT: '20000000-0000-4000-8000-000000000005',
  HELD: '20000000-0000-4000-8000-000000000006',
  INACTIVE: '20000000-0000-4000-8000-000000000007',
  NOSCHED: '20000000-0000-4000-8000-000000000008',
  MISSING: '20000000-0000-4000-8000-0000000000ff',
}
const WEEK = '2026-09-13'

type Row = Record<string, unknown>

const vendor = (over: Row): Row => ({
  account_id: ACC.TCS,
  amount_cents: 100_00,
  section: 'weekly',
  schedule_weekday: null,
  schedule_day_of_month: null,
  schedule_anchor_month: null,
  last_amount_sent_cents: null,
  plan_terms: null,
  plan_due_date: null,
  notes: null,
  on_hold: false,
  active: true,
  sort_order: 0,
  created_by: CONTROLLER,
  created_at: '2026-09-01T10:00:00Z',
  ...over,
})

const seedVendors = (): Row[] => [
  // Thursday 2026-09-17
  vendor({ id: V.WEEKLY, vendor_name: 'Fuel card', schedule_weekday: 4, amount_cents: 120_00 }),
  // the 15th, and a last amount sent that differs from the standing figure
  vendor({
    id: V.MONTHLY, vendor_name: 'Yard rent', section: 'monthly', schedule_day_of_month: 15,
    amount_cents: 2500_00, last_amount_sent_cents: 2499_99, account_id: ACC.STS, notes: 'Landlord: Bob',
  }),
  // the 10th of Feb/May/Aug/Nov → 2026-08-10, whose quarter window runs Aug 1 – Oct 31
  vendor({
    id: V.QUARTERLY, vendor_name: 'Workers comp', section: 'quarterly',
    schedule_day_of_month: 10, schedule_anchor_month: 2, amount_cents: 5000_00, account_id: ACC.STS,
  }),
  // the 1st of September
  vendor({
    id: V.ANNUAL, vendor_name: 'Permit renewal', section: 'annually',
    schedule_day_of_month: 1, schedule_anchor_month: 9, amount_cents: 750_00,
  }),
  vendor({ id: V.URGENT, vendor_name: 'IRS plan', section: 'urgent', plan_terms: '$1,500/wk' }),
  vendor({ id: V.HELD, vendor_name: 'Tire shop', schedule_weekday: 1, on_hold: true }),
  vendor({ id: V.INACTIVE, vendor_name: 'Old uniforms', schedule_weekday: 2, active: false }),
  vendor({ id: V.NOSCHED, vendor_name: 'Unset vendor', section: 'monthly' }),
]

/** The database's own re-check, mirrored: lock the vendor, refuse a window already handled. */
function placementRpc(table: 'cmr_pending_items' | 'cmr_weekly_priorities') {
  return (args: Record<string, unknown>, t: Record<string, Row[]>) => {
    const v = (t.cmr_recurring_vendors ?? []).find((r) => r.id === args.p_vendor_id)
    if (!v) return { message: 'NOT_FOUND' }
    if (v.section === 'urgent') return { message: 'NOT_SCHEDULED' }
    if (!v.active) return { message: 'INACTIVE' }
    if (v.on_hold) return { message: 'ON_HOLD' }
    const ws = args.p_window_start as string
    const we = args.p_window_end as string
    const handledPending = (t.cmr_pending_items ?? []).some(
      (r) => r.source === 'recurring' && r.source_ref_id === args.p_vendor_id &&
        typeof r.effective_date === 'string' && r.effective_date >= ws && r.effective_date <= we,
    )
    const handledPriority = (t.cmr_weekly_priorities ?? []).some((r) => {
      if (r.source_recurring_id !== args.p_vendor_id || typeof r.week_start !== 'string') return false
      const [y, m, d] = r.week_start.split('-').map(Number)
      const end = new Date(Date.UTC(y, m - 1, d + 6)).toISOString().slice(0, 10)
      return r.week_start <= we && end >= ws
    })
    if (handledPending || handledPriority) return { message: 'ALREADY_HANDLED' }

    const id = `${table === 'cmr_pending_items' ? '50' : '60'}000000-0000-4000-8000-${String(
      (t[table] ?? []).length + 1,
    ).padStart(12, '0')}`
    const row: Row =
      table === 'cmr_pending_items'
        ? {
            id, daily_ledger_id: args.p_ledger_id, account_id: args.p_account_id, payee: args.p_payee,
            amount_cents: args.p_amount_cents, status: 'pending', original_date: args.p_date,
            effective_date: args.p_date, paid_at: null, paid_by: null, source: 'recurring',
            source_ref_id: args.p_vendor_id, pushed_from_id: null, notes: args.p_notes,
            sort_order: args.p_sort_order, created_by: args.p_actor, created_at: '2026-09-16T14:00:00Z',
          }
        : {
            id, week_start: args.p_week_start, description: args.p_description, amount_cents: args.p_amount_cents,
            due_date: args.p_due_date, notes: args.p_notes, is_top_priority: false, status: 'open',
            carried_from_id: null, source_recurring_id: args.p_vendor_id, paid_at: null, paid_by: null,
            sort_order: args.p_sort_order, created_by: args.p_actor, created_at: '2026-09-16T14:00:00Z',
          }
    ;(t[table] ??= []).push(row)
    if (args.p_last_amount_cents != null) v.last_amount_sent_cents = args.p_last_amount_cents
    return { data: id }
  }
}

function world(userId: string | null, over: Record<string, Row[]> = {}) {
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
        { id: ACC.STS, name: 'STS', account_type: 'Checking', active: true, sort_order: 1 },
        { id: ACC.OLD, name: 'Old Payroll', account_type: null, active: false, sort_order: 2 },
      ],
      cmr_recurring_vendors: seedVendors(),
      cmr_daily_ledger: [],
      cmr_ledger_adjustments: [],
      cmr_pending_items: [],
      cmr_weekly_priorities: [],
      ...over,
    },
    {
      defaults: { cmr_daily_ledger: () => ({ id: `30000000-0000-4000-8000-00000000000${Math.floor(Math.random() * 9) + 1}` }) },
      rpc: {
        cmr_place_recurring_pending: placementRpc('cmr_pending_items'),
        cmr_place_recurring_priority: placementRpc('cmr_weekly_priorities'),
      },
    },
  )
  server.routeClient = fakeRouteClient(userId)
  server.serviceClient = fake.client
  return fake
}

const base = 'https://cmr.safetynetworkteams.com/api/cmr'
const post = (body: unknown) =>
  placeRoute.POST(
    new Request(`${base}/recurring/place`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
const rollup = (week = WEEK) => rollupRoute.GET(new Request(`${base}/rollup?week=${week}`))

const writes = (fake: ReturnType<typeof world>) => fake.calls.filter((c) => c.op !== 'select')
type AuditArg = { action: string; resourceId?: string; resourceLabel?: string; resourceType?: string; userRole?: string; metadata?: Record<string, unknown> }
const auditCalls = () => audit.logAudit.mock.calls.map((c) => c[0] as AuditArg)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const bodyOf = async (r: Response) => (await r.json()) as { success: boolean; data?: any; error?: string; code?: string }
const viewOf = async (r: Response): Promise<CmrRollupView> => (await bodyOf(r)).data as CmrRollupView
const stateOf = (view: CmrRollupView, id: string) => view.recurring.find((v) => v.vendorId === id)

beforeEach(() => { audit.logAudit.mockClear() })
afterEach(() => { vi.restoreAllMocks() })

// ── access ──────────────────────────────────────────────────────────────────

describe('accept a suggestion — access', () => {
  it('both route files export only HTTP handlers + dynamic (BUG-019)', () => {
    const allowed = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'dynamic'])
    for (const mod of [placeRoute, rollupRoute]) {
      for (const k of Object.keys(mod)) expect(allowed.has(k), k).toBe(true)
      expect((mod as { dynamic?: string }).dynamic).toBe('force-dynamic')
    }
  })

  for (const [label, uid] of [['platform admin', ADMIN], ['stranger', STRANGER], ['requester', REQUESTER], ['viewer', VIEWER]] as const) {
    it(`${label} cannot accept a suggestion (403) and nothing is written`, async () => {
      const fake = world(uid)
      const r = await post({ id: V.WEEKLY, week: WEEK, target: 'pending', date: '2026-09-17', period: 'am' })
      expect(r.status).toBe(403)
      expect(writes(fake)).toHaveLength(0)
      expect(audit.logAudit).not.toHaveBeenCalled()
      expect(fake.tables.cmr_pending_items).toHaveLength(0)
    })
  }

  for (const [label, uid, can] of [['requester', REQUESTER, false], ['viewer', VIEWER, false], ['controller', CONTROLLER, true]] as const) {
    it(`${label} reads the rollup (canEdit ${can})`, async () => {
      world(uid)
      const r = await rollup()
      expect(r.status).toBe(200)
      const view = await viewOf(r)
      expect(view.canEdit).toBe(can)
      expect(view.weekStart).toBe(WEEK)
      expect(view.recurring.length).toBeGreaterThan(0)
    })
  }

  for (const [label, uid] of [['platform admin', ADMIN], ['stranger', STRANGER]] as const) {
    it(`${label} cannot read the rollup either (403)`, async () => {
      world(uid)
      expect((await rollup()).status).toBe(403)
    })
  }

  it('no session → 401 on both', async () => {
    world(null)
    expect((await post({ id: V.WEEKLY, week: WEEK, target: 'pending' })).status).toBe(401)
    expect((await rollup()).status).toBe(401)
  })
})

// ── what the rollup says is due ─────────────────────────────────────────────

describe('the rollup', () => {
  it('surfaces one occurrence per frequency and leaves the rest alone', async () => {
    world(CONTROLLER)
    const view = await viewOf(await rollup())

    expect(stateOf(view, V.WEEKLY)).toMatchObject({ state: 'due', occurrenceDate: '2026-09-17', scheduleText: 'Every Thursday' })
    expect(stateOf(view, V.MONTHLY)).toMatchObject({ state: 'due', occurrenceDate: '2026-09-15', suggestedCents: 2499_99 })
    expect(stateOf(view, V.QUARTERLY)).toMatchObject({ state: 'due', occurrenceDate: '2026-08-10' })
    expect(stateOf(view, V.ANNUAL)).toMatchObject({ state: 'due', occurrenceDate: '2026-09-01' })

    for (const id of [V.URGENT, V.HELD, V.INACTIVE, V.NOSCHED]) {
      expect(stateOf(view, id), id).toMatchObject({ state: 'unscheduled', occurrenceDate: null })
    }
    expect(stateOf(view, V.NOSCHED)?.scheduleText).toBe('No schedule set')
    expect(stateOf(view, V.URGENT)?.scheduleText).toBe('No fixed schedule')
  })

  it('totals by frequency, and the account filter narrows them', async () => {
    world(CONTROLLER)
    const view = await viewOf(await rollup())
    const all = rollupRecurringTotals(view.recurring)
    expect(all.map((t) => [t.frequency, t.vendorCount, t.dueCents])).toEqual([
      ['weekly', 1, 120_00],
      ['monthly', 1, 2499_99],
      ['quarterly', 1, 5000_00],
      ['annually', 1, 750_00],
    ])

    const tcs = rollupRecurringTotals(view.recurring, ACC.TCS)
    expect(tcs.map((t) => [t.frequency, t.vendorCount])).toEqual([['weekly', 1], ['monthly', 0], ['quarterly', 0], ['annually', 1]])
    const sts = rollupRecurringTotals(view.recurring, ACC.STS)
    expect(sts.map((t) => [t.frequency, t.vendorCount])).toEqual([['weekly', 0], ['monthly', 1], ['quarterly', 1], ['annually', 0]])

    expect(dueThisWeek(view.recurring).map((x) => x.vendorName)).toEqual([
      'Workers comp', 'Permit renewal', 'Yard rent', 'Fuel card',
    ])
    expect(dueThisWeek(view.recurring, ACC.STS).map((x) => x.vendorName)).toEqual(['Workers comp', 'Yard rent'])
  })

  it('a week with no saved snapshot reports none rather than a zero balance', async () => {
    world(CONTROLLER)
    const view = await viewOf(await rollup())
    expect(view.days).toHaveLength(7)
    expect(view.days.map((d) => d.date)[0]).toBe('2026-09-13')
    expect(view.cash).toMatchObject({ snapshotCount: 0, openingDate: null, closingDate: null })
    expect(view.pending).toMatchObject({ totalCents: 0, count: 0 })
  })

  it('reads each day’s saved snapshots and their derived balance', async () => {
    const LEDGER = '30000000-0000-4000-8000-000000000001'
    world(CONTROLLER, {
      cmr_daily_ledger: [
        { id: LEDGER, ledger_date: '2026-09-16', period: 'pm', beginning_cash_cents: 1000_00, created_by: CONTROLLER, created_at: 'x', updated_at: 'x' },
      ],
      cmr_ledger_adjustments: [
        { id: 'a1', daily_ledger_id: LEDGER, description: 'Deposit', amount_cents: 250_00, note: null, warn_note: null, kind: 'manual', sort_order: 0, created_by: CONTROLLER, created_at: 'x' },
        { id: 'a2', daily_ledger_id: LEDGER, description: 'Derived', amount_cents: 999_00, note: null, warn_note: null, kind: 'pending_rollup', sort_order: 1, created_by: CONTROLLER, created_at: 'x' },
      ],
      cmr_pending_items: [
        { id: 'p1', daily_ledger_id: LEDGER, account_id: ACC.TCS, payee: 'Vendor', amount_cents: 300_00, status: 'pending', original_date: '2026-09-16', effective_date: '2026-09-16', paid_at: null, paid_by: null, source: 'manual', source_ref_id: null, pushed_from_id: null, notes: null, sort_order: 0, created_by: CONTROLLER, created_at: 'x' },
        { id: 'p2', daily_ledger_id: LEDGER, account_id: ACC.TCS, payee: 'Moved on', amount_cents: 900_00, status: 'pushed', original_date: '2026-09-16', effective_date: '2026-09-16', paid_at: null, paid_by: null, source: 'manual', source_ref_id: null, pushed_from_id: null, notes: null, sort_order: 1, created_by: CONTROLLER, created_at: 'x' },
      ],
    })
    const view = await viewOf(await rollup())
    const wed = view.days.find((d) => d.date === '2026-09-16')!
    expect(wed.am).toBeNull()
    // the derived pending_rollup line is never counted twice; a pushed item counts elsewhere
    expect(wed.pm).toMatchObject({
      beginningCashCents: 1000_00, adjustmentsTotalCents: 250_00, pendingRollupCents: 300_00, currentBalanceCents: 950_00,
    })
    expect(view.cash).toMatchObject({ snapshotCount: 1, openingCents: 1000_00, closingCents: 950_00, closingPeriod: 'pm' })
    expect(view.pending).toMatchObject({ totalCents: 300_00, openCents: 300_00, count: 1 })
  })
})

// ── accepting ───────────────────────────────────────────────────────────────

describe('accept into the daily pending list', () => {
  it('writes a recurring-sourced item and the vendor leaves the due list', async () => {
    const fake = world(CONTROLLER)
    const r = await post({ id: V.WEEKLY, week: WEEK, target: 'pending', date: '2026-09-17', period: 'am' })
    expect(r.status).toBe(200)
    const { data } = await bodyOf(r)
    expect(data.placedKind).toBe('pending')
    expect(data.where).toBe('2026-09-17 AM')

    const item = fake.tables.cmr_pending_items[0]
    expect(item).toMatchObject({
      source: 'recurring', source_ref_id: V.WEEKLY, payee: 'Fuel card', amount_cents: 120_00,
      account_id: ACC.TCS, status: 'pending', effective_date: '2026-09-17', created_by: CONTROLLER,
    })

    const view = await viewOf(await rollup())
    expect(stateOf(view, V.WEEKLY)).toMatchObject({ state: 'handled', handledBy: 'pending' })
    expect(dueThisWeek(view.recurring).map((x) => x.vendorId)).not.toContain(V.WEEKLY)
  })

  it('enters the last amount sent when there is one, and remembers it', async () => {
    const fake = world(CONTROLLER)
    await post({ id: V.MONTHLY, week: WEEK, target: 'pending', date: '2026-09-15', period: 'pm' })
    expect(fake.tables.cmr_pending_items[0]).toMatchObject({ amount_cents: 2499_99, payee: 'Yard rent', notes: 'Landlord: Bob' })
    expect(fake.tables.cmr_recurring_vendors.find((v) => v.id === V.MONTHLY)).toMatchObject({ last_amount_sent_cents: 2499_99 })
  })

  it('defaults to the scheduled day, AM, when none is given', async () => {
    const fake = world(CONTROLLER)
    await post({ id: V.ANNUAL, week: WEEK, target: 'pending' })
    expect(fake.tables.cmr_pending_items[0]).toMatchObject({ effective_date: '2026-09-01' })
  })

  it('creates the ledger for that day on demand', async () => {
    const fake = world(CONTROLLER)
    expect(fake.tables.cmr_daily_ledger).toHaveLength(0)
    await post({ id: V.WEEKLY, week: WEEK, target: 'pending', date: '2026-09-17', period: 'pm' })
    expect(fake.tables.cmr_daily_ledger).toHaveLength(1)
    expect(fake.tables.cmr_daily_ledger[0]).toMatchObject({ ledger_date: '2026-09-17', period: 'pm', beginning_cash_cents: 0 })
  })

  it('refuses a second accept for the same occurrence and writes nothing', async () => {
    const fake = world(CONTROLLER)
    expect((await post({ id: V.WEEKLY, week: WEEK, target: 'pending', date: '2026-09-17', period: 'am' })).status).toBe(200)
    const again = await post({ id: V.WEEKLY, week: WEEK, target: 'pending', date: '2026-09-18', period: 'am' })
    expect(again.status).toBe(409)
    const body = await bodyOf(again)
    expect(body.code).toBe('ALREADY_HANDLED')
    expect(body.error).toMatch(/already been added for this period/)
    expect(fake.tables.cmr_pending_items).toHaveLength(1)
  })

  it('the account must still be active', async () => {
    const fake = world(CONTROLLER, {
      cmr_recurring_vendors: [vendor({ id: V.WEEKLY, vendor_name: 'Fuel card', schedule_weekday: 4, account_id: ACC.OLD })],
    })
    const r = await post({ id: V.WEEKLY, week: WEEK, target: 'pending', date: '2026-09-17', period: 'am' })
    expect(r.status).toBe(409)
    expect((await bodyOf(r)).code).toBe('ACCOUNT_INACTIVE')
    expect(fake.tables.cmr_pending_items).toHaveLength(0)
  })
})

describe('accept into a weekly priority', () => {
  it('writes an open priority stamped with the vendor and it leaves the due list', async () => {
    const fake = world(CONTROLLER)
    const r = await post({ id: V.QUARTERLY, week: WEEK, target: 'priority', weekStart: WEEK })
    expect(r.status).toBe(200)
    expect((await bodyOf(r)).data.placedKind).toBe('priority')

    expect(fake.tables.cmr_weekly_priorities[0]).toMatchObject({
      source_recurring_id: V.QUARTERLY, description: 'Workers comp', amount_cents: 5000_00,
      week_start: WEEK, status: 'open', is_top_priority: false, due_date: '2026-08-10', created_by: CONTROLLER,
    })

    const view = await viewOf(await rollup())
    expect(stateOf(view, V.QUARTERLY)).toMatchObject({ state: 'handled', handledBy: 'priority' })
    expect(dueThisWeek(view.recurring).map((x) => x.vendorId)).not.toContain(V.QUARTERLY)
  })

  it('a priority already handles the occurrence, so pending is refused too', async () => {
    const fake = world(CONTROLLER)
    expect((await post({ id: V.WEEKLY, week: WEEK, target: 'priority', weekStart: WEEK })).status).toBe(200)
    const r = await post({ id: V.WEEKLY, week: WEEK, target: 'pending', date: '2026-09-17', period: 'am' })
    expect(r.status).toBe(409)
    expect(fake.tables.cmr_pending_items).toHaveLength(0)
  })

  it('any day resolves to its Sunday', async () => {
    const fake = world(CONTROLLER)
    await post({ id: V.ANNUAL, week: WEEK, target: 'priority', weekStart: '2026-09-17' })
    expect(fake.tables.cmr_weekly_priorities[0]).toMatchObject({ week_start: WEEK })
  })
})

describe('accept — what cannot be accepted', () => {
  for (const [label, id, code] of [
    ['an urgent payment plan', V.URGENT, 'NOT_SCHEDULED'],
    ['an inactive vendor', V.INACTIVE, 'INACTIVE'],
    ['a vendor on hold', V.HELD, 'ON_HOLD'],
    ['a vendor with no schedule', V.NOSCHED, 'NO_SCHEDULE'],
  ] as const) {
    it(`${label} is refused (409) and nothing is written`, async () => {
      const fake = world(CONTROLLER)
      const r = await post({ id, week: WEEK, target: 'pending', date: '2026-09-17', period: 'am' })
      expect(r.status).toBe(409)
      expect((await bodyOf(r)).code).toBe(code)
      expect(fake.tables.cmr_pending_items).toHaveLength(0)
      expect(audit.logAudit).not.toHaveBeenCalled()
    })
  }

  it('a vendor that does not exist is a 404', async () => {
    world(CONTROLLER)
    const r = await post({ id: V.MISSING, week: WEEK, target: 'pending', date: '2026-09-17', period: 'am' })
    expect(r.status).toBe(404)
  })

  it('validates the id, the target and the week', async () => {
    const fake = world(CONTROLLER)
    const cases: [unknown, RegExp][] = [
      [{ week: WEEK, target: 'pending' }, /Choose a vendor/],
      [{ id: 'nope', week: WEEK, target: 'pending' }, /Choose a vendor/],
      [{ id: V.WEEKLY, week: WEEK }, /Choose where to add it/],
      [{ id: V.WEEKLY, week: WEEK, target: 'ledger' }, /Choose where to add it/],
      [{ id: V.WEEKLY, week: 'not-a-week', target: 'pending' }, /Choose a valid week/],
      [{ id: V.WEEKLY, week: WEEK, target: 'pending', date: '2026-02-30' }, /valid date/],
      [{ id: V.WEEKLY, week: WEEK, target: 'pending', date: '2026-09-17', period: 'noon' }, /AM or PM/],
    ]
    for (const [body, msg] of cases) {
      const r = await post(body)
      expect(r.status, JSON.stringify(body)).toBe(400)
      expect((await bodyOf(r)).error).toMatch(msg)
    }
    expect(fake.tables.cmr_pending_items).toHaveLength(0)
    expect(audit.logAudit).not.toHaveBeenCalled()
  })
})

describe('accept — the audit trail', () => {
  it('records each accept with the occurrence it was for', async () => {
    world(CONTROLLER)
    await post({ id: V.WEEKLY, week: WEEK, target: 'pending', date: '2026-09-17', period: 'am' })
    await post({ id: V.MONTHLY, week: WEEK, target: 'priority', weekStart: WEEK })

    // Opening the day's ledger is audited on its own; the accepts are what this asserts.
    expect(auditCalls().map((c) => c.action)).toEqual(['cmr.ledger.create', 'cmr.recurring.place', 'cmr.recurring.place'])
    const calls = auditCalls().filter((c) => c.action === 'cmr.recurring.place')
    expect(calls[0]).toMatchObject({
      resourceType: 'cmr_recurring_vendors', resourceId: V.WEEKLY, resourceLabel: 'Fuel card', userRole: 'cmr:controller',
    })
    expect(calls[0].metadata).toMatchObject({
      target: 'pending', week: WEEK, schedule: 'Every Thursday', occurrenceDate: '2026-09-17',
      occurrenceWindow: { start: '2026-09-13', end: '2026-09-19' }, amountCents: 120_00, accountName: 'TCS',
    })
    expect(calls[1].metadata).toMatchObject({
      target: 'priority', occurrenceDate: '2026-09-15',
      occurrenceWindow: { start: '2026-09-01', end: '2026-09-30' }, amountCents: 2499_99,
    })
  })
})
