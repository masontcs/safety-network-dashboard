import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fakeSupabase, fakeRouteClient } from '@/lib/cmr/__testing__/fakeSupabase'

/**
 * Phase 6, the undo the Phase 5 queue never had: UNPLACE a placed vendor request.
 *
 *   • the row the placement created is DELETED and the request goes back to 'queued' with its
 *     placement columns cleared — both in one call, so it can't half-happen
 *   • refused (409) once that row has been PAID, or PUSHED / CARRIED onward; the reason also
 *     rides on the request in GET (canUnplace / unplaceBlockedReason) so the screen can say why
 *   • a queued or declined request is not undoable at all
 *   • a placed row that has already been deleted by hand still returns the request to the queue
 *   • CONTROLLER ONLY: requester / viewer / no-grant / platform admin → 403, nothing written
 *   • the request dead-end Phase 6 introduced and then closed: a placed item that was PUSHED
 *     can't be unplaced (ROW_MOVED) — un-push it first and the undo works normally
 *   • audited as cmr.request.unplace
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

import * as unplaceRoute from './route'
import * as requestsRoute from '../route'
import * as unpushRoute from '../../ledger/pending/unpush/route'

const ADMIN = '00000000-0000-4000-8000-00000000a0a0'
const CONTROLLER = '00000000-0000-4000-8000-00000000c0c0'
const REQUESTER = '00000000-0000-4000-8000-00000000e0e0'
const VIEWER = '00000000-0000-4000-8000-00000000f0f0'
const STRANGER = '00000000-0000-4000-8000-00000000d0d0'

const ACC = { TCS: '10000000-0000-4000-8000-000000000001' }
const LEDGER = '30000000-0000-4000-8000-000000000001'
const ITEM = {
  LIVE: '50000000-0000-4000-8000-000000000001',
  PAID: '50000000-0000-4000-8000-000000000002',
  PUSHED: '50000000-0000-4000-8000-000000000003',
}
const PRIO = {
  OPEN: '60000000-0000-4000-8000-000000000001',
  CARRIED: '60000000-0000-4000-8000-000000000002',
}
const R = {
  PEND: '70000000-0000-4000-8000-000000000001', // placed → ITEM.LIVE
  PEND_PAID: '70000000-0000-4000-8000-000000000002', // placed → ITEM.PAID
  PEND_PUSHED: '70000000-0000-4000-8000-000000000003', // placed → ITEM.PUSHED
  PRIO: '70000000-0000-4000-8000-000000000004', // placed → PRIO.OPEN
  PRIO_CARRIED: '70000000-0000-4000-8000-000000000005', // placed → PRIO.CARRIED
  ORPHAN: '70000000-0000-4000-8000-000000000006', // placed → a row that no longer exists
  QUEUED: '70000000-0000-4000-8000-000000000007',
  DECLINED: '70000000-0000-4000-8000-000000000008',
}

type Row = Record<string, unknown>

const rq = (over: Row): Row => ({
  requested_by: REQUESTER,
  account_id: ACC.TCS,
  amount_cents: 5_000,
  due_date: null,
  notes: null,
  status: 'queued',
  placed_kind: null,
  placed_ref_id: null,
  placed_at: null,
  placed_by: null,
  created_at: '2026-09-15T15:00:00Z',
  ...over,
})
const placed = (id: string, kind: 'pending' | 'priority', ref: string, vendor: string): Row =>
  rq({ id, vendor, status: 'placed', placed_kind: kind, placed_ref_id: ref, placed_at: '2026-09-15T18:00:00Z', placed_by: CONTROLLER })

const pend = (over: Row): Row => ({
  daily_ledger_id: LEDGER,
  account_id: ACC.TCS,
  amount_cents: 5_000,
  status: 'pending',
  original_date: '2026-09-16',
  effective_date: '2026-09-16',
  paid_at: null,
  paid_by: null,
  source: 'request',
  pushed_from_id: null,
  notes: null,
  sort_order: 0,
  created_by: CONTROLLER,
  created_at: '2026-09-16T14:00:00Z',
  ...over,
})
const pr = (over: Row): Row => ({
  week_start: '2026-09-13',
  amount_cents: 5_000,
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
    cmr_daily_ledger: [
      { id: LEDGER, ledger_date: '2026-09-16', period: 'am', beginning_cash_cents: 0, created_by: CONTROLLER, created_at: '2026-09-16T14:00:00Z', updated_at: '2026-09-16T14:00:00Z' },
    ],
    cmr_pending_items: [
      pend({ id: ITEM.LIVE, payee: 'Sunbelt Rentals', source_ref_id: R.PEND }),
      pend({ id: ITEM.PAID, payee: 'Paid already', status: 'paid', paid_at: '2026-09-16T18:00:00Z', paid_by: CONTROLLER, source_ref_id: R.PEND_PAID }),
      pend({ id: ITEM.PUSHED, payee: 'Pushed already', status: 'pushed', source_ref_id: R.PEND_PUSHED }),
    ],
    cmr_weekly_priorities: [
      pr({ id: PRIO.OPEN, description: 'Wells Fargo' }),
      pr({ id: PRIO.CARRIED, description: 'Carried onward', status: 'carried' }),
    ],
    cmr_vendor_requests: [
      placed(R.PEND, 'pending', ITEM.LIVE, 'Sunbelt Rentals'),
      placed(R.PEND_PAID, 'pending', ITEM.PAID, 'Paid already'),
      placed(R.PEND_PUSHED, 'pending', ITEM.PUSHED, 'Pushed already'),
      placed(R.PRIO, 'priority', PRIO.OPEN, 'Wells Fargo'),
      placed(R.PRIO_CARRIED, 'priority', PRIO.CARRIED, 'Carried onward'),
      placed(R.ORPHAN, 'pending', '50000000-0000-4000-8000-0000000000ff', 'Vanished line'),
      rq({ id: R.QUEUED, vendor: 'Still queued' }),
      rq({ id: R.DECLINED, vendor: 'Declined one', status: 'declined' }),
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
      cmr_accounts: [{ id: ACC.TCS, name: 'TCS', account_type: 'Checking', active: true, sort_order: 0 }],
      ...tables,
    },
    {
      // Mirror the AFTER DELETE trigger cmr_revive_pushed_source.
      onDelete: {
        cmr_pending_items: (removed, t) => {
          for (const row of removed) {
            if (!row.pushed_from_id) continue
            const src = t.cmr_pending_items.find((r) => r.id === row.pushed_from_id)
            if (src && src.status === 'pushed') src.status = 'pending'
          }
        },
      },
      // Mirror cmr_unplace_request: check, delete, re-queue — or refuse and touch nothing.
      rpc: {
        // Mirror cmr_unpush_pending_item.
        cmr_unpush_pending_item: (args, t) => {
          const src = t.cmr_pending_items.find((r) => r.id === args.p_item_id)
          if (!src) return { message: 'NOT_FOUND' }
          if (src.status !== 'pushed') return { message: 'NOT_PUSHED' }
          const copy = t.cmr_pending_items.find((r) => r.pushed_from_id === src.id)
          let removed: string | null = null
          if (copy) {
            if (copy.status === 'paid') return { message: 'ROW_PAID' }
            if (copy.status !== 'pending') return { message: 'ROW_MOVED' }
            t.cmr_pending_items = t.cmr_pending_items.filter((r) => r !== copy)
            removed = copy.id as string
          }
          src.status = 'pending'
          return { data: removed }
        },
        cmr_unplace_request: (args, t) => {
          const req = t.cmr_vendor_requests.find((r) => r.id === args.p_request_id)
          if (!req) return { message: 'NOT_FOUND' }
          if (req.status !== 'placed') return { message: 'NOT_PLACED' }
          let removed: string | null = null
          if (req.placed_kind === 'pending') {
            const row = t.cmr_pending_items.find((r) => r.id === req.placed_ref_id)
            if (row) {
              if (row.status === 'paid') return { message: 'ROW_PAID' }
              if (row.status !== 'pending' || t.cmr_pending_items.some((r) => r.pushed_from_id === row.id)) return { message: 'ROW_MOVED' }
              t.cmr_pending_items = t.cmr_pending_items.filter((r) => r !== row)
              removed = row.id as string
            }
          } else if (req.placed_kind === 'priority') {
            const row = t.cmr_weekly_priorities.find((r) => r.id === req.placed_ref_id)
            if (row) {
              if (row.status === 'paid') return { message: 'ROW_PAID' }
              if (row.status === 'carried' || t.cmr_weekly_priorities.some((r) => r.carried_from_id === row.id)) return { message: 'ROW_MOVED' }
              if (row.status !== 'open') return { message: 'ROW_SETTLED' }
              t.cmr_weekly_priorities = t.cmr_weekly_priorities.filter((r) => r !== row)
              removed = row.id as string
            }
          }
          Object.assign(req, { status: 'queued', placed_kind: null, placed_ref_id: null, placed_at: null, placed_by: null })
          return { data: removed }
        },
      },
    },
  )
  server.routeClient = fakeRouteClient(userId)
  server.serviceClient = fake.client
  return fake
}

const base = 'https://cmr.safetynetworkteams.com/api/cmr/requests'
const req = (method: string, path = '', body?: unknown) =>
  new Request(base + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

const api = {
  unplace: (body: unknown) => unplaceRoute.POST(req('POST', '/unplace', body)),
  unpush: (body: unknown) => unpushRoute.POST(req('POST', '/unpush', body)),
  list: () => requestsRoute.GET(),
}

const writes = (fake: ReturnType<typeof world>) => fake.calls.filter((c) => c.op !== 'select')
type AuditArg = { action: string; resourceId?: string; resourceLabel?: string; resourceType?: string; userRole?: string; metadata?: Record<string, any> } // eslint-disable-line @typescript-eslint/no-explicit-any
const auditCalls = () => audit.logAudit.mock.calls.map((c) => c[0] as AuditArg)
const bodyOf = async (r: Response) => (await r.json()) as { success: boolean; data?: any; error?: string; code?: string } // eslint-disable-line @typescript-eslint/no-explicit-any
const reqRow = (fake: ReturnType<typeof world>, id: string) => fake.tables.cmr_vendor_requests.find((r) => r.id === id)
const listed = async (id: string) => {
  const { data } = await bodyOf(await api.list())
  return [...data.queued, ...data.history].find((r: any) => r.id === id) // eslint-disable-line @typescript-eslint/no-explicit-any
}

beforeEach(() => { audit.logAudit.mockClear() })
afterEach(() => { vi.restoreAllMocks() })

// ── access ──────────────────────────────────────────────────────────────────

describe('unplace — access', () => {
  it('route file exports only HTTP handlers + dynamic (BUG-019)', () => {
    const allowed = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'dynamic'])
    for (const k of Object.keys(unplaceRoute)) expect(allowed.has(k), k).toBe(true)
    expect((unplaceRoute as { dynamic?: string }).dynamic).toBe('force-dynamic')
  })

  for (const [label, uid] of [['platform admin', ADMIN], ['stranger', STRANGER], ['requester', REQUESTER], ['viewer', VIEWER]] as const) {
    it(`${label}: unplace is 403 — nothing written, nothing audited`, async () => {
      const fake = world(uid)
      const rs = await Promise.all([api.unplace({ id: R.PEND }), api.unplace({ id: R.PRIO })])
      expect(rs.map((r) => r.status)).toEqual([403, 403])
      expect(writes(fake)).toHaveLength(0)
      expect(reqRow(fake, R.PEND)).toMatchObject({ status: 'placed', placed_ref_id: ITEM.LIVE })
      expect(fake.tables.cmr_pending_items).toHaveLength(3)
      expect(audit.logAudit).not.toHaveBeenCalled()
    })
  }

  it('no session: 401', async () => {
    world(null)
    expect((await api.unplace({ id: R.PEND })).status).toBe(401)
    expect(audit.logAudit).not.toHaveBeenCalled()
  })
})

// ── undoing ─────────────────────────────────────────────────────────────────

describe('POST /api/cmr/requests/unplace', () => {
  it('a pending placement: the line is deleted and the request is back in the queue', async () => {
    const fake = world(CONTROLLER)
    const r = await api.unplace({ id: R.PEND })
    expect(r.status).toBe(200)
    expect((await bodyOf(r)).data.removedRowId).toBe(ITEM.LIVE)

    expect(fake.tables.cmr_pending_items.find((x) => x.id === ITEM.LIVE)).toBeUndefined()
    expect(reqRow(fake, R.PEND)).toMatchObject({
      status: 'queued',
      placed_kind: null,
      placed_ref_id: null,
      placed_at: null,
      placed_by: null,
    })
    const back = await listed(R.PEND)
    expect(back).toMatchObject({ status: 'queued', canUnplace: false })
  })

  it('a priority placement: that priority is deleted and the request is back in the queue', async () => {
    const fake = world(CONTROLLER)
    expect((await api.unplace({ id: R.PRIO })).status).toBe(200)
    expect(fake.tables.cmr_weekly_priorities.find((x) => x.id === PRIO.OPEN)).toBeUndefined()
    expect(reqRow(fake, R.PRIO)).toMatchObject({ status: 'queued', placed_kind: null })
  })

  it('refused once the line was PAID — nothing is deleted or changed', async () => {
    const fake = world(CONTROLLER)
    const r = await api.unplace({ id: R.PEND_PAID })
    expect(r.status).toBe(409)
    expect((await bodyOf(r)).code).toBe('ROW_PAID')
    expect(fake.tables.cmr_pending_items.find((x) => x.id === ITEM.PAID)).toBeTruthy()
    expect(reqRow(fake, R.PEND_PAID)).toMatchObject({ status: 'placed', placed_ref_id: ITEM.PAID })
    expect(audit.logAudit).not.toHaveBeenCalled()
  })

  it('refused once the line was PUSHED to another day, or the priority CARRIED to another week', async () => {
    const fake = world(CONTROLLER)
    const pushed = await api.unplace({ id: R.PEND_PUSHED })
    expect(pushed.status).toBe(409)
    expect((await bodyOf(pushed)).code).toBe('ROW_MOVED')

    const carried = await api.unplace({ id: R.PRIO_CARRIED })
    expect(carried.status).toBe(409)
    expect((await bodyOf(carried)).code).toBe('ROW_MOVED')

    expect(fake.tables.cmr_pending_items).toHaveLength(3)
    expect(fake.tables.cmr_weekly_priorities).toHaveLength(2)
    expect(audit.logAudit).not.toHaveBeenCalled()
  })

  it('GET carries the same verdict, so the screen can disable the button and say why', async () => {
    world(CONTROLLER)
    expect(await listed(R.PEND)).toMatchObject({ canUnplace: true, unplaceBlockedReason: null })
    expect(await listed(R.PEND_PAID)).toMatchObject({ canUnplace: false, unplaceBlockedReason: expect.stringContaining('already paid') })
    expect(await listed(R.PEND_PUSHED)).toMatchObject({ canUnplace: false, unplaceBlockedReason: expect.stringContaining('another day') })
    expect(await listed(R.PRIO_CARRIED)).toMatchObject({ canUnplace: false, unplaceBlockedReason: expect.stringContaining('another week') })
    // A queued or declined request is not a placement at all.
    expect(await listed(R.QUEUED)).toMatchObject({ canUnplace: false, unplaceBlockedReason: null })
    expect(await listed(R.DECLINED)).toMatchObject({ canUnplace: false, unplaceBlockedReason: null })
  })

  it('a queued or declined request can’t be unplaced', async () => {
    const fake = world(CONTROLLER)
    for (const id of [R.QUEUED, R.DECLINED]) {
      const r = await api.unplace({ id })
      expect(r.status).toBe(409)
      expect((await bodyOf(r)).code).toBe('NOT_PLACED')
    }
    expect(writes(fake)).toHaveLength(0)
    expect(audit.logAudit).not.toHaveBeenCalled()
  })

  it('a placement whose line was already deleted by hand still returns to the queue', async () => {
    const fake = world(CONTROLLER)
    const r = await api.unplace({ id: R.ORPHAN })
    expect(r.status).toBe(200)
    expect((await bodyOf(r)).data.removedRowId).toBeNull()
    expect(reqRow(fake, R.ORPHAN)).toMatchObject({ status: 'queued' })
    expect(auditCalls().find((a) => a.action === 'cmr.request.unplace')!.metadata).toMatchObject({ rowWasAlreadyGone: true })
  })

  it('undoing then re-placing is possible — that is the point of the undo', async () => {
    const fake = world(CONTROLLER)
    expect((await api.unplace({ id: R.PEND })).status).toBe(200)
    // Back in the queue means the Phase 5 place route will take it again.
    expect(reqRow(fake, R.PEND)).toMatchObject({ status: 'queued' })
    const second = await api.unplace({ id: R.PEND })
    expect(second.status).toBe(409)
    expect((await bodyOf(second)).code).toBe('NOT_PLACED')
  })

  it('rejects a bad id', async () => {
    const fake = world(CONTROLLER)
    expect((await api.unplace({ id: 'not-a-uuid' })).status).toBe(400)
    expect((await api.unplace({ id: '70000000-0000-4000-8000-0000000000ff' })).status).toBe(404)
    expect((await api.unplace({})).status).toBe(400)
    expect(writes(fake)).toHaveLength(0)
  })

  it('audits the undo with where it had gone', async () => {
    world(CONTROLLER)
    await api.unplace({ id: R.PRIO })
    const a = auditCalls().find((x) => x.action === 'cmr.request.unplace')!
    expect(a).toMatchObject({ resourceType: 'cmr_vendor_requests', resourceId: R.PRIO, resourceLabel: 'Wells Fargo', userRole: 'cmr:controller' })
    expect(a.metadata).toMatchObject({
      placedKind: 'priority',
      removedRowId: PRIO.OPEN,
      accountName: 'TCS',
      before: { status: 'placed', placedKind: 'priority', placedRefId: PRIO.OPEN },
      after: { status: 'queued', placedKind: null, placedRefId: null },
    })
  })
})

// ── the dead-end Phase 6 opened and then closed ─────────────────────────────

describe('a placed request whose item was pushed', () => {
  /** ITEM.PUSHED is R.PEND_PUSHED's placed row; give it the forward copy a real push leaves. */
  function withCopy() {
    const tables = seed()
    tables.cmr_pending_items.push(
      pend({
        id: '50000000-0000-4000-8000-0000000000c1',
        payee: 'Pushed already',
        source: 'manual',
        source_ref_id: null,
        pushed_from_id: ITEM.PUSHED,
        original_date: '2026-09-16',
        effective_date: '2026-09-17',
      }),
    )
    return world(CONTROLLER, tables)
  }

  it('un-push first, then the undo works — the request goes back to the queue', async () => {
    const fake = withCopy()
    // Before: undoing is refused, because the line has moved on.
    const blocked = await api.unplace({ id: R.PEND_PUSHED })
    expect(blocked.status).toBe(409)
    expect((await bodyOf(blocked)).code).toBe('ROW_MOVED')
    expect(await listed(R.PEND_PUSHED)).toMatchObject({ canUnplace: false })

    // Take the push back: the copy goes, the placed row is pending again on its own day.
    const un = await api.unpush({ id: ITEM.PUSHED })
    expect(un.status).toBe(200)
    expect(fake.tables.cmr_pending_items.find((r) => r.pushed_from_id === ITEM.PUSHED)).toBeUndefined()
    expect(fake.tables.cmr_pending_items.find((r) => r.id === ITEM.PUSHED)).toMatchObject({ status: 'pending' })
    expect(await listed(R.PEND_PUSHED)).toMatchObject({ canUnplace: true, unplaceBlockedReason: null })

    // And now the undo goes through normally.
    const undo = await api.unplace({ id: R.PEND_PUSHED })
    expect(undo.status).toBe(200)
    expect(fake.tables.cmr_pending_items.find((r) => r.id === ITEM.PUSHED)).toBeUndefined()
    expect(reqRow(fake, R.PEND_PUSHED)).toMatchObject({ status: 'queued', placed_kind: null, placed_ref_id: null })
  })

  it('deleting the forward copy reaches the same place — the placed row is undoable again', async () => {
    const fake = withCopy()
    const copyId = fake.tables.cmr_pending_items.find((r) => r.pushed_from_id === ITEM.PUSHED)!.id as string
    // Whatever route deletes the copy, the trigger revives its source.
    await fake.client.from('cmr_pending_items').delete().eq('id', copyId)
    expect(fake.tables.cmr_pending_items.find((r) => r.id === ITEM.PUSHED)).toMatchObject({ status: 'pending' })
    expect(await listed(R.PEND_PUSHED)).toMatchObject({ canUnplace: true })
    expect((await api.unplace({ id: R.PEND_PUSHED })).status).toBe(200)
  })
})
