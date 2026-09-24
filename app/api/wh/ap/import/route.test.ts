import { describe, it, expect, vi, beforeEach } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as XLSX from 'xlsx'
import { fakeSupabase, fakeRouteClient } from '@/lib/cmr/__testing__/fakeSupabase'

/**
 * /api/wh/ap/import — the gate, the replace behaviour, and the derived report date.
 *
 * The A/P export has no title block, so the date question is the interesting one here: the
 * route must surface where the date came from, must not store a snapshot with no date at all,
 * and must let the uploader override it.
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
const AR_MANAGER = '00000000-0000-4000-8000-0000000000b1'
const SALES = '00000000-0000-4000-8000-0000000000f1'

const FIXTURE = join(process.cwd(), 'Western Highways Traffic Truck Products_A_P Aging Detail Report.xlsx')
const AR_FIXTURE = join(process.cwd(), 'Western Highways Traffic Truck Products_A_R Aging Detail Report.csv')
const hasFixture = existsSync(FIXTURE)

function world(userId: string | null, current: Record<string, unknown>[] = []) {
  const fake = fakeSupabase(
    {
      user_profiles: [
        { id: ADMIN, role: 'admin', display_name: 'Ada Admin', is_active: true, billing_role: null, qb_export_enabled: false, qb_config_enabled: false },
        { id: EXEC, role: 'executive', display_name: 'Eve Exec', is_active: true, billing_role: null, qb_export_enabled: false, qb_config_enabled: false },
        { id: AR_MANAGER, role: 'ar_manager', display_name: 'Ari Manager', is_active: true, billing_role: null, qb_export_enabled: false, qb_config_enabled: false },
        { id: SALES, role: 'sales', display_name: 'Sam Sales', is_active: true, billing_role: null, qb_export_enabled: false, qb_config_enabled: false },
      ],
      user_branch_assignments: [{ user_id: SALES, branch_id: 'b1' }],
      wh_ap_imports: current,
      wh_ap_lines: [],
    },
    {
      rpc: {
        wh_ap_replace_import: (args, tables) => {
          const lines = args.p_lines as Record<string, unknown>[]
          tables.wh_ap_imports.length = 0
          tables.wh_ap_imports.push({
            id: 'new-import',
            report_as_of: args.p_report_as_of,
            source_filename: args.p_source_filename,
            report_total_cents: args.p_report_total_cents,
            line_count: lines.length,
            is_current: true,
          })
          tables.wh_ap_lines.length = 0
          for (const l of lines) tables.wh_ap_lines.push({ ...l, import_id: 'new-import' })
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
  return new Request('http://localhost/api/wh/ap/import', { method: 'POST', body: form })
}

/** A tiny A/P export: header at row 0, no title block, one past-due Bill and one Vendor Credit. */
function tinyApFile(opts: { pastDue?: boolean } = {}): Buffer {
  const pastDue = opts.pastDue ?? true
  const rows: unknown[][] = [
    ['', 'Date', 'Transaction type', 'Num', 'Vendor display name', 'Location full name', 'Due date', 'Past due', 'Amount', 'Open balance'],
    [pastDue ? '31 - 60 days past due' : 'CURRENT', '', '', '', '', '', '', '', '', ''],
    ['', '08/01/2026', 'Bill', 'B-1', 'LINDE', 'Western Highways', pastDue ? '08/31/2026' : '10/24/2026', pastDue ? 24 : -30, 300, 300],
    ['', '08/02/2026', 'Vendor Credit', 'VC-1', 'Safety Network Logistics', 'Western Highways', pastDue ? '08/31/2026' : '10/24/2026', pastDue ? 24 : -30, -100, -100],
    ['Total for ' + (pastDue ? '31 - 60 days past due' : 'CURRENT'), '', '', '', '', '', '', '', 200, 200],
    ['TOTAL', '', '', '', '', '', '', '', 200, 200],
  ]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Sheet1')
  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as ArrayBuffer)
}

beforeEach(() => {
  audit.logAudit.mockClear()
})

describe('/api/wh/ap/import — access', () => {
  it('401s with no session', async () => {
    const fake = world(null)
    const res = await POST(upload(tinyApFile(), 'a.xlsx'))
    expect(res.status).toBe(401)
    expect(fake.calls.some((c) => c.op === 'rpc')).toBe(false)
  })

  it.each([['ar_manager', AR_MANAGER], ['sales', SALES]])('403s a %s', async (_l, userId) => {
    const fake = world(userId)
    const res = await POST(upload(tinyApFile(), 'a.xlsx', { mode: 'commit' }))
    expect(res.status).toBe(403)
    expect(fake.calls.some((c) => c.op === 'rpc')).toBe(false)
    expect(fake.tables.wh_ap_lines).toHaveLength(0)
    expect(audit.logAudit).not.toHaveBeenCalled()
  })

  it.each([['admin', ADMIN], ['executive', EXEC]])('lets a %s in', async (_l, userId) => {
    world(userId)
    expect((await POST(upload(tinyApFile(), 'a.xlsx'))).status).toBe(200)
  })
})

describe('/api/wh/ap/import — the report date', () => {
  it('derives it from due date + past due days and says so', async () => {
    world(ADMIN)
    const body = await (await POST(upload(tinyApFile(), 'ap.xlsx'))).json()
    expect(body.preview).toMatchObject({
      reportAsOf: '2026-09-24',
      reportAsOfSource: 'derived',
      reportAsOfEvidence: 2,
    })
  })

  it('reports that it could not be derived when nothing is past due', async () => {
    world(ADMIN)
    const body = await (await POST(upload(tinyApFile({ pastDue: false }), 'ap.xlsx'))).json()
    expect(body.preview.reportAsOf).toBeNull()
    expect(body.preview.reportAsOfSource).toBe('none')
  })

  it('refuses to store an undated snapshot', async () => {
    const fake = world(ADMIN)
    const res = await POST(upload(tinyApFile({ pastDue: false }), 'ap.xlsx', { mode: 'commit' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/report date/i)
    expect(fake.calls.some((c) => c.op === 'rpc')).toBe(false)
    expect(audit.logAudit).not.toHaveBeenCalled()
  })

  it('accepts a date supplied by the uploader when none could be derived', async () => {
    const fake = world(ADMIN)
    const res = await POST(upload(tinyApFile({ pastDue: false }), 'ap.xlsx', { mode: 'commit', reportAsOf: '2026-09-24' }))
    expect(res.status).toBe(200)
    expect((fake.calls.find((c) => c.op === 'rpc')!.payload as Record<string, unknown>).p_report_as_of).toBe('2026-09-24')
  })

  it('lets the uploader override a derived date', async () => {
    const fake = world(ADMIN)
    await POST(upload(tinyApFile(), 'ap.xlsx', { mode: 'commit', reportAsOf: '2026-09-23' }))
    expect((fake.calls.find((c) => c.op === 'rpc')!.payload as Record<string, unknown>).p_report_as_of).toBe('2026-09-23')
  })
})

describe('/api/wh/ap/import — preview and commit', () => {
  it('previews the payable split without writing', async () => {
    const fake = world(ADMIN)
    const body = await (await POST(upload(tinyApFile(), 'ap.xlsx'))).json()
    expect(body.preview).toMatchObject({
      report: 'ap',
      lineCount: 2,
      sumOpenCents: 20000,
      reportTotalCents: 20000,
      reconciled: true,
      openTotalCents: 20000,
      openLineCount: 2,
      intercompanyCents: -10000,
      outsideCents: 30000,
      intercompanyLineCount: 1,
    })
    expect(fake.calls.some((c) => c.op === 'rpc')).toBe(false)
  })

  it('commits, sends past_due_days, and audits', async () => {
    const fake = world(ADMIN, [
      { id: 'old', report_as_of: '2026-09-17', source_filename: 'older.xlsx', line_count: 9, is_current: true },
    ])
    const res = await POST(upload(tinyApFile(), 'ap.xlsx', { mode: 'commit' }))
    expect(res.status).toBe(200)

    const args = fake.calls.find((c) => c.op === 'rpc')!.payload as Record<string, unknown>
    const lines = args.p_lines as Record<string, unknown>[]
    expect(lines[0]).toMatchObject({
      txn_type: 'Bill',
      vendor_name: 'LINDE',
      vendor_code: null,
      past_due_days: 24,
      aging_bucket: '31-60',
      open_balance_cents: 30000,
    })
    expect(lines[0]).not.toHaveProperty('payable')
    expect(lines[0]).not.toHaveProperty('is_intercompany')

    expect(fake.tables.wh_ap_imports).toHaveLength(1)
    expect(fake.tables.wh_ap_lines).toHaveLength(2)

    expect(audit.logAudit).toHaveBeenCalledTimes(1)
    const entry = audit.logAudit.mock.calls[0][0] as Record<string, unknown>
    expect(entry).toMatchObject({ action: 'wh.ap.import', resourceLabel: 'ap.xlsx' })
    expect(entry.metadata).toMatchObject({
      replaced: { reportAsOf: '2026-09-17', filename: 'older.xlsx', lineCount: 9 },
      reportAsOfSource: 'derived',
    })
  })

  it('400s the A/R report uploaded into the A/P slot', async () => {
    if (!existsSync(AR_FIXTURE)) return
    const fake = world(ADMIN)
    const res = await POST(upload(readFileSync(AR_FIXTURE), 'ar.csv', { mode: 'commit' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/A\/R/)
    expect(fake.calls.some((c) => c.op === 'rpc')).toBe(false)
  })
})

describe('/api/wh/ap/import — the real export', () => {
  it.skipIf(!hasFixture)('imports 684 lines: $1,243,855.07 total, $1,224,952.99 payable', async () => {
    const fake = world(ADMIN)
    const res = await POST(upload(readFileSync(FIXTURE), 'wh-ap.xlsx', { mode: 'commit' }))
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.committed).toMatchObject({
      lineCount: 684,
      sumOpenCents: 124385507,
      reportTotalCents: 124385507,
      reconciled: true,
      openTotalCents: 122495299,
      openLineCount: 671,
      intercompanyLineCount: 51,
      reportAsOf: '2026-09-24',
      reportAsOfSource: 'derived',
      reportAsOfEvidence: 655,
    })
    expect(body.committed.typeCounts).toEqual({
      'Bill': 666, 'Vendor Credit': 5, 'Journal Entry': 12, 'Bill Payment (Check)': 1,
    })
    expect(fake.tables.wh_ap_lines).toHaveLength(684)
  })

  it.skipIf(!hasFixture)('a second import leaves exactly one snapshot', async () => {
    const fake = world(ADMIN)
    await POST(upload(readFileSync(FIXTURE), 'wh-ap.xlsx', { mode: 'commit' }))
    await POST(upload(readFileSync(FIXTURE), 'wh-ap-again.xlsx', { mode: 'commit' }))
    expect(fake.tables.wh_ap_imports).toHaveLength(1)
    expect(fake.tables.wh_ap_lines).toHaveLength(684)
    expect(fake.tables.wh_ap_imports[0].source_filename).toBe('wh-ap-again.xlsx')
  })
})
