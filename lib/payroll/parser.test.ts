import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import { getDay, parseISO } from 'date-fns'
import { splitLegalName } from './split-name'
import { extractPeriodDate } from './parse-helpers'
import { parsePayrollFile } from './parser'
import { ParseError } from '@/lib/utils/errors'
import type { Rows } from './parse-helpers'

// ─── Test buffer helpers ───────────────────────────────────────────────────

function aoa2buffer(aoa: unknown[][]): Buffer {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa))
  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }))
}

// Emp 1 (AGUILAR, MARC A) at col 4: 40h @ $25 = $1000, tax $92.35
// Emp 2 (SMITH, JOHN) at col 9:    all zeros — should be skipped
// Items: Regular Pay, Overtime Pay (emp 2 has zeros for both)
function buildPayrollAOA(weekOf = 'Week of Mar 29, 2026'): unknown[][] {
  return [
    // Row 0: name header
    [null, null, null, null, 'AGUILAR, MARC A', null, null, null, null, 'SMITH, JOHN', null, null, null, null, 'TOTAL'],
    // Row 1: "Week of" date
    [null, weekOf],
    [], // Row 2
    [], // Row 3
    // Row 4: Regular Pay — emp1 has data, emp2 zeros
    [null, null, null, 'Regular Pay', 40, null, 25.00, null, 1000.00, null, null, null, null, null],
    // Row 5: Overtime Pay — emp1 only
    [null, null, null, 'Overtime Pay', 5, null, 37.50, null, 187.50, null, null, null, null, null],
    // Row 6: null in col 3 — stops item extraction
    [],
    // Row 7: tax row — label in col A (index 0), amounts at employee col+4
    ['Total Employer Taxes and Contributions', null, null, null, null, null, null, null, 92.35, null, null, null, null, null],
  ]
}

// ─── splitLegalName ────────────────────────────────────────────────────────

describe('splitLegalName', () => {
  it('splits standard "LAST, FIRST MIDDLE" and strips middle initial', () => {
    const r = splitLegalName('AGUILAR, MARC A')
    expect(r).toEqual({ firstName: 'Marc', lastName: 'Aguilar', unexpected: false })
  })

  it('splits "LAST, FIRST" with no middle initial', () => {
    const r = splitLegalName('AGUILAR, OBED G')
    expect(r).toEqual({ firstName: 'Obed', lastName: 'Aguilar', unexpected: false })
  })

  it('title-cases multi-syllable last name', () => {
    const r = splitLegalName('BETTENCOURT, LUIS A')
    expect(r).toEqual({ firstName: 'Luis', lastName: 'Bettencourt', unexpected: false })
  })

  it('preserves hyphen in hyphenated last name', () => {
    const r = splitLegalName('ALTAMIRANO-CRUZ, CESAR A')
    expect(r).toEqual({ firstName: 'Cesar', lastName: 'Altamirano-Cruz', unexpected: false })
  })

  it('stores full name in lastName and sets unexpected=true when no comma', () => {
    const r = splitLegalName('MARC AGUILAR')
    expect(r).toEqual({ firstName: '', lastName: 'Marc Aguilar', unexpected: true })
  })

  it('handles leading/trailing whitespace', () => {
    const r = splitLegalName('  SMITH, JANE  ')
    expect(r.firstName).toBe('Jane')
    expect(r.lastName).toBe('Smith')
    expect(r.unexpected).toBe(false)
  })
})

// ─── extractPeriodDate ─────────────────────────────────────────────────────

function makeRows(weekOfText: string): Rows {
  return [[], [null, weekOfText]]
}

describe('extractPeriodDate', () => {
  it('subtracts 1 day from the report date', () => {
    expect(extractPeriodDate(makeRows('Week of Mar 29, 2026'))).toBe('2026-03-28')
  })

  it('handles year boundary (Jan 1 → Dec 31 of prior year)', () => {
    // Jan 1, 2023 is a Sunday; Dec 31, 2022 is a Saturday ✓
    expect(extractPeriodDate(makeRows('Week of Jan 1, 2023'))).toBe('2022-12-31')
  })

  it('result is always a Saturday', () => {
    const dateStr = extractPeriodDate(makeRows('Week of Mar 29, 2026'))
    expect(getDay(parseISO(dateStr))).toBe(6)
  })

  it('throws on missing "Week of" text', () => {
    expect(() => extractPeriodDate(makeRows('No date here'))).toThrow()
  })

  it('throws when the computed date is not a Saturday', () => {
    // Mar 28, 2026 − 1 = Mar 27, 2026 = Friday
    // ParseError.message is the generic text; specific reason is in .detail
    let caught: unknown
    try { extractPeriodDate(makeRows('Week of Mar 28, 2026')) } catch (e) { caught = e }
    expect(caught).toBeInstanceOf(ParseError)
    expect((caught as ParseError).detail).toMatch(/not a Saturday/i)
  })

  it('auto-corrects 2-digit year and pushes a warning', () => {
    // "Mar 8, 26" → year 26 CE → corrected to 2026 → subtract 1 day → 2026-03-07 (Saturday)
    const warnings: string[] = []
    const result = extractPeriodDate(makeRows('Week of Mar 8, 26'), warnings)
    expect(result).toBe('2026-03-07')
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatch(/2-digit year/i)
    expect(warnings[0]).toMatch(/2026/)
  })
})

// ─── parsePayrollFile ──────────────────────────────────────────────────────

describe('parsePayrollFile', () => {
  it('returns correct period date', () => {
    const result = parsePayrollFile(aoa2buffer(buildPayrollAOA()), 'INC')
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.periodDate).toBe('2026-03-28')
  })

  it('parses dynamic payroll items list from col D', () => {
    const result = parsePayrollFile(aoa2buffer(buildPayrollAOA()), 'INC')
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.payrollItems).toEqual(['Regular Pay', 'Overtime Pay'])
  })

  it('stops parsing employee names at TOTAL sentinel', () => {
    // Header: VALID at col 4, TOTAL at col 9, AFTER at col 14 (should be ignored)
    const aoa: unknown[][] = [
      [null, null, null, null, 'VALID, EMP', null, null, null, null, 'TOTAL', null, null, null, null, 'AFTER, TOTAL'],
      [null, 'Week of Mar 29, 2026'],
      [], [],
      [null, null, null, 'Regular Pay', 8, null, 20.00, null, 160.00, null, null, null, null, null, null, null, null, null, null],
      [],
      ['Total Employer Taxes and Contributions', null, null, null, null, null, null, null, 14.40, null, null, null, null, null],
    ]
    const result = parsePayrollFile(aoa2buffer(aoa), 'INC')
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.employees).toHaveLength(1)
    expect(result.data.employees[0].rawName).toBe('VALID, EMP')
  })

  it('skips employees with all-zero amounts and zero tax', () => {
    const result = parsePayrollFile(aoa2buffer(buildPayrollAOA()), 'INC')
    expect(result.success).toBe(true)
    if (!result.success) return
    // SMITH, JOHN has all zeros — should be excluded
    expect(result.data.employees).toHaveLength(1)
    expect(result.data.employees[0].rawName).toBe('AGUILAR, MARC A')
  })

  it('keeps employee with zero line items but non-zero tax', () => {
    // Same layout but SMITH, JOHN gets a non-zero tax value
    const aoa = buildPayrollAOA()
    // Row 7 (tax row): set SMITH, JOHN tax at col 13 = 45.00
    ;(aoa[7] as unknown[])[13] = 45.00
    const result = parsePayrollFile(aoa2buffer(aoa), 'INC')
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.employees).toHaveLength(2)
    const smith = result.data.employees.find(e => e.rawName === 'SMITH, JOHN')!
    expect(smith.taxAmount).toBe(45.00)
    expect(smith.lineItems).toHaveLength(0)
  })

  it('auto-splits employee names and sets autoFirstName/autoLastName', () => {
    const result = parsePayrollFile(aoa2buffer(buildPayrollAOA()), 'INC')
    expect(result.success).toBe(true)
    if (!result.success) return
    const aguilar = result.data.employees[0]
    expect(aguilar.autoFirstName).toBe('Marc')
    expect(aguilar.autoLastName).toBe('Aguilar')
    expect(aguilar.nameFormatUnexpected).toBe(false)
  })

  it('flags unexpected name format and adds a warning', () => {
    const aoa = buildPayrollAOA()
    // Replace AGUILAR with a no-comma name
    ;(aoa[0] as unknown[])[4] = 'NOLAN RYAN'
    const result = parsePayrollFile(aoa2buffer(aoa), 'INC')
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.employees[0].nameFormatUnexpected).toBe(true)
    expect(result.warnings.some(w => /no comma/i.test(w))).toBe(true)
  })

  it('returns structured error (success=false) on missing period date', () => {
    const aoa = buildPayrollAOA()
    // Wipe the "Week of" text
    ;(aoa[1] as unknown[])[1] = 'Some other header'
    const result = parsePayrollFile(aoa2buffer(aoa), 'INC')
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error).toMatch(/pay period date/i)
  })

  it('includes entity code in parse result', () => {
    const result = parsePayrollFile(aoa2buffer(buildPayrollAOA()), 'TCS')
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.entityCode).toBe('TCS')
  })

  it('reads line item hours, rate, and amount correctly', () => {
    const result = parsePayrollFile(aoa2buffer(buildPayrollAOA()), 'INC')
    expect(result.success).toBe(true)
    if (!result.success) return
    const regularPay = result.data.employees[0].lineItems.find(i => i.itemName === 'Regular Pay')!
    expect(regularPay.hours).toBe(40)
    expect(regularPay.rate).toBe(25)
    expect(regularPay.amount).toBe(1000)
  })
})
