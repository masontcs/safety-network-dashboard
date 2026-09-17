import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import { fakeSupabase, fakeRouteClient } from '@/lib/cmr/__testing__/fakeSupabase'

/**
 * Phase 6, the daily-ledger half: PUSH a pending item to another day, and the paid CHECK-OFF.
 *
 *   • push defaults to the NEXT CALENDAR DAY, same snapshot, and honours a chosen day/period
 *   • the original stays where it was, flipped to 'pushed' — so it drops out of that day's
 *     pending roll-up and off its balance — and the forward copy is a plain 'manual' pending
 *     item with original_date preserved and pushed_from_id pointing back
 *   • a paid or already-pushed item can't be pushed (409); nor can it be pushed onto the day it
 *     is already on
 *   • pay stamps paid_at + paid_by and keeps counting that day; unpay clears the stamp; a
 *     pushed item can't be paid
 *   • the check-off works on a placed-request item too (paying is about the money, not the
 *     source), but never together with a field edit
 *   • UN-PUSH reverses it: the copy is deleted and the original goes back to 'pending' on its
 *     own day, so the amount counts there again. Refused once the copy was paid or pushed on.
 *   • the safety net: deleting a forward copy by ANY route revives its source, so no sequence
 *     leaves a pushed amount on no ledger at all
 *   • CONTROLLER ONLY: requester / viewer / no-grant / platform admin → 403, nothing written
 *   • every action is audited (cmr.pending.push / .unpush / .pay / .unpay)
 */

const server = vi.hoisted(() => ({ routeClient: null as unknown, serviceClient: null as unknown }))
vi.mock('@/lib/supabase/server', () => ({
  createRouteClient: () => server.routeClient,
  createServerClient: () => server.routeClient,
  createServiceClient: () => server.serviceClient,
}))
const audit = vi.hoisted(() => ({ logAudit: vi.fn(async (_p: unknown) => {}) }))
vi.mock('@/lib/audit/log', () => ({ logAudit: audit.logAudit, getClientIp: () => null }))
// Wednesday Sep 16 2026 (Pacific).
vi.mock('@/lib/utils/date', async (orig) => ({
  ...(await orig<typeof import('@/lib/utils/date')>()),
  pacificToday: () => '2026-09-16',
}))

import * as pushRoute from './route'
import * as unpushRoute from '../unpush/route'
import * as pendRoute from '../route'
import * as ledgerRoute from '../../route'

const ADMIN = '00000000-0000-4000-8000-00000000a0a0'
const CONTROLLER = '00000000-0000-4000-8000-00000000c0c0'
const REQUESTER = '00000000-0000-4000-8000-00000000e0e0'
const VIEWER = '00000000-0000-4000-8000-00000000f0f0'
const STRANGER = '00000000-0000-4000-8000-00000000d0d0'

const ACC = {
  TCS: '10000000-0000-4000-8000-000000000001',
  INC: '10000000-0000-4000-8000-000000000002',
}
const L = {
  AM: '30000000-0000-4000-8000-000000000001', // Sep 16 AM
  PM: '30000000-0000-4000-8000-000000000002', // Sep 16 PM
  NEXT_AM: '30000000-0000-4000-8000-000000000003', // Sep 17 AM — already exists
}
const P = {
  FERG: '50000000-0000-4000-8000-000000000001', // Sep 16 AM, TCS, pending
  SUN: '50000000-0000-4000-8000-000000000002', // Sep 16 AM, TCS, pending
  ADP: '50000000-0000-4000-8000-000000000003', // Sep 16 AM, INC, pending
  PAID: '50000000-0000-4000-8000-000000000004', // Sep 16 AM, already paid
  GONE: '50000000-0000-4000-8000-000000000005', // Sep 16 AM, already pushed
  REQ: '50000000-0000-4000-8000-000000000006', // Sep 16 AM, came from a request
}
const REQUEST_ID = '70000000-0000-4000-8000-0000000000aa'

type Row = Record<string, unknown>

const pend = (over: Row): Row => ({
  daily_ledger_id: L.AM,
  account_id: ACC.TCS,
  status: 'pending',
  original_date: '2026-09-16',
  effective_date: '2026-09-16',
  paid_at: null,
  paid_by: null,
  source: 'manual',
  source_ref_id: null,
  pushed_from_id: null,
  notes: null,
  sort_order: 0,
  created_by: CONTROLLER,
  created_at: '2026-09-16T14:00:00Z',
  ...over,
})

const ledger = (id: string, ledger_date: string, period: string, cents = 0): Row => ({
  id,
  ledger_date,
  period,
  beginning_cash_cents: cents,
  created_by: CONTROLLER,
  created_at: '2026-09-16T14:00:00Z',
  updated_at: '2026-09-16T14:00:00Z',
})

function seed(): Record<string, Row[]> {
  return {
    cmr_daily_ledger: [
      ledger(L.AM, '2026-09-16', 'am', 48_230_000),
      ledger(L.PM, '2026-09-16', 'pm', 100_000),
      ledger(L.NEXT_AM, '2026-09-17', 'am', 900_000),
    ],
    cmr_ledger_adjustments: [],
    cmr_pending_items: [
      pend({ id: P.FERG, payee: 'Ferguson Enterprises', amount_cents: 21_000_000, sort_order: 0, notes: 'Net 30' }),
      pend({ id: P.SUN, payee: 'Sunbelt Rentals', amount_cents: 10_200_000, sort_order: 1 }),
      pend({ id: P.ADP, payee: 'ADP payroll run', amount_cents: 17_752_000, account_id: ACC.INC }),
      pend({ id: P.PAID, payee: 'Already paid', amount_cents: 500, status: 'paid', paid_at: '2026-09-16T18:00:00Z', paid_by: CONTROLLER, sort_order: 2 }),
      pend({ id: P.GONE, payee: 'Already pushed', amount_cents: 700, status: 'pushed', sort_order: 3 }),
      pend({ id: P.REQ, payee: 'From a request', amount_cents: 1_100, source: 'request', source_ref_id: REQUEST_ID, sort_order: 4 }),
    ],
  }
}

function world(userId: string | null, tables: Record<string, Row[]> = seed()) {
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
      ],
      ...tables,
    },
    {
      defaults: {
        cmr_daily_ledger: () => ({ id: randomUUID(), updated_at: '2026-09-16T15:00:00Z' }),
        cmr_pending_items: () => ({ id: randomUUID(), paid_at: null, paid_by: null, source_ref_id: null, pushed_from_id: null, notes: null }),
      },
      unique: {
        cmr_daily_ledger: (c, others) =>
          others.some((o) => o.ledger_date === c.ledger_date && o.period === c.period)
            ? 'duplicate key value violates unique constraint "cmr_daily_ledger_date_period_key"'
            : null,
        // The CHECK that makes a manual item carry no source_ref_id.
        cmr_pending_items: (c) =>
          c.source === 'manual' && c.source_ref_id != null
            ? 'violates check constraint "cmr_pending_items_manual_no_ref"'
            : null,
      },
      // Mirror the AFTER DELETE trigger cmr_revive_pushed_source: deleting a forward copy puts
      // the item it was pushed from back to 'pending', whatever route issued the delete.
      onDelete: {
        cmr_pending_items: (removed, t) => {
          for (const row of removed) {
            if (!row.pushed_from_id) continue
            if (t.cmr_pending_items.some((c) => c.pushed_from_id === row.pushed_from_id && c.id !== row.id)) continue
            const src = t.cmr_pending_items.find((r) => r.id === row.pushed_from_id)
            if (src && src.status === 'pushed') src.status = 'pending'
          }
        },
      },
      // Mirror cmr_push_pending_item: copy + flip, or refuse — one call, nothing half-done.
      rpc: {
        cmr_push_pending_item: (args, t) => {
          const src = t.cmr_pending_items.find((r) => r.id === args.p_item_id)
          if (!src) return { message: 'NOT_FOUND' }
          if (src.status !== 'pending') return { message: 'NOT_PENDING' }
          if (src.daily_ledger_id === args.p_ledger_id) return { message: 'SAME_LEDGER' }
          const id = randomUUID()
          t.cmr_pending_items.push({
            id,
            daily_ledger_id: args.p_ledger_id,
            account_id: src.account_id,
            payee: src.payee,
            amount_cents: src.amount_cents,
            status: 'pending',
            original_date: src.original_date ?? src.effective_date,
            effective_date: args.p_date,
            paid_at: null,
            paid_by: null,
            source: 'manual',
            source_ref_id: null,
            pushed_from_id: src.id,
            notes: src.notes,
            sort_order: args.p_sort_order,
            created_by: args.p_actor,
            created_at: '2026-09-16T19:00:00Z',
          })
          src.status = 'pushed'
          return { data: id }
        },
        // Mirror cmr_unpush_pending_item: validate the copy, delete it, put the source back.
        cmr_unpush_pending_item: (args, t) => {
          const src = t.cmr_pending_items.find((r) => r.id === args.p_item_id)
          if (!src) return { message: 'NOT_FOUND' }
          if (src.status !== 'pushed') return { message: 'NOT_PUSHED' }
          const copy = t.cmr_pending_items.find((r) => r.pushed_from_id === src.id)
          let removed: string | null = null
          if (copy) {
            if (copy.status === 'paid') return { message: 'ROW_PAID' }
            if (copy.status !== 'pending' || t.cmr_pending_items.some((r) => r.pushed_from_id === copy.id)) {
              return { message: 'ROW_MOVED' }
            }
            t.cmr_pending_items = t.cmr_pending_items.filter((r) => r !== copy)
            removed = copy.id as string
          }
          src.status = 'pending'
          return { data: removed }
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
    body: body === undefined ? undefined : JSON.stringify(body),
  })

const api = {
  push: (body: unknown) => pushRoute.POST(req('POST', '/pending/push', body)),
  unpush: (body: unknown) => unpushRoute.POST(req('POST', '/pending/unpush', body)),
  del: (id: string) => pendRoute.DELETE(req('DELETE', `/pending?id=${id}`)),
  patch: (body: unknown) => pendRoute.PATCH(req('PATCH', '/pending', body)),
  view: (qs: string) => ledgerRoute.GET(req('GET', qs)),
}

const writes = (fake: ReturnType<typeof world>) => fake.calls.filter((c) => c.op !== 'select')
type AuditArg = { action: string; resourceId?: string; resourceType?: string; resourceLabel?: string; userRole?: string; metadata?: Record<string, any> } // eslint-disable-line @typescript-eslint/no-explicit-any
const auditCalls = () => audit.logAudit.mock.calls.map((c) => c[0] as AuditArg)
const actions = () => auditCalls().map((a) => a.action)
const bodyOf = async (r: Response) => (await r.json()) as { success: boolean; data?: any; error?: string; code?: string } // eslint-disable-line @typescript-eslint/no-explicit-any
const rowOf = (fake: ReturnType<typeof world>, id: string) => fake.tables.cmr_pending_items.find((r) => r.id === id)
const copyOf = (fake: ReturnType<typeof world>, srcId: string) => fake.tables.cmr_pending_items.find((r) => r.pushed_from_id === srcId)
const viewOf = async (qs: string) => (await bodyOf(await api.view(qs))).data

beforeEach(() => { audit.logAudit.mockClear() })
afterEach(() => { vi.restoreAllMocks() })

// ── access ──────────────────────────────────────────────────────────────────

describe('push + check-off — access', () => {
  it('route files export only HTTP handlers + dynamic (BUG-019)', () => {
    const allowed = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'dynamic'])
    for (const mod of [pushRoute, unpushRoute]) {
      for (const k of Object.keys(mod)) expect(allowed.has(k), k).toBe(true)
      expect((mod as { dynamic?: string }).dynamic).toBe('force-dynamic')
    }
  })

  for (const [label, uid] of [['platform admin', ADMIN], ['stranger', STRANGER], ['requester', REQUESTER], ['viewer', VIEWER]] as const) {
    it(`${label}: push, pay and unpay are all 403 — nothing written, nothing audited`, async () => {
      const fake = world(uid)
      const rs = await Promise.all([
        api.push({ id: P.FERG }),
        api.push({ id: P.FERG, targetDate: '2026-09-18', targetPeriod: 'pm' }),
        api.unpush({ id: P.GONE }),
        api.patch({ id: P.FERG, status: 'paid' }),
        api.patch({ id: P.PAID, status: 'pending' }),
      ])
      expect(rs.map((r) => r.status)).toEqual([403, 403, 403, 403, 403])
      expect(writes(fake)).toHaveLength(0)
      expect(rowOf(fake, P.FERG)).toMatchObject({ status: 'pending' })
      expect(audit.logAudit).not.toHaveBeenCalled()
    })
  }

  it('no session: 401', async () => {
    world(null)
    expect((await api.push({ id: P.FERG })).status).toBe(401)
    expect((await api.unpush({ id: P.GONE })).status).toBe(401)
    expect((await api.patch({ id: P.FERG, status: 'paid' })).status).toBe(401)
    expect(audit.logAudit).not.toHaveBeenCalled()
  })
})

// ── push ────────────────────────────────────────────────────────────────────

describe('POST /api/cmr/ledger/pending/push', () => {
  it('defaults to the next calendar day, same snapshot; original → pushed, copy carries the back-link', async () => {
    const fake = world(CONTROLLER)
    const r = await api.push({ id: P.FERG })
    expect(r.status).toBe(200)
    const { data } = await bodyOf(r)
    expect(data.to).toEqual({ date: '2026-09-17', period: 'am' })

    expect(rowOf(fake, P.FERG)).toMatchObject({ status: 'pushed', daily_ledger_id: L.AM })
    const copy = copyOf(fake, P.FERG)!
    expect(copy).toMatchObject({
      daily_ledger_id: L.NEXT_AM,
      account_id: ACC.TCS,
      payee: 'Ferguson Enterprises',
      amount_cents: 21_000_000,
      status: 'pending',
      source: 'manual',
      source_ref_id: null,
      pushed_from_id: P.FERG,
      original_date: '2026-09-16', // preserved
      effective_date: '2026-09-17', // the day it now sits on
      notes: 'Net 30',
      created_by: CONTROLLER,
    })
  })

  it('the day it left stops counting it; the day it landed on starts', async () => {
    world(CONTROLLER)
    const before = await viewOf('?date=2026-09-16&period=am')
    expect(before.totals.pendingRollupCents).toBe(21_000_000 + 10_200_000 + 17_752_000 + 500 + 1_100)

    expect((await api.push({ id: P.FERG })).status).toBe(200)

    const after = await viewOf('?date=2026-09-16&period=am')
    expect(after.totals.pendingRollupCents).toBe(before.totals.pendingRollupCents - 21_000_000)
    expect(after.totals.currentBalanceCents).toBe(before.totals.currentBalanceCents + 21_000_000)
    // …and it is still ON the day, as history, saying where it went.
    const left = after.pending.flatMap((g: any) => g.items).find((i: any) => i.id === P.FERG) // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(left).toMatchObject({ status: 'pushed', pushedTo: { date: '2026-09-17', period: 'am' } })

    const next = await viewOf('?date=2026-09-17&period=am')
    expect(next.totals.pendingRollupCents).toBe(21_000_000)
    const arrived = next.pending.flatMap((g: any) => g.items)[0] // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(arrived).toMatchObject({
      payee: 'Ferguson Enterprises',
      status: 'pending',
      pushedFrom: { date: '2026-09-16', period: 'am' },
      originalDate: '2026-09-16',
    })
  })

  it('a chosen day and snapshot are honoured, and the target ledger is created on demand', async () => {
    const fake = world(CONTROLLER)
    const r = await api.push({ id: P.SUN, targetDate: '2026-09-21', targetPeriod: 'pm' })
    expect(r.status).toBe(200)
    expect((await bodyOf(r)).data.to).toEqual({ date: '2026-09-21', period: 'pm' })

    const made = fake.tables.cmr_daily_ledger.find((l) => l.ledger_date === '2026-09-21' && l.period === 'pm')
    expect(made).toBeTruthy()
    expect(copyOf(fake, P.SUN)).toMatchObject({ daily_ledger_id: made!.id, effective_date: '2026-09-21' })
    expect(actions()).toContain('cmr.ledger.create')
  })

  it('the copy goes at the end of its account group on the target day', async () => {
    const tables = seed()
    tables.cmr_pending_items.push(
      pend({ id: randomUUID(), daily_ledger_id: L.NEXT_AM, payee: 'Already there', amount_cents: 100, sort_order: 0, effective_date: '2026-09-17', original_date: '2026-09-17' }),
    )
    const fake = world(CONTROLLER, tables)
    expect((await api.push({ id: P.FERG })).status).toBe(200)
    expect(copyOf(fake, P.FERG)).toMatchObject({ sort_order: 1 })
  })

  it('pushing twice is impossible: the second attempt is a 409 and writes nothing', async () => {
    const fake = world(CONTROLLER)
    expect((await api.push({ id: P.FERG })).status).toBe(200)
    audit.logAudit.mockClear()
    const again = await api.push({ id: P.FERG })
    expect(again.status).toBe(409)
    expect((await bodyOf(again)).code).toBe('NOT_PENDING')
    expect(fake.tables.cmr_pending_items.filter((r) => r.pushed_from_id === P.FERG)).toHaveLength(1)
    expect(audit.logAudit).not.toHaveBeenCalled()
  })

  it('refuses a paid item, an already-pushed one, the same day/snapshot, and anything unknown', async () => {
    const fake = world(CONTROLLER)
    const paid = await api.push({ id: P.PAID })
    expect(paid.status).toBe(409)
    expect((await bodyOf(paid)).code).toBe('NOT_PENDING')

    const gone = await api.push({ id: P.GONE })
    expect(gone.status).toBe(409)

    const same = await api.push({ id: P.FERG, targetDate: '2026-09-16', targetPeriod: 'am' })
    expect(same.status).toBe(409)
    expect((await bodyOf(same)).code).toBe('SAME_LEDGER')

    expect((await api.push({ id: '50000000-0000-4000-8000-0000000000ff' })).status).toBe(404)
    expect((await api.push({ id: 'not-a-uuid' })).status).toBe(400)
    expect((await api.push({ id: P.FERG, targetDate: '2026-02-31' })).status).toBe(400)
    expect((await api.push({ id: P.FERG, targetPeriod: 'noon' })).status).toBe(400)

    expect(writes(fake)).toHaveLength(0)
    expect(audit.logAudit).not.toHaveBeenCalled()
  })

  it('a request-sourced item pushes as a plain manual copy, so the request still points at one row', async () => {
    const fake = world(CONTROLLER)
    expect((await api.push({ id: P.REQ })).status).toBe(200)
    expect(copyOf(fake, P.REQ)).toMatchObject({ source: 'manual', source_ref_id: null })
    expect(rowOf(fake, P.REQ)).toMatchObject({ status: 'pushed', source: 'request', source_ref_id: REQUEST_ID })
  })

  it('audits the push from → to', async () => {
    world(CONTROLLER)
    await api.push({ id: P.FERG, targetDate: '2026-09-18', targetPeriod: 'pm' })
    const a = auditCalls().find((x) => x.action === 'cmr.pending.push')!
    expect(a).toMatchObject({ resourceType: 'cmr_pending_items', resourceId: P.FERG, resourceLabel: 'Ferguson Enterprises', userRole: 'cmr:controller' })
    expect(a.metadata).toMatchObject({
      from: { ledgerDate: '2026-09-16', period: 'am' },
      to: { ledgerDate: '2026-09-18', period: 'pm' },
      amountCents: 21_000_000,
      accountName: 'TCS',
      before: { status: 'pending' },
      after: { status: 'pushed' },
    })
  })
})

// ── the paid check-off ──────────────────────────────────────────────────────

describe('PATCH /api/cmr/ledger/pending — the paid check-off', () => {
  it('pay stamps paid_at + paid_by, and the item keeps counting that day', async () => {
    const fake = world(CONTROLLER)
    const before = await viewOf('?date=2026-09-16&period=am')
    const r = await api.patch({ id: P.SUN, status: 'paid' })
    expect(r.status).toBe(200)
    expect((await bodyOf(r)).data.changed).toBe(true)

    const row = rowOf(fake, P.SUN)!
    expect(row.status).toBe('paid')
    expect(row.paid_at).toBeTruthy()
    expect(row.paid_by).toBe(CONTROLLER)

    // Paid money left the bank on this day — the roll-up is unchanged.
    const after = await viewOf('?date=2026-09-16&period=am')
    expect(after.totals.pendingRollupCents).toBe(before.totals.pendingRollupCents)
    expect(actions()).toContain('cmr.pending.pay')
  })

  it('unpay clears the stamp and puts it back to pending', async () => {
    const fake = world(CONTROLLER)
    const r = await api.patch({ id: P.PAID, status: 'pending' })
    expect(r.status).toBe(200)
    expect(rowOf(fake, P.PAID)).toMatchObject({ status: 'pending', paid_at: null, paid_by: null })
    expect(actions()).toContain('cmr.pending.unpay')
  })

  it('re-sending the same state changes nothing and is not audited', async () => {
    const fake = world(CONTROLLER)
    const r = await api.patch({ id: P.PAID, status: 'paid' })
    expect(r.status).toBe(200)
    expect((await bodyOf(r)).data.changed).toBe(false)
    expect(rowOf(fake, P.PAID)).toMatchObject({ paid_at: '2026-09-16T18:00:00Z' })
    expect(writes(fake)).toHaveLength(0)
    expect(audit.logAudit).not.toHaveBeenCalled()
  })

  it('a pushed item can’t be paid', async () => {
    const fake = world(CONTROLLER)
    const r = await api.patch({ id: P.GONE, status: 'paid' })
    expect(r.status).toBe(409)
    expect((await bodyOf(r)).code).toBe('NOT_EDITABLE')
    expect(rowOf(fake, P.GONE)).toMatchObject({ status: 'pushed', paid_at: null })
    expect(audit.logAudit).not.toHaveBeenCalled()
  })

  it('a placed-request item can be checked off — paying is about the money, not the source', async () => {
    const fake = world(CONTROLLER)
    expect((await api.patch({ id: P.REQ, status: 'paid' })).status).toBe(200)
    expect(rowOf(fake, P.REQ)).toMatchObject({ status: 'paid', paid_by: CONTROLLER })
  })

  it('refuses a check-off mixed with a field edit, and any status but paid/pending', async () => {
    const fake = world(CONTROLLER)
    expect((await api.patch({ id: P.SUN, status: 'paid', payee: 'Renamed' })).status).toBe(400)
    expect((await api.patch({ id: P.SUN, status: 'pushed' })).status).toBe(400)
    expect((await api.patch({ id: P.SUN, status: 'nonsense' })).status).toBe(400)
    expect(rowOf(fake, P.SUN)).toMatchObject({ status: 'pending', payee: 'Sunbelt Rentals' })
    expect(writes(fake)).toHaveLength(0)
    expect(audit.logAudit).not.toHaveBeenCalled()
  })

  it('writes compare-and-swap on the status it read, so a racing push can’t be paid over', async () => {
    // Push flips this same column from another connection (under a row lock). Without the
    // status predicate an in-flight check-off could pay an item that had already been pushed
    // away — and the amount would then count against BOTH days.
    const fake = world(CONTROLLER)
    expect((await api.patch({ id: P.SUN, status: 'paid' })).status).toBe(200)
    const update = fake.calls.filter((c) => c.table === 'cmr_pending_items' && c.op === 'update').at(-1)!
    expect(update.filters).toEqual(expect.arrayContaining([['id', P.SUN], ['status', 'pending']]))

    // The same guard on a field edit, which must not land on a row that has since been pushed.
    expect((await api.patch({ id: P.ADP, payee: 'Renamed' })).status).toBe(200)
    const edit = fake.calls.filter((c) => c.table === 'cmr_pending_items' && c.op === 'update').at(-1)!
    expect(edit.filters).toEqual(expect.arrayContaining([['id', P.ADP], ['status', 'pending']]))
  })

  it('a paid item is no longer editable or deletable as a line (unchanged from Phase 3)', async () => {
    world(CONTROLLER)
    expect((await api.patch({ id: P.PAID, payee: 'Renamed' })).status).toBe(409)
  })
})

// ── un-push, and the safety net that makes a push impossible to lose ────────

describe('POST /api/cmr/ledger/pending/unpush', () => {
  const totalOn = async (qs: string) => (await viewOf(qs)).totals.pendingRollupCents

  it('deletes the copy and puts the original back to pending on its own day', async () => {
    const fake = world(CONTROLLER)
    const before = await totalOn('?date=2026-09-16&period=am')
    expect((await api.push({ id: P.FERG })).status).toBe(200)
    const copyId = copyOf(fake, P.FERG)!.id as string
    expect(await totalOn('?date=2026-09-16&period=am')).toBe(before - 21_000_000)

    audit.logAudit.mockClear()
    const r = await api.unpush({ id: P.FERG })
    expect(r.status).toBe(200)
    expect((await bodyOf(r)).data.removedCopyId).toBe(copyId)

    // The copy is gone from the target day, and the original counts again on its own.
    expect(fake.tables.cmr_pending_items.find((x) => x.id === copyId)).toBeUndefined()
    expect(rowOf(fake, P.FERG)).toMatchObject({ status: 'pending', daily_ledger_id: L.AM })
    expect(await totalOn('?date=2026-09-16&period=am')).toBe(before)
    expect(await totalOn('?date=2026-09-17&period=am')).toBe(0)

    const a = auditCalls().find((x) => x.action === 'cmr.pending.unpush')!
    expect(a).toMatchObject({ resourceType: 'cmr_pending_items', resourceId: P.FERG, resourceLabel: 'Ferguson Enterprises', userRole: 'cmr:controller' })
    expect(a.metadata).toMatchObject({ removedCopyId: copyId, amountCents: 21_000_000, before: { status: 'pushed' }, after: { status: 'pending' } })
  })

  it('the round trip leaves both days exactly where they started', async () => {
    world(CONTROLLER)
    const am = await totalOn('?date=2026-09-16&period=am')
    const next = await totalOn('?date=2026-09-17&period=am')
    await api.push({ id: P.SUN, targetDate: '2026-09-17', targetPeriod: 'am' })
    await api.unpush({ id: P.SUN })
    expect(await totalOn('?date=2026-09-16&period=am')).toBe(am)
    expect(await totalOn('?date=2026-09-17&period=am')).toBe(next)
  })

  it('refuses once the copy was paid, or pushed on again — nothing is deleted', async () => {
    const fake = world(CONTROLLER)
    await api.push({ id: P.FERG })
    const copyId = copyOf(fake, P.FERG)!.id as string
    expect((await api.patch({ id: copyId, status: 'paid' })).status).toBe(200)

    audit.logAudit.mockClear()
    const paid = await api.unpush({ id: P.FERG })
    expect(paid.status).toBe(409)
    expect((await bodyOf(paid)).code).toBe('ROW_PAID')
    expect(fake.tables.cmr_pending_items.find((x) => x.id === copyId)).toBeTruthy()
    expect(rowOf(fake, P.FERG)).toMatchObject({ status: 'pushed' })

    // …and the same once it has been pushed on a second time.
    await api.patch({ id: copyId, status: 'pending' })
    expect((await api.push({ id: copyId, targetDate: '2026-09-18', targetPeriod: 'am' })).status).toBe(200)
    const moved = await api.unpush({ id: P.FERG })
    expect(moved.status).toBe(409)
    expect((await bodyOf(moved)).code).toBe('ROW_MOVED')
    expect(audit.logAudit).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'cmr.pending.unpush' }))
  })

  it('GET carries the same verdict, so the screen can disable Un-push and say why', async () => {
    const fake = world(CONTROLLER)
    await api.push({ id: P.FERG })
    const pushedRow = async () =>
      (await viewOf('?date=2026-09-16&period=am')).pending
        .flatMap((g: any) => g.items) // eslint-disable-line @typescript-eslint/no-explicit-any
        .find((i: any) => i.id === P.FERG) // eslint-disable-line @typescript-eslint/no-explicit-any

    expect(await pushedRow()).toMatchObject({ canUnpush: true, unpushBlockedReason: null })
    await api.patch({ id: copyOf(fake, P.FERG)!.id as string, status: 'paid' })
    expect(await pushedRow()).toMatchObject({ canUnpush: false, unpushBlockedReason: expect.stringContaining('already paid') })
  })

  it('refuses an item that was never pushed, and anything unknown', async () => {
    const fake = world(CONTROLLER)
    const notPushed = await api.unpush({ id: P.FERG })
    expect(notPushed.status).toBe(409)
    expect((await bodyOf(notPushed)).code).toBe('NOT_PUSHED')
    expect((await api.unpush({ id: P.PAID })).status).toBe(409)
    expect((await api.unpush({ id: '50000000-0000-4000-8000-0000000000ff' })).status).toBe(404)
    expect((await api.unpush({ id: 'not-a-uuid' })).status).toBe(400)
    expect(writes(fake)).toHaveLength(0)
    expect(audit.logAudit).not.toHaveBeenCalled()
  })

  it('a pushed item whose copy was already deleted still comes back', async () => {
    const fake = world(CONTROLLER)
    await api.push({ id: P.FERG })
    // Force the stranded state the trigger normally prevents, then prove un-push still recovers.
    fake.tables.cmr_pending_items = fake.tables.cmr_pending_items.filter((r) => r.pushed_from_id !== P.FERG)
    const r = await api.unpush({ id: P.FERG })
    expect(r.status).toBe(200)
    expect((await bodyOf(r)).data.removedCopyId).toBeNull()
    expect(rowOf(fake, P.FERG)).toMatchObject({ status: 'pending' })
    expect(auditCalls().find((x) => x.action === 'cmr.pending.unpush')!.metadata).toMatchObject({ copyWasAlreadyGone: true })
  })
})

describe('the delete safety net', () => {
  const totalOn = async (qs: string) => (await viewOf(qs)).totals.pendingRollupCents

  it('deleting a forward copy revives the source, and its amount is back in that day’s total', async () => {
    const fake = world(CONTROLLER)
    const before = await totalOn('?date=2026-09-16&period=am')
    await api.push({ id: P.FERG })
    const copyId = copyOf(fake, P.FERG)!.id as string
    expect(await totalOn('?date=2026-09-16&period=am')).toBe(before - 21_000_000)

    const r = await api.del(copyId)
    expect(r.status).toBe(200)
    expect((await bodyOf(r)).data.revivedSourceId).toBe(P.FERG)

    // The whole point: the amount is on a ledger again, not floating free.
    expect(rowOf(fake, P.FERG)).toMatchObject({ status: 'pending', daily_ledger_id: L.AM })
    expect(await totalOn('?date=2026-09-16&period=am')).toBe(before)
    expect(await totalOn('?date=2026-09-17&period=am')).toBe(0)
    expect(auditCalls().find((x) => x.action === 'cmr.ledger.pending.delete')!.metadata).toMatchObject({
      pushedFromId: P.FERG,
      revivedSourceId: P.FERG,
    })
  })

  it('deleting an ordinary item revives nothing', async () => {
    const fake = world(CONTROLLER)
    const r = await api.del(P.SUN)
    expect(r.status).toBe(200)
    expect((await bodyOf(r)).data.revivedSourceId).toBeNull()
    expect(fake.tables.cmr_pending_items.find((x) => x.id === P.SUN)).toBeUndefined()
  })

  it('there is no sequence that leaves a pushed amount on no ledger', async () => {
    // push → delete the copy → the source is pending again; push → un-push → likewise.
    for (const finish of ['delete', 'unpush'] as const) {
      const fake = world(CONTROLLER)
      const before = await totalOn('?date=2026-09-16&period=am')
      await api.push({ id: P.FERG, targetDate: '2026-09-19', targetPeriod: 'pm' })
      const copyId = copyOf(fake, P.FERG)!.id as string
      if (finish === 'delete') await api.del(copyId)
      else await api.unpush({ id: P.FERG })
      expect(rowOf(fake, P.FERG), finish).toMatchObject({ status: 'pending' })
      expect(await totalOn('?date=2026-09-16&period=am')).toBe(before)
      expect(await totalOn('?date=2026-09-19&period=pm')).toBe(0)
    }
  })
})
