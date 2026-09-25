import { describe, it, expect, vi, beforeEach } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as XLSX from 'xlsx'
import { fakeSupabase, fakeRouteClient } from '@/lib/cmr/__testing__/fakeSupabase'

/**
 * /api/wh/payroll/import — the gate, and the behaviour that makes this phase different from
 * Phase 1: periods ACCUMULATE. Re-importing a period must replace only that period's rows and
 * leave the rest of the history standing; a different period must add a second row.
 *
 * The fake rpc below implements the same contract as the real wh_payroll_replace_period
 * (delete by (period_start, period_end), re-insert, sum the totals from the rows), so what is
 * asserted here is the ROUTE's behaviour against that contract. The SQL function itself was run
 * against a scratch PostgreSQL 16 — see lib/wh/payroll-migration.test.ts for what was checked.
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
// An admin and an executive who are NOT on the WH allow-list, and a sales user who is.
const ADMIN_OFF_LIST = '00000000-0000-4000-8000-0000000000a2'
const EXEC_OFF_LIST = '00000000-0000-4000-8000-0000000000e2'
const GRANTED_SALES = '00000000-0000-4000-8000-0000000000f2'
const AR_MANAGER = '00000000-0000-4000-8000-0000000000b1'
const SALES = '00000000-0000-4000-8000-0000000000f1'

const FIXTURE = join(
  process.cwd(),
  'WesternHighwaysTrafficTruckProducts_PayrollSummaryByEmployee_09242026_1134.xls',
)
const AP_FIXTURE = join(process.cwd(), 'Western Highways Traffic Truck Products_A_P Aging Detail Report.xlsx')
const hasFixture = existsSync(FIXTURE)

let nextPeriodId = 0

function world(periods: Record<string, unknown>[] = [], lines: Record<string, unknown>[] = []) {
  nextPeriodId = 0
  const fake = fakeSupabase(
    {
      user_profiles: [
        { id: ADMIN, role: 'admin', display_name: 'Ada Admin', is_active: true, billing_role: null, qb_export_enabled: false, qb_config_enabled: false },
        { id: EXEC, role: 'executive', display_name: 'Eve Exec', is_active: true, billing_role: null, qb_export_enabled: false, qb_config_enabled: false },
        { id: ADMIN_OFF_LIST, role: 'admin', display_name: 'Una Granted', is_active: true, billing_role: null, qb_export_enabled: false, qb_config_enabled: false },
        { id: EXEC_OFF_LIST, role: 'executive', display_name: 'Ex Cluded', is_active: true, billing_role: null, qb_export_enabled: false, qb_config_enabled: false },
        { id: GRANTED_SALES, role: 'sales', display_name: 'Sal Sales', is_active: true, billing_role: null, qb_export_enabled: false, qb_config_enabled: false },
        { id: AR_MANAGER, role: 'ar_manager', display_name: 'Ari Manager', is_active: true, billing_role: null, qb_export_enabled: false, qb_config_enabled: false },
        { id: SALES, role: 'sales', display_name: 'Sam Sales', is_active: true, billing_role: null, qb_export_enabled: false, qb_config_enabled: false },
      ],
      // THE allow-list. Ada, Eve and Sal are on it; every other profile above is not.
      wh_access: [ADMIN, EXEC, GRANTED_SALES].map((id) => ({ user_id: id, granted_by: null, granted_at: '2026-09-24T10:00:00Z' })),
      wh_payroll_periods: periods,
      wh_payroll_lines: lines,
    },
    {
      rpc: {
        // The contract of the real function: this period only, totals summed from the rows.
        wh_payroll_replace_period: (args, tables) => {
          const rows = args.p_lines as Record<string, unknown>[]
          const start = args.p_period_start as string
          const end = args.p_period_end as string

          const doomed = tables.wh_payroll_periods.filter((p) => p.period_start === start && p.period_end === end)
          const doomedIds = new Set(doomed.map((p) => p.id))
          tables.wh_payroll_periods = tables.wh_payroll_periods.filter((p) => !doomedIds.has(p.id))
          // ON DELETE CASCADE
          tables.wh_payroll_lines = tables.wh_payroll_lines.filter((l) => !doomedIds.has(l.period_id))

          const id = `period-${++nextPeriodId}`
          for (const r of rows) tables.wh_payroll_lines.push({ ...r, period_id: id })
          tables.wh_payroll_periods.push({
            id,
            period_start: start,
            period_end: end,
            source_filename: args.p_source_filename,
            employee_count: rows.length,
            total_hours: Math.round(rows.reduce((s, r) => s + Math.round(Number(r.hours) * 100), 0)) / 100,
            gross_total_cents: rows.reduce((s, r) => s + Number(r.gross_cents), 0),
            taxes_total_cents: rows.reduce((s, r) => s + Number(r.taxes_cents), 0),
            net_total_cents: rows.reduce((s, r) => s + Number(r.net_cents), 0),
            imported_by: args.p_actor,
          })
          return { data: id }
        },
      },
    },
  )
  server.serviceClient = fake.client
  return fake
}

function as(userId: string | null) {
  server.routeClient = fakeRouteClient(userId)
}

function upload(file: Buffer, name: string, fields: Record<string, string> = {}): Request {
  const form = new FormData()
  form.set('file', new File([new Uint8Array(file)], name))
  for (const [k, v] of Object.entries(fields)) form.set(k, v)
  return new Request('http://localhost/api/wh/payroll/import', { method: 'POST', body: form })
}

/** A tiny payroll export: the period line, the Item/Total header, two employees (one starred). */
function tinyPayroll(opts: { start?: string; end?: string; gross?: [number, number]; brokenTotal?: boolean } = {}): Buffer {
  const start = opts.start ?? 'Sep 13, 2026'
  const end = opts.end ?? 'Sep 19, 2026'
  const [g1, g2] = opts.gross ?? [1000, 500]
  const rows: unknown[][] = [
    ['Western Highways Traffic Truck Products'],
    ['Payroll summary by employee report'],
    [''],
    [`From ${start} to ${end} for all employees from all locations`],
    ['Item', 'Total', 'Bauer Lance', '*Ivison Mindy A'],
    ['Hours - total', 70, 40, 30],
    ['Gross pay - total', opts.brokenTotal ? 9999 : g1 + g2, g1, g2],
    ['Pretax deductions - total', -100, -100, ''],
    ['Adjusted gross', g1 + g2 - 100, g1 - 100, g2],
    ['Employee taxes - total', -200, -150, -50],
    ['Net pay', g1 + g2 - 300, g1 - 250, g2 - 50],
  ]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Sheet1')
  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as ArrayBuffer)
}

beforeEach(() => {
  audit.logAudit.mockClear()
})

describe('/api/wh/payroll/import — access', () => {
  it('401s with no session, and never reads or writes anything', async () => {
    const fake = world()
    as(null)
    const res = await POST(upload(tinyPayroll(), 'p.xlsx', { mode: 'commit' }))
    expect(res.status).toBe(401)
    expect(fake.calls).toHaveLength(0)
    expect(fake.tables.wh_payroll_periods).toHaveLength(0)
  })

  it.each([
    ['ar_manager', AR_MANAGER],
    ['sales', SALES],
    ['platform admin with no wh_access row', ADMIN_OFF_LIST],
    ['executive with no wh_access row', EXEC_OFF_LIST],
  ])('403s a %s — WH payroll needs an explicit grant, and no role inherits it', async (_l, userId) => {
    const fake = world()
    as(userId)
    const res = await POST(upload(tinyPayroll(), 'p.xlsx', { mode: 'commit' }))
    expect(res.status).toBe(403)
    expect(fake.calls.some((c) => c.op === 'rpc')).toBe(false)
    expect(fake.tables.wh_payroll_periods).toHaveLength(0)
    expect(fake.tables.wh_payroll_lines).toHaveLength(0)
    expect(audit.logAudit).not.toHaveBeenCalled()
  })

  it.each([
    ['granted admin', ADMIN],
    ['granted executive', EXEC],
    ['granted sales user', GRANTED_SALES],
  ])('lets a %s in with a 200', async (_l, userId) => {
    world()
    as(userId)
    expect((await POST(upload(tinyPayroll(), 'p.xlsx'))).status).toBe(200)
  })
})

describe('/api/wh/payroll/import — preview', () => {
  it('names the period and the figures without writing anything', async () => {
    const fake = world()
    as(ADMIN)
    const body = await (await POST(upload(tinyPayroll(), 'p.xlsx'))).json()
    expect(body.preview).toMatchObject({
      report: 'payroll',
      filename: 'p.xlsx',
      periodStart: '2026-09-13',
      periodEnd: '2026-09-19',
      employeeCount: 2,
      inactiveCount: 1,
      totalHours: 70,
      grossTotalCents: 150000,
      taxesTotalCents: -20000,
      reconciled: true,
      existingPeriod: null,
    })
    expect(fake.calls.some((c) => c.op === 'rpc')).toBe(false)
    expect(fake.tables.wh_payroll_periods).toHaveLength(0)
  })

  it('warns that this week is already stored, and with what', async () => {
    world([
      {
        id: 'old', period_start: '2026-09-13', period_end: '2026-09-19', source_filename: 'first-try.xls',
        employee_count: 16, gross_total_cents: 2359733, imported_at: '2026-09-24T18:00:00Z',
      },
    ])
    as(ADMIN)
    const body = await (await POST(upload(tinyPayroll(), 'p.xlsx'))).json()
    expect(body.preview.existingPeriod).toEqual({
      periodStart: '2026-09-13',
      periodEnd: '2026-09-19',
      filename: 'first-try.xls',
      employeeCount: 16,
      grossTotalCents: 2359733,
      importedAt: '2026-09-24T18:00:00Z',
    })
  })

  it('does not mistake a different week for the one being uploaded', async () => {
    world([
      { id: 'old', period_start: '2026-09-06', period_end: '2026-09-12', source_filename: 'last-week.xls', employee_count: 16, gross_total_cents: 1, imported_at: null },
    ])
    as(ADMIN)
    const body = await (await POST(upload(tinyPayroll(), 'p.xlsx'))).json()
    expect(body.preview.existingPeriod).toBeNull()
  })

  it('strips the asterisk and flags that employee inactive, biggest gross first', async () => {
    world()
    as(ADMIN)
    const body = await (await POST(upload(tinyPayroll(), 'p.xlsx'))).json()
    expect(body.preview.employees).toEqual([
      { name: 'Bauer Lance', isActive: true, hours: 40, grossCents: 100000, taxesCents: -15000, netCents: 75000 },
      { name: 'Ivison Mindy A', isActive: false, hours: 30, grossCents: 50000, taxesCents: -5000, netCents: 45000 },
    ])
  })

  it('400s an aging report uploaded as payroll', async () => {
    if (!existsSync(AP_FIXTURE)) return
    const fake = world()
    as(ADMIN)
    const res = await POST(upload(readFileSync(AP_FIXTURE), 'ap.xlsx', { mode: 'commit' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/Payroll Summary by Employee/i)
    expect(fake.calls.some((c) => c.op === 'rpc')).toBe(false)
  })
})

describe('/api/wh/payroll/import — commit', () => {
  it('sends the lines and no totals: the function derives them', async () => {
    const fake = world()
    as(ADMIN)
    const res = await POST(upload(tinyPayroll(), 'p.xlsx', { mode: 'commit' }))
    expect(res.status).toBe(200)

    const args = fake.calls.find((c) => c.op === 'rpc')!.payload as Record<string, unknown>
    expect(args.p_period_start).toBe('2026-09-13')
    expect(args.p_period_end).toBe('2026-09-19')
    for (const k of ['p_employee_count', 'p_total_hours', 'p_gross_total_cents', 'p_taxes_total_cents', 'p_net_total_cents']) {
      expect(args, k).not.toHaveProperty(k)
    }

    const lines = args.p_lines as Record<string, unknown>[]
    expect(lines[0]).toMatchObject({
      employee_name: 'Bauer Lance', is_active: true, hours: 40,
      gross_cents: 100000, taxes_cents: -15000, net_cents: 75000,
    })
    // Net is adjusted gross - |taxes|, NOT gross - |taxes| — Lance has a pretax deduction.
    expect(lines[0].net_cents).toBe(90000 - 15000)
    expect(lines[1]).toMatchObject({ employee_name: 'Ivison Mindy A', is_active: false })
    // The whole report column travels with each employee.
    expect((lines[0].detail as Record<string, number>)['Pretax deductions - total']).toBe(-10000)
    expect((lines[0].detail as Record<string, number>).adjustedGrossCents).toBe(90000)
  })

  it('audits the import, saying it added a period rather than replacing one', async () => {
    world()
    as(ADMIN)
    await POST(upload(tinyPayroll(), 'p.xlsx', { mode: 'commit' }))

    expect(audit.logAudit).toHaveBeenCalledTimes(1)
    const entry = audit.logAudit.mock.calls[0][0] as Record<string, unknown>
    expect(entry).toMatchObject({ action: 'wh.payroll.import', resourceType: 'wh_payroll_period', resourceLabel: 'p.xlsx' })
    expect(entry.metadata).toMatchObject({
      periodStart: '2026-09-13', periodEnd: '2026-09-19', employeeCount: 2, inactiveCount: 1,
      grossTotalCents: 150000, reconciled: true, replaced: null,
    })
  })

  it('records in the audit log what an overwrite replaced', async () => {
    world([
      { id: 'old', period_start: '2026-09-13', period_end: '2026-09-19', source_filename: 'first-try.xls', employee_count: 16, gross_total_cents: 2359733, imported_at: null },
    ])
    as(ADMIN)
    const res = await POST(upload(tinyPayroll(), 'p.xlsx', { mode: 'commit' }))
    expect((await res.json()).committed.replacedExisting).toBe(true)
    const entry = audit.logAudit.mock.calls[0][0] as Record<string, unknown>
    expect((entry.metadata as Record<string, unknown>).replaced).toMatchObject({
      periodStart: '2026-09-13', filename: 'first-try.xls', employeeCount: 16, grossTotalCents: 2359733,
    })
  })

  it('returns the new period id', async () => {
    world()
    as(ADMIN)
    const body = await (await POST(upload(tinyPayroll(), 'p.xlsx', { mode: 'commit' }))).json()
    expect(body.committed.periodId).toBe('period-1')
  })

  it.each([
    ['NO_LINES', /no employees/i, 400],
    ['BAD_DATES', /valid date range/i, 400],
    ['BAD_LINES', /payload was rejected/i, 400],
    ['something nobody planned for', /could not be saved/i, 500],
  ])('maps the function refusal %s to a useful response, writing nothing', async (message, matcher, status) => {
    const fake = fakeSupabase(
      {
        user_profiles: [{ id: ADMIN, role: 'admin', display_name: 'Ada Admin', is_active: true, billing_role: null, qb_export_enabled: false, qb_config_enabled: false }],
        wh_access: [{ user_id: ADMIN, granted_by: null, granted_at: '2026-09-24T10:00:00Z' }],
        wh_payroll_periods: [],
        wh_payroll_lines: [],
      },
      { rpc: { wh_payroll_replace_period: () => ({ message }) } },
    )
    server.serviceClient = fake.client
    as(ADMIN)
    const res = await POST(upload(tinyPayroll(), 'p.xlsx', { mode: 'commit' }))
    expect(res.status).toBe(status)
    expect((await res.json()).error).toMatch(matcher)
    expect(fake.tables.wh_payroll_periods).toHaveLength(0)
    expect(audit.logAudit).not.toHaveBeenCalled()
  })

  it('refuses to store a file that does not add up to its own Total column', async () => {
    const fake = world()
    as(ADMIN)
    const res = await POST(upload(tinyPayroll({ brokenTotal: true }), 'p.xlsx', { mode: 'commit' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/not read correctly/i)
    expect(fake.calls.some((c) => c.op === 'rpc')).toBe(false)
    expect(fake.tables.wh_payroll_periods).toHaveLength(0)
    expect(audit.logAudit).not.toHaveBeenCalled()
  })
})

describe('/api/wh/payroll/import — periods accumulate', () => {
  it('re-importing the SAME period replaces its rows and does not duplicate the period', async () => {
    const fake = world()
    as(ADMIN)

    await POST(upload(tinyPayroll(), 'week-1.xlsx', { mode: 'commit' }))
    expect(fake.tables.wh_payroll_periods).toHaveLength(1)
    expect(fake.tables.wh_payroll_lines).toHaveLength(2)
    expect(fake.tables.wh_payroll_periods[0].gross_total_cents).toBe(150000)

    // The same week again, corrected: one period still, with the NEW figures and file.
    await POST(upload(tinyPayroll({ gross: [1200, 600] }), 'week-1-corrected.xlsx', { mode: 'commit' }))
    expect(fake.tables.wh_payroll_periods).toHaveLength(1)
    expect(fake.tables.wh_payroll_lines).toHaveLength(2)
    expect(fake.tables.wh_payroll_periods[0]).toMatchObject({
      period_start: '2026-09-13',
      period_end: '2026-09-19',
      source_filename: 'week-1-corrected.xlsx',
      gross_total_cents: 180000,
      employee_count: 2,
    })
  })

  it('a DIFFERENT period is added alongside, leaving the first one untouched', async () => {
    const fake = world()
    as(ADMIN)

    await POST(upload(tinyPayroll(), 'week-1.xlsx', { mode: 'commit' }))
    await POST(upload(tinyPayroll({ start: 'Sep 20, 2026', end: 'Sep 26, 2026', gross: [1100, 400] }), 'week-2.xlsx', { mode: 'commit' }))

    expect(fake.tables.wh_payroll_periods).toHaveLength(2)
    expect(fake.tables.wh_payroll_lines).toHaveLength(4)
    const byStart = [...fake.tables.wh_payroll_periods].sort((a, b) => String(a.period_start).localeCompare(String(b.period_start)))
    expect(byStart.map((p) => [p.period_start, p.period_end, p.source_filename, p.gross_total_cents])).toEqual([
      ['2026-09-13', '2026-09-19', 'week-1.xlsx', 150000],
      ['2026-09-20', '2026-09-26', 'week-2.xlsx', 150000],
    ])
  })

  it('re-importing one week does not disturb the other weeks in the history', async () => {
    const fake = world()
    as(ADMIN)

    await POST(upload(tinyPayroll({ start: 'Sep 6, 2026', end: 'Sep 12, 2026' }), 'w0.xlsx', { mode: 'commit' }))
    await POST(upload(tinyPayroll(), 'w1.xlsx', { mode: 'commit' }))
    await POST(upload(tinyPayroll({ start: 'Sep 20, 2026', end: 'Sep 26, 2026' }), 'w2.xlsx', { mode: 'commit' }))
    expect(fake.tables.wh_payroll_periods).toHaveLength(3)

    await POST(upload(tinyPayroll({ gross: [1, 1] }), 'w1-again.xlsx', { mode: 'commit' }))
    expect(fake.tables.wh_payroll_periods).toHaveLength(3)
    expect(fake.tables.wh_payroll_lines).toHaveLength(6)

    const middle = fake.tables.wh_payroll_periods.find((p) => p.period_start === '2026-09-13')!
    expect(middle).toMatchObject({ source_filename: 'w1-again.xlsx', gross_total_cents: 200 })
    // The weeks either side kept their own files and figures.
    expect(fake.tables.wh_payroll_periods.find((p) => p.period_start === '2026-09-06')).toMatchObject({ source_filename: 'w0.xlsx', gross_total_cents: 150000 })
    expect(fake.tables.wh_payroll_periods.find((p) => p.period_start === '2026-09-20')).toMatchObject({ source_filename: 'w2.xlsx', gross_total_cents: 150000 })
  })
})

describe('/api/wh/payroll/import — the real export', () => {
  it.skipIf(!hasFixture)('imports the Sep 13–19 period: 16 employees, $23,597.33 gross, -$3,891.29 taxes', async () => {
    const fake = world()
    as(ADMIN)
    const res = await POST(upload(readFileSync(FIXTURE), 'wh-payroll.xls', { mode: 'commit' }))
    expect(res.status).toBe(200)

    const { committed } = await res.json()
    expect(committed).toMatchObject({
      report: 'payroll',
      periodStart: '2026-09-13',
      periodEnd: '2026-09-19',
      employeeCount: 16,
      inactiveCount: 1,
      totalHours: 677.04,
      grossTotalCents: 2359733,
      taxesTotalCents: -389129,
      adjustedGrossTotalCents: 2246086,
      netTotalCents: 1856957,
      reconciled: true,
      replacedExisting: false,
    })
    expect(committed.reportTotals).toMatchObject({
      hours: 677.04, grossCents: 2359733, taxesCents: -389129, adjustedGrossCents: 2246086, netCents: 1856957,
    })

    // What actually landed, summed from the rows the way the SQL function does.
    expect(fake.tables.wh_payroll_periods).toHaveLength(1)
    expect(fake.tables.wh_payroll_periods[0]).toMatchObject({
      period_start: '2026-09-13', period_end: '2026-09-19', employee_count: 16,
      total_hours: 677.04, gross_total_cents: 2359733, taxes_total_cents: -389129, net_total_cents: 1856957,
    })
    expect(fake.tables.wh_payroll_lines).toHaveLength(16)
    expect(fake.tables.wh_payroll_lines.filter((l) => l.is_active === false).map((l) => l.employee_name))
      .toEqual(['Ivison Mindy A'])
    expect(fake.tables.wh_payroll_lines.every((l) => Number(l.taxes_cents) <= 0)).toBe(true)
  })

  it.skipIf(!hasFixture)('re-importing the real file leaves exactly one Sep 13–19 period', async () => {
    const fake = world()
    as(ADMIN)
    await POST(upload(readFileSync(FIXTURE), 'wh-payroll.xls', { mode: 'commit' }))
    await POST(upload(readFileSync(FIXTURE), 'wh-payroll-again.xls', { mode: 'commit' }))

    expect(fake.tables.wh_payroll_periods).toHaveLength(1)
    expect(fake.tables.wh_payroll_lines).toHaveLength(16)
    expect(fake.tables.wh_payroll_periods[0]).toMatchObject({
      source_filename: 'wh-payroll-again.xls', gross_total_cents: 2359733, employee_count: 16,
    })
  })

  it.skipIf(!hasFixture)('the second upload knows it is overwriting the week it already has', async () => {
    world()
    as(ADMIN)
    await POST(upload(readFileSync(FIXTURE), 'wh-payroll.xls', { mode: 'commit' }))
    const body = await (await POST(upload(readFileSync(FIXTURE), 'wh-payroll.xls'))).json()
    expect(body.preview.existingPeriod).toMatchObject({
      periodStart: '2026-09-13', periodEnd: '2026-09-19', employeeCount: 16, grossTotalCents: 2359733,
    })
  })
})
