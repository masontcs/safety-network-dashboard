import { describe, it, expect, vi, beforeEach } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as XLSX from 'xlsx'
import { fakeSupabase, fakeRouteClient } from '@/lib/cmr/__testing__/fakeSupabase'

/**
 * /api/wh/ar/import — the gate and the replace behaviour.
 *
 *   • no session                      → 401, nothing read, nothing written
 *   • any role outside WH_ROLES       → 403, no rpc, no audit (an AR role included: WH is NOT
 *                                       part of SN AR, and this is the assertion that keeps it
 *                                       that way if someone widens the guard by accident)
 *   • admin / executive, preview      → 200 with the real numbers, and STILL no write
 *   • admin, commit                   → wh_ar_replace_import called with the parsed lines, and
 *                                       an audit entry naming what it replaced
 *   • a file that isn't this report   → 400, no write
 */

const server = vi.hoisted(() => ({ routeClient: null as unknown, serviceClient: null as unknown }))
vi.mock('@/lib/supabase/server', () => ({
  createRouteClient: () => server.routeClient,
  createServerClient: () => server.routeClient,
  createServiceClient: () => server.serviceClient,
}))
const audit = vi.hoisted(() => ({ logAudit: vi.fn(async (_p: unknown) => {}) }))
vi.mock('@/lib/audit/log', () => ({ logAudit: audit.logAudit, getClientIp: () => null }))

import { POST } from './route'

const ADMIN = '00000000-0000-4000-8000-0000000000a1'
const EXEC = '00000000-0000-4000-8000-0000000000e1'
const AR_MANAGER = '00000000-0000-4000-8000-0000000000r1'.replace('r', 'b')
const BRANCH = '00000000-0000-4000-8000-0000000000c1'
const ACCOUNTING = '00000000-0000-4000-8000-0000000000d1'

const FIXTURE = join(process.cwd(), 'Western Highways Traffic Truck Products_A_R Aging Detail Report.csv')
const AP_FIXTURE = join(process.cwd(), 'Western Highways Traffic Truck Products_A_P Aging Detail Report.xlsx')
const hasFixture = existsSync(FIXTURE)

function world(userId: string | null, current: Record<string, unknown>[] = []) {
  const fake = fakeSupabase(
    {
      user_profiles: [
        { id: ADMIN, role: 'admin', display_name: 'Ada Admin', is_active: true, billing_role: null, qb_export_enabled: false, qb_config_enabled: false },
        { id: EXEC, role: 'executive', display_name: 'Eve Exec', is_active: true, billing_role: null, qb_export_enabled: false, qb_config_enabled: false },
        { id: AR_MANAGER, role: 'ar_manager', display_name: 'Ari Manager', is_active: true, billing_role: null, qb_export_enabled: false, qb_config_enabled: false },
        { id: BRANCH, role: 'branch_manager', display_name: 'Bo Branch', is_active: true, billing_role: null, qb_export_enabled: false, qb_config_enabled: false },
        { id: ACCOUNTING, role: 'accounting', display_name: 'Acc Ounting', is_active: true, billing_role: null, qb_export_enabled: false, qb_config_enabled: false },
      ],
      user_branch_assignments: [{ user_id: BRANCH, branch_id: 'b1' }],
      wh_ar_imports: current,
      wh_ar_lines: [],
    },
    {
      rpc: {
        wh_ar_replace_import: (args, tables) => {
          const lines = args.p_lines as Record<string, unknown>[]
          tables.wh_ar_imports.length = 0
          tables.wh_ar_imports.push({
            id: 'new-import',
            report_as_of: args.p_report_as_of,
            source_filename: args.p_source_filename,
            report_total_cents: args.p_report_total_cents,
            line_count: lines.length,
            is_current: true,
          })
          tables.wh_ar_lines.length = 0
          for (const l of lines) tables.wh_ar_lines.push({ ...l, import_id: 'new-import' })
          return null
        },
      },
    },
  )
  server.routeClient = fakeRouteClient(userId)
  server.serviceClient = fake.client
  return fake
}

function upload(file: Buffer, name: string, fields: Record<string, string> = {}): Request {
  const form = new FormData()
  form.set('file', new File([new Uint8Array(file)], name))
  for (const [k, v] of Object.entries(fields)) form.set(k, v)
  return new Request('http://localhost/api/wh/ar/import', { method: 'POST', body: form })
}

function tinyArFile(): Buffer {
  const rows = [
    ['Western Highways Traffic Truck Products', '', '', '', '', '', '', '', ''],
    ['A/R Aging Detail Report', '', '', '', '', '', '', '', ''],
    ['As of Sep 23, 2026', '', '', '', '', '', '', '', ''],
    ['', '', '', '', '', '', '', '', ''],
    ['', 'Date', 'Transaction type', 'Num', 'Customer full name', 'Location full name', 'Due date', 'Amount', 'Open balance'],
    ['CURRENT', '', '', '', '', '', '', '', ''],
    ['', '09/01/2026', 'Invoice', 'INV-1', 'Safety Network Holdings CTM-0000016', 'Western Highways', '10/01/2026', '100.00', '100.00'],
    ['', '09/02/2026', 'Invoice', 'INV-2', 'Outside Co', 'Western Highways', '10/02/2026', '50.00', '25.00'],
    ['Total for CURRENT', '', '', '', '', '', '', '$150.00', '$125.00'],
    ['TOTAL', '', '', '', '', '', '', '$150.00', '$125.00'],
  ]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Sheet1')
  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as ArrayBuffer)
}

beforeEach(() => {
  audit.logAudit.mockClear()
})

describe('/api/wh/ar/import — access', () => {
  it('401s with no session', async () => {
    const fake = world(null)
    const res = await POST(upload(tinyArFile(), 'a.xlsx'))
    expect(res.status).toBe(401)
    expect(fake.calls.some((c) => c.op === 'rpc')).toBe(false)
    expect(audit.logAudit).not.toHaveBeenCalled()
  })

  it.each([
    ['ar_manager', AR_MANAGER],
    ['branch_manager', BRANCH],
    ['accounting', ACCOUNTING],
  ])('403s a %s — WH is not reachable from an SN role', async (_label, userId) => {
    const fake = world(userId)
    const res = await POST(upload(tinyArFile(), 'a.xlsx', { mode: 'commit' }))
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ success: false, code: 'FORBIDDEN' })
    expect(fake.calls.some((c) => c.op === 'rpc')).toBe(false)
    expect(fake.tables.wh_ar_lines).toHaveLength(0)
    expect(audit.logAudit).not.toHaveBeenCalled()
  })

  it.each([['admin', ADMIN], ['executive', EXEC]])('lets a %s in', async (_label, userId) => {
    world(userId)
    const res = await POST(upload(tinyArFile(), 'a.xlsx'))
    expect(res.status).toBe(200)
  })
})

describe('/api/wh/ar/import — preview', () => {
  it('returns the numbers and writes nothing', async () => {
    const fake = world(ADMIN)
    const res = await POST(upload(tinyArFile(), 'ar.xlsx'))
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.committed).toBeUndefined()
    expect(body.preview).toMatchObject({
      report: 'ar',
      filename: 'ar.xlsx',
      reportAsOf: '2026-09-23',
      reportAsOfSource: 'title',
      lineCount: 2,
      sumOpenCents: 12500,
      reportTotalCents: 12500,
      reconciled: true,
      openTotalCents: 12500,
      intercompanyCents: 10000,
      outsideCents: 2500,
      intercompanyLineCount: 1,
      locations: ['Western Highways'],
    })
    expect(body.preview.sample).toHaveLength(2)

    expect(fake.calls.some((c) => c.op === 'rpc')).toBe(false)
    expect(fake.tables.wh_ar_lines).toHaveLength(0)
    expect(audit.logAudit).not.toHaveBeenCalled()
  })
})

describe('/api/wh/ar/import — commit', () => {
  it('replaces the snapshot and audits what it replaced', async () => {
    const fake = world(ADMIN, [
      { id: 'old', report_as_of: '2026-09-16', source_filename: 'older.csv', line_count: 5, is_current: true },
    ])

    const res = await POST(upload(tinyArFile(), 'ar.xlsx', { mode: 'commit' }))
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.committed).toMatchObject({
      report: 'ar',
      lineCount: 2,
      reconciled: true,
      replaced: { reportAsOf: '2026-09-16', filename: 'older.csv', lineCount: 5 },
    })

    const rpc = fake.calls.find((c) => c.op === 'rpc')
    expect(rpc?.table).toBe('wh_ar_replace_import')
    const args = rpc!.payload as Record<string, unknown>
    expect(args.p_report_as_of).toBe('2026-09-23')
    expect(args.p_report_total_cents).toBe(12500)
    expect((args.p_lines as unknown[]).length).toBe(2)
    expect((args.p_lines as Record<string, unknown>[])[0]).toMatchObject({
      txn_date: '2026-09-01',
      txn_type: 'Invoice',
      customer_name: 'Safety Network Holdings CTM-0000016',
      customer_code: 'CTM-0000016',
      aging_bucket: 'Current',
      open_balance_cents: 10000,
    })
    // The route never sends the derived flags — the database computes them.
    expect((args.p_lines as Record<string, unknown>[])[0]).not.toHaveProperty('receivable')
    expect((args.p_lines as Record<string, unknown>[])[0]).not.toHaveProperty('is_intercompany')

    // Exactly one snapshot remains.
    expect(fake.tables.wh_ar_imports).toHaveLength(1)
    expect(fake.tables.wh_ar_lines).toHaveLength(2)

    expect(audit.logAudit).toHaveBeenCalledTimes(1)
    const entry = audit.logAudit.mock.calls[0][0] as Record<string, unknown>
    expect(entry).toMatchObject({ userId: ADMIN, action: 'wh.ar.import', resourceLabel: 'ar.xlsx' })
    expect(entry.metadata).toMatchObject({
      reportAsOf: '2026-09-23',
      lineCount: 2,
      reconciled: true,
      replaced: { reportAsOf: '2026-09-16', filename: 'older.csv', lineCount: 5 },
    })
  })

  it('honours an explicit report date from the preview screen', async () => {
    const fake = world(ADMIN)
    await POST(upload(tinyArFile(), 'ar.xlsx', { mode: 'commit', reportAsOf: '2026-09-22' }))
    const rpc = fake.calls.find((c) => c.op === 'rpc')
    expect((rpc!.payload as Record<string, unknown>).p_report_as_of).toBe('2026-09-22')
  })

  it('ignores a malformed report date rather than storing it', async () => {
    const fake = world(ADMIN)
    await POST(upload(tinyArFile(), 'ar.xlsx', { mode: 'commit', reportAsOf: 'yesterday' }))
    const rpc = fake.calls.find((c) => c.op === 'rpc')
    expect((rpc!.payload as Record<string, unknown>).p_report_as_of).toBe('2026-09-23')
  })
})

describe('/api/wh/ar/import — refusals', () => {
  it('400s a file that is not the A/R report, without writing', async () => {
    const fake = world(ADMIN)
    const res = await POST(upload(Buffer.from('not,a,report\n1,2,3\n'), 'junk.csv', { mode: 'commit' }))
    expect(res.status).toBe(400)
    expect(fake.calls.some((c) => c.op === 'rpc')).toBe(false)
    expect(audit.logAudit).not.toHaveBeenCalled()
  })

  it('400s the A/P report uploaded into the A/R slot', async () => {
    if (!existsSync(AP_FIXTURE)) return
    const fake = world(ADMIN)
    const res = await POST(upload(readFileSync(AP_FIXTURE), 'ap.xlsx', { mode: 'commit' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/A\/P/)
    expect(fake.calls.some((c) => c.op === 'rpc')).toBe(false)
  })

  it('400s when no file was chosen', async () => {
    world(ADMIN)
    const form = new FormData()
    form.set('mode', 'commit')
    const res = await POST(new Request('http://localhost/api/wh/ar/import', { method: 'POST', body: form }))
    expect(res.status).toBe(400)
  })
})

describe('/api/wh/ar/import — the real export', () => {
  it.skipIf(!hasFixture)('imports 213 lines totalling $678,768.26', async () => {
    const fake = world(ADMIN)
    const res = await POST(upload(readFileSync(FIXTURE), 'wh-ar.csv', { mode: 'commit' }))
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.committed).toMatchObject({
      lineCount: 213,
      sumOpenCents: 67876826,
      reportTotalCents: 67876826,
      reconciled: true,
      openTotalCents: 67376826,
      intercompanyLineCount: 182,
      reportAsOf: '2026-09-23',
    })
    expect(body.committed.typeCounts).toEqual({ Invoice: 211, 'Credit Memo': 1, Check: 1 })
    expect(fake.tables.wh_ar_lines).toHaveLength(213)
  })
})
