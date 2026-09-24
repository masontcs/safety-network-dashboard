import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as XLSX from 'xlsx'
import { parseWhApFile, isWhApPayableType, deriveApAsOf } from './ap-import'
import { parseWhArFile } from './ar-import'

/**
 * Western Highways A/P parser — pinned to the real QuickBooks Online export.
 *
 * The sample file lives untracked in the repo root (like the STS CMR fixture), so these tests
 * skip rather than fail on a checkout that doesn't have it.
 */

const FIXTURE = join(
  process.cwd(),
  'Western Highways Traffic Truck Products_A_P Aging Detail Report.xlsx',
)
const AR_FIXTURE = join(
  process.cwd(),
  'Western Highways Traffic Truck Products_A_R Aging Detail Report.csv',
)

const hasFixture = existsSync(FIXTURE)
const describeFixture = hasFixture ? describe : describe.skip

/** Re-encode the .xlsx fixture as a real .csv, so "accepts both formats" is tested for real. */
function asCsv(xlsx: Buffer): Buffer {
  const wb = XLSX.read(xlsx, { type: 'buffer', raw: true })
  const ws = wb.Sheets[wb.SheetNames[0]]
  return Buffer.from(XLSX.utils.sheet_to_csv(ws), 'utf8')
}

describeFixture('parseWhApFile — the real WH A/P Aging Detail export', () => {
  const buffer = hasFixture ? readFileSync(FIXTURE) : Buffer.alloc(0)

  it('parses 684 lines: 666 Bill, 5 Vendor Credit, 12 Journal Entry, 1 Bill Payment (Check)', () => {
    const result = parseWhApFile(buffer)
    expect(result.success).toBe(true)
    if (!result.success) return

    expect(result.data.lines).toHaveLength(684)
    expect(result.data.typeCounts).toEqual({
      'Bill': 666,
      'Vendor Credit': 5,
      'Journal Entry': 12,
      'Bill Payment (Check)': 1,
    })
  })

  it('sums ALL open balances to $1,243,855.07 and reconciles to the report TOTAL', () => {
    const result = parseWhApFile(buffer)
    expect(result.success).toBe(true)
    if (!result.success) return

    expect(result.data.sumOpenCents).toBe(124385507)
    expect(result.data.reportTotalCents).toBe(124385507)
    expect(result.data.reconciled).toBe(true)
  })

  it('sums the payable (Bill + Vendor Credit) lines to $1,224,952.99', () => {
    const result = parseWhApFile(buffer)
    expect(result.success).toBe(true)
    if (!result.success) return

    const payable = result.data.lines.filter((l) => l.payable)
    expect(payable).toHaveLength(671)
    expect(result.data.payableTotalCents).toBe(122495299)

    // Journal Entries and the Bill Payment are kept so the file reconciles, but never payable.
    const nonPayable = result.data.lines.filter((l) => !l.payable)
    expect(nonPayable).toHaveLength(13)
    expect(new Set(nonPayable.map((l) => l.txnType))).toEqual(
      new Set(['Journal Entry', 'Bill Payment (Check)']),
    )
  })

  it('keeps open balances signed', () => {
    const result = parseWhApFile(buffer)
    expect(result.success).toBe(true)
    if (!result.success) return

    const negatives = result.data.lines.filter((l) => l.openBalanceCents < 0)
    expect(negatives.length).toBeGreaterThan(0)
    // The reversing pair of Journal Entries nets to zero.
    expect(result.data.lines.some((l) => l.openBalanceCents === -12972953)).toBe(true)
    expect(result.data.lines.some((l) => l.openBalanceCents === 12972953)).toBe(true)
  })

  it('derives the as-of date from due date + past due days, with every past-due line agreeing', () => {
    const result = parseWhApFile(buffer)
    expect(result.success).toBe(true)
    if (!result.success) return

    // This export carries no title block at all, so there is no "As of" line to read.
    expect(result.data.reportAsOfSource).toBe('derived')
    expect(result.data.reportAsOf).toBe('2026-09-24')
    expect(result.data.reportAsOfEvidence).toBe(655)
  })

  it('splits the five aging buckets', () => {
    const result = parseWhApFile(buffer)
    expect(result.success).toBe(true)
    if (!result.success) return

    const byBucket: Record<string, number> = {}
    for (const l of result.data.lines) {
      byBucket[l.agingBucket!] = (byBucket[l.agingBucket!] ?? 0) + l.openBalanceCents
    }
    expect(byBucket).toEqual({
      'Current': 1811842,
      '1-30':    7510361,
      '31-60':   3099095,
      '61-90':   6591417,
      '>90':   105372792,
    })
    expect(Object.values(byBucket).reduce((a, b) => a + b, 0)).toBe(124385507)
  })

  it('reads the extra "Past due" column, negatives included', () => {
    const result = parseWhApFile(buffer)
    expect(result.success).toBe(true)
    if (!result.success) return

    expect(result.data.lines.some((l) => (l.pastDueDays ?? 0) < 0)).toBe(true)
    expect(result.data.lines.some((l) => (l.pastDueDays ?? 0) > 1000)).toBe(true)
    // A not-yet-due bill sits in a current/near bucket with a negative past-due.
    const notDue = result.data.lines.filter((l) => (l.pastDueDays ?? 0) < 0)
    expect(notDue.every((l) => l.agingBucket === 'Current')).toBe(true)
  })

  it('flags the Safety Network vendors as intercompany', () => {
    const result = parseWhApFile(buffer)
    expect(result.success).toBe(true)
    if (!result.success) return

    const inter = result.data.lines.filter((l) => l.isIntercompany)
    expect(inter).toHaveLength(51)
    expect(inter.every((l) => /safety network/i.test(l.vendorName))).toBe(true)
    expect(result.data.lines.some((l) => l.vendorName === 'LINDE' && !l.isIntercompany)).toBe(true)
  })

  it('pulls the embedded VDR code out of the vendor name', () => {
    const result = parseWhApFile(buffer)
    expect(result.success).toBe(true)
    if (!result.success) return

    const coded = result.data.lines.find((l) => l.vendorName === 'AMAZON VDR-0087')
    expect(coded?.vendorCode).toBe('VDR-0087')

    const uncoded = result.data.lines.find((l) => l.vendorName === 'LINDE')
    expect(uncoded).toBeDefined()
    expect(uncoded?.vendorCode).toBeNull()
  })

  it('parses the same file re-encoded as .csv to identical numbers', () => {
    const fromXlsx = parseWhApFile(buffer)
    const fromCsv = parseWhApFile(asCsv(buffer))
    expect(fromXlsx.success).toBe(true)
    expect(fromCsv.success).toBe(true)
    if (!fromXlsx.success || !fromCsv.success) return

    expect(fromCsv.data.lines).toHaveLength(684)
    expect(fromCsv.data.sumOpenCents).toBe(124385507)
    expect(fromCsv.data.reportTotalCents).toBe(124385507)
    expect(fromCsv.data.reconciled).toBe(true)
    expect(fromCsv.data.payableTotalCents).toBe(122495299)
    expect(fromCsv.data.typeCounts).toEqual(fromXlsx.data.typeCounts)
    expect(fromCsv.data.reportAsOf).toBe('2026-09-24')
  })

  it('refuses the A/R report — it has no "Past due" column', () => {
    if (!existsSync(AR_FIXTURE)) return
    const result = parseWhApFile(readFileSync(AR_FIXTURE))
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error).toMatch(/A\/R/)
  })
})

describe('deriveApAsOf', () => {
  it('returns the agreed date and how many lines agreed', () => {
    expect(deriveApAsOf([
      { dueDate: '2026-09-01', pastDueDays: 23 },
      { dueDate: '2026-08-24', pastDueDays: 31 },
    ])).toEqual({ date: '2026-09-24', agreeing: 2 })
  })

  it('ignores lines that are not past due — they carry no information about the as-of day', () => {
    expect(deriveApAsOf([
      { dueDate: '2026-10-17', pastDueDays: -23 },
      { dueDate: '2026-09-24', pastDueDays: 0 },
      { dueDate: '2026-09-01', pastDueDays: 23 },
    ])).toEqual({ date: '2026-09-24', agreeing: 1 })
  })

  it('refuses to guess when the lines disagree', () => {
    expect(deriveApAsOf([
      { dueDate: '2026-09-01', pastDueDays: 23 },
      { dueDate: '2026-09-01', pastDueDays: 24 },
    ])).toEqual({ date: null, agreeing: 0 })
  })

  it('returns null when there is nothing past due', () => {
    expect(deriveApAsOf([{ dueDate: '2026-10-17', pastDueDays: -23 }])).toEqual({ date: null, agreeing: 0 })
    expect(deriveApAsOf([])).toEqual({ date: null, agreeing: 0 })
  })
})

describe('parseWhApFile — refusals that need no fixture', () => {
  it('refuses a file with no "Transaction type" header', () => {
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['nope']]), 'Sheet1')
    const buf = Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as ArrayBuffer)

    const result = parseWhApFile(buf)
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error).toMatch(/Transaction type/)
  })

  it('classifies transaction types case-insensitively', () => {
    expect(isWhApPayableType('Bill')).toBe(true)
    expect(isWhApPayableType('vendor credit')).toBe(true)
    expect(isWhApPayableType('Journal Entry')).toBe(false)
    expect(isWhApPayableType('Bill Payment (Check)')).toBe(false)
  })

  it('does not accept the A/R layout', () => {
    const rows = [
      ['Western Highways Traffic Truck Products', '', '', '', '', '', '', '', ''],
      ['A/R Aging Detail Report', '', '', '', '', '', '', '', ''],
      ['As of Sep 23, 2026', '', '', '', '', '', '', '', ''],
      ['', '', '', '', '', '', '', '', ''],
      ['', 'Date', 'Transaction type', 'Num', 'Customer full name', 'Location full name', 'Due date', 'Amount', 'Open balance'],
      ['CURRENT', '', '', '', '', '', '', '', ''],
      ['', '09/01/2026', 'Invoice', '1', 'ACME', 'WH', '10/01/2026', '100.00', '100.00'],
      ['TOTAL', '', '', '', '', '', '', '$100.00', '$100.00'],
    ]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Sheet1')
    const buf = Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as ArrayBuffer)

    expect(parseWhApFile(buf).success).toBe(false)
    expect(parseWhArFile(buf).success).toBe(true)
  })
})
