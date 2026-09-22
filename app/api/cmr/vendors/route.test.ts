import { describe, it, expect, vi, beforeEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import * as XLSX from 'xlsx'
import { fakeSupabase, fakeRouteClient } from '@/lib/cmr/__testing__/fakeSupabase'
import { replaceApImport } from '@/lib/cmr/__testing__/vendorResolver'
import { composeFromAp, type CmrComposableLine } from '@/lib/cmr/requests'
import { vendorRollup, vendorRollupTotals, type CmrVendorsView } from '@/lib/cmr/vendors'
import { parseCmrApWorkbook } from '@/lib/cmr/ap-import'

/**
 * AP Phase 3a — canonical vendors, end to end through the real routes:
 *
 *   • IMPORT resolution (POST /api/cmr/ap/import/commit → cmr_ap_replace_import, whose last step
 *     is cmr_resolve_ap_vendors): a new spelling registers a vendor + alias; an identical
 *     (normalized) spelling in ANOTHER account links to the SAME vendor; a differently spelled
 *     name (INC vs LLC) is a SEPARATE vendor; a re-import re-resolves without duplicating.
 *   • READ (GET /api/cmr/vendors): Controller, Requester, Viewer 200; a platform admin or
 *     anyone else without a cmr_access grant 403 (nothing read); no session 401. Read only —
 *     the route has no write handler at all.
 *   • the rollup built from it: Σ payable per vendor and per account.
 *   • the request picker (GET /api/cmr/ap/vendors) shows canonical names, stays account-scoped,
 *     and a request composed from it still gets the right amount (POST /api/cmr/requests).
 *   • with the real exports present (STS / TCS / HLD / INC AP files, gitignored), STS lists its
 *     33 payable vendors for $107,577.75 and the four accounts give 250 vendors, 12 of them in
 *     more than one account — the same figures the SQL produced on PostgreSQL 16.
 *
 * The database functions are mirrored in lib/cmr/__testing__/vendorResolver.ts.
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

import * as vendorsRoute from './route'
import * as commitRoute from '@/app/api/cmr/ap/import/commit/route'
import * as pickerRoute from '@/app/api/cmr/ap/vendors/route'
import * as requestsRoute from '@/app/api/cmr/requests/route'

const ADMIN = '00000000-0000-4000-8000-00000000a0a0'
const CONTROLLER = '00000000-0000-4000-8000-00000000c0c0'
const REQUESTER = '00000000-0000-4000-8000-00000000e0e0'
const VIEWER = '00000000-0000-4000-8000-00000000f0f0'
const STRANGER = '00000000-0000-4000-8000-00000000d0d0'

const ACC = {
  TCS: '70000000-0000-4000-8000-000000000001',
  STS: '70000000-0000-4000-8000-000000000002',
  HLD: '70000000-0000-4000-8000-000000000003',
  INC: '70000000-0000-4000-8000-000000000004',
}

type Row = Record<string, unknown>

// ── synthetic QuickBooks A/P Aging Detail reports ────────────────────────────

const HEADER = ['', '', '', 'Type', '', 'Date', '', 'Num', '', 'Name', '', 'Due Date', '', 'Aging', '', 'Open Balance']
const line = (type: string, num: string, name: string, bal: number) =>
  ['', '', '', type, '', 46265, '', num, '', name, '', 46295, '', 30, '', bal]
const label = (col0: string, bal: number | '' = '') => [col0, '', '', '', '', '', '', '', '', '', '', '', '', '', '', bal]
function report(lines: [string, string, string, number][]): Uint8Array {
  const total = Math.round(lines.reduce((s, l) => s + l[3], 0) * 100) / 100
  const rows = [HEADER, label('Current'), ...lines.map((l) => line(...l)), label('Total Current', total), label('TOTAL', total)]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Sheet1')
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer)
}

// STS and TCS share ZAP (spelled with / without the trailing dot) and TRAFFIX (identical).
// ACME INC (STS) and ACME LLC (Holdings) are different spellings → different vendors.
const STS_REPORT = report([
  ['Bill', '9421', 'ZAP MANUFACTURING INC.', 1710],
  ['Bill', '9440', 'ZAP MANUFACTURING INC.', 1290],
  ['Bill', '4092103', 'TRAFFIX DEVICES', 2930.8],
  ['Credit', 'CM', 'TRAFFIX DEVICES', -600.14],
  ['Bill', 'A1', 'ACME INC', 100],
  ['General Journal', 'EJ1', 'AP ADJUSTMENT ACCOUNT', 5000],
])
const TCS_REPORT = report([
  ['Bill', '9999', 'ZAP MANUFACTURING INC', 500],
  ['Bill', 'T1', 'TRAFFIX DEVICES', 99.99],
  ['Bill', 'T2', 'Traffix  Devices', 0.01],
])
const HLD_REPORT = report([
  ['Bill', 'L1', 'ACME LLC', 250],
  ['Bill Pmt -Check', '101', 'ACME LLC', -35],
])

function world(userId: string | null) {
  const fake = fakeSupabase(
    {
      user_profiles: [
        { id: ADMIN, role: 'admin', display_name: 'Ada Admin', is_active: true },
        { id: CONTROLLER, role: 'executive', display_name: 'Mason Doty', is_active: true },
        { id: REQUESTER, role: 'sales', display_name: 'Jordan Requester', is_active: true },
        { id: VIEWER, role: 'sales', display_name: 'Vi Viewer', is_active: true },
        { id: STRANGER, role: 'executive', display_name: 'Sam Stranger', is_active: true },
      ],
      cmr_access: [
        { user_id: CONTROLLER, role: 'controller' },
        { user_id: REQUESTER, role: 'requester' },
        { user_id: VIEWER, role: 'viewer' },
      ],
      cmr_accounts: [
        { id: ACC.TCS, name: 'TCS', account_type: null, active: true, sort_order: 0 },
        { id: ACC.STS, name: 'STS', account_type: null, active: true, sort_order: 1 },
        { id: ACC.HLD, name: 'Holdings', account_type: null, active: true, sort_order: 2 },
        { id: ACC.INC, name: 'INC', account_type: null, active: true, sort_order: 3 },
      ],
      cmr_ap_imports: [],
      cmr_ap_lines: [],
      cmr_vendors: [],
      cmr_vendor_aliases: [],
      cmr_vendor_requests: [],
      cmr_vendor_request_invoices: [],
    },
    {
      rpc: {
        cmr_ap_replace_import: replaceApImport,
        // Mirrors cmr_compose_vendor_request for a new request (AP Phase 2 — unchanged).
        cmr_compose_vendor_request: (a, t) => {
          const current = new Set(t.cmr_ap_imports.filter((i) => i.is_current && i.account_id === a.p_account_id).map((i) => i.id))
          const lines = t.cmr_ap_lines.filter((l) => current.has(l.import_id))
          const asC = (r: Row): CmrComposableLine => ({
            id: r.id as string, accountId: r.account_id as string, vendorName: r.vendor_name as string,
            docType: r.doc_type as string, payable: r.payable as boolean, openBalanceCents: Number(r.open_balance_cents),
          })
          const r = composeFromAp(lines.map(asC), { accountId: a.p_account_id as string, vendorName: a.p_vendor_name as string, apLineIds: (a.p_ap_line_ids as string[]) ?? [] })
          if (!r.ok) return { message: r.code }
          const id = randomUUID()
          t.cmr_vendor_requests.push({
            id, requested_by: a.p_actor, account_id: a.p_account_id, vendor: a.p_vendor, amount_cents: r.totalCents,
            due_date: a.p_due_date, notes: a.p_notes, status: 'queued', placed_kind: null, placed_ref_id: null,
            placed_at: null, placed_by: null, created_at: '2026-09-22T21:00:00Z',
          })
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
      },
    },
  )
  server.routeClient = fakeRouteClient(userId)
  server.serviceClient = fake.client
  return fake
}

const as = (fake: ReturnType<typeof world>, userId: string | null) => { server.routeClient = fakeRouteClient(userId); return fake }

const base = 'https://cmr.safetynetworkteams.com/api/cmr'
function importForm(accountId: string, bytes: Uint8Array, name: string) {
  const f = new FormData()
  f.append('accountId', accountId)
  f.append('file', new File([bytes as Uint8Array<ArrayBuffer>], name, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
  return f
}
const commit = (accountId: string, bytes: Uint8Array, name = 'AP.xlsx') =>
  commitRoute.POST(new Request(`${base}/ap/import/commit`, { method: 'POST', body: importForm(accountId, bytes, name) }))
const readVendors = () => vendorsRoute.GET()
const picker = (accountId: string) => pickerRoute.GET(new Request(`${base}/ap/vendors?accountId=${accountId}`))
const submit = (body: unknown) =>
  requestsRoute.POST(new Request(`${base}/requests`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }))
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const bodyOf = async (r: Response) => (await r.json()) as { success: boolean; data?: any; error?: string; code?: string }

/** STS, TCS and Holdings imported as the Controller. */
async function importAll(fake: ReturnType<typeof world>) {
  as(fake, CONTROLLER)
  expect((await commit(ACC.STS, STS_REPORT, 'STS AP.xlsx')).status).toBe(201)
  expect((await commit(ACC.TCS, TCS_REPORT, 'TCS AP.xlsx')).status).toBe(201)
  expect((await commit(ACC.HLD, HLD_REPORT, 'HLD AP.xlsx')).status).toBe(201)
}

beforeEach(() => { audit.logAudit.mockClear() })

describe('route shape', () => {
  it('GET /api/cmr/vendors exports only GET + dynamic (BUG-019) — no write handler at all', () => {
    expect(Object.keys(vendorsRoute).sort()).toEqual(['GET', 'dynamic'])
    expect(vendorsRoute.dynamic).toBe('force-dynamic')
  })
})

describe('GET /api/cmr/vendors — access', () => {
  for (const [label, uid] of [['controller', CONTROLLER], ['requester', REQUESTER], ['viewer', VIEWER]] as const) {
    it(`${label} reads the rollup (200)`, async () => {
      const fake = world(CONTROLLER)
      await importAll(fake)
      as(fake, uid)
      const r = await readVendors()
      expect(r.status).toBe(200)
      const view = (await bodyOf(r)).data as CmrVendorsView
      expect(view.accounts.map((a) => a.name)).toEqual(['TCS', 'STS', 'Holdings', 'INC'])
      expect(view.imports).toHaveLength(3)
    })
  }

  for (const [label, uid] of [['platform admin with no grant', ADMIN], ['stranger', STRANGER]] as const) {
    it(`${label} is refused (403) and nothing is read — no admin inheritance`, async () => {
      const fake = world(uid)
      const r = await readVendors()
      expect(r.status).toBe(403)
      expect((await bodyOf(r)).code).toBe('FORBIDDEN')
      expect(fake.calls.some((c) => c.table.startsWith('cmr_ap') || c.table.startsWith('cmr_vendor'))).toBe(false)
    })
  }

  it('no session → 401', async () => {
    const fake = world(null)
    expect((await readVendors()).status).toBe(401)
    expect(fake.calls.some((c) => c.table.startsWith('cmr_vendor'))).toBe(false)
  })
})

describe('import resolution — identical spellings unify, everything else stays separate', () => {
  it('a new name registers a vendor + alias; the identical name in another account links to the SAME vendor', async () => {
    const fake = world(CONTROLLER)
    as(fake, CONTROLLER)
    await commit(ACC.STS, STS_REPORT)
    const t = fake.tables
    // STS: ZAP, TRAFFIX, ACME INC, AP ADJUSTMENT ACCOUNT → 4 vendors, 4 aliases, every line linked
    expect(t.cmr_vendors.map((v) => v.canonical_name).sort()).toEqual(['ACME INC', 'AP ADJUSTMENT ACCOUNT', 'TRAFFIX DEVICES', 'ZAP MANUFACTURING INC.'])
    expect(t.cmr_vendor_aliases).toHaveLength(4)
    expect(t.cmr_ap_lines.every((l) => typeof l.vendor_id === 'string')).toBe(true)
    const zap = t.cmr_vendors.find((v) => v.canonical_name === 'ZAP MANUFACTURING INC.')!
    expect(zap).toMatchObject({ normalized_name: 'ZAP MANUFACTURING INC', created_by: CONTROLLER })

    await commit(ACC.TCS, TCS_REPORT)
    // "ZAP MANUFACTURING INC" (no dot), "TRAFFIX DEVICES" and "Traffix  Devices" are all known → nothing new
    expect(t.cmr_vendors).toHaveLength(4)
    const tcsZap = t.cmr_ap_lines.find((l) => l.account_id === ACC.TCS && l.invoice_num === '9999')!
    expect(tcsZap.vendor_id).toBe(zap.id)
    expect(tcsZap.vendor_name).toBe('ZAP MANUFACTURING INC') // the raw QuickBooks name is never overwritten
    const trx = new Set(t.cmr_ap_lines.filter((l) => /traffix/i.test(l.vendor_name as string)).map((l) => l.vendor_id))
    expect(trx.size).toBe(1)
  })

  it('a differently spelled name (ACME LLC vs ACME INC) creates a SEPARATE vendor', async () => {
    const fake = world(CONTROLLER)
    await importAll(fake)
    const t = fake.tables
    const acme = t.cmr_vendors.filter((v) => /^ACME/.test(v.canonical_name as string))
    expect(acme.map((v) => v.canonical_name).sort()).toEqual(['ACME INC', 'ACME LLC'])
    expect(new Set(t.cmr_ap_lines.filter((l) => /^ACME/.test(l.vendor_name as string)).map((l) => l.vendor_id)).size).toBe(2)
  })

  it('a re-import re-resolves to the same vendors without duplicating any', async () => {
    const fake = world(CONTROLLER)
    await importAll(fake)
    const t = fake.tables
    const before = t.cmr_vendors.map((v) => `${v.id}|${v.normalized_name}`).sort()
    const aliases = t.cmr_vendor_aliases.length
    const zapId = t.cmr_vendors.find((v) => v.normalized_name === 'ZAP MANUFACTURING INC')!.id
    await commit(ACC.STS, STS_REPORT)
    await commit(ACC.STS, STS_REPORT)
    expect(t.cmr_vendors.map((v) => `${v.id}|${v.normalized_name}`).sort()).toEqual(before)
    expect(t.cmr_vendor_aliases).toHaveLength(aliases)
    expect(t.cmr_ap_lines.filter((l) => l.account_id === ACC.STS && /^ZAP/.test(l.vendor_name as string)).every((l) => l.vendor_id === zapId)).toBe(true)
  })

  it('the import is audited with the vendors it registered', async () => {
    const fake = world(CONTROLLER)
    as(fake, CONTROLLER)
    await commit(ACC.STS, STS_REPORT)
    await commit(ACC.TCS, TCS_REPORT)
    const [sts, tcs] = audit.logAudit.mock.calls.map((c) => (c[0] as { metadata: { vendors: unknown } }).metadata.vendors)
    expect(sts).toEqual({
      distinctSpellings: 4, registeredCount: 4,
      registered: ['ACME INC', 'AP ADJUSTMENT ACCOUNT', 'TRAFFIX DEVICES', 'ZAP MANUFACTURING INC'],
    })
    expect(tcs).toEqual({ distinctSpellings: 2, registeredCount: 0, registered: [] })
  })
})

describe('the rollup from GET /api/cmr/vendors', () => {
  it('one row per canonical vendor; Σ payable per vendor and per account', async () => {
    const fake = world(CONTROLLER)
    await importAll(fake)
    as(fake, VIEWER)
    const view = (await bodyOf(await readVendors())).data as CmrVendorsView
    // payable lines only are sent
    expect(view.lines.every((l) => l.payable)).toBe(true)
    const rows = vendorRollup(view, null)
    const by = (name: string) => rows.find((r) => r.name === name)!

    const zap = by('ZAP MANUFACTURING INC.')
    expect(zap.owedCents).toBe(171_000 + 129_000 + 50_000)
    expect(zap.accounts.map((s) => [s.accountName, s.owedCents])).toEqual([['TCS', 50_000], ['STS', 300_000]])

    const trx = by('TRAFFIX DEVICES')
    expect(trx.accounts.map((s) => [s.accountName, s.owedCents, s.rawNames])).toEqual([
      ['TCS', 10_000, ['Traffix  Devices', 'TRAFFIX DEVICES']], // A–Z, locale order
      ['STS', 293_080 - 60_014, ['TRAFFIX DEVICES']],
    ])
    expect(by('ACME INC').owedCents).toBe(10_000)
    expect(by('ACME LLC').owedCents).toBe(25_000) // the Bill Pmt -Check is not payable
    expect(rows.some((r) => r.name === 'AP ADJUSTMENT ACCOUNT')).toBe(false)

    const t = vendorRollupTotals(rows)
    expect(t).toMatchObject({ vendorCount: 4, multiAccountCount: 2, accountCount: 3 })
    expect(t.owedCents).toBe(fake.tables.cmr_ap_lines.filter((l) => l.payable).reduce((s, l) => s + Number(l.open_balance_cents), 0))
  })

  it('with nothing imported the view is empty (the page says "import A/P first")', async () => {
    world(REQUESTER)
    const view = (await bodyOf(await readVendors())).data as CmrVendorsView
    expect(view).toMatchObject({ imports: [], lines: [], vendors: [] })
  })
})

describe('the request picker — canonical names, still one account, same amounts', () => {
  it('groups the chosen account’s payable lines by canonical vendor and shows the canonical name', async () => {
    const fake = world(CONTROLLER)
    await importAll(fake)
    as(fake, REQUESTER)
    const { data } = await bodyOf(await picker(ACC.TCS))
    expect(data.vendors.map((v: { canonicalName: string; rawNames: string[]; owedCents: number }) => [v.canonicalName, v.rawNames, v.owedCents])).toEqual([
      ['TRAFFIX DEVICES', ['Traffix  Devices', 'TRAFFIX DEVICES'], 10_000],
      ['ZAP MANUFACTURING INC.', ['ZAP MANUFACTURING INC'], 50_000], // STS registered it first, with the dot
    ])
    // account-scoped: no STS line leaks into the TCS picker
    expect(data.vendors.flatMap((v: { lines: { accountId: string }[] }) => v.lines).every((l: { accountId: string }) => l.accountId === ACC.TCS)).toBe(true)
  })

  it('a request built from a canonical group still composes the right amount on the raw QuickBooks name', async () => {
    const fake = world(CONTROLLER)
    await importAll(fake)
    as(fake, REQUESTER)
    const { data } = await bodyOf(await picker(ACC.STS))
    const trx = data.vendors.find((v: { canonicalName: string }) => v.canonicalName === 'TRAFFIX DEVICES')
    const r = await submit({ accountId: ACC.STS, vendorName: trx.vendorName, apLineIds: trx.lines.map((l: { id: string }) => l.id) })
    expect(r.status).toBe(201)
    expect(fake.tables.cmr_vendor_requests[0]).toMatchObject({ account_id: ACC.STS, vendor: 'TRAFFIX DEVICES', amount_cents: 293_080 - 60_014 })

    // one spelling per request: mixing TCS's two spellings is refused, each alone is fine
    const tcs = (await bodyOf(await picker(ACC.TCS))).data.vendors.find((v: { canonicalName: string }) => v.canonicalName === 'TRAFFIX DEVICES')
    const mixed = await submit({ accountId: ACC.TCS, vendorName: 'TRAFFIX DEVICES', apLineIds: tcs.lines.map((l: { id: string }) => l.id) })
    expect(mixed.status).toBe(409)
    const one = tcs.lines.filter((l: { vendorName: string }) => l.vendorName === 'Traffix  Devices')
    expect((await submit({ accountId: ACC.TCS, vendorName: 'Traffix  Devices', apLineIds: one.map((l: { id: string }) => l.id) })).status).toBe(201)
    expect(fake.tables.cmr_vendor_requests[1]).toMatchObject({ account_id: ACC.TCS, amount_cents: 1 })
  })
})

// ── the real exports (gitignored; run where they are present) ────────────────

const REAL: [keyof typeof ACC, string][] = [['STS', 'STS AP 92226.xlsx'], ['TCS', 'TCS AP 092226.xlsx'], ['HLD', 'HLD AP 092226.xlsx'], ['INC', 'INC AP 092226.xlsx']]
const HAS_REAL = REAL.every(([, f]) => existsSync(path.join(process.cwd(), f)))

describe.runIf(HAS_REAL)('the real A/P exports', () => {
  it('STS: every line linked; the rollup lists its 33 payable vendors for $107,577.75', async () => {
    const fake = world(CONTROLLER)
    as(fake, CONTROLLER)
    expect((await commit(ACC.STS, readFileSync(path.join(process.cwd(), 'STS AP 92226.xlsx')), 'STS AP 92226.xlsx')).status).toBe(201)
    expect(fake.tables.cmr_ap_lines).toHaveLength(147)
    expect(fake.tables.cmr_ap_lines.every((l) => l.vendor_id)).toBe(true)
    const view = (await bodyOf(await readVendors())).data as CmrVendorsView
    const rows = vendorRollup(view, null)
    expect(rows).toHaveLength(33)
    expect(vendorRollupTotals(rows).owedCents).toBe(10_757_775)
    // …and each vendor's total is what the AP page shows for it
    const parsed = parseCmrApWorkbook(readFileSync(path.join(process.cwd(), 'STS AP 92226.xlsx')))
    if (!parsed.ok) throw new Error(parsed.error)
    const byRaw = new Map<string, number>()
    for (const l of parsed.value.lines) if (l.payable) byRaw.set(l.vendorName, (byRaw.get(l.vendorName) ?? 0) + l.openBalanceCents)
    for (const r of rows) expect(r.owedCents).toBe(r.rawNames.reduce((s, n) => s + byRaw.get(n)!, 0))
  })

  it('all four accounts: 250 canonical vendors, 12 in more than one account; a re-import adds none', async () => {
    const fake = world(CONTROLLER)
    as(fake, CONTROLLER)
    for (const [acc, f] of REAL) expect((await commit(ACC[acc], readFileSync(path.join(process.cwd(), f)), f)).status).toBe(201)
    expect(fake.tables.cmr_vendors).toHaveLength(250)
    expect(fake.tables.cmr_ap_lines.every((l) => l.vendor_id)).toBe(true)
    const view = (await bodyOf(await readVendors())).data as CmrVendorsView
    const multi = vendorRollup(view, null).filter((r) => r.accounts.length > 1)
    // SAFETY NETWORK HOLDINGS, INC (TCS) / INC. (INC) unify on the trailing dot but are not
    // payable in both — the payable rollup shows 11 of the 12 cross-account vendors.
    expect(multi.length).toBeGreaterThanOrEqual(10)
    const sn = vendorRollup(view, null).find((r) => r.name.startsWith('SAFETY NETWORK TRAFFIC SIGNS,'))!
    expect(sn.rawNames).toEqual(['SAFETY NETWORK TRAFFIC SIGNS, INC', 'SAFETY NETWORK TRAFFIC SIGNS, INC.'])
    const keys = new Set(fake.tables.cmr_ap_lines.map((l) => l.vendor_id))
    const accountsPerVendor = [...keys].map((k) => new Set(fake.tables.cmr_ap_lines.filter((l) => l.vendor_id === k).map((l) => l.account_id)).size)
    expect(accountsPerVendor.filter((n) => n > 1)).toHaveLength(12)
    await commit(ACC.TCS, readFileSync(path.join(process.cwd(), 'TCS AP 092226.xlsx')), 'TCS AP 092226.xlsx')
    expect(fake.tables.cmr_vendors).toHaveLength(250)
  })
})
