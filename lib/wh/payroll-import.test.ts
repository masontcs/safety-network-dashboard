import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as XLSX from 'xlsx'
import {
  parseWhPayrollFile,
  parseEmployeeName,
  parsePayrollPeriod,
  findPayrollHeaderRow,
  isHoursItem,
  toHours,
} from './payroll-import'

/**
 * Western Highways payroll parser — pinned to the real QuickBooks Online export.
 *
 * The sample file lives untracked in the repo root (like the A/R, A/P and STS CMR fixtures), so
 * these tests skip rather than fail on a checkout that doesn't have it.
 *
 * Every number below was read off the real file and is the phase's acceptance criteria:
 * period 2026-09-13 → 2026-09-19, 16 employees, 677.04 hours, $23,597.33 gross,
 * −$3,891.29 employee taxes, $22,460.86 adjusted gross, $18,569.57 net.
 */

const FIXTURE = join(
  process.cwd(),
  'WesternHighwaysTrafficTruckProducts_PayrollSummaryByEmployee_09242026_1134.xls',
)
const AP_FIXTURE = join(process.cwd(), 'Western Highways Traffic Truck Products_A_P Aging Detail Report.xlsx')

const hasFixture = existsSync(FIXTURE)
const describeFixture = hasFixture ? describe : describe.skip

/** Re-encode the old .xls fixture as a real .xlsx, so "accepts both" is tested for real. */
function asXlsx(xls: Buffer): Buffer {
  const wb = XLSX.read(xls, { type: 'buffer', raw: true })
  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as ArrayBuffer)
}

describeFixture('parseWhPayrollFile — the real WH Payroll Summary by Employee export', () => {
  const buffer = hasFixture ? readFileSync(FIXTURE) : Buffer.alloc(0)

  it('reads the pay period 2026-09-13 → 2026-09-19 from the report line', () => {
    const result = parseWhPayrollFile(buffer)
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.periodStart).toBe('2026-09-13')
    expect(result.data.periodEnd).toBe('2026-09-19')
  })

  it('transposes the matrix into 16 employees', () => {
    const result = parseWhPayrollFile(buffer)
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.employees).toHaveLength(16)
    expect(result.data.employees.map((e) => e.name)).toEqual([
      'Bauer Lance', 'Dewitt Wesley', 'Flores Marcus R', 'Garrison Jr Jon E', 'Gonzalez Roberto',
      'Greer Jacob A', 'Ivison Mindy A', 'Ivison Thatcher R', 'Ivison Travis', 'Lopez Anthony',
      'Marcom Gregory', 'Mayberry Christine D', 'Mayberry Heaven C', 'Perez-Nunez Jr Moses',
      'Rodriguez Jacob J', 'Siordia Jr Michael',
    ])
  })

  it("reads the Total column: 677.04 hours, $23,597.33 gross, -$3,891.29 taxes, $22,460.86 adjusted gross", () => {
    const result = parseWhPayrollFile(buffer)
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.totals.hours).toBe(677.04)
    expect(result.data.totals.grossCents).toBe(2359733)
    expect(result.data.totals.taxesCents).toBe(-389129)
    expect(result.data.totals.adjustedGrossCents).toBe(2246086)
  })

  it('reconciles: Σ per-employee gross equals the Total column, and so does every other figure', () => {
    const result = parseWhPayrollFile(buffer)
    expect(result.success).toBe(true)
    if (!result.success) return

    expect(result.data.sums.grossCents).toBe(2359733)
    expect(result.data.sums.grossCents).toBe(result.data.totals.grossCents)
    expect(result.data.reconciled).toBe(true)

    expect(result.data.sums.hours).toBe(677.04)
    expect(result.data.sums.taxesCents).toBe(-389129)
    expect(result.data.sums.adjustedGrossCents).toBe(2246086)
    expect(result.data.checks).toEqual({
      hours: true, grossCents: true, taxesCents: true, adjustedGrossCents: true, netCents: true,
    })
  })

  it("derives net as adjusted gross - |taxes| = $18,569.57, matching the report's own Net pay row", () => {
    const result = parseWhPayrollFile(buffer)
    expect(result.success).toBe(true)
    if (!result.success) return

    expect(result.data.sums.netCents).toBe(1856957)
    expect(2246086 - 389129).toBe(1856957)
    // The report carries its own Net pay row — an independent check on the derivation.
    expect(result.data.reportedNetCents).toBe(1856957)
    for (const e of result.data.employees) {
      expect(e.netCents, `${e.name} net`).toBe(e.adjustedGrossCents - Math.abs(e.taxesCents))
      expect(e.detail['Net pay'], `${e.name} vs the report's Net pay row`).toBe(e.netCents)
    }
  })

  it("keeps net distinct from gross - taxes wherever there is a pretax deduction", () => {
    const result = parseWhPayrollFile(buffer)
    expect(result.success).toBe(true)
    if (!result.success) return

    // Five employees have a pretax deduction, so their adjusted gross is below gross and
    // gross - |taxes| would OVERSTATE their net.
    const withPretax = result.data.employees.filter((e) => e.adjustedGrossCents !== e.grossCents)
    expect(withPretax).toHaveLength(5)
    for (const e of withPretax) {
      expect(e.adjustedGrossCents).toBeLessThan(e.grossCents)
      expect(e.netCents).toBeLessThan(e.grossCents - Math.abs(e.taxesCents))
    }
  })

  it("strips the '*' and flags that employee inactive", () => {
    const result = parseWhPayrollFile(buffer)
    expect(result.success).toBe(true)
    if (!result.success) return

    const mindy = result.data.employees.find((e) => e.name === 'Ivison Mindy A')
    expect(mindy).toBeTruthy()
    expect(mindy!.isActive).toBe(false)
    expect(result.data.inactiveCount).toBe(1)
    // Exactly one, and no name anywhere keeps the asterisk.
    expect(result.data.employees.filter((e) => !e.isActive).map((e) => e.name)).toEqual(['Ivison Mindy A'])
    for (const e of result.data.employees) expect(e.name.startsWith('*')).toBe(false)
  })

  it('has Perez-Nunez Jr Moses highest at $3,076.92 and Ivison Thatcher R lowest at $599.50', () => {
    const result = parseWhPayrollFile(buffer)
    expect(result.success).toBe(true)
    if (!result.success) return

    const byGross = [...result.data.employees].sort((a, b) => b.grossCents - a.grossCents)
    expect(byGross[0]).toMatchObject({ name: 'Perez-Nunez Jr Moses', grossCents: 307692 })
    expect(byGross[byGross.length - 1]).toMatchObject({ name: 'Ivison Thatcher R', grossCents: 59950 })
  })

  it('keeps per-employee hours as decimal hours, not cents', () => {
    const result = parseWhPayrollFile(buffer)
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.employees.find((e) => e.name === 'Bauer Lance')!.hours).toBe(40.02)
    expect(result.data.employees.find((e) => e.name === 'Perez-Nunez Jr Moses')!.hours).toBe(80)
  })

  it("carries each employee's whole column in detail — hours as hours, money as cents", () => {
    const result = parseWhPayrollFile(buffer)
    expect(result.success).toBe(true)
    if (!result.success) return

    const lance = result.data.employees.find((e) => e.name === 'Bauer Lance')!
    expect(lance.detail['Hours - Regular Pay']).toBe(28.02)
    expect(lance.detail['Gross pay - Regular Pay']).toBe(70050)
    expect(lance.detail['Employee taxes - Medicare']).toBe(-1451)
    expect(lance.detail['Employee taxes - CA State Disability Ins']).toBe(-1301)
    expect(lance.detail.adjustedGrossCents).toBe(100050)

    // A blank cell is omitted rather than stored as a real 0 — 'Hours - Salary' is blank for an
    // hourly employee and present for a salaried one.
    expect(lance.detail).not.toHaveProperty('Hours - Salary')
    expect(result.data.employees.find((e) => e.name === 'Greer Jacob A')!.detail['Hours - Salary']).toBe(32)
  })

  it('reads the same numbers from the same report saved as .xlsx', () => {
    const fromXls = parseWhPayrollFile(buffer)
    const fromXlsx = parseWhPayrollFile(asXlsx(buffer))
    expect(fromXls.success && fromXlsx.success).toBe(true)
    if (!fromXls.success || !fromXlsx.success) return

    expect(fromXlsx.data.periodStart).toBe('2026-09-13')
    expect(fromXlsx.data.employees).toHaveLength(16)
    expect(fromXlsx.data.sums).toEqual(fromXls.data.sums)
    expect(fromXlsx.data.totals).toEqual(fromXls.data.totals)
    expect(fromXlsx.data.employees.map((e) => [e.name, e.isActive, e.hours, e.grossCents, e.taxesCents, e.netCents]))
      .toEqual(fromXls.data.employees.map((e) => [e.name, e.isActive, e.hours, e.grossCents, e.taxesCents, e.netCents]))
  })

  it('refuses an aging report uploaded as payroll', () => {
    if (!existsSync(AP_FIXTURE)) return
    const result = parseWhPayrollFile(readFileSync(AP_FIXTURE))
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error).toMatch(/Payroll Summary by Employee/i)
  })
})

// ─── The pieces, without the fixture ──────────────────────────────────────────

describe('parseEmployeeName', () => {
  it('keeps "Last First Middle" as written', () => {
    expect(parseEmployeeName('Flores Marcus R')).toEqual({ name: 'Flores Marcus R', isActive: true })
    expect(parseEmployeeName('Perez-Nunez Jr Moses')).toEqual({ name: 'Perez-Nunez Jr Moses', isActive: true })
  })

  it("strips a leading '*' and marks the employee inactive", () => {
    expect(parseEmployeeName('*Ivison Mindy A')).toEqual({ name: 'Ivison Mindy A', isActive: false })
    expect(parseEmployeeName('  *Bauer Lance  ')).toEqual({ name: 'Bauer Lance', isActive: false })
  })

  it('never treats an interior asterisk as the flag', () => {
    expect(parseEmployeeName('Smith John*')).toEqual({ name: 'Smith John*', isActive: true })
  })
})

describe('parsePayrollPeriod', () => {
  it('reads the named-month form the real report uses', () => {
    expect(parsePayrollPeriod([['From Sep 13, 2026 to Sep 19, 2026 for all employees from all locations']]))
      .toEqual({ start: '2026-09-13', end: '2026-09-19' })
  })

  it('reads a full month name and a numeric form', () => {
    expect(parsePayrollPeriod([['From September 13, 2026 to September 19, 2026']]))
      .toEqual({ start: '2026-09-13', end: '2026-09-19' })
    expect(parsePayrollPeriod([['From 09/13/2026 to 09/19/2026']]))
      .toEqual({ start: '2026-09-13', end: '2026-09-19' })
  })

  it('spans a month and a year boundary', () => {
    expect(parsePayrollPeriod([['From Dec 28, 2025 to Jan 3, 2026']]))
      .toEqual({ start: '2025-12-28', end: '2026-01-03' })
  })

  it('returns null when there is no period line', () => {
    expect(parsePayrollPeriod([['Payroll summary by employee report'], ['Item', 'Total']])).toBeNull()
    expect(parsePayrollPeriod([['From nowhere to nowhere']])).toBeNull()
  })
})

describe('findPayrollHeaderRow', () => {
  it('finds Item / Total wherever the title block ends', () => {
    expect(findPayrollHeaderRow([['WH'], ['Payroll'], [''], ['From …'], ['Item', 'Total', 'Bauer Lance']])).toBe(4)
    expect(findPayrollHeaderRow([['Item', 'Total', 'A']])).toBe(0)
  })

  it('returns -1 when the file is some other report', () => {
    expect(findPayrollHeaderRow([['Date', 'Transaction type', 'Num']])).toBe(-1)
    // 'Item' alone is not the payroll header — 'Total' must sit beside it.
    expect(findPayrollHeaderRow([['Item', 'Rate', 'Hours']])).toBe(-1)
  })
})

describe('isHoursItem / toHours', () => {
  it('treats only the Hours - … rows as hours', () => {
    expect(isHoursItem('Hours - total')).toBe(true)
    expect(isHoursItem('Hours - Regular Pay')).toBe(true)
    expect(isHoursItem('Gross pay - total')).toBe(false)
    expect(isHoursItem('Adjusted gross')).toBe(false)
  })

  it('keeps two decimals and tells a blank from a zero', () => {
    expect(toHours(40.02)).toBe(40.02)
    expect(toHours('1,234.5')).toBe(1234.5)
    expect(toHours(0)).toBe(0)
    expect(toHours('')).toBeNull()
    expect(toHours(null)).toBeNull()
    expect(toHours('n/a')).toBeNull()
  })
})

describe('parseWhPayrollFile — refusals', () => {
  function sheet(rows: unknown[][]): Buffer {
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Sheet1')
    return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as ArrayBuffer)
  }

  it('refuses a file with no Item/Total header', () => {
    const r = parseWhPayrollFile(sheet([['Date', 'Transaction type'], ['08/01/2026', 'Bill']]))
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error).toMatch(/Item \/ Total/i)
  })

  it('refuses a payroll report with no period line — an undated period cannot be stored', () => {
    const r = parseWhPayrollFile(sheet([
      ['Payroll summary by employee report'],
      ['Item', 'Total', 'Bauer Lance'],
      ['Gross pay - total', 100, 100],
    ]))
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error).toMatch(/pay period/i)
  })

  it('refuses a report with no employee columns', () => {
    const r = parseWhPayrollFile(sheet([
      ['From Sep 13, 2026 to Sep 19, 2026'],
      ['Item', 'Total'],
      ['Gross pay - total', 100],
    ]))
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error).toMatch(/no employee columns/i)
  })

  it('refuses a report that lists one employee twice rather than double-counting them', () => {
    const r = parseWhPayrollFile(sheet([
      ['From Sep 13, 2026 to Sep 19, 2026'],
      ['Item', 'Total', 'Bauer Lance', 'Bauer Lance'],
      ['Gross pay - total', 200, 100, 100],
    ]))
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error).toMatch(/two columns/i)
  })

  it("treats a starred and unstarred spelling of one name as the duplicate it is", () => {
    const r = parseWhPayrollFile(sheet([
      ['From Sep 13, 2026 to Sep 19, 2026'],
      ['Item', 'Total', 'Ivison Mindy A', '*Ivison Mindy A'],
      ['Gross pay - total', 200, 100, 100],
    ]))
    expect(r.success).toBe(false)
  })

  it('refuses an empty file', () => {
    const r = parseWhPayrollFile(Buffer.alloc(0))
    expect(r.success).toBe(false)
  })

  it('flags a file whose employee columns do not add up to its own Total', () => {
    const r = parseWhPayrollFile(sheet([
      ['From Sep 13, 2026 to Sep 19, 2026'],
      ['Item', 'Total', 'Bauer Lance', 'Dewitt Wesley'],
      ['Hours - total', 80, 40, 40],
      ['Gross pay - total', 9999, 1000, 1000],
      ['Employee taxes - total', -100, -50, -50],
      ['Adjusted gross', 2000, 1000, 1000],
    ]))
    expect(r.success).toBe(true)
    if (!r.success) return
    expect(r.data.reconciled).toBe(false)
    expect(r.data.checks.grossCents).toBe(false)
    // The figures that DO agree are still reported as agreeing.
    expect(r.data.checks.hours).toBe(true)
    expect(r.data.checks.taxesCents).toBe(true)
  })

  it('normalises withholding written positive, so a period can never sum taxes the wrong way', () => {
    const r = parseWhPayrollFile(sheet([
      ['From Sep 13, 2026 to Sep 19, 2026'],
      ['Item', 'Total', 'Bauer Lance'],
      ['Gross pay - total', 1000, 1000],
      ['Employee taxes - total', 100, 100],
      ['Adjusted gross', 1000, 1000],
    ]))
    expect(r.success).toBe(true)
    if (!r.success) return
    expect(r.data.employees[0].taxesCents).toBe(-10000)
    expect(r.data.employees[0].netCents).toBe(90000)
  })

  it('falls back to gross as adjusted gross when the report omits that row', () => {
    const r = parseWhPayrollFile(sheet([
      ['From Sep 13, 2026 to Sep 19, 2026'],
      ['Item', 'Total', 'Bauer Lance'],
      ['Hours - total', 40, 40],
      ['Gross pay - total', 1000, 1000],
      ['Employee taxes - total', -100, -100],
    ]))
    expect(r.success).toBe(true)
    if (!r.success) return
    expect(r.data.employees[0].adjustedGrossCents).toBe(100000)
    expect(r.data.employees[0].netCents).toBe(90000)
    expect(r.data.reportedNetCents).toBeNull()
  })
})
