import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import * as XLSX from 'xlsx'
import { fakeSupabase, fakeRouteClient } from '@/lib/cmr/__testing__/fakeSupabase'

/**
 * AP Phase 1 — importing a QuickBooks A/P Aging Detail report and reading the AP page.
 *
 *   • READ (/api/cmr/ap): Controller, Requester and Viewer all 200 (canImport only for the
 *     Controller); a platform admin / anyone without a cmr_access grant 403; no session 401
 *   • IMPORT (preview + commit): Controller only — Requester / Viewer / no-grant 403 with
 *     nothing written and nothing audited; no session 401
 *   • the real STS AP 92226.xlsx imported as STS gives the AP page 33 payable vendors and a
 *     payable total of $107,577.75 that reconciles to the $176,038.56 report TOTAL (runs where
 *     the file is present — see REAL_PATH)
 *   • a second import REPLACES the first: exactly one current import with its own lines remains
 *   • a reconciliation mismatch is detected in the preview and flagged on the AP page
 *   • only an active, existing account may be imported into; a non-A/P file is refused
 *   • every commit is audited as cmr.ap.import, with what it replaced
 *
 * cmr_ap_replace_import is mirrored below (the same steps the SQL takes, in the same order);
 * the SQL itself was run against a real PostgreSQL 16 — see lib/cmr/ap-migration.test.ts.
 */

const server = vi.hoisted(() => ({ routeClient: null as unknown, serviceClient: null as unknown }))
vi.mock('@/lib/supabase/server', () => ({
  createRouteClient: () => server.routeClient,
  createServerClient: () => server.routeClient,
  createServiceClient: () => server.serviceClient,
}))
const audit = vi.hoisted(() => ({ logAudit: vi.fn(async (_p: unknown) => {}) }))
vi.mock('@/lib/audit/log', () => ({ logAudit: audit.logAudit, getClientIp: () => null }))

import * as apRoute from './route'
import * as previewRoute from './import/preview/route'
import * as commitRoute from './import/commit/route'
import { apTotals, apVendorGroups, apReconciliationLines, type CmrApView } from '@/lib/cmr/ap'

const ADMIN = '00000000-0000-4000-8000-00000000a0a0'
const CONTROLLER = '00000000-0000-4000-8000-00000000c0c0'
const REQUESTER = '00000000-0000-4000-8000-00000000e0e0'
const VIEWER = '00000000-0000-4000-8000-00000000f0f0'
const STRANGER = '00000000-0000-4000-8000-00000000d0d0'

const ACC = {
  TCS: '10000000-0000-4000-8000-000000000001',
  STS: '10000000-0000-4000-8000-000000000002',
  OLD: '10000000-0000-4000-8000-000000000003',
  MISSING: '10000000-0000-4000-8000-0000000000ff',
}

type Row = Record<string, unknown>

/**
 * The real export lives in the repo root on Mason's Mac and is gitignored (*.xlsx — raw
 * QuickBooks source files are never committed), so the tests that need it run wherever it is
 * present and are skipped elsewhere. Everything else uses SAMPLE, a synthetic report built below.
 */
const REAL_PATH = path.join(process.cwd(), 'STS AP 92226.xlsx')
const HAS_REAL = existsSync(REAL_PATH)
const STS_FILE: Uint8Array = HAS_REAL ? readFileSync(REAL_PATH) : new Uint8Array()

const HEADER = ['', '', '', 'Type', '', 'Date', '', 'Num', '', 'Name', '', 'Due Date', '', 'Aging', '', 'Open Balance']
const line = (type: string, num: string, name: string, bal: number, aging: number | '' = '') =>
  ['', '', '', type, '', 46265, '', num, '', name, '', 46295, '', aging, '', bal]
const label = (col0: string, bal: number | '' = '') => [col0, '', '', '', '', '', '', '', '', '', '', '', '', '', '', bal]
function xlsx(rows: unknown[][]): Uint8Array {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Sheet1')
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer)
}

/**
 * A small report in the same layout: 3 Bills, 1 Credit, 1 General Journal, 1 Bill Pmt -Check.
 *   lines 1,000.00 + 250.50 − 300.00 + 99.99 + 5,000.00 − 35.00 = TOTAL 6,015.49 (reconciles)
 *   payable (Bill + Credit) = 1,050.49 · vendors: ACME, BOLT CO, AP ADJUSTMENT ACCOUNT (2 payable)
 */
const SAMPLE = xlsx([
  HEADER,
  label('Current'),
  line('Bill', 'A1', 'ACME', 1000),
  line('Bill', 'A2', 'ACME', 250.5),
  line('Credit', 'C1', 'ACME', -300),
  label('Total Current', 950.5),
  label('1 - 30'),
  line('Bill', 'B1', 'BOLT CO', 99.99, 12),
  line('General Journal', 'J1', 'AP ADJUSTMENT ACCOUNT', 5000),
  line('Bill Pmt -Check', '101', 'BOLT CO', -35),
  label('Total 1 - 30', 5064.99),
  label('TOTAL', 6015.49),
])

let seq = 0
const nextId = (prefix: string) => `${prefix}000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`

/**
 * The database function, step for step: lock + check the account, refuse a non-array, delete
 * the account's current import AND its lines (ON DELETE CASCADE), insert the new current import
 * and its lines with payable derived from doc_type, then sum the payable total.
 */
function replaceRpc(args: Record<string, unknown>, t: Record<string, Row[]>) {
  const acc = (t.cmr_accounts ?? []).find((a) => a.id === args.p_account_id)
  if (!acc) return { message: 'NOT_FOUND' }
  if (!acc.active) return { message: 'INACTIVE' }
  if (!Array.isArray(args.p_lines)) return { message: 'BAD_LINES' }
  const old = (t.cmr_ap_imports ?? []).filter((i) => i.account_id === args.p_account_id && i.is_current).map((i) => i.id)
  t.cmr_ap_imports = (t.cmr_ap_imports ?? []).filter((i) => !old.includes(i.id))
  t.cmr_ap_lines = (t.cmr_ap_lines ?? []).filter((l) => !old.includes(l.import_id))
  const importId = nextId('40')
  const lines: Row[] = (args.p_lines as Row[]).map((l) => ({
    id: nextId('50'),
    import_id: importId,
    account_id: args.p_account_id,
    ...l,
    payable: l.doc_type === 'Bill' || l.doc_type === 'Credit',
    created_at: '2026-09-22T18:00:00Z',
  }))
  t.cmr_ap_lines.push(...lines)
  t.cmr_ap_imports.push({
    id: importId,
    account_id: args.p_account_id,
    source_filename: args.p_source_filename,
    report_total_cents: args.p_report_total_cents,
    payable_total_cents: lines.filter((l) => l.payable).reduce((s, l) => s + (l.open_balance_cents as number), 0),
    line_count: lines.length,
    imported_by: args.p_actor,
    imported_at: `2026-09-22T18:${String(seq % 60).padStart(2, '0')}:00Z`,
    is_current: true,
  })
  return { data: importId }
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
        { id: ACC.TCS, name: 'TCS', account_type: null, active: true, sort_order: 0 },
        { id: ACC.STS, name: 'STS', account_type: null, active: true, sort_order: 1 },
        { id: ACC.OLD, name: 'Old Payroll', account_type: null, active: false, sort_order: 2 },
      ],
      cmr_ap_imports: [],
      cmr_ap_lines: [],
      ...over,
    },
    { rpc: { cmr_ap_replace_import: replaceRpc } },
  )
  server.routeClient = fakeRouteClient(userId)
  server.serviceClient = fake.client
  return fake
}

const base = 'https://cmr.safetynetworkteams.com/api/cmr/ap'
function form(accountId: string, bytes: Uint8Array | null, name = 'STS AP 92226.xlsx', extra: Record<string, string> = {}) {
  const f = new FormData()
  f.append('accountId', accountId)
  if (bytes) f.append('file', new File([bytes as Uint8Array<ArrayBuffer>], name, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
  for (const [k, v] of Object.entries(extra)) f.append(k, v)
  return f
}
const preview = (f: FormData) => previewRoute.POST(new Request(`${base}/import/preview`, { method: 'POST', body: f }))
const commit = (f: FormData) => commitRoute.POST(new Request(`${base}/import/commit`, { method: 'POST', body: f }))
const read = () => apRoute.GET()

const writes = (fake: ReturnType<typeof world>) => fake.calls.filter((c) => c.op !== 'select')
type AuditArg = { action: string; resourceId?: string; resourceLabel?: string; resourceType?: string; userRole?: string; metadata?: Record<string, unknown> }
const auditCalls = () => audit.logAudit.mock.calls.map((c) => c[0] as AuditArg)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const bodyOf = async (r: Response) => (await r.json()) as { success: boolean; data?: any; error?: string; code?: string }
const viewOf = async (r: Response): Promise<CmrApView> => (await bodyOf(r)).data as CmrApView

/** As a given user, switching identity on the same store. */
const as = (fake: ReturnType<typeof world>, userId: string | null) => { server.routeClient = fakeRouteClient(userId); return fake }

beforeEach(() => { audit.logAudit.mockClear(); seq = 0 })
afterEach(() => { vi.restoreAllMocks() })

// ── route shape ─────────────────────────────────────────────────────────────

describe('AP routes', () => {
  it('export only HTTP handlers + dynamic (BUG-019)', () => {
    const allowed = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'dynamic'])
    for (const mod of [apRoute, previewRoute, commitRoute]) {
      for (const k of Object.keys(mod)) expect(allowed.has(k), k).toBe(true)
      expect((mod as { dynamic?: string }).dynamic).toBe('force-dynamic')
    }
  })
})

// ── access ──────────────────────────────────────────────────────────────────

describe('AP access', () => {
  for (const [label, uid, can] of [['controller', CONTROLLER, true], ['requester', REQUESTER, false], ['viewer', VIEWER, false]] as const) {
    it(`${label} reads the AP page data (200, canImport ${can})`, async () => {
      world(uid)
      const r = await read()
      expect(r.status).toBe(200)
      const view = await viewOf(r)
      expect(view.canImport).toBe(can)
      expect(view.accounts.map((a) => a.name)).toEqual(['TCS', 'STS', 'Old Payroll'])
    })
  }

  for (const [label, uid] of [['platform admin with no grant', ADMIN], ['stranger', STRANGER]] as const) {
    it(`${label} is refused everywhere (403) — no admin inheritance`, async () => {
      const fake = world(uid)
      expect((await read()).status).toBe(403)
      expect((await preview(form(ACC.STS, SAMPLE))).status).toBe(403)
      expect((await commit(form(ACC.STS, SAMPLE))).status).toBe(403)
      expect(writes(fake)).toHaveLength(0)
      expect(fake.calls.some((c) => c.table.startsWith('cmr_ap'))).toBe(false)
      expect(audit.logAudit).not.toHaveBeenCalled()
    })
  }

  for (const [label, uid] of [['requester', REQUESTER], ['viewer', VIEWER]] as const) {
    it(`${label} gets 403 on preview and commit, and nothing is written or audited`, async () => {
      const fake = world(uid)
      const p = await preview(form(ACC.STS, SAMPLE))
      expect(p.status).toBe(403)
      expect((await bodyOf(p)).code).toBe('FORBIDDEN')
      expect((await commit(form(ACC.STS, SAMPLE))).status).toBe(403)
      expect(writes(fake)).toHaveLength(0)
      expect(fake.tables.cmr_ap_imports).toHaveLength(0)
      expect(audit.logAudit).not.toHaveBeenCalled()
    })
  }

  it('no session → 401 on read, preview and commit', async () => {
    const fake = world(null)
    expect((await read()).status).toBe(401)
    expect((await preview(form(ACC.STS, SAMPLE))).status).toBe(401)
    expect((await commit(form(ACC.STS, SAMPLE))).status).toBe(401)
    expect(writes(fake)).toHaveLength(0)
  })

  it('a deactivated user with a grant is refused', async () => {
    world(VIEWER, {
      user_profiles: [{ id: VIEWER, role: 'sales', display_name: 'Vi', is_active: false }],
      cmr_access: [{ user_id: VIEWER, role: 'viewer' }],
    })
    expect((await read()).status).toBe(403)
  })
})

// ── preview ─────────────────────────────────────────────────────────────────

describe('AP import — preview', () => {
  it('parses the file, reports its figures, and writes NOTHING', async () => {
    const fake = world(CONTROLLER)
    const r = await preview(form(ACC.STS, SAMPLE, 'STS AP 92226.xlsx'))
    expect(r.status).toBe(200)
    const { data } = await bodyOf(r)
    expect(data.account).toEqual({ id: ACC.STS, name: 'STS' })
    expect(data.fileName).toBe('STS AP 92226.xlsx')
    expect(data.summary).toMatchObject({
      lineCount: 6, payableLineCount: 4, vendorCount: 3, payableVendorCount: 2,
      docTypeCounts: { Bill: 3, Credit: 1, 'General Journal': 1, 'Bill Pmt -Check': 1 },
      reportTotalCents: 6015_49, importedTotalCents: 6015_49, payableTotalCents: 1050_49, differenceCents: 0, reconciled: true,
      sampleVendors: [{ vendorName: 'ACME', owedCents: 950_50, lineCount: 3 }, { vendorName: 'BOLT CO', owedCents: 99_99, lineCount: 1 }],
    })
    expect(data.replaces).toBeNull()
    expect(writes(fake)).toHaveLength(0)
    expect(audit.logAudit).not.toHaveBeenCalled()
  })

  it.runIf(HAS_REAL)('parses the real STS AP 92226.xlsx and writes NOTHING', async () => {
    const fake = world(CONTROLLER)
    const r = await preview(form(ACC.STS, STS_FILE))
    expect(r.status).toBe(200)
    const { data } = await bodyOf(r)
    expect(data.account).toEqual({ id: ACC.STS, name: 'STS' })
    expect(data.fileName).toBe('STS AP 92226.xlsx')
    expect(data.summary).toMatchObject({
      lineCount: 147,
      payableLineCount: 141,
      vendorCount: 35,
      payableVendorCount: 33,
      docTypeCounts: { Bill: 116, Credit: 25, 'General Journal': 5, 'Bill Pmt -Check': 1 },
      reportTotalCents: 176_038_56,
      importedTotalCents: 176_038_56,
      payableTotalCents: 107_577_75,
      differenceCents: 0,
      reconciled: true,
    })
    expect(data.summary.sampleVendors).toHaveLength(8)
    expect(data.summary.sampleVendors[0].owedCents).toBeGreaterThanOrEqual(data.summary.sampleVendors[1].owedCents)
    expect(data.replaces).toBeNull()
    expect(writes(fake)).toHaveLength(0)
    expect(audit.logAudit).not.toHaveBeenCalled()
  })

  it('flags a file whose lines do not add up to its TOTAL', async () => {
    world(CONTROLLER)
    const bytes = xlsx([HEADER, label('Current'), line('Bill', 'A1', 'ACME', 100), line('Credit', 'C1', 'ACME', -25), label('TOTAL', 80)])
    const { data } = await bodyOf(await preview(form(ACC.TCS, bytes, 'TCS AP.xlsx')))
    expect(data.summary).toMatchObject({ reconciled: false, importedTotalCents: 75_00, reportTotalCents: 80_00, differenceCents: -5_00, payableTotalCents: 75_00 })
  })

  it('refuses an unknown account (404) and an inactive one (409)', async () => {
    world(CONTROLLER)
    const missing = await preview(form(ACC.MISSING, SAMPLE))
    expect(missing.status).toBe(404)
    const old = await preview(form(ACC.OLD, SAMPLE))
    expect(old.status).toBe(409)
    expect((await bodyOf(old)).code).toBe('ACCOUNT_INACTIVE')
  })

  it('refuses a missing account id, a missing file, and a file that is not .xlsx', async () => {
    world(CONTROLLER)
    expect((await preview(form('not-a-uuid', SAMPLE))).status).toBe(400)
    expect((await preview(form(ACC.STS, null))).status).toBe(400)
    const csv = await preview(form(ACC.STS, new TextEncoder().encode('Type,Date\nBill,1/1/26'), 'ap.csv'))
    expect((await bodyOf(csv)).code).toBe('NOT_XLSX')
    // renamed, but not actually a workbook
    const fake = await preview(form(ACC.STS, new TextEncoder().encode('%PDF-1.7'), 'ap.xlsx'))
    expect((await bodyOf(fake)).code).toBe('NOT_XLSX')
  })

  it('refuses a workbook that is not an A/P Aging Detail report', async () => {
    world(CONTROLLER)
    const r = await preview(form(ACC.STS, xlsx([['Customer', 'Invoice', 'Open Balance'], ['Acme', '1', 10]]), 'AR aging.xlsx'))
    expect(r.status).toBe(400)
    expect((await bodyOf(r)).code).toBe('NOT_AP_AGING')
  })
})

// ── commit + the AP page ────────────────────────────────────────────────────

describe('AP import — commit', () => {
  it.runIf(HAS_REAL)('imports the real STS AP 92226.xlsx as STS: the AP page shows its vendors and $107,577.75 reconciling to $176,038.56', async () => {
    const fake = world(CONTROLLER)
    const r = await commit(form(ACC.STS, STS_FILE, 'STS AP 92226.xlsx', { expectedLineCount: '147', expectedReportTotalCents: '17603856' }))
    expect(r.status).toBe(201)
    const { data } = await bodyOf(r)
    expect(data.replaced).toBeNull()
    expect(fake.tables.cmr_ap_imports).toHaveLength(1)
    expect(fake.tables.cmr_ap_lines).toHaveLength(147)
    // the rpc got the parsed lines and nothing that decides payability
    const call = fake.calls.find((c) => c.op === 'rpc')
    const sent = (call?.payload as { p_lines: Row[] }).p_lines
    expect(sent).toHaveLength(147)
    expect(sent.every((l) => !('payable' in l))).toBe(true)

    // … every role reads the same page
    for (const uid of [CONTROLLER, REQUESTER, VIEWER]) {
      as(fake, uid)
      const view = await viewOf(await read())
      expect(view.imports).toHaveLength(1)
      expect(view.imports[0]).toMatchObject({
        accountId: ACC.STS,
        sourceFilename: 'STS AP 92226.xlsx',
        reportTotalCents: 176_038_56,
        importedTotalCents: 176_038_56,
        payableTotalCents: 107_577_75,
        lineCount: 147,
        payableLineCount: 141,
        vendorCount: 33,
        importedByName: 'Cora Controller',
        reconciled: true,
      })
      const totals = apTotals(view, ACC.STS)
      expect(totals).toMatchObject({ payableCents: 107_577_75, reportCents: 176_038_56, importedCents: 176_038_56, billCount: 116, creditCount: 25, otherCount: 6, vendorCount: 33, reconciled: true })
      const vendors = apVendorGroups(view.lines, view.accounts, ACC.STS)
      expect(vendors).toHaveLength(33)
      expect(vendors.reduce((s, v) => s + v.owedCents, 0)).toBe(107_577_75)
      expect(vendors.every((v) => v.accountName === 'STS')).toBe(true)
      // largest first; credits sit inside their vendor as negative lines
      expect(vendors[0].owedCents).toBeGreaterThanOrEqual(vendors[1].owedCents)
      const avery = vendors.find((v) => v.vendorName === 'AVERY DENNISON')
      expect(avery?.creditCount).toBeGreaterThan(0)
      expect(avery?.lines.some((l) => l.openBalanceCents < 0)).toBe(true)
      // the journal / bill-payment lines are shown for reconciliation, never as a vendor
      expect(vendors.some((v) => v.vendorName === 'AP ADJUSTMENT ACCOUNT')).toBe(false)
      expect(apReconciliationLines(view.lines, ACC.STS)).toHaveLength(6)
      // another account has nothing
      expect(apVendorGroups(view.lines, view.accounts, ACC.TCS)).toHaveLength(0)
    }
  })

  it('a second import REPLACES the first — one current import, its own lines only', async () => {
    const fake = world(CONTROLLER)
    expect((await commit(form(ACC.STS, SAMPLE))).status).toBe(201)
    const firstId = fake.tables.cmr_ap_imports[0].id
    // an import for another account must survive STS being replaced
    const tcsBytes = xlsx([HEADER, label('Current'), line('Bill', 'T1', 'TIRE CO', 50), label('TOTAL', 50)])
    expect((await commit(form(ACC.TCS, tcsBytes, 'TCS AP.xlsx'))).status).toBe(201)

    const smaller = xlsx([HEADER, label('Current'), line('Bill', 'N1', 'NEW VENDOR', 10), line('Credit', 'NC', 'NEW VENDOR', -4), label('TOTAL', 6)])
    const r = await commit(form(ACC.STS, smaller, 'STS AP 92326.xlsx'))
    expect(r.status).toBe(201)
    const { data } = await bodyOf(r)
    expect(data.replaced).toMatchObject({ importId: firstId, sourceFilename: 'STS AP 92226.xlsx', lineCount: 6, payableTotalCents: 1050_49, importedByName: 'Cora Controller' })

    const sts = fake.tables.cmr_ap_imports.filter((i) => i.account_id === ACC.STS)
    expect(sts).toHaveLength(1)
    expect(sts[0].is_current).toBe(true)
    expect(sts[0].id).not.toBe(firstId)
    expect(fake.tables.cmr_ap_lines.filter((l) => l.account_id === ACC.STS)).toHaveLength(2)
    expect(fake.tables.cmr_ap_lines.some((l) => l.import_id === firstId)).toBe(false)
    expect(fake.tables.cmr_ap_lines.filter((l) => l.account_id === ACC.TCS)).toHaveLength(1)

    const view = await viewOf(await read())
    expect(view.imports.map((i) => i.accountId)).toEqual([ACC.TCS, ACC.STS]) // account order
    expect(apTotals(view, ACC.STS)).toMatchObject({ payableCents: 6_00, reconciled: true })
    expect(apVendorGroups(view.lines, view.accounts, null).map((v) => v.vendorName)).toEqual(['TIRE CO', 'NEW VENDOR'])
  })

  it('re-importing the same file twice leaves one snapshot, not stacked lines', async () => {
    const fake = world(CONTROLLER)
    await commit(form(ACC.STS, SAMPLE))
    await commit(form(ACC.STS, SAMPLE))
    expect(fake.tables.cmr_ap_imports).toHaveLength(1)
    expect(fake.tables.cmr_ap_lines).toHaveLength(6)
    const view = await viewOf(await read())
    expect(apTotals(view, null)).toMatchObject({ payableCents: 1050_49, reportCents: 6015_49, importedCents: 6015_49, reconciled: true })
    expect(apVendorGroups(view.lines, view.accounts, ACC.STS).map((v) => [v.vendorName, v.owedCents])).toEqual([['ACME', 950_50], ['BOLT CO', 99_99]])
    expect(apReconciliationLines(view.lines, ACC.STS).map((l) => l.docType)).toEqual(['General Journal', 'Bill Pmt -Check'])
  })

  it('an unreconciled import is stored and flagged on the AP page', async () => {
    const fake = world(CONTROLLER)
    const bytes = xlsx([HEADER, label('Current'), line('Bill', 'A1', 'ACME', 100), label('TOTAL', 90)])
    expect((await commit(form(ACC.TCS, bytes, 'TCS AP.xlsx'))).status).toBe(201)
    const view = await viewOf(await read())
    expect(view.imports[0]).toMatchObject({ reconciled: false, importedTotalCents: 100_00, reportTotalCents: 90_00 })
    expect(apTotals(view, null).reconciled).toBe(false)
    expect(auditCalls()[0].metadata).toMatchObject({ reconciled: false })
    expect(fake.tables.cmr_ap_lines).toHaveLength(1)
  })

  it('refuses an inactive or unknown account and writes nothing', async () => {
    const fake = world(CONTROLLER)
    const old = await commit(form(ACC.OLD, SAMPLE))
    expect(old.status).toBe(409)
    expect((await bodyOf(old)).code).toBe('ACCOUNT_INACTIVE')
    expect((await commit(form(ACC.MISSING, SAMPLE))).status).toBe(404)
    expect(writes(fake)).toHaveLength(0)
    expect(audit.logAudit).not.toHaveBeenCalled()
  })

  it('an account deactivated between the check and the write is refused by the database (409)', async () => {
    const fake = world(CONTROLLER)
    // the route's own check passes; the function (holding the account lock) sees it inactive
    fake.tables.cmr_accounts.find((a) => a.id === ACC.STS)!.active = true
    const realRpc = fake.client.rpc
    fake.client.rpc = async (name: string, args: Record<string, unknown> = {}) => {
      fake.tables.cmr_accounts.find((a) => a.id === ACC.STS)!.active = false
      return realRpc(name, args)
    }
    const r = await commit(form(ACC.STS, SAMPLE))
    expect(r.status).toBe(409)
    expect(fake.tables.cmr_ap_imports).toHaveLength(0)
    expect(audit.logAudit).not.toHaveBeenCalled()
  })

  it('refuses a file that differs from the one previewed (409 PREVIEW_MISMATCH)', async () => {
    const fake = world(CONTROLLER)
    const r = await commit(form(ACC.STS, SAMPLE, 'STS AP 92226.xlsx', { expectedLineCount: '5', expectedReportTotalCents: '601549' }))
    expect(r.status).toBe(409)
    expect((await bodyOf(r)).code).toBe('PREVIEW_MISMATCH')
    expect(writes(fake)).toHaveLength(0)
  })

  it('refuses a non-A/P workbook and writes nothing', async () => {
    const fake = world(CONTROLLER)
    const r = await commit(form(ACC.STS, xlsx([['Name', 'Amount'], ['X', 1]]), 'payroll.xlsx'))
    expect(r.status).toBe(400)
    expect((await bodyOf(r)).code).toBe('NOT_AP_AGING')
    expect(writes(fake)).toHaveLength(0)
  })

  it('audits each commit as cmr.ap.import, with the figures and what it replaced', async () => {
    world(CONTROLLER)
    await commit(form(ACC.STS, SAMPLE, 'STS AP 92226.xlsx', { expectedLineCount: '6', expectedReportTotalCents: '601549' }))
    await commit(form(ACC.STS, SAMPLE, 'STS AP 92326.xlsx'))
    const entries = auditCalls()
    expect(entries.map((e) => e.action)).toEqual(['cmr.ap.import', 'cmr.ap.import'])
    expect(entries[0]).toMatchObject({
      resourceType: 'cmr_ap_imports',
      resourceLabel: 'STS · STS AP 92226.xlsx',
      userRole: 'cmr:controller',
      metadata: {
        accountId: ACC.STS,
        accountName: 'STS',
        sourceFilename: 'STS AP 92226.xlsx',
        lineCount: 6,
        payableLineCount: 4,
        vendorCount: 3,
        payableVendorCount: 2,
        docTypeCounts: { Bill: 3, Credit: 1, 'General Journal': 1, 'Bill Pmt -Check': 1 },
        reportTotalCents: 6015_49,
        importedTotalCents: 6015_49,
        payableTotalCents: 1050_49,
        reconciled: true,
        replaced: null,
      },
    })
    expect(entries[1].metadata?.replaced).toMatchObject({ importId: entries[0].resourceId, lineCount: 6, payableTotalCents: 1050_49 })
    expect(entries[1].resourceLabel).toBe('STS · STS AP 92326.xlsx')
  })
})

// ── reading ─────────────────────────────────────────────────────────────────

describe('AP read', () => {
  it('reads every line even past the 1,000-row page size', async () => {
    const importId = '40000000-0000-4000-8000-00000000abcd'
    const many: Row[] = Array.from({ length: 2345 }, (_, i) => ({
      id: `50000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      import_id: importId, account_id: ACC.TCS, vendor_name: `V${i % 40}`, invoice_num: `I${i}`, doc_type: 'Bill',
      bill_date: '2026-09-01', due_date: null, aging_days: null, aging_bucket: 'Current', open_balance_cents: 1_00, payable: true,
    }))
    world(VIEWER, {
      cmr_ap_imports: [{ id: importId, account_id: ACC.TCS, source_filename: 'big.xlsx', report_total_cents: 2345_00, payable_total_cents: 2345_00, line_count: 2345, imported_by: CONTROLLER, imported_at: '2026-09-22T17:00:00Z', is_current: true }],
      cmr_ap_lines: many,
    })
    const view = await viewOf(await read())
    expect(view.lines).toHaveLength(2345)
    expect(view.imports[0]).toMatchObject({ reconciled: true, importedTotalCents: 2345_00 })
  })

  it('a stored line count that disagrees with the lines present is not reconciled', async () => {
    const importId = '40000000-0000-4000-8000-00000000abce'
    world(VIEWER, {
      cmr_ap_imports: [{ id: importId, account_id: ACC.TCS, source_filename: 'x.xlsx', report_total_cents: 0, payable_total_cents: 0, line_count: 3, imported_by: null, imported_at: '2026-09-22T17:00:00Z', is_current: true }],
      cmr_ap_lines: [],
    })
    const view = await viewOf(await read())
    expect(view.imports[0]).toMatchObject({ reconciled: false, importedByName: null })
  })

  it('fails closed (500) when a table cannot be read', async () => {
    const fake = fakeSupabase(
      {
        user_profiles: [{ id: VIEWER, role: 'sales', display_name: 'Vi', is_active: true }],
        cmr_access: [{ user_id: VIEWER, role: 'viewer' }],
        cmr_accounts: [],
      },
      { failTables: ['cmr_ap_imports'] },
    )
    server.routeClient = fakeRouteClient(VIEWER)
    server.serviceClient = fake.client
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect((await read()).status).toBe(500)
  })
})
