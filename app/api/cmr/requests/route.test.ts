import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import { fakeSupabase, fakeRouteClient } from '@/lib/cmr/__testing__/fakeSupabase'

/**
 * /api/cmr/requests (+ /place, /decline) — THE access-sensitive phase. This is the first write
 * a non-Controller can make anywhere in Cash Ledger, so the matrix is the point of this file:
 *
 *   • no grant (platform admin included) → 403 on EVERY method, incl. GET; nothing read/written
 *   • no session → 401 everywhere
 *   • VIEWER → GET 200 read-only; submit / edit / withdraw / place / decline all 403
 *   • REQUESTER → submit 201; edit + withdraw their OWN queued request; 403 on someone else's,
 *     403/409 on one already placed or declined; place + decline 403
 *   • requested_by is ALWAYS the caller — a spoofed requestedBy in the body is ignored
 *   • CONTROLLER → submit, edit/withdraw anyone's queued request, place, decline
 *   • place → pending creates a cmr_pending_items row (source 'request' + source_ref_id) and
 *     flips the request to placed with that ref; place → priority does the same into
 *     cmr_weekly_priorities; a placed request can't be re-placed or declined
 *   • account must exist and be active on submit
 *   • every mutation is audited
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
import * as placeRoute from './place/route'
import * as declineRoute from './decline/route'

const ADMIN = '00000000-0000-4000-8000-00000000a0a0'
const CONTROLLER = '00000000-0000-4000-8000-00000000c0c0'
const REQUESTER = '00000000-0000-4000-8000-00000000e0e0'
const REQUESTER2 = '00000000-0000-4000-8000-00000000e0e1'
const VIEWER = '00000000-0000-4000-8000-00000000f0f0'
const STRANGER = '00000000-0000-4000-8000-00000000d0d0'

const ACC = {
  TCS: '50000000-0000-4000-8000-000000000001',
  SIGNS: '50000000-0000-4000-8000-000000000002',
  OLD: '50000000-0000-4000-8000-000000000003', // inactive
}
const R = {
  MINE: '70000000-0000-4000-8000-000000000001', // REQUESTER, queued
  MINE2: '70000000-0000-4000-8000-000000000002', // REQUESTER, queued, no amount
  THEIRS: '70000000-0000-4000-8000-000000000003', // REQUESTER2, queued
  PLACED: '70000000-0000-4000-8000-000000000004', // REQUESTER, already placed
  DECLINED: '70000000-0000-4000-8000-000000000005', // REQUESTER, already declined
}
const PLACED_REF = '80000000-0000-4000-8000-0000000000ff'

type Row = Record<string, unknown>

const rq = (over: Row): Row => ({
  account_id: ACC.TCS,
  amount_cents: 0,
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

function seed(): Record<string, Row[]> {
  return {
    cmr_accounts: [
      { id: ACC.TCS, name: 'TCS', account_type: 'Checking', active: true, sort_order: 0 },
      { id: ACC.SIGNS, name: 'Signs', account_type: null, active: true, sort_order: 1 },
      { id: ACC.OLD, name: 'Old Account', account_type: null, active: false, sort_order: 2 },
    ],
    cmr_daily_ledger: [],
    cmr_pending_items: [],
    cmr_weekly_priorities: [],
    cmr_vendor_requests: [
      rq({ id: R.MINE, requested_by: REQUESTER, vendor: 'Sunbelt Rentals', amount_cents: 125_000, due_date: '2026-09-18', notes: 'Credit hold' }),
      rq({ id: R.MINE2, requested_by: REQUESTER, vendor: 'Call the bank', created_at: '2026-09-15T16:00:00Z' }),
      rq({ id: R.THEIRS, requested_by: REQUESTER2, vendor: 'Wells Fargo', amount_cents: 3_200_000, account_id: ACC.SIGNS, created_at: '2026-09-15T17:00:00Z' }),
      rq({
        id: R.PLACED,
        requested_by: REQUESTER,
        vendor: 'Already placed',
        amount_cents: 5_000,
        status: 'placed',
        placed_kind: 'pending',
        placed_ref_id: PLACED_REF,
        placed_at: '2026-09-15T18:00:00Z',
        placed_by: CONTROLLER,
        created_at: '2026-09-15T12:00:00Z',
      }),
      rq({ id: R.DECLINED, requested_by: REQUESTER, vendor: 'Already declined', status: 'declined', created_at: '2026-09-15T11:00:00Z' }),
    ],
  }
}

function world(userId: string | null, tables: Record<string, Row[]> = seed(), opts: { failTables?: string[] } = {}) {
  const fake = fakeSupabase(
    {
      user_profiles: [
        { id: ADMIN, role: 'admin', display_name: 'Ada Admin', is_active: true },
        { id: CONTROLLER, role: 'executive', display_name: 'Mason Doty', is_active: true },
        { id: REQUESTER, role: 'admin', display_name: 'Jordan Requester', is_active: true },
        { id: REQUESTER2, role: 'sales', display_name: 'Russ Requester', is_active: true },
        { id: VIEWER, role: 'sales', display_name: 'Vi Viewer', is_active: true },
        { id: STRANGER, role: 'executive', display_name: 'Sam Stranger', is_active: true },
      ],
      cmr_access: [
        { user_id: CONTROLLER, role: 'controller' },
        { user_id: REQUESTER, role: 'requester' },
        { user_id: REQUESTER2, role: 'requester' },
        { user_id: VIEWER, role: 'viewer' },
      ],
      ...tables,
    },
    {
      failTables: opts.failTables,
      defaults: {
        cmr_vendor_requests: () => ({
          id: randomUUID(),
          amount_cents: 0,
          due_date: null,
          notes: null,
          status: 'queued',
          placed_kind: null,
          placed_ref_id: null,
          placed_at: null,
          placed_by: null,
        }),
        cmr_daily_ledger: () => ({ id: randomUUID(), beginning_cash_cents: 0, updated_at: '2026-09-16T00:00:00Z' }),
        cmr_pending_items: () => ({ id: randomUUID(), paid_at: null, paid_by: null, source_ref_id: null, notes: null, sort_order: 0 }),
        cmr_weekly_priorities: () => ({ id: randomUUID(), carried_from_id: null, paid_at: null, paid_by: null }),
      },
      // Mirror the DB CHECKs that matter here.
      unique: {
        cmr_vendor_requests: (c) => {
          const placed = c.placed_kind != null || c.placed_ref_id != null || c.placed_at != null
          if (!['queued', 'placed', 'paid', 'declined'].includes(String(c.status))) return 'violates check constraint "cmr_vendor_requests_status_chk"'
          if (!['placed', 'paid'].includes(String(c.status)) && placed) return 'violates check constraint "cmr_vendor_requests_unplaced_chk"'
          if (c.status === 'placed' && !(c.placed_kind && c.placed_ref_id && c.placed_at)) return 'violates check constraint "cmr_vendor_requests_placed_chk"'
          if (Number(c.amount_cents) < 0) return 'violates check constraint "cmr_vendor_requests_amount_chk"'
          return null
        },
        cmr_weekly_priorities: (c) => {
          const [y, m, d] = String(c.week_start).split('-').map(Number)
          if (new Date(Date.UTC(y, m - 1, d)).getUTCDay() !== 0) return 'violates check constraint "cmr_weekly_priorities_week_start_sunday"'
          return null
        },
      },
      // Mirror the two placement functions: insert the row AND flip the request, or refuse.
      rpc: {
        cmr_place_request_pending: (args, t) => {
          const req = t.cmr_vendor_requests.find((r) => r.id === args.p_request_id)
          if (!req) return { message: 'NOT_FOUND' }
          if (req.status !== 'queued') return { message: 'NOT_QUEUED' }
          const id = randomUUID()
          t.cmr_pending_items.push({
            id,
            daily_ledger_id: args.p_ledger_id,
            account_id: args.p_account_id,
            payee: args.p_payee,
            amount_cents: args.p_amount_cents,
            status: 'pending',
            original_date: args.p_date,
            effective_date: args.p_date,
            paid_at: null,
            paid_by: null,
            source: 'request',
            source_ref_id: args.p_request_id,
            notes: args.p_notes,
            sort_order: args.p_sort_order,
            created_by: args.p_placed_by,
            created_at: '2026-09-16T12:00:00Z',
          })
          Object.assign(req, {
            status: 'placed',
            placed_kind: 'pending',
            placed_ref_id: id,
            placed_at: '2026-09-16T12:00:00Z',
            placed_by: args.p_placed_by,
          })
          return { data: id }
        },
        cmr_place_request_priority: (args, t) => {
          const req = t.cmr_vendor_requests.find((r) => r.id === args.p_request_id)
          if (!req) return { message: 'NOT_FOUND' }
          if (req.status !== 'queued') return { message: 'NOT_QUEUED' }
          const [y, m, d] = String(args.p_week_start).split('-').map(Number)
          if (new Date(Date.UTC(y, m - 1, d)).getUTCDay() !== 0) {
            return { message: 'violates check constraint "cmr_weekly_priorities_week_start_sunday"' }
          }
          const id = randomUUID()
          t.cmr_weekly_priorities.push({
            id,
            week_start: args.p_week_start,
            description: args.p_description,
            amount_cents: args.p_amount_cents,
            due_date: args.p_due_date,
            notes: args.p_notes,
            is_top_priority: false,
            status: 'open',
            carried_from_id: null,
            paid_at: null,
            paid_by: null,
            sort_order: args.p_sort_order,
            created_by: args.p_placed_by,
            created_at: '2026-09-16T12:00:00Z',
          })
          Object.assign(req, {
            status: 'placed',
            placed_kind: 'priority',
            placed_ref_id: id,
            placed_at: '2026-09-16T12:00:00Z',
            placed_by: args.p_placed_by,
          })
          return { data: id }
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
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  })

const api = {
  get: () => route.GET(),
  add: (body: unknown) => route.POST(req('POST', '', body)),
  edit: (body: unknown) => route.PATCH(req('PATCH', '', body)),
  del: (id: string) => route.DELETE(req('DELETE', `?id=${id}`)),
  place: (body: unknown) => placeRoute.POST(req('POST', '/place', body)),
  decline: (body: unknown) => declineRoute.POST(req('POST', '/decline', body)),
}

/** One call of every write, for the access tests. */
const everyWrite = () => [
  api.add({ accountId: ACC.TCS, vendor: 'Hacked', amountCents: 1 }),
  api.edit({ id: R.MINE, amountCents: 1 }),
  api.del(R.MINE),
  api.place({ id: R.MINE, target: 'pending', date: '2026-09-17', period: 'am' }),
  api.place({ id: R.MINE, target: 'priority', weekStart: '2026-09-13' }),
  api.decline({ id: R.MINE }),
]
/** The writes only a Controller may make. */
const controllerOnlyWrites = () => [
  api.place({ id: R.MINE, target: 'pending', date: '2026-09-17', period: 'am' }),
  api.place({ id: R.MINE, target: 'priority', weekStart: '2026-09-13' }),
  api.decline({ id: R.MINE }),
]

const writes = (fake: ReturnType<typeof world>) => fake.calls.filter((c) => c.op !== 'select')
type AuditArg = { action: string; resourceId?: string; resourceType?: string; resourceLabel?: string; userRole?: string; metadata?: Record<string, any> } // eslint-disable-line @typescript-eslint/no-explicit-any
const auditCalls = () => audit.logAudit.mock.calls.map((c) => c[0] as AuditArg)
const bodyOf = async (r: Response) => (await r.json()) as { success: boolean; data?: any; error?: string; code?: string } // eslint-disable-line @typescript-eslint/no-explicit-any
const viewOf = async () => (await bodyOf(await api.get())).data
const rowOf = (fake: ReturnType<typeof world>, id: string) => fake.tables.cmr_vendor_requests.find((r) => r.id === id)

beforeEach(() => { audit.logAudit.mockClear() })
afterEach(() => { vi.restoreAllMocks() })

// ── access ──────────────────────────────────────────────────────────────────

describe('/api/cmr/requests — access', () => {
  it('route files export only HTTP handlers + dynamic (BUG-019)', () => {
    const allowed = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'dynamic'])
    for (const mod of [route, placeRoute, declineRoute]) {
      for (const k of Object.keys(mod)) expect(allowed.has(k), k).toBe(true)
      expect((mod as { dynamic?: string }).dynamic).toBe('force-dynamic')
    }
    expect(Object.keys(route).sort()).toEqual(['DELETE', 'GET', 'PATCH', 'POST', 'dynamic'])
    expect(Object.keys(placeRoute).sort()).toEqual(['POST', 'dynamic'])
    expect(Object.keys(declineRoute).sort()).toEqual(['POST', 'dynamic'])
  })

  it('platform admin / stranger with NO grant: 403 on GET and every write — nothing read or written', async () => {
    for (const uid of [ADMIN, STRANGER]) {
      const fake = world(uid)
      const statuses = [(await api.get()).status, ...(await Promise.all(everyWrite())).map((r) => r.status)]
      expect(statuses).toEqual(Array(7).fill(403))
      expect(writes(fake)).toHaveLength(0)
      expect(fake.calls.some((c) => c.table === 'cmr_vendor_requests')).toBe(false)
    }
    expect(audit.logAudit).not.toHaveBeenCalled()
  })

  it('no session: 401 everywhere, nothing touched', async () => {
    const fake = world(null)
    const statuses = [(await api.get()).status, ...(await Promise.all(everyWrite())).map((r) => r.status)]
    expect(statuses).toEqual(Array(7).fill(401))
    expect(fake.calls).toHaveLength(0)
    expect(audit.logAudit).not.toHaveBeenCalled()
  })

  it('VIEWER: reads everything, but CANNOT submit — every write 403, nothing written', async () => {
    const fake = world(VIEWER)
    const g = await api.get()
    expect(g.status).toBe(200)
    const { data } = await bodyOf(g)
    expect(data.canEdit).toBe(false)
    expect(data.canRequest).toBe(false)
    expect(data.userId).toBe(VIEWER)
    expect(data.queued).toHaveLength(3) // sees every queued request, not only their own
    expect(data.history).toHaveLength(2)

    const results = await Promise.all(everyWrite())
    expect(results.map((r) => r.status)).toEqual(Array(6).fill(403))
    for (const r of results) expect((await bodyOf(r)).code).toBe('FORBIDDEN')
    expect(writes(fake)).toHaveLength(0)
    expect(audit.logAudit).not.toHaveBeenCalled()
  })

  it('REQUESTER: may submit, but place and decline are 403 and write nothing', async () => {
    const fake = world(REQUESTER)
    const results = await Promise.all(controllerOnlyWrites())
    expect(results.map((r) => r.status)).toEqual([403, 403, 403])
    for (const r of results) expect((await bodyOf(r)).code).toBe('FORBIDDEN')
    expect(writes(fake)).toHaveLength(0)
    expect(rowOf(fake, R.MINE)!.status).toBe('queued')
    expect(fake.tables.cmr_pending_items).toHaveLength(0)
    expect(fake.tables.cmr_weekly_priorities).toHaveLength(0)
    expect(audit.logAudit).not.toHaveBeenCalled()
  })

  it('GET reports canEdit / canRequest / userId per role', async () => {
    for (const [uid, canEdit, canRequest] of [
      [CONTROLLER, true, true],
      [REQUESTER, false, true],
      [VIEWER, false, false],
    ] as const) {
      world(uid)
      const v = await viewOf()
      expect([v.canEdit, v.canRequest, v.userId]).toEqual([canEdit, canRequest, uid])
    }
  })
})

// ── submitting ──────────────────────────────────────────────────────────────

describe('POST /api/cmr/requests — submit', () => {
  // Hand-entered requests (vendor + amount typed in) are CONTROLLER-only since AP Phase 2 — a
  // Requester's requests are composed from A/P (see ap-compose.test.ts).
  it('a controller hand-enters a request: 201, queued, requested_by = the caller, audited', async () => {
    const fake = world(CONTROLLER)
    const res = await api.add({ accountId: ACC.SIGNS, vendor: '  Sunbelt   Rentals  ', amountCents: 250_000, dueDate: '2026-09-19', notes: 'Rental invoice' })
    expect(res.status).toBe(201)
    const { data } = await bodyOf(res)
    expect(data.request).toMatchObject({
      requestedBy: CONTROLLER,
      accountId: ACC.SIGNS,
      accountName: 'Signs',
      vendor: 'Sunbelt Rentals', // squashed
      amountCents: 250_000,
      dueDate: '2026-09-19',
      notes: 'Rental invoice',
      status: 'queued',
      placedKind: null,
      placedRefId: null,
    })
    expect(data.request).toMatchObject({ fromAp: false, invoices: [] })
    const row = rowOf(fake, data.request.id)!
    expect(row.requested_by).toBe(CONTROLLER)
    expect(row.status).toBe('queued')

    const a = auditCalls()
    expect(a).toHaveLength(1)
    expect(a[0]).toMatchObject({ action: 'cmr.request.submit', resourceType: 'cmr_vendor_requests', resourceId: data.request.id, resourceLabel: 'Sunbelt Rentals', userRole: 'cmr:controller' })
    expect(a[0].metadata?.before).toBeNull()
    expect(a[0].metadata?.after).toMatchObject({ requestedBy: CONTROLLER, status: 'queued', amountCents: 250_000, accountName: 'Signs' })
  })

  it('IGNORES a spoofed requestedBy in the body — the row belongs to the caller', async () => {
    const fake = world(CONTROLLER)
    const res = await api.add({ accountId: ACC.TCS, vendor: 'Spoofed', requestedBy: REQUESTER, amountCents: 100 })
    expect(res.status).toBe(201)
    const { data } = await bodyOf(res)
    expect(data.request.requestedBy).toBe(CONTROLLER)
    expect(rowOf(fake, data.request.id)!.requested_by).toBe(CONTROLLER)
    const insert = fake.calls.find((c) => c.table === 'cmr_vendor_requests' && c.op === 'insert')
    expect((insert?.payload as Row).requested_by).toBe(CONTROLLER)
  })

  it('refuses to set status or placement on submit', async () => {
    const fake = world(REQUESTER)
    for (const body of [
      { accountId: ACC.TCS, vendor: 'V', status: 'placed' },
      { accountId: ACC.TCS, vendor: 'V', placedKind: 'pending' },
      { accountId: ACC.TCS, vendor: 'V', placedRefId: PLACED_REF },
      { accountId: ACC.TCS, vendor: 'V', placedBy: CONTROLLER },
    ]) {
      const res = await api.add(body)
      expect(res.status).toBe(400)
    }
    expect(writes(fake)).toHaveLength(0)
  })

  it('the account must exist and be ACTIVE', async () => {
    const fake = world(CONTROLLER)
    const missing = await api.add({ accountId: '50000000-0000-4000-8000-00000000dead', vendor: 'V' })
    expect(missing.status).toBe(404)
    const inactive = await api.add({ accountId: ACC.OLD, vendor: 'V' })
    expect(inactive.status).toBe(409)
    expect((await bodyOf(inactive)).code).toBe('ACCOUNT_INACTIVE')
    expect(writes(fake)).toHaveLength(0)
    expect(audit.logAudit).not.toHaveBeenCalled()
  })

  it('validates vendor, amount and notes', async () => {
    const fake = world(CONTROLLER)
    const bad = [
      { accountId: ACC.TCS, vendor: '   ' },
      { accountId: ACC.TCS, vendor: 'x'.repeat(81) },
      { accountId: ACC.TCS, vendor: 'V', amountCents: -1 },
      { accountId: ACC.TCS, vendor: 'V', amountCents: 12.5 },
      { accountId: ACC.TCS, vendor: 'V', notes: 'y'.repeat(501) },
      { accountId: 'not-a-uuid', vendor: 'V' },
      { accountId: ACC.TCS, vendor: 'V', dueDate: '2026-13-40' },
    ]
    for (const body of bad) expect((await api.add(body)).status).toBe(400)
    expect(writes(fake)).toHaveLength(0)
  })

  it('amount is optional — a request with no dollar figure stores 0', async () => {
    world(CONTROLLER)
    const { data } = await bodyOf(await api.add({ accountId: ACC.TCS, vendor: 'Call the bank' }))
    expect(data.request.amountCents).toBe(0)
  })

  it('a CONTROLLER may submit too', async () => {
    world(CONTROLLER)
    const res = await api.add({ accountId: ACC.TCS, vendor: 'Controller asked' })
    expect(res.status).toBe(201)
    expect((await bodyOf(res)).data.request.requestedBy).toBe(CONTROLLER)
    expect(auditCalls()[0].userRole).toBe('cmr:controller')
  })
})

// ── editing and withdrawing: own + still queued ─────────────────────────────

describe('PATCH / DELETE /api/cmr/requests — own row, still queued', () => {
  it('a requester edits the note and date of their OWN queued request', async () => {
    const fake = world(REQUESTER)
    const res = await api.edit({ id: R.MINE, notes: 'Called them', dueDate: '2026-09-21' })
    expect(res.status).toBe(200)
    expect((await bodyOf(res)).data.request).toMatchObject({ notes: 'Called them', dueDate: '2026-09-21', amountCents: 125_000 })
    expect(rowOf(fake, R.MINE)).toMatchObject({ notes: 'Called them', due_date: '2026-09-21', amount_cents: 125_000, status: 'queued' })
    const a = auditCalls()
    expect(a).toHaveLength(1)
    expect(a[0]).toMatchObject({ action: 'cmr.request.update', resourceId: R.MINE, userRole: 'cmr:requester' })
    expect(a[0].metadata?.before).toMatchObject({ notes: 'Credit hold' })
    expect(a[0].metadata?.after).toMatchObject({ notes: 'Called them' })
  })

  it('a requester may NOT hand-edit vendor, amount or account (400 AP_REQUIRED) — only the Controller can', async () => {
    const fake = world(REQUESTER)
    for (const body of [{ amountCents: 99_900 }, { vendor: 'Sunbelt Rentals Inc' }, { accountId: ACC.SIGNS }]) {
      const res = await api.edit({ id: R.MINE, ...body })
      expect(res.status).toBe(400)
      expect((await bodyOf(res)).code).toBe('AP_REQUIRED')
    }
    expect(rowOf(fake, R.MINE)).toMatchObject({ amount_cents: 125_000, vendor: 'Sunbelt Rentals', account_id: ACC.TCS })
    expect(writes(fake)).toHaveLength(0)

    world(CONTROLLER)
    const res = await api.edit({ id: R.MINE, amountCents: 99_900, vendor: 'Sunbelt Rentals Inc' })
    expect(res.status).toBe(200)
    expect((await bodyOf(res)).data.request).toMatchObject({ amountCents: 99_900, vendor: 'Sunbelt Rentals Inc' })
    const a = auditCalls()
    expect(a).toHaveLength(1)
    expect(a[0].metadata?.before).toMatchObject({ amountCents: 125_000, vendor: 'Sunbelt Rentals' })
    expect(a[0].metadata?.after).toMatchObject({ amountCents: 99_900, vendor: 'Sunbelt Rentals Inc' })
  })

  it('a requester withdraws their OWN queued request — the row is gone, the audit entry is not', async () => {
    const fake = world(REQUESTER)
    const res = await api.del(R.MINE)
    expect(res.status).toBe(200)
    expect(rowOf(fake, R.MINE)).toBeUndefined()
    const a = auditCalls()
    expect(a).toHaveLength(1)
    expect(a[0]).toMatchObject({ action: 'cmr.request.withdraw', resourceId: R.MINE, resourceLabel: 'Sunbelt Rentals' })
    expect(a[0].metadata?.after).toBeNull()
    expect(a[0].metadata?.before).toMatchObject({ vendor: 'Sunbelt Rentals', requestedBy: REQUESTER })
  })

  it('a requester CANNOT touch someone else’s queued request — 403, unchanged', async () => {
    const fake = world(REQUESTER)
    const edit = await api.edit({ id: R.THEIRS, amountCents: 1 })
    const del = await api.del(R.THEIRS)
    expect([edit.status, del.status]).toEqual([403, 403])
    expect((await bodyOf(edit)).code).toBe('FORBIDDEN')
    expect(rowOf(fake, R.THEIRS)).toMatchObject({ amount_cents: 3_200_000, status: 'queued' })
    expect(writes(fake)).toHaveLength(0)
    expect(audit.logAudit).not.toHaveBeenCalled()
  })

  it('a requester CANNOT touch their own request once it is placed or declined — 409, unchanged', async () => {
    const fake = world(REQUESTER)
    for (const id of [R.PLACED, R.DECLINED]) {
      const edit = await api.edit({ id, amountCents: 1 })
      const del = await api.del(id)
      expect([edit.status, del.status]).toEqual([409, 409])
      expect((await bodyOf(edit)).code).toBe('NOT_EDITABLE')
    }
    expect(rowOf(fake, R.PLACED)).toMatchObject({ status: 'placed', placed_ref_id: PLACED_REF, amount_cents: 5_000 })
    expect(rowOf(fake, R.DECLINED)).toMatchObject({ status: 'declined' })
    expect(writes(fake)).toHaveLength(0)
    expect(audit.logAudit).not.toHaveBeenCalled()
  })

  it('a CONTROLLER may edit and withdraw ANY queued request', async () => {
    const fake = world(CONTROLLER)
    expect((await api.edit({ id: R.THEIRS, notes: 'Called them' })).status).toBe(200)
    expect(rowOf(fake, R.THEIRS)!.notes).toBe('Called them')
    expect((await api.del(R.MINE2)).status).toBe(200)
    expect(rowOf(fake, R.MINE2)).toBeUndefined()
    expect(auditCalls().map((a) => a.action)).toEqual(['cmr.request.update', 'cmr.request.withdraw'])
  })

  it('...but not one that is already placed — even a Controller gets 409', async () => {
    const fake = world(CONTROLLER)
    expect((await api.edit({ id: R.PLACED, amountCents: 1 })).status).toBe(409)
    expect((await api.del(R.PLACED)).status).toBe(409)
    expect(rowOf(fake, R.PLACED)).toMatchObject({ status: 'placed', amount_cents: 5_000 })
    expect(writes(fake)).toHaveLength(0)
  })

  it('PATCH never sets status, placement or the submitter', async () => {
    const fake = world(CONTROLLER)
    for (const body of [
      { id: R.MINE, status: 'placed' },
      { id: R.MINE, placedKind: 'priority' },
      { id: R.MINE, placedRefId: PLACED_REF },
      { id: R.MINE, placedAt: '2026-09-16T00:00:00Z' },
      { id: R.MINE, placedBy: CONTROLLER },
      { id: R.MINE, requestedBy: CONTROLLER },
    ]) {
      const res = await api.edit(body)
      expect(res.status).toBe(400)
      expect((await bodyOf(res)).code).toBe('NOT_ALLOWED_HERE')
    }
    expect(rowOf(fake, R.MINE)).toMatchObject({ status: 'queued', requested_by: REQUESTER, placed_kind: null })
    expect(writes(fake)).toHaveLength(0)
  })

  it('a no-op edit changes nothing and is not audited', async () => {
    const fake = world(REQUESTER)
    const res = await api.edit({ id: R.MINE, notes: 'Credit hold' })
    expect(res.status).toBe(200)
    expect((await bodyOf(res)).data.changed).toBe(false)
    expect(writes(fake)).toHaveLength(0)
    expect(audit.logAudit).not.toHaveBeenCalled()
  })

  it('an unknown id is 404 and a missing/bad id is 400', async () => {
    world(REQUESTER)
    expect((await api.edit({ id: '70000000-0000-4000-8000-00000000dead', vendor: 'V' })).status).toBe(404)
    expect((await api.del('70000000-0000-4000-8000-00000000dead')).status).toBe(404)
    expect((await api.edit({ id: 'nope', vendor: 'V' })).status).toBe(400)
    expect((await api.del('nope')).status).toBe(400)
  })

  it('an edit may not move the request to an inactive account', async () => {
    const fake = world(CONTROLLER)
    const res = await api.edit({ id: R.MINE, accountId: ACC.OLD })
    expect(res.status).toBe(409)
    expect((await bodyOf(res)).code).toBe('ACCOUNT_INACTIVE')
    expect(rowOf(fake, R.MINE)!.account_id).toBe(ACC.TCS)
  })
})

// ── placing ─────────────────────────────────────────────────────────────────

describe('POST /api/cmr/requests/place — Controller only', () => {
  it('into PENDING: creates the item (source request + ref) and flips the request, audited', async () => {
    const fake = world(CONTROLLER)
    const res = await api.place({ id: R.MINE, target: 'pending', date: '2026-09-17', period: 'pm' })
    expect(res.status).toBe(200)
    const { data } = await bodyOf(res)

    // The ledger for that date/period was created on demand.
    const ledger = fake.tables.cmr_daily_ledger.find((l) => l.ledger_date === '2026-09-17' && l.period === 'pm')
    expect(ledger).toBeTruthy()

    const item = fake.tables.cmr_pending_items.find((i) => i.id === data.placedRefId)!
    expect(item).toMatchObject({
      daily_ledger_id: ledger!.id,
      account_id: ACC.TCS,
      payee: 'Sunbelt Rentals',
      amount_cents: 125_000,
      status: 'pending',
      source: 'request',
      source_ref_id: R.MINE,
      notes: 'Credit hold',
      original_date: '2026-09-17',
      effective_date: '2026-09-17',
    })
    expect(rowOf(fake, R.MINE)).toMatchObject({
      status: 'placed',
      placed_kind: 'pending',
      placed_ref_id: item.id,
      placed_by: CONTROLLER,
    })
    expect(data.request).toMatchObject({ status: 'placed', placedKind: 'pending', placedRefId: item.id })

    const place = auditCalls().find((a) => a.action === 'cmr.request.place')!
    expect(place).toMatchObject({ resourceId: R.MINE, resourceType: 'cmr_vendor_requests', resourceLabel: 'Sunbelt Rentals', userRole: 'cmr:controller' })
    expect(place.metadata).toMatchObject({ target: 'pending', ledgerDate: '2026-09-17', period: 'pm', placedRefId: item.id, accountName: 'TCS' })
    expect(place.metadata?.after).toMatchObject({ status: 'placed', placedKind: 'pending', placedRefId: item.id })
  })

  it('into a PRIORITY: creates the open priority in that week and flips the request, audited', async () => {
    const fake = world(CONTROLLER)
    const res = await api.place({ id: R.MINE, target: 'priority', weekStart: '2026-09-16' }) // a Wednesday
    expect(res.status).toBe(200)
    const { data } = await bodyOf(res)

    const p = fake.tables.cmr_weekly_priorities.find((x) => x.id === data.placedRefId)!
    expect(p).toMatchObject({
      week_start: '2026-09-13', // normalised to its Sunday
      description: 'Sunbelt Rentals',
      amount_cents: 125_000,
      due_date: '2026-09-18',
      notes: 'Credit hold',
      status: 'open',
      is_top_priority: false,
      created_by: CONTROLLER,
    })
    expect(rowOf(fake, R.MINE)).toMatchObject({ status: 'placed', placed_kind: 'priority', placed_ref_id: p.id })
    expect(fake.tables.cmr_pending_items).toHaveLength(0)

    const place = auditCalls().find((a) => a.action === 'cmr.request.place')!
    expect(place.metadata).toMatchObject({ target: 'priority', weekStart: '2026-09-13', placedRefId: p.id })
  })

  it('a placed request cannot be re-placed or declined', async () => {
    const fake = world(CONTROLLER)
    for (const body of [
      { id: R.PLACED, target: 'pending', date: '2026-09-17', period: 'am' },
      { id: R.PLACED, target: 'priority', weekStart: '2026-09-13' },
    ]) {
      const res = await api.place(body)
      expect(res.status).toBe(409)
      expect((await bodyOf(res)).code).toBe('NOT_QUEUED')
    }
    expect((await api.decline({ id: R.PLACED })).status).toBe(409)
    expect(rowOf(fake, R.PLACED)!.placed_ref_id).toBe(PLACED_REF)
    expect(fake.tables.cmr_pending_items).toHaveLength(0)
    expect(fake.tables.cmr_weekly_priorities).toHaveLength(0)
    expect(auditCalls().some((a) => a.action === 'cmr.request.place')).toBe(false)
  })

  it('a declined request cannot be placed', async () => {
    const fake = world(CONTROLLER)
    const res = await api.place({ id: R.DECLINED, target: 'pending', date: '2026-09-17', period: 'am' })
    expect(res.status).toBe(409)
    expect(fake.tables.cmr_pending_items).toHaveLength(0)
  })

  it('validates the target and its fields, writing nothing', async () => {
    const fake = world(CONTROLLER)
    const bad = [
      { id: R.MINE },
      { id: R.MINE, target: 'somewhere' },
      { id: R.MINE, target: 'pending' }, // no date
      { id: R.MINE, target: 'pending', date: '2026-09-17' }, // no period
      { id: R.MINE, target: 'pending', date: '2026-09-17', period: 'noon' },
      { id: R.MINE, target: 'pending', date: 'nope', period: 'am' },
      { id: R.MINE, target: 'priority' }, // no week
      { id: R.MINE, target: 'priority', weekStart: 'nope' },
      { id: 'nope', target: 'pending', date: '2026-09-17', period: 'am' },
    ]
    for (const body of bad) expect((await api.place(body)).status, JSON.stringify(body)).toBe(400)
    expect(rowOf(fake, R.MINE)!.status).toBe('queued')
    expect(fake.tables.cmr_pending_items).toHaveLength(0)
    expect(fake.tables.cmr_weekly_priorities).toHaveLength(0)
  })

  it('an unknown request is 404', async () => {
    world(CONTROLLER)
    const res = await api.place({ id: '70000000-0000-4000-8000-00000000dead', target: 'pending', date: '2026-09-17', period: 'am' })
    expect(res.status).toBe(404)
  })

  it('refuses to place into an INACTIVE account and leaves the request queued', async () => {
    const tables = seed()
    ;(tables.cmr_vendor_requests.find((r) => r.id === R.MINE) as Row).account_id = ACC.OLD
    const fake = world(CONTROLLER, tables)
    const res = await api.place({ id: R.MINE, target: 'pending', date: '2026-09-17', period: 'am' })
    expect(res.status).toBe(409)
    expect((await bodyOf(res)).code).toBe('ACCOUNT_INACTIVE')
    expect(rowOf(fake, R.MINE)!.status).toBe('queued')
    expect(fake.tables.cmr_pending_items).toHaveLength(0)
  })

  it('placing appends to the end of that account group on that ledger', async () => {
    const fake = world(CONTROLLER)
    await api.place({ id: R.MINE, target: 'pending', date: '2026-09-17', period: 'am' })
    await api.place({ id: R.MINE2, target: 'pending', date: '2026-09-17', period: 'am' })
    const mine = fake.tables.cmr_pending_items.map((i) => i.sort_order)
    expect(mine).toEqual([0, 1])
  })

  it('a second placement into the same week goes after the first', async () => {
    const fake = world(CONTROLLER)
    await api.place({ id: R.MINE, target: 'priority', weekStart: '2026-09-13' })
    await api.place({ id: R.THEIRS, target: 'priority', weekStart: '2026-09-13' })
    expect(fake.tables.cmr_weekly_priorities.map((p) => p.sort_order)).toEqual([0, 1])
  })
})

// ── declining ───────────────────────────────────────────────────────────────

describe('POST /api/cmr/requests/decline — Controller only', () => {
  it('queued → declined, no placement, audited', async () => {
    const fake = world(CONTROLLER)
    const res = await api.decline({ id: R.MINE, reason: 'Paying next week instead' })
    expect(res.status).toBe(200)
    const row = rowOf(fake, R.MINE)!
    expect(row).toMatchObject({ status: 'declined', placed_kind: null, placed_ref_id: null, placed_at: null })
    expect(String(row.notes)).toContain('Declined: Paying next week instead')
    expect(String(row.notes)).toContain('Credit hold') // the requester's own note is kept

    const a = auditCalls()
    expect(a).toHaveLength(1)
    expect(a[0]).toMatchObject({ action: 'cmr.request.decline', resourceId: R.MINE, userRole: 'cmr:controller' })
    expect(a[0].metadata?.reason).toBe('Paying next week instead')
    expect(a[0].metadata?.after).toMatchObject({ status: 'declined' })
  })

  it('declining without a reason leaves the notes alone', async () => {
    const fake = world(CONTROLLER)
    await api.decline({ id: R.MINE })
    expect(rowOf(fake, R.MINE)).toMatchObject({ status: 'declined', notes: 'Credit hold' })
  })

  it('a declined request stays in the history and out of the queue', async () => {
    world(CONTROLLER)
    await api.decline({ id: R.MINE })
    const v = await viewOf()
    expect(v.queued.map((r: { id: string }) => r.id)).not.toContain(R.MINE)
    expect(v.history.map((r: { id: string }) => r.id)).toContain(R.MINE)
    expect(v.totals.declinedCount).toBe(2)
  })

  it('re-declining is 409', async () => {
    world(CONTROLLER)
    expect((await api.decline({ id: R.DECLINED })).status).toBe(409)
  })
})

// ── the view ────────────────────────────────────────────────────────────────

describe('GET /api/cmr/requests — the view', () => {
  it('splits queued (oldest first) from history (newest first) with totals and names', async () => {
    world(CONTROLLER)
    const v = await viewOf()
    expect(v.queued.map((r: { id: string }) => r.id)).toEqual([R.MINE, R.MINE2, R.THEIRS])
    expect(v.history.map((r: { id: string }) => r.id)).toEqual([R.PLACED, R.DECLINED])
    expect(v.totals).toMatchObject({
      queuedCount: 3,
      queuedCents: 125_000 + 0 + 3_200_000,
      historyCount: 2,
      placedCount: 1,
      declinedCount: 1,
      mineQueuedCount: 0, // the Controller submitted none of them
    })
    expect(v.queued[0]).toMatchObject({ requestedByName: 'Jordan Requester', accountName: 'TCS', accountActive: true })
    expect(v.history[0]).toMatchObject({ placedKind: 'pending', placedByName: 'Mason Doty' })
  })

  it('mineQueuedCount counts the caller’s own queued requests', async () => {
    world(REQUESTER)
    expect((await viewOf()).totals.mineQueuedCount).toBe(2)
    world(REQUESTER2)
    expect((await viewOf()).totals.mineQueuedCount).toBe(1)
  })

  it('sends the accounts in CMR order, inactive ones included so history still names them', async () => {
    world(REQUESTER)
    const v = await viewOf()
    expect(v.accounts.map((a: { name: string }) => a.name)).toEqual(['TCS', 'Signs', 'Old Account'])
    expect(v.accounts.find((a: { name: string }) => a.name === 'Old Account').active).toBe(false)
  })

  it('fails CLOSED when the requests table errors', async () => {
    world(CONTROLLER, seed(), { failTables: ['cmr_vendor_requests'] })
    expect((await api.get()).status).toBe(500)
  })
})
