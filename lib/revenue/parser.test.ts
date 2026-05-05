import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import { parseRevenueFile } from './parser'

// ─── Test buffer helpers ───────────────────────────────────────────────────

function aoa2buffer(aoa: unknown[][]): Buffer {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa))
  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }))
}

// Builds a minimal valid revenue AOA.
// Row 0: title
// Row 1: blank
// Row 2: "Date Range [start] - [end]"  ← end date used as period_date
// Row 3: column headers
// Row 4+: Branch header / month rows / year totals / branch totals
//
// Column layout (0-indexed) — same for monthly rows AND Branch Totals rows:
//   0=Branch/rowtype, 1=Month, 2=Labor, 3=Rental, 4=OneTime, 5=TotalNoTax, 6=SalesTax, 7=CompanyCode
//
// Monthly rows:       [year, monthName, labor, rental, ot, total, tax, companyCode]
// Subsequent months:  [null, monthName, labor, rental, ot, total, tax, companyCode]
// Year Totals:        ["Year Totals", null, laborSum, ...]
// Branch Totals:      ["Branch Totals", null, laborSum, rentalSum, otSum, totalSum, taxSum, null]
//                       ↑ company code NOT present — parser uses last seen code in section
function buildRevenueAOA(options: {
  dateRange?: string
  rows?: unknown[][]
} = {}): unknown[][] {
  const dateRange = options.dateRange ?? 'Date Range 03/29/2026 - 04/04/2026'
  const dataRows  = options.rows ?? [
    ['Branch: Bakersfield'],
    [2026, 'March',  5000, 200, 100, 5300, 530,  'SAFETY1003'],
    [null, 'April',  3000, 100,   0, 3100, 310,  'SAFETY1003'],
    ['Year Totals', null, 8000, 300, 100, 8400, 840, null],
    [null],
    ['Branch Totals', null, 8000, 300, 100, 8400, 840, null],
  ]

  return [
    ['Invoice Summary by Month by Branch'],
    [],
    [dateRange],
    ['Invoice Year', 'Invoice Month', 'Labor', 'Rental', 'One Time Charges', 'Total w/o Tax', 'Sales Tax', 'Company Code'],
    ...dataRows,
  ]
}

// ─── Period date extraction ────────────────────────────────────────────────

describe('parseRevenueFile — period date', () => {
  it('uses the END date of the range, not the start', () => {
    const result = parseRevenueFile(aoa2buffer(buildRevenueAOA({
      dateRange: 'Date Range 03/29/2026 - 04/04/2026',
    })))
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.periodDate).toBe('2026-04-04')
  })

  it('period date is always a Saturday', () => {
    const result = parseRevenueFile(aoa2buffer(buildRevenueAOA()))
    expect(result.success).toBe(true)
    if (!result.success) return
    // 2026-04-04 is a Saturday
    const day = new Date(result.data.periodDate + 'T12:00:00').getDay()
    expect(day).toBe(6)
  })

  it('returns error when Date Range row is missing', () => {
    const aoa = buildRevenueAOA()
    aoa[2] = ['No date range here']
    const result = parseRevenueFile(aoa2buffer(aoa))
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error).toMatch(/date range/i)
  })

  it('throws when end date is not a Saturday', () => {
    // 04/03/2026 is a Friday
    const result = parseRevenueFile(aoa2buffer(buildRevenueAOA({
      dateRange: 'Date Range 03/29/2026 - 04/03/2026',
    })))
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error).toMatch(/not a Saturday/i)
  })
})

// ─── Entity code mapping ───────────────────────────────────────────────────

describe('parseRevenueFile — entity mapping', () => {
  it('maps SAFETY1003 to INC', () => {
    const result = parseRevenueFile(aoa2buffer(buildRevenueAOA({
      rows: [
        ['Branch: Bakersfield'],
        [2026, 'March', 5000, 0, 0, 5000, 500, 'SAFETY1003'],
        ['Branch Totals', null, 5000, 0, 0, 5000, 500, null],
      ],
    })))
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.records[0].entityCode).toBe('INC')
  })

  it('maps SNTCS1503 to TCS', () => {
    const result = parseRevenueFile(aoa2buffer(buildRevenueAOA({
      rows: [
        ['Branch: Bakersfield'],
        [2026, 'March', 3000, 0, 0, 3000, 300, 'SNTCS1503'],
        ['Branch Totals', null, 3000, 0, 0, 3000, 300, null],
      ],
    })))
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.records[0].entityCode).toBe('TCS')
  })

  it('maps SNTSIGN to STS', () => {
    const result = parseRevenueFile(aoa2buffer(buildRevenueAOA({
      rows: [
        ['Branch: Bakersfield'],
        [2026, 'March', 1000, 0, 0, 1000, 100, 'SNTSIGN'],
        ['Branch Totals', null, 1000, 0, 0, 1000, 100, null],
      ],
    })))
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.records[0].entityCode).toBe('STS')
  })

  it('adds unknown company code to warnings and does not throw', () => {
    const result = parseRevenueFile(aoa2buffer(buildRevenueAOA({
      rows: [
        ['Branch: Bakersfield'],
        [2026, 'March', 5000, 0, 0, 5000, 500, 'SAFETY1003'],
        ['Branch Totals', null, 5000, 0, 0, 5000, 500, null],
        ['Branch: Fresno'],
        [2026, 'March', 1000, 0, 0, 1000, 100, 'UNKNOWN99'],
        ['Branch Totals', null, 1000, 0, 0, 1000, 100, null],
      ],
    })))
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.warnings.some(w => /UNKNOWN99/i.test(w))).toBe(true)
    // Only the known-code record should be present
    expect(result.data.records).toHaveLength(1)
  })
})

// ─── Revenue calculation ───────────────────────────────────────────────────

describe('parseRevenueFile — revenue calculation', () => {
  it('reads totals from Branch Totals row, not individual month rows', () => {
    const result = parseRevenueFile(aoa2buffer(buildRevenueAOA({
      rows: [
        ['Branch: Bakersfield'],
        [2026, 'March',  5000, 200, 100, 5300, 530,  'SAFETY1003'],
        [null, 'April',  3000, 100,   0, 3100, 310,  'SAFETY1003'],
        ['Year Totals', null, 8000, 300, 100, 8400, 840, null],
        [null],
        ['Branch Totals', null, 8000, 300, 100, 8400, 840, null],
      ],
    })))
    expect(result.success).toBe(true)
    if (!result.success) return
    const rec = result.data.records[0]
    expect(rec.labor).toBe(8000)
    expect(rec.rental).toBe(300)
    expect(rec.oneTimeCharges).toBe(100)
    expect(rec.salesTax).toBe(840)
    expect(rec.totalRevenue).toBe(9240)   // 8000 + 300 + 100 + 840
  })

  it('total_revenue = labor + rental + one_time_charges + sales_tax', () => {
    const result = parseRevenueFile(aoa2buffer(buildRevenueAOA({
      rows: [
        ['Branch: Bakersfield'],
        [2026, 'March', 5000, 200, 100, 99999, 530, 'SAFETY1003'],
        ['Branch Totals', null, 5000, 200, 100, 99999, 530, null],
      ],
    })))
    expect(result.success).toBe(true)
    if (!result.success) return
    const rec = result.data.records[0]
    expect(rec.labor).toBe(5000)
    expect(rec.rental).toBe(200)
    expect(rec.oneTimeCharges).toBe(100)
    expect(rec.salesTax).toBe(530)
    expect(rec.totalRevenue).toBe(5830)   // 5000 + 200 + 100 + 530
  })

  it('sales_tax is stored separately AND included in total_revenue', () => {
    const result = parseRevenueFile(aoa2buffer(buildRevenueAOA({
      rows: [
        ['Branch: Bakersfield'],
        [2026, 'March', 4000, 0, 0, 4000, 400, 'SAFETY1003'],
        ['Branch Totals', null, 4000, 0, 0, 4000, 400, null],
      ],
    })))
    expect(result.success).toBe(true)
    if (!result.success) return
    const rec = result.data.records[0]
    expect(rec.salesTax).toBe(400)
    expect(rec.totalRevenue).toBe(4400)   // 4000 + 400
  })

  it('entity code from month rows applies to Branch Totals', () => {
    // company code is on month rows only — Branch Totals row has null in col H
    const result = parseRevenueFile(aoa2buffer(buildRevenueAOA({
      rows: [
        ['Branch: Bakersfield'],
        [2026, 'March',  7388, 500, 0, 7888, 788, 'SAFETY1003'],
        [null, 'April', 12040, 700, 0, 12740, 1274, 'SAFETY1003'],
        ['Branch Totals', null, 19428, 1200, 0, 20628, 2062, null],
      ],
    })))
    expect(result.success).toBe(true)
    if (!result.success) return
    const rec = result.data.records[0]
    expect(rec.entityCode).toBe('INC')
    expect(rec.labor).toBe(19428)
    expect(rec.rental).toBe(1200)
    expect(rec.salesTax).toBe(2062)
    expect(rec.totalRevenue).toBe(22690)   // 19428 + 1200 + 0 + 2062
  })
})

// ─── Branch merging ────────────────────────────────────────────────────────

describe('parseRevenueFile — branch merging', () => {
  it('merges Bakersfield Sales into Bakersfield', () => {
    const result = parseRevenueFile(aoa2buffer(buildRevenueAOA({
      rows: [
        ['Branch: Bakersfield'],
        [2026, 'March', 5000, 0, 0, 5000, 500, 'SAFETY1003'],
        ['Branch Totals', null, 5000, 0, 0, 5000, 500, null],
        ['Branch: Bakersfield Sales'],
        [2026, 'March', 1000, 0, 0, 1000, 100, 'SAFETY1003'],
        ['Branch Totals', null, 1000, 0, 0, 1000, 100, null],
      ],
    })))
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.records).toHaveLength(1)
    expect(result.data.records[0].branchName).toBe('Bakersfield')
    expect(result.data.records[0].totalRevenue).toBe(6600)   // (5000+500) + (1000+100)
  })

  it('merges Fresno Sales into Fresno', () => {
    const result = parseRevenueFile(aoa2buffer(buildRevenueAOA({
      rows: [
        ['Branch: Fresno'],
        [2026, 'March', 3000, 0, 0, 3000, 300, 'SAFETY1003'],
        ['Branch Totals', null, 3000, 0, 0, 3000, 300, null],
        ['Branch: Fresno Sales'],
        [2026, 'March', 500, 0, 0, 500, 50, 'SAFETY1003'],
        ['Branch Totals', null, 500, 0, 0, 500, 50, null],
      ],
    })))
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.records).toHaveLength(1)
    expect(result.data.records[0].branchName).toBe('Fresno')
    expect(result.data.records[0].totalRevenue).toBe(3850)   // (3000+300) + (500+50)
  })

  it('keeps distinct branch+entity combinations separate', () => {
    const result = parseRevenueFile(aoa2buffer(buildRevenueAOA({
      rows: [
        ['Branch: Bakersfield'],
        [2026, 'March', 5000, 0, 0, 5000, 500, 'SAFETY1003'],
        ['Branch Totals', null, 5000, 0, 0, 5000, 500, null],
        ['Branch: Bakersfield'],
        [2026, 'March', 3000, 0, 0, 3000, 300, 'SNTCS1503'],
        ['Branch Totals', null, 3000, 0, 0, 3000, 300, null],
      ],
    })))
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.records).toHaveLength(2)
  })
})

// ─── Row-type skipping ─────────────────────────────────────────────────────

describe('parseRevenueFile — skipping non-totals rows', () => {
  it('skips individual month rows — only Branch Totals values are used', () => {
    // Monthly rows sum to 12000+1200, but Branch Totals row has labor=10000 tax=1000
    // Parser must use Branch Totals value, not accumulate monthly rows
    const result = parseRevenueFile(aoa2buffer(buildRevenueAOA({
      rows: [
        ['Branch: Bakersfield'],
        [2026, 'March',  7000, 0, 0, 7000, 700, 'SAFETY1003'],
        [null, 'April',  5000, 0, 0, 5000, 500, 'SAFETY1003'],
        ['Branch Totals', null, 10000, 0, 0, 10000, 1000, null],
      ],
    })))
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.records[0].totalRevenue).toBe(11000)   // 10000 + 1000
  })

  it('skips Year Totals rows', () => {
    const result = parseRevenueFile(aoa2buffer(buildRevenueAOA({
      rows: [
        ['Branch: Bakersfield'],
        [2026, 'March', 5000, 0, 0, 5000, 500, 'SAFETY1003'],
        ['Year Totals', null, 5000, 0, 0, 5000, 500, null],
        ['Branch Totals', null, 5000, 0, 0, 5000, 500, null],
      ],
    })))
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.records).toHaveLength(1)
    expect(result.data.records[0].totalRevenue).toBe(5500)   // 5000 + 500
  })

  it('skips Report Totals rows', () => {
    const result = parseRevenueFile(aoa2buffer(buildRevenueAOA({
      rows: [
        ['Branch: Bakersfield'],
        [2026, 'March', 5000, 0, 0, 5000, 500, 'SAFETY1003'],
        ['Branch Totals', null, 5000, 0, 0, 5000, 500, null],
        ['Report Totals', null, 5000, 0, 0, 5000, 500, null],
      ],
    })))
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.records).toHaveLength(1)
  })

  it('warns when Branch Totals has no preceding company code', () => {
    const result = parseRevenueFile(aoa2buffer(buildRevenueAOA({
      rows: [
        ['Branch: Bakersfield'],
        // No month row with company code — Branch Totals skipped with warning
        ['Branch Totals', null, 5000, 0, 0, 5000, 500, null],
        ['Branch: Fresno'],
        [2026, 'March', 3000, 0, 0, 3000, 300, 'SAFETY1003'],
        ['Branch Totals', null, 3000, 0, 0, 3000, 300, null],
      ],
    })))
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.warnings.some(w => /no company code/i.test(w))).toBe(true)
    expect(result.data.records).toHaveLength(1)
    expect(result.data.records[0].branchName).toBe('Fresno')
  })
})

// ─── Multi-month accuracy ──────────────────────────────────────────────────

describe('parseRevenueFile — multi-month reports', () => {
  it('captures Branch Totals across multiple months correctly', () => {
    // This mirrors the real file structure where April rows have blank col A
    const result = parseRevenueFile(aoa2buffer(buildRevenueAOA({
      rows: [
        ['Branch: Fresno'],
        [2026, 'March',  7388,  500, 0,  7888,  788, 'SAFETY1003'],
        [null, 'April', 12040,  721, 0, 12761, 1276, 'SAFETY1003'],
        ['Year Totals', null, 19428, 1221, 0, 20649, 2064, null],
        [null],
        ['Branch Totals', null, 19428, 1221, 0, 20649, 2064, null],
      ],
    })))
    expect(result.success).toBe(true)
    if (!result.success) return
    const rec = result.data.records[0]
    expect(rec.labor).toBe(19428)
    expect(rec.rental).toBe(1221)
    expect(rec.salesTax).toBe(2064)
    expect(rec.totalRevenue).toBe(22713)   // 19428 + 1221 + 0 + 2064
  })

  it('does not double-count when both month rows and Branch Totals present', () => {
    // If parser incorrectly reads month rows, total would be 22000 not 11000
    const result = parseRevenueFile(aoa2buffer(buildRevenueAOA({
      rows: [
        ['Branch: Bakersfield'],
        [2026, 'March', 5000, 0, 0, 5000, 500, 'SAFETY1003'],
        [null, 'April', 5000, 0, 0, 5000, 500, 'SAFETY1003'],
        ['Branch Totals', null, 10000, 0, 0, 10000, 1000, null],
      ],
    })))
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.records).toHaveLength(1)
    expect(result.data.records[0].totalRevenue).toBe(11000)   // 10000 + 1000
  })
})
