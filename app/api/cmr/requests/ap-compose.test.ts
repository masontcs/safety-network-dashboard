import { describe, it, expect, vi, beforeEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import { fakeSupabase, fakeRouteClient } from '@/lib/cmr/__testing__/fakeSupabase'
import { composeFromAp, type CmrComposableLine } from '@/lib/cmr/requests'

/**
 * AP Phase 2 — vendor requests COMPOSED from the account's current A/P.
 *
 *   • submit composes the amount on the server from the stored lines; any amount / vendor the
 *     client sends is ignored; credits subtract;
 *   • a line that is not a payable line of that vendor in that account's CURRENT A/P refuses the
 *     whole request (other vendor, other account, non-payable, paid off / re-imported, unknown);
 *     so do an inactive account and a selection whose credits cancel its bills — nothing written;
 *   • the ticked lines are snapshotted; a re-import that removes the source lines leaves the
 *     snapshot and the amount intact (ap_line_id → null); the view then says which invoices are
 *     "no longer in current AP", and placing still works with the snapshot total, listing the
 *     invoices in the new row's notes;
 *   • access: Requester submit 201 · Viewer 403 · no grant (admin included) 403 · no session 401,
 *     for submit AND the picker read; a Requester's hand-entered (free-text) request is refused;
 *   • the Controller is never forced through the picker: hand-entered requests and direct
 *     ledger pending items still work with no A/P at all;
 *   • editing an own queued request re-composes it (snapshot replaced); someone else's is 403.
 *
 * The fake database mirrors cmr_compose_vendor_request with the SAME rule the app uses
 * (composeFromAp over the account's current lines); the SQL itself was run against a real
 * PostgreSQL 16 with the real STS file (see lib/cmr/ap-requests-migration.test.ts).
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
  pacificToday: () => '2026-09-22',
}))

import * as route from './route'
import * as placeRoute from './place/route'
import * as vendorsRoute from '@/app/api/cmr/ap/vendors/route'
import * as pendingRoute from '@/app/api/cmr/ledger/pending/route'

const ADMIN = '00000000-0000-4000-8000-00000000a0a0'
const CONTROLLER = '00000000-0000-4000-8000-00000000c0c0'
const REQUESTER = '00000000-0000-4000-8000-00000000e0e0'
const REQUESTER2 = '00000000-0000-4000-8000-00000000e0e1'
const VIEWER = '00000000-0000-4000-8000-00000000f0f0'

const ACC = {
  STS: '50000000-0000-4000-8000-000000000001',
  TCS: '50000000-0000-4000-8000-000000000002',
  OLD: '50000000-0000-4000-8000-000000000003', // inactive, has A/P
  INC: '50000000-0000-4000-8000-000000000004', // no A/P import at all
}
const IMP = { STS: '60000000-0000-4000-8000-000000000001', TCS: '60000000-0000-4000-8000-000000000002', OLD: '60000000-0000-4000-8000-000000000003' }

type Row = Record<string, unknown>

// Real lines from "STS AP 92226.xlsx" (a subset), plus one TCS and one inactive-account line.
const SPEC: [key: string, account: keyof typeof IMP, vendor: string, num: string | null, type: string, bill: string, cents: number][] = [
  ['zap9421', 'STS', 'ZAP MANUFACTURING INC.', '9421', 'Bill', '2025-01-24', 171_000],
  ['zap9440', 'STS', 'ZAP MANUFACTURING INC.', '9440', 'Bill', '2025-02-04', 129_000],
  ['zap9520', 'STS', 'ZAP MANUFACTURING INC.', '9520', 'Bill', '2025-02-26', 365_000],
  ['trx103', 'STS', 'TRAFFIX DEVICES', '4092103', 'Bill', '2025-11-24', 293_080],
  ['trx104', 'STS', 'TRAFFIX DEVICES', '4092104', 'Bill', '2025-11-24', 1_530_050],
  ['trxCM', 'STS', 'TRAFFIX DEVICES', 'CM', 'Credit', '2026-01-02', -600_814],
  ['amgBill', 'STS', 'AMERIGAS', '3163965555', 'Bill', '2024-05-04', 6_262],
  ['amgCR', 'STS', 'AMERIGAS', '102124CC TRAVIS', 'Credit', '2024-10-21', -77_951],
  ['omega', 'STS', 'OMEGA  ACCOUNTING SOLUTIONS', '231869', 'Bill', '2025-05-06', 1_651_139],
  ['adj', 'STS', 'AP ADJUSTMENT ACCOUNT', 'EJ.24.01', 'General Journal', '2023-12-31', 27_937_775],
  ['tcsZap', 'TCS', 'ZAP MANUFACTURING INC.', '9999', 'Bill', '2025-03-01', 50_000],
  ['oldZap', 'OLD', 'ZAP MANUFACTURING INC.', '1', 'Bill', '2025-03-01', 10_000],
]
const L: Record<string, string> = {}

function apLine(key: string, acc: keyof typeof IMP, vendor: string, num: string | null, type: string, bill: string, cents: number, id = randomUUID()): Row {
  L[key] = id
  return {
    id,
    import_id: IMP[acc],
    account_id: ACC[acc],
    vendor_name: vendor,
    invoice_num: num,
    doc_type: type,
    bill_date: bill,
    due_date: null,
    aging_days: 100,
    aging_bucket: '> 90',
    open_balance_cents: cents,
    payable: type === 'Bill' || type === 'Credit',
  }
}

const asComposable = (r: Row): CmrComposableLine => ({
  id: r.id as string,
  accountId: r.account_id as string,
  vendorName: r.vendor_name as string,
  docType: r.doc_type as string,
  payable: r.payable as boolean,
  openBalanceCents: Number(r.open_balance_cents),
})

function world(userId: string | null) {
  const fake = fakeSupabase(
    {
      user_profiles: [
        { id: ADMIN, role: 'admin', display_name: 'Ada Admin', is_active: true },
        { id: CONTROLLER, role: 'executive', display_name: 'Mason Doty', is_active: true },
        { id: REQUESTER, role: 'sales', display_name: 'Jordan Requester', is_active: true },
        { id: REQUESTER2, role: 'sales', display_name: 'Russ Requester', is_active: true },
        { id: VIEWER, role: 'sales', display_name: 'Vi Viewer', is_active: true },
      ],
      cmr_access: [
        { user_id: CONTROLLER, role: 'controller' },
        { user_id: REQUESTER, role: 'requester' },
        { user_id: REQUESTER2, role: 'requester' },
        { user_id: VIEWER, role: 'viewer' },
      ],
      cmr_accounts: [
        { id: ACC.STS, name: 'STS', account_type: null, active: true, sort_order: 0 },
        { id: ACC.TCS, name: 'TCS', account_type: null, active: true, sort_order: 1 },
        { id: ACC.OLD, name: 'Old Account', account_type: null, active: false, sort_order: 2 },
        { id: ACC.INC, name: 'INC', account_type: null, active: true, sort_order: 3 },
      ],
      cmr_ap_imports: (Object.keys(IMP) as (keyof typeof IMP)[]).map((a) => ({
        id: IMP[a],
        account_id: ACC[a],
        source_filename: `${a} AP 92226.xlsx`,
        report_total_cents: 0,
        payable_total_cents: 0,
        line_count: 0,
        imported_by: CONTROLLER,
        imported_at: '2026-09-22T20:05:39Z',
        is_current: true,
      })),
      cmr_ap_lines: SPEC.map((s) => apLine(...s)),
      cmr_vendor_requests: [],
      cmr_vendor_request_invoices: [],
      cmr_daily_ledger: [],
      cmr_ledger_adjustments: [],
      cmr_pending_items: [],
      cmr_weekly_priorities: [],
    },
    {
      defaults: {
        cmr_vendor_requests: () => ({
          id: randomUUID(), amount_cents: 0, due_date: null, notes: null, status: 'queued',
          placed_kind: null, placed_ref_id: null, placed_at: null, placed_by: null,
        }),
        cmr_daily_ledger: () => ({ id: randomUUID(), beginning_cash_cents: 0, updated_at: '2026-09-22T00:00:00Z' }),
        cmr_pending_items: () => ({ id: randomUUID(), paid_at: null, paid_by: null, source_ref_id: null, notes: null, sort_order: 0 }),
      },
      unique: {
        cmr_vendor_requests: (c) => (Number(c.amount_cents) < 0 ? 'violates check constraint "cmr_vendor_requests_amount_chk"' : null),
      },
      // ON DELETE CASCADE: withdrawing a request removes its snapshot rows.
      onDelete: {
        cmr_vendor_requests: (deleted, t) => {
          const gone = new Set(deleted.map((r) => r.id))
          t.cmr_vendor_request_invoices = t.cmr_vendor_request_invoices.filter((i) => !gone.has(i.request_id))
        },
      },
      rpc: {
        // Mirrors cmr_compose_vendor_request.
        cmr_compose_vendor_request: (a, t) => {
          const acc = t.cmr_accounts.find((r) => r.id === a.p_account_id)
          if (!acc) return { message: 'NOT_FOUND' }
          if (!acc.active) return { message: 'INACTIVE' }
          const current = new Set(t.cmr_ap_imports.filter((i) => i.is_current && i.account_id === a.p_account_id).map((i) => i.id))
          const lines = t.cmr_ap_lines.filter((l) => current.has(l.import_id))
          const r = composeFromAp(lines.map(asComposable), {
            accountId: a.p_account_id as string,
            vendorName: a.p_vendor_name as string,
            apLineIds: (a.p_ap_line_ids as string[]) ?? [],
          })
          if (!r.ok) return { message: r.code }
          let id = a.p_request_id as string | null
          if (!id) {
            id = randomUUID()
            t.cmr_vendor_requests.push({
              id, requested_by: a.p_actor, account_id: a.p_account_id, vendor: a.p_vendor, amount_cents: r.totalCents,
              due_date: a.p_due_date, notes: a.p_notes, status: 'queued', placed_kind: null, placed_ref_id: null,
              placed_at: null, placed_by: null, created_at: '2026-09-22T21:00:00Z',
            })
          } else {
            const req = t.cmr_vendor_requests.find((q) => q.id === id)
            if (!req) return { message: 'NOT_FOUND' }
            if (req.status !== 'queued') return { message: 'NOT_QUEUED' }
            if (a.p_owner && req.requested_by !== a.p_owner) return { message: 'FORBIDDEN' }
            Object.assign(req, { account_id: a.p_account_id, vendor: a.p_vendor, amount_cents: r.totalCents, due_date: a.p_due_date, notes: a.p_notes })
            t.cmr_vendor_request_invoices = t.cmr_vendor_request_invoices.filter((i) => i.request_id !== id)
          }
          for (const c of r.lines) {
            const l = lines.find((x) => x.id === c.id)!
            t.cmr_vendor_request_invoices.push({
              id: randomUUID(), request_id: id, ap_line_id: l.id, vendor_name: l.vendor_name, invoice_num: l.invoice_num,
              doc_type: l.doc_type, bill_date: l.bill_date, due_date: l.due_date, open_balance_cents: l.open_balance_cents,
              created_at: '2026-09-22T21:00:00Z',
            })
          }
          return { data: id }
        },
        cmr_place_request_pending: (a, t) => {
          const req = t.cmr_vendor_requests.find((r) => r.id === a.p_request_id)
          if (!req) return { message: 'NOT_FOUND' }
          if (req.status !== 'queued') return { message: 'NOT_QUEUED' }
          const id = randomUUID()
          t.cmr_pending_items.push({
            id, daily_ledger_id: a.p_ledger_id, account_id: a.p_account_id, payee: a.p_payee, amount_cents: a.p_amount_cents,
            status: 'pending', original_date: a.p_date, effective_date: a.p_date, paid_at: null, paid_by: null,
            source: 'request', source_ref_id: a.p_request_id, notes: a.p_notes, sort_order: a.p_sort_order,
            created_by: a.p_placed_by, created_at: '2026-09-22T22:00:00Z',
          })
          Object.assign(req, { status: 'placed', placed_kind: 'pending', placed_ref_id: id, placed_at: '2026-09-22T22:00:00Z', placed_by: a.p_placed_by })
          return { data: id }
        },
        cmr_place_request_priority: (a, t) => {
          const req = t.cmr_vendor_requests.find((r) => r.id === a.p_request_id)
          if (!req) return { message: 'NOT_FOUND' }
          if (req.status !== 'queued') return { message: 'NOT_QUEUED' }
          const id = randomUUID()
          t.cmr_weekly_priorities.push({
            id, week_start: a.p_week_start, description: a.p_description, amount_cents: a.p_amount_cents, due_date: a.p_due_date,
            notes: a.p_notes, is_top_priority: false, status: 'open', carried_from_id: null, paid_at: null, paid_by: null,
            sort_order: a.p_sort_order, created_by: a.p_placed_by, created_at: '2026-09-22T22:00:00Z',
          })
          Object.assign(req, { status: 'placed', placed_kind: 'priority', placed_ref_id: id, placed_at: '2026-09-22T22:00:00Z', placed_by: a.p_placed_by })
          return { data: id }
        },
      },
    },
  )
  server.routeClient = fakeRouteClient(userId)
  server.serviceClient = fake.client
  return fake
}

/**
 * A re-import of STS, as cmr_ap_replace_import does it: the old import and ALL its lines go
 * (ON DELETE SET NULL nulls the snapshot's ap_line_id) and every line comes back with a NEW
 * id. `drop` leaves some invoices out (paid off since yesterday).
 */
function reimportSts(fake: ReturnType<typeof world>, drop: string[] = []) {
  const t = fake.tables
  const old = new Set(t.cmr_ap_lines.filter((l) => l.account_id === ACC.STS).map((l) => l.id))
  for (const i of t.cmr_vendor_request_invoices) if (old.has(i.ap_line_id)) i.ap_line_id = null
  t.cmr_ap_lines = t.cmr_ap_lines.filter((l) => l.account_id !== ACC.STS)
  for (const s of SPEC) if (s[1] === 'STS' && !drop.includes(s[0])) t.cmr_ap_lines.push(apLine(...s))
  for (const k of drop) delete L[k]
}

const base = 'https://cmr.safetynetworkteams.com/api/cmr'
const jreq = (method: string, url: string, body?: unknown) =>
  new Request(url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
const api = {
  get: () => route.GET(),
  add: (body: unknown) => route.POST(jreq('POST', `${base}/requests`, body)),
  edit: (body: unknown) => route.PATCH(jreq('PATCH', `${base}/requests`, body)),
  del: (id: string) => route.DELETE(jreq('DELETE', `${base}/requests?id=${id}`)),
  place: (body: unknown) => placeRoute.POST(jreq('POST', `${base}/requests/place`, body)),
  vendors: (accountId: string) => vendorsRoute.GET(jreq('GET', `${base}/ap/vendors?accountId=${accountId}`)),
  addPending: (body: unknown) => pendingRoute.POST(jreq('POST', `${base}/ledger/pending`, body)),
}
const bodyOf = async (r: Response) => (await r.json()) as { success: boolean; data?: any; error?: string; code?: string } // eslint-disable-line @typescript-eslint/no-explicit-any
type AuditArg = { action: string; resourceId?: string; userRole?: string; metadata?: Record<string, any> } // eslint-disable-line @typescript-eslint/no-explicit-any
const auditCalls = () => audit.logAudit.mock.calls.map((c) => c[0] as AuditArg)
const writes = (fake: ReturnType<typeof world>) => fake.calls.filter((c) => c.op !== 'select')
const zap = (ids: string[], extra: Row = {}) => ({ accountId: ACC.STS, vendorName: 'ZAP MANUFACTURING INC.', apLineIds: ids, ...extra })
const traffix = () => ({ accountId: ACC.STS, vendorName: 'TRAFFIX DEVICES', apLineIds: [L.trx103, L.trx104, L.trxCM] })

beforeEach(() => { audit.logAudit.mockClear() })

// ── access ──────────────────────────────────────────────────────────────────

describe('AP-composed requests — access', () => {
  it('the picker route exports only GET + dynamic (BUG-019)', () => {
    expect(Object.keys(vendorsRoute).sort()).toEqual(['GET', 'dynamic'])
    expect(vendorsRoute.dynamic).toBe('force-dynamic')
  })

  it('Requester submit → 201; Viewer → 403; no-grant platform admin → 403; no session → 401', async () => {
    world(REQUESTER)
    expect((await api.add(zap([L.zap9421]))).status).toBe(201)

    for (const [uid, status] of [[VIEWER, 403], [ADMIN, 403], [null, 401]] as const) {
      const fake = world(uid)
      const res = await api.add(zap([L.zap9421]))
      expect(res.status).toBe(status)
      expect(writes(fake)).toHaveLength(0)
      expect(fake.tables.cmr_vendor_requests).toHaveLength(0)
      expect(fake.calls.some((c) => c.table === 'cmr_ap_lines')).toBe(false) // refused before reading A/P
    }
    expect(auditCalls().map((a) => a.userRole)).toEqual(['cmr:requester'])
  })

  it('the picker read: every CMR role 200 (incl. Viewer); no grant 403; no session 401', async () => {
    for (const uid of [CONTROLLER, REQUESTER, VIEWER]) {
      world(uid)
      expect((await api.vendors(ACC.STS)).status).toBe(200)
    }
    let fake = world(ADMIN)
    expect((await api.vendors(ACC.STS)).status).toBe(403)
    expect(fake.calls.some((c) => c.table === 'cmr_ap_lines')).toBe(false)
    fake = world(null)
    expect((await api.vendors(ACC.STS)).status).toBe(401)
    expect(fake.calls).toHaveLength(0)
  })

  it('a Requester cannot hand-enter a vendor + amount any more (400 AP_REQUIRED); nothing written', async () => {
    const fake = world(REQUESTER)
    const res = await api.add({ accountId: ACC.STS, vendor: 'ZAP MANUFACTURING INC.', amountCents: 999_999 })
    expect(res.status).toBe(400)
    expect((await bodyOf(res)).code).toBe('AP_REQUIRED')
    expect(writes(fake)).toHaveLength(0)
  })
})

// ── the picker read ────────────────────────────────────────────────────────

describe('GET /api/cmr/ap/vendors', () => {
  it('lists the account’s vendors A–Z with PAYABLE lines only — credits negative, GJ lines absent', async () => {
    world(REQUESTER)
    const { data } = await bodyOf(await api.vendors(ACC.STS))
    expect(data.account).toMatchObject({ id: ACC.STS, name: 'STS' })
    expect(data.import).toMatchObject({ id: IMP.STS, sourceFilename: 'STS AP 92226.xlsx' })
    expect(data.vendors.map((v: { vendorName: string }) => v.vendorName)).toEqual([
      'AMERIGAS', 'OMEGA  ACCOUNTING SOLUTIONS', 'TRAFFIX DEVICES', 'ZAP MANUFACTURING INC.',
    ])
    const trx = data.vendors.find((v: { vendorName: string }) => v.vendorName === 'TRAFFIX DEVICES')
    expect(trx).toMatchObject({ owedCents: 293_080 + 1_530_050 - 600_814, billCount: 2, creditCount: 1 })
    expect(trx.lines.map((l: { invoiceNum: string; docType: string; openBalanceCents: number }) => [l.invoiceNum, l.docType, l.openBalanceCents])).toEqual([
      ['4092103', 'Bill', 293_080], ['4092104', 'Bill', 1_530_050], ['CM', 'Credit', -600_814],
    ])
    // other accounts' lines never leak in
    expect(JSON.stringify(data)).not.toContain(L.tcsZap)
  })

  it('an account with no A/P import → import: null (the form shows "import this account’s A/P first")', async () => {
    world(REQUESTER)
    const { data } = await bodyOf(await api.vendors(ACC.INC))
    expect(data).toMatchObject({ import: null, vendors: [] })
  })

  it('validates the account', async () => {
    world(REQUESTER)
    expect((await api.vendors('nope')).status).toBe(400)
    expect((await api.vendors('50000000-0000-4000-8000-00000000dead')).status).toBe(404)
  })
})

// ── composing ──────────────────────────────────────────────────────────────

describe('POST /api/cmr/requests — composed from A/P', () => {
  it('computes the amount on the SERVER from the stored lines — the client’s amount and vendor are ignored', async () => {
    const fake = world(REQUESTER)
    const res = await api.add(zap([L.zap9421, L.zap9440], { amountCents: 1, vendor: 'Hacked', requestedBy: CONTROLLER, dueDate: '2026-09-25', notes: 'Two oldest' }))
    expect(res.status).toBe(201)
    const { data } = await bodyOf(res)
    expect(data.request).toMatchObject({
      requestedBy: REQUESTER,
      accountId: ACC.STS,
      vendor: 'ZAP MANUFACTURING INC.',
      amountCents: 171_000 + 129_000,
      dueDate: '2026-09-25',
      notes: 'Two oldest',
      status: 'queued',
      fromAp: true,
      staleInvoiceCount: 0,
    })
    const row = fake.tables.cmr_vendor_requests[0]
    expect(row).toMatchObject({ amount_cents: 300_000, requested_by: REQUESTER, vendor: 'ZAP MANUFACTURING INC.' })
    // the compose call carried the ids, never an amount
    const call = fake.calls.find((c) => c.table === 'cmr_compose_vendor_request')!.payload as Row
    expect(Object.keys(call).some((k) => /amount/i.test(k))).toBe(false)
    expect(call.p_actor).toBe(REQUESTER)
    // snapshot
    expect(fake.tables.cmr_vendor_request_invoices.map((i) => [i.invoice_num, i.open_balance_cents, i.ap_line_id])).toEqual([
      ['9421', 171_000, L.zap9421], ['9440', 129_000, L.zap9440],
    ])
    const a = auditCalls()
    expect(a).toHaveLength(1)
    expect(a[0]).toMatchObject({ action: 'cmr.request.submit', resourceId: row.id, userRole: 'cmr:requester' })
    expect(a[0].metadata).toMatchObject({ fromAp: true, accountName: 'STS', vendorName: 'ZAP MANUFACTURING INC.', lineCount: 2, totalCents: 300_000 })
  })

  it('credits SUBTRACT: 2 bills + 1 credit = Σ bills − Σ credits', async () => {
    const fake = world(REQUESTER)
    const { data } = await bodyOf(await api.add(traffix()))
    expect(data.request.amountCents).toBe(293_080 + 1_530_050 - 600_814)
    expect(data.request.invoices.map((i: { invoiceNum: string; docType: string; openBalanceCents: number }) => [i.invoiceNum, i.docType, i.openBalanceCents])).toEqual([
      ['4092103', 'Bill', 293_080], ['4092104', 'Bill', 1_530_050], ['CM', 'Credit', -600_814], // bills first, then credits
    ])
    expect(fake.tables.cmr_vendor_requests[0].amount_cents).toBe(1_222_316)
  })

  it('matches the QuickBooks vendor name EXACTLY (double spaces and all) and labels it squashed', async () => {
    const fake = world(REQUESTER)
    const res = await api.add({ accountId: ACC.STS, vendorName: 'OMEGA  ACCOUNTING SOLUTIONS', apLineIds: [L.omega] })
    expect(res.status).toBe(201)
    expect(fake.tables.cmr_vendor_requests[0]).toMatchObject({ vendor: 'OMEGA ACCOUNTING SOLUTIONS', amount_cents: 1_651_139 })
    expect(fake.tables.cmr_vendor_request_invoices[0].vendor_name).toBe('OMEGA  ACCOUNTING SOLUTIONS')
    // the squashed spelling is a different vendor → its line doesn't belong to it
    world(REQUESTER)
    expect((await api.add({ accountId: ACC.STS, vendorName: 'OMEGA ACCOUNTING SOLUTIONS', apLineIds: [L.omega] })).status).toBe(409)
  })

  it('REJECTS a line that is not in the current A/P for that account + vendor — the whole request, nothing written', async () => {
    const cases: [string, Row][] = [
      ['another vendor’s line', zap([L.zap9421, L.trxCM])],
      ['another account’s line', zap([L.zap9421, L.tcsZap])],
      ['a non-payable General Journal line', { accountId: ACC.STS, vendorName: 'AP ADJUSTMENT ACCOUNT', apLineIds: [L.adj] }],
      ['an id that does not exist', zap([L.zap9421, randomUUID()])],
      ['the right vendor under the wrong account', { accountId: ACC.TCS, vendorName: 'ZAP MANUFACTURING INC.', apLineIds: [L.zap9421] }],
    ]
    for (const [why, body] of cases) {
      const fake = world(REQUESTER)
      const res = await api.add(body)
      expect(res.status, why).toBe(409)
      expect((await bodyOf(res)).code, why).toBe('STALE_LINES')
      expect(fake.tables.cmr_vendor_requests, why).toHaveLength(0)
      expect(fake.tables.cmr_vendor_request_invoices, why).toHaveLength(0)
    }
    expect(audit.logAudit).not.toHaveBeenCalled()
  })

  it('a line paid off since the picker loaded (re-import dropped it) is rejected', async () => {
    const fake = world(REQUESTER)
    const stale = L.zap9421
    reimportSts(fake, ['zap9421'])
    const res = await api.add(zap([stale, L.zap9440]))
    expect(res.status).toBe(409)
    expect((await bodyOf(res)).error).toMatch(/One of the invoices you ticked is no longer in STS’s current A\/P/)
    expect(fake.tables.cmr_vendor_requests).toHaveLength(0)
  })

  it('an INACTIVE account is rejected (409), an unknown one 404', async () => {
    const fake = world(REQUESTER)
    const res = await api.add({ accountId: ACC.OLD, vendorName: 'ZAP MANUFACTURING INC.', apLineIds: [L.oldZap] })
    expect(res.status).toBe(409)
    expect((await bodyOf(res)).code).toBe('ACCOUNT_INACTIVE')
    expect((await api.add(zap([L.zap9421], { accountId: '50000000-0000-4000-8000-00000000dead' }))).status).toBe(404)
    expect(fake.tables.cmr_vendor_requests).toHaveLength(0)
  })

  it('credits that cancel or exceed the bills are refused (400 NOT_POSITIVE)', async () => {
    const fake = world(REQUESTER)
    for (const ids of [[L.amgCR], [L.amgCR, L.amgBill]]) {
      const res = await api.add({ accountId: ACC.STS, vendorName: 'AMERIGAS', apLineIds: ids })
      expect(res.status).toBe(400)
      expect((await bodyOf(res)).code).toBe('NOT_POSITIVE')
    }
    expect(fake.tables.cmr_vendor_requests).toHaveLength(0)
  })

  it('validates the payload: no invoices, bad ids, no vendor, bad account', async () => {
    const fake = world(REQUESTER)
    for (const body of [
      zap([]),
      zap(['not-a-uuid']),
      zap('x' as unknown as string[]),
      { accountId: ACC.STS, vendorName: '', apLineIds: [L.zap9421] },
      { accountId: 'nope', vendorName: 'ZAP MANUFACTURING INC.', apLineIds: [L.zap9421] },
      zap([L.zap9421], { notes: 'y'.repeat(501) }),
    ]) {
      expect((await api.add(body)).status).toBe(400)
    }
    expect(writes(fake)).toHaveLength(0)
  })

  it('duplicate ids count once', async () => {
    const fake = world(REQUESTER)
    const { data } = await bodyOf(await api.add(zap([L.zap9421, L.zap9421, L.zap9421.toUpperCase()])))
    expect(data.request.amountCents).toBe(171_000)
    expect(fake.tables.cmr_vendor_request_invoices).toHaveLength(1)
  })
})

// ── the snapshot outlives a re-import ──────────────────────────────────────

describe('the invoice snapshot', () => {
  it('survives a re-import that REPLACES every source line: ap_line_id → null, amount unchanged, still "in current AP" by match', async () => {
    const fake = world(REQUESTER)
    const { data } = await bodyOf(await api.add(traffix()))
    reimportSts(fake)
    expect(fake.tables.cmr_vendor_request_invoices.every((i) => i.ap_line_id === null)).toBe(true)
    expect(fake.tables.cmr_vendor_requests[0].amount_cents).toBe(1_222_316)

    const v = (await bodyOf(await api.get())).data
    const q = v.queued.find((r: { id: string }) => r.id === data.request.id)
    expect(q).toMatchObject({ amountCents: 1_222_316, fromAp: true, staleInvoiceCount: 0 })
    // re-linked to TODAY's line ids (what an edit pre-ticks)
    expect(q.invoices.map((i: { currentApLineId: string }) => i.currentApLineId).sort()).toEqual([L.trx103, L.trx104, L.trxCM].sort())
  })

  it('flags invoices that are NO LONGER in the current A/P — and placing still works with the snapshot total, listing the invoices', async () => {
    const fake = world(REQUESTER)
    const { data } = await bodyOf(await api.add(traffix()))
    reimportSts(fake, ['trx104']) // paid off
    let v = (await bodyOf(await api.get())).data
    let q = v.queued[0]
    expect(q.staleInvoiceCount).toBe(1)
    expect(q.invoices.find((i: { invoiceNum: string }) => i.invoiceNum === '4092104')).toMatchObject({ inCurrentAp: false, currentApLineId: null })

    world(CONTROLLER)
    Object.assign(server, { serviceClient: fake.client })
    const res = await api.place({ id: data.request.id, target: 'pending', date: '2026-09-23', period: 'am' })
    expect(res.status).toBe(200)
    const item = fake.tables.cmr_pending_items[0]
    expect(item).toMatchObject({ amount_cents: 1_222_316, payee: 'TRAFFIX DEVICES', source: 'request', source_ref_id: data.request.id })
    expect(item.notes).toBe('Invoices (3): Bill 4092103 $2,930.80; Bill 4092104 $15,300.50; Credit CM −$6,008.14 = $12,223.16')
    const placeAudit = auditCalls().find((a) => a.action === 'cmr.request.place')!
    expect(placeAudit.metadata).toMatchObject({ amountCents: 1_222_316, invoiceCount: 3, staleInvoiceCount: 1 })

    // the placed request keeps listing its invoices (history)
    v = (await bodyOf(await api.get())).data
    q = v.history[0]
    expect(q).toMatchObject({ status: 'placed', fromAp: true, amountCents: 1_222_316 })
    expect(q.invoices).toHaveLength(3)
  })

  it('placing into a weekly priority carries the total and the invoices too; the request’s own note comes first', async () => {
    const fake = world(REQUESTER)
    const { data } = await bodyOf(await api.add(zap([L.zap9421, L.zap9440], { notes: 'Call Zap first' })))
    world(CONTROLLER)
    Object.assign(server, { serviceClient: fake.client })
    expect((await api.place({ id: data.request.id, target: 'priority', weekStart: '2026-09-20' })).status).toBe(200)
    expect(fake.tables.cmr_weekly_priorities[0]).toMatchObject({
      description: 'ZAP MANUFACTURING INC.',
      amount_cents: 300_000,
      notes: 'Call Zap first · Invoices (2): Bill 9421 $1,710.00; Bill 9440 $1,290.00 = $3,000.00',
    })
  })

  it('withdrawing a request removes its snapshot (cascade) and the audit keeps the invoices', async () => {
    const fake = world(REQUESTER)
    const { data } = await bodyOf(await api.add(traffix()))
    expect((await api.del(data.request.id)).status).toBe(200)
    expect(fake.tables.cmr_vendor_request_invoices).toHaveLength(0)
    const w = auditCalls().find((a) => a.action === 'cmr.request.withdraw')!
    expect(w.metadata?.before.invoices).toHaveLength(3)
  })
})

describe('reading many requests', () => {
  it('the snapshot read batches request ids (the list only grows; one huge in.() would outgrow the URL)', async () => {
    const fake = world(REQUESTER)
    for (let i = 0; i < 320; i++) {
      fake.tables.cmr_vendor_requests.push({
        id: randomUUID(), requested_by: REQUESTER, account_id: ACC.STS, vendor: 'V', amount_cents: 1, due_date: null, notes: null,
        status: 'declined', placed_kind: null, placed_ref_id: null, placed_at: null, placed_by: null, created_at: '2026-09-01T00:00:00Z',
      })
    }
    await api.add(zap([L.zap9421]))
    const res = await api.get()
    expect(res.status).toBe(200)
    const reads = fake.calls.filter((c) => c.table === 'cmr_vendor_request_invoices' && c.op === 'select' && c.filters.some(([k]) => k === 'request_id'))
    const sizes = reads.map((c) => ((c.filters.find(([k]) => k === 'request_id')![1] as { in: string[] }).in.length))
    expect(Math.max(...sizes)).toBeLessThanOrEqual(150)
    expect(sizes.slice(-3).reduce((a, b) => a + b, 0)).toBe(321)
    expect((await bodyOf(res)).data.queued[0]).toMatchObject({ fromAp: true, amountCents: 171_000 })
  })
})

// ── editing ─────────────────────────────────────────────────────────────────

describe('PATCH — editing a composed request', () => {
  it('edit-own RE-COMPOSES: new invoices → new amount, snapshot replaced, audited before → after', async () => {
    const fake = world(REQUESTER)
    const { data } = await bodyOf(await api.add(zap([L.zap9421])))
    const res = await api.edit({ id: data.request.id, vendorName: 'ZAP MANUFACTURING INC.', apLineIds: [L.zap9440, L.zap9520], amountCents: 5 })
    expect(res.status).toBe(200)
    expect((await bodyOf(res)).data.request).toMatchObject({ amountCents: 129_000 + 365_000, fromAp: true })
    expect(fake.tables.cmr_vendor_request_invoices.map((i) => i.invoice_num).sort()).toEqual(['9440', '9520'])
    const call = fake.calls.filter((c) => c.table === 'cmr_compose_vendor_request').pop()!.payload as Row
    expect(call).toMatchObject({ p_request_id: data.request.id, p_owner: REQUESTER })
    const u = auditCalls().find((a) => a.action === 'cmr.request.update')!
    expect(u.metadata).toMatchObject({ recomposed: true, lineCount: 2, totalCents: 494_000 })
    expect(u.metadata?.before.invoices.map((i: { num: string }) => i.num)).toEqual(['9421'])
    expect(u.metadata?.after.invoices.map((i: { num: string }) => i.num)).toEqual(['9440', '9520'])
  })

  it('re-composing may switch vendor; unsent note and date are kept', async () => {
    const fake = world(REQUESTER)
    const { data } = await bodyOf(await api.add(zap([L.zap9421], { notes: 'Keep me', dueDate: '2026-09-30' })))
    expect((await api.edit({ id: data.request.id, ...traffix() })).status).toBe(200)
    expect(fake.tables.cmr_vendor_requests[0]).toMatchObject({ vendor: 'TRAFFIX DEVICES', amount_cents: 1_222_316, notes: 'Keep me', due_date: '2026-09-30' })
  })

  it('a Requester cannot re-compose someone else’s request (403); a placed one is 409', async () => {
    const fake = world(REQUESTER2)
    const { data } = await bodyOf(await api.add(zap([L.zap9421])))
    world(REQUESTER)
    Object.assign(server, { serviceClient: fake.client })
    const res = await api.edit({ id: data.request.id, vendorName: 'ZAP MANUFACTURING INC.', apLineIds: [L.zap9440] })
    expect(res.status).toBe(403)
    expect(fake.tables.cmr_vendor_requests[0].amount_cents).toBe(171_000)

    world(CONTROLLER)
    Object.assign(server, { serviceClient: fake.client })
    await api.place({ id: data.request.id, target: 'priority', weekStart: '2026-09-20' })
    const placed = await api.edit({ id: data.request.id, vendorName: 'ZAP MANUFACTURING INC.', apLineIds: [L.zap9440] })
    expect(placed.status).toBe(409)
  })

  it('a note-only edit leaves the amount and snapshot alone; a hand edit of an A/P request is 409 AP_COMPOSED even for the Controller', async () => {
    const fake = world(REQUESTER)
    const { data } = await bodyOf(await api.add(traffix()))
    const snap = JSON.stringify(fake.tables.cmr_vendor_request_invoices)
    expect((await api.edit({ id: data.request.id, notes: 'Urgent' })).status).toBe(200)
    expect(fake.tables.cmr_vendor_requests[0]).toMatchObject({ notes: 'Urgent', amount_cents: 1_222_316 })
    expect(JSON.stringify(fake.tables.cmr_vendor_request_invoices)).toBe(snap)

    world(CONTROLLER)
    Object.assign(server, { serviceClient: fake.client })
    const res = await api.edit({ id: data.request.id, amountCents: 1 })
    expect(res.status).toBe(409)
    expect((await bodyOf(res)).code).toBe('AP_COMPOSED')
    expect(fake.tables.cmr_vendor_requests[0].amount_cents).toBe(1_222_316)
  })
})

// ── the Controller is never forced through the picker ──────────────────────

describe('Controller paths that do not need A/P', () => {
  it('a Controller can still hand-enter a request for an account with no A/P', async () => {
    const fake = world(CONTROLLER)
    const res = await api.add({ accountId: ACC.INC, vendor: 'Blue Diamond', amountCents: 1_840_000 })
    expect(res.status).toBe(201)
    expect((await bodyOf(res)).data.request).toMatchObject({ fromAp: false, invoices: [], amountCents: 1_840_000 })
    expect(fake.tables.cmr_vendor_request_invoices).toHaveLength(0)
  })

  it('…and add a pending item straight on the ledger — no request, no A/P involved', async () => {
    const fake = world(CONTROLLER)
    const res = await api.addPending({ date: '2026-09-22', period: 'am', accountId: ACC.INC, payee: 'Blue Diamond', amountCents: 1_840_000 })
    expect(res.status).toBe(201)
    expect(fake.tables.cmr_pending_items[0]).toMatchObject({ payee: 'Blue Diamond', amount_cents: 1_840_000, source: 'manual' })
    expect(fake.calls.some((c) => c.table === 'cmr_ap_lines' || c.table === 'cmr_compose_vendor_request')).toBe(false)
  })

  it('a Controller may also compose from A/P (same rules)', async () => {
    const fake = world(CONTROLLER)
    expect((await api.add(zap([L.zap9421]))).status).toBe(201)
    const call = fake.calls.find((c) => c.table === 'cmr_compose_vendor_request')!.payload as Row
    expect(call.p_owner).toBeNull()
  })
})
