import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import * as XLSX from 'xlsx'
import {
  CMR_AP_NO_NAME,
  cmrApCents,
  cmrApDay,
  parseCmrApRows,
  parseCmrApWorkbook,
  type CmrApParsed,
} from './ap-import'

/**
 * The QuickBooks A/P Aging Detail parser, against the REAL export Mason supplied
 * (`STS AP 92226.xlsx` — the STS account as of 9/22/26, in the repo root) and against small
 * synthetic sheets for the edge cases.
 *
 * Counted independently of this parser (openpyxl) from the same file:
 *   116 Bill · 25 Credit · 5 General Journal · 1 Bill Pmt -Check = 147 lines
 *   report TOTAL $176,038.56 = Σ all 147 lines  → reconciled
 *   payable (Bill + Credit) $107,577.75
 *   35 distinct vendor names across all lines; 33 carry a Bill or Credit
 *   (the phase prompt said 36 — the file has 35; see the status doc)
 */

/**
 * The real export sits in the repo root on Mason's Mac and is gitignored (*.xlsx — raw QuickBooks
 * source files are never committed), so this block runs wherever the file is present (the build
 * sandbox and Mason's Mac) and is skipped elsewhere. The synthetic cases below always run.
 */
const FIXTURE = path.join(process.cwd(), 'STS AP 92226.xlsx')
const HAS_REAL = existsSync(FIXTURE)

function parseFixture(): CmrApParsed {
  const r = parseCmrApWorkbook(readFileSync(FIXTURE))
  if (!r.ok) throw new Error(r.error)
  return r.value
}

const HEADER = ['', '', '', 'Type', '', 'Date', '', 'Num', '', 'Name', '', 'Due Date', '', 'Aging', '', 'Open Balance']
/** A detail row in the report's spaced-out layout. */
const line = (type: string, date: unknown, num: unknown, name: unknown, due: unknown, aging: unknown, bal: unknown) =>
  ['', '', '', type, '', date, '', num, '', name, '', due, '', aging, '', bal]
const label = (col0: string, bal: unknown = '') => [col0, '', '', '', '', '', '', '', '', '', '', '', '', '', '', bal]

describe.runIf(HAS_REAL)('the real STS A/P Aging Detail export (9/22/26)', () => {
  const p = HAS_REAL ? parseFixture() : (null as unknown as CmrApParsed)

  it('keeps every typed line, by doc type', () => {
    expect(p.docTypeCounts).toEqual({ Bill: 116, Credit: 25, 'General Journal': 5, 'Bill Pmt -Check': 1 })
    expect(p.lineCount).toBe(147)
    expect(p.lines).toHaveLength(147)
    expect(p.payableLineCount).toBe(141)
  })

  it('reads the report TOTAL and reconciles to it', () => {
    expect(p.reportTotalCents).toBe(176_038_56)
    expect(p.importedTotalCents).toBe(176_038_56)
    expect(p.reconciled).toBe(true)
  })

  it('payable total = Bills + Credits only = $107,577.75', () => {
    expect(p.payableTotalCents).toBe(107_577_75)
    expect(p.lines.filter((l) => l.payable).reduce((s, l) => s + l.openBalanceCents, 0)).toBe(107_577_75)
    // … and the non-payable lines make up exactly the difference
    expect(p.lines.filter((l) => !l.payable).reduce((s, l) => s + l.openBalanceCents, 0)).toBe(176_038_56 - 107_577_75)
  })

  it('marks ONLY Bill and Credit payable', () => {
    for (const l of p.lines) expect(l.payable).toBe(l.docType === 'Bill' || l.docType === 'Credit')
    const nonPayable = p.lines.filter((l) => !l.payable)
    expect(nonPayable.map((l) => l.docType).sort()).toEqual([
      'Bill Pmt -Check', 'General Journal', 'General Journal', 'General Journal', 'General Journal', 'General Journal',
    ])
    expect(nonPayable.some((l) => l.vendorName === 'AP ADJUSTMENT ACCOUNT')).toBe(true)
  })

  it('counts vendors: 35 names in all, 33 with something payable', () => {
    expect(p.vendorCount).toBe(35)
    expect(p.payableVendorCount).toBe(33)
    // vendor names are the exact QuickBooks names (internal double space kept, ends trimmed)
    expect(p.lines.some((l) => l.vendorName === 'OMEGA  ACCOUNTING SOLUTIONS')).toBe(true)
  })

  it('reads the first line field by field, with the aging bucket from its group header', () => {
    expect(p.lines[0]).toEqual({
      vendorName: 'EQUIPMENT SHARE',
      invoiceNum: 'MAE-7486573-0000',
      docType: 'Bill',
      billDate: '2026-08-31',
      dueDate: '2026-09-30',
      agingDays: null,
      agingBucket: 'Current',
      openBalanceCents: 1134_31,
      payable: true,
    })
  })

  it('credits are negative, with no due date or aging', () => {
    const credits = p.lines.filter((l) => l.docType === 'Credit')
    expect(credits).toHaveLength(25)
    for (const c of credits) {
      expect(c.openBalanceCents).toBeLessThan(0)
      expect(c.dueDate).toBeNull()
      expect(c.agingDays).toBeNull()
    }
    expect(credits[0]).toMatchObject({ vendorName: 'GRIMCO INC.( VERICORE, LLC)', invoiceNum: 'LOG.- CM', openBalanceCents: -525_00, agingBucket: '1 - 30' })
  })

  it('tracks every aging bucket, and each bucket subtotal matches the report', () => {
    const byBucket = new Map<string, number>()
    for (const l of p.lines) byBucket.set(l.agingBucket ?? '?', (byBucket.get(l.agingBucket ?? '?') ?? 0) + l.openBalanceCents)
    // the report's own "Total <bucket>" rows
    expect(Object.fromEntries(byBucket)).toEqual({
      Current: 1662_95,
      '1 - 30': 1137_00,
      '31 - 60': 2961_40,
      '61 - 90': 18_316_00,
      '> 90': 151_961_21,
    })
    expect([...byBucket.values()].reduce((a, b) => a + b, 0)).toBe(176_038_56)
    expect(p.lines.every((l) => l.agingBucket !== null)).toBe(true)
  })

  it('reads aging days when present', () => {
    const paysafe = p.lines.find((l) => l.invoiceNum === 'AUGUST 2026')
    expect(paysafe).toMatchObject({ vendorName: 'PAYSAFE GROUP', agingDays: 11, dueDate: '2026-09-11', openBalanceCents: 2211_02 })
  })

  it('keeps the journal and bill-payment lines for reconciliation, non-payable', () => {
    expect(p.lines.find((l) => l.docType === 'Bill Pmt -Check')).toMatchObject({
      vendorName: 'M & R MARKET', invoiceNum: '10404', billDate: '2026-03-16', openBalanceCents: -35_00, payable: false,
    })
    expect(p.lines.filter((l) => l.vendorName === 'AP ADJUSTMENT ACCOUNT').map((l) => l.openBalanceCents).sort((a, b) => a - b))
      .toEqual([-279_377_75, 279_377_75])
  })
})

describe('edge cases (synthetic sheets)', () => {
  const sheet = (rows: unknown[][]) => parseCmrApRows(rows)

  it('blank due date and blank aging become null; a credit stays negative', () => {
    const r = sheet([
      HEADER,
      label('Current'),
      line('Bill', 46265, 'A-1', 'ACME', '', '', 100.1),
      line('Credit', '9/1/2026', 'CM-1', 'ACME', '', '', -40.05),
      label('Total Current', 60.05),
      label('TOTAL', 60.05),
    ])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.lines).toEqual([
      { vendorName: 'ACME', invoiceNum: 'A-1', docType: 'Bill', billDate: '2026-08-31', dueDate: null, agingDays: null, agingBucket: 'Current', openBalanceCents: 100_10, payable: true },
      { vendorName: 'ACME', invoiceNum: 'CM-1', docType: 'Credit', billDate: '2026-09-01', dueDate: null, agingDays: null, agingBucket: 'Current', openBalanceCents: -40_05, payable: true },
    ])
    expect(r.value.payableTotalCents).toBe(60_05)
    expect(r.value.reconciled).toBe(true)
  })

  it('detects a mismatch between the lines and the TOTAL row', () => {
    const r = sheet([HEADER, label('Current'), line('Bill', 46265, '1', 'A', '', '', 10), label('TOTAL', 11)])
    expect(r.ok && r.value.reconciled).toBe(false)
    if (r.ok) {
      expect(r.value.importedTotalCents).toBe(10_00)
      expect(r.value.reportTotalCents).toBe(11_00)
    }
  })

  it('money rounds to the nearest cent, half away from zero, and parses money text', () => {
    expect(cmrApCents(1134.31)).toBe(113431)
    expect(cmrApCents(0.1 + 0.2)).toBe(30)
    expect(cmrApCents(-525)).toBe(-52500)
    expect(cmrApCents(1.005)).toBe(101)
    expect(cmrApCents(-1.005)).toBe(-101)
    expect(cmrApCents(-0.001)).toBe(0)
    expect(Object.is(cmrApCents(-0.001), -0)).toBe(false)
    expect(cmrApCents('1,134.31')).toBe(113431)
    expect(cmrApCents('$2,000')).toBe(200000)
    expect(cmrApCents('(525.00)')).toBe(-52500)
    expect(cmrApCents('-35')).toBe(-3500)
    expect(cmrApCents('')).toBeNull()
    expect(cmrApCents('abc')).toBeNull()
    expect(cmrApCents(null)).toBeNull()
  })

  it('dates: Excel serial, Date, M/D/YYYY and ISO all give the same day; junk is null', () => {
    expect(cmrApDay(46265)).toBe('2026-08-31')
    expect(cmrApDay(new Date(Date.UTC(2026, 7, 31)))).toBe('2026-08-31')
    expect(cmrApDay('8/31/2026')).toBe('2026-08-31')
    expect(cmrApDay('2026-08-31')).toBe('2026-08-31')
    expect(cmrApDay('2/30/2026')).toBeNull()
    expect(cmrApDay('')).toBeNull()
    expect(cmrApDay('soon')).toBeNull()
  })

  it('a blank Name is stored as a placeholder; a numeric Num becomes text', () => {
    const r = sheet([HEADER, line('General Journal', 45000, 10404, '', '', '', 5), label('TOTAL', 5)])
    expect(r.ok && r.value.lines[0]).toMatchObject({ vendorName: CMR_AP_NO_NAME, invoiceNum: '10404', payable: false, agingBucket: null })
  })

  it('an unknown doc type is imported (so it still reconciles) but never payable', () => {
    const r = sheet([HEADER, label('> 90'), line('Check', 45000, '1', 'X', '', '', -3), line('Bill', 45000, '2', 'X', '', 120, 3), label('TOTAL', 0)])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.lines.map((l) => [l.docType, l.payable, l.agingBucket])).toEqual([['Check', false, '> 90'], ['Bill', true, '> 90']])
    expect(r.value.reconciled).toBe(true)
    expect(r.value.payableTotalCents).toBe(3_00)
  })

  it('an empty AP report (header + TOTAL 0) is valid', () => {
    const r = sheet([HEADER, label('TOTAL', 0)])
    expect(r.ok && r.value).toMatchObject({ lineCount: 0, reportTotalCents: 0, reconciled: true, vendorCount: 0 })
  })

  it('refuses a file that is not an A/P Aging Detail report', () => {
    // an A/R aging export has the same shape but "Open Balance" in a different column set
    expect(sheet([['Customer', 'Invoice', 'Amount'], ['A', '1', 10]])).toMatchObject({ ok: false, code: 'NOT_AP_AGING' })
    expect(sheet([])).toMatchObject({ ok: false, code: 'NOT_AP_AGING' })
    const shifted = HEADER.slice(1)
    expect(sheet([shifted, label('TOTAL', 0)])).toMatchObject({ ok: false, code: 'NOT_AP_AGING' })
  })

  it('refuses a report with no TOTAL row (it cannot be reconciled)', () => {
    expect(sheet([HEADER, label('Current'), line('Bill', 45000, '1', 'A', '', '', 1)])).toMatchObject({ ok: false, code: 'NO_TOTAL' })
  })

  it('refuses a detail line with no amount', () => {
    expect(sheet([HEADER, line('Bill', 45000, '1', 'A', '', '', ''), label('TOTAL', 0)])).toMatchObject({ ok: false, code: 'BAD_ROW' })
  })

  it('stops at TOTAL and ignores bucket subtotals and repeated headers', () => {
    const r = sheet([
      HEADER,
      label('1 - 30'),
      line('Bill', 45000, '1', 'A', '', 5, 1),
      HEADER,
      label('Total 1 - 30', 1),
      label('TOTAL', 1),
      line('Bill', 45000, '2', 'B', '', 5, 999),
    ])
    expect(r.ok && r.value.lineCount).toBe(1)
  })

  it('refuses bytes that are not a workbook, and a workbook without the report', () => {
    expect(parseCmrApWorkbook(new TextEncoder().encode('%PDF-1.7 not a sheet'))).toMatchObject({ ok: false })
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Customer', 'Amount'], ['X', 1]]), 'AR')
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
    expect(parseCmrApWorkbook(buf)).toMatchObject({ ok: false, code: 'NOT_AP_AGING' })
  })

  it('finds the report on a later sheet (a notes tab in front)', () => {
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['QuickBooks Desktop Export Tips']]), 'Tips')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([HEADER, label('Current'), line('Bill', 46265, 'Z', 'ZED', 46295, '', 12.5), label('TOTAL', 12.5)]), 'Sheet1')
    const r = parseCmrApWorkbook(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer)
    expect(r.ok && r.value.lines[0]).toMatchObject({ vendorName: 'ZED', dueDate: '2026-09-30', openBalanceCents: 12_50 })
  })
})
