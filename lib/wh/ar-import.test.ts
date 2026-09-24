import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as XLSX from 'xlsx'
import { parseWhArFile, isWhArReceivableType } from './ar-import'
import { parseWhApFile } from './ap-import'

/**
 * Western Highways A/R parser — pinned to the real QuickBooks Online export.
 *
 * The sample file lives untracked in the repo root (like the STS CMR fixture), so these tests
 * skip rather than fail on a checkout that doesn't have it. The acceptance numbers come from
 * the brief and are asserted exactly — an off-by-one column or a float rounded the wrong way
 * moves them, which is the whole point.
 */

const FIXTURE = join(
  process.cwd(),
  'Western Highways Traffic Truck Products_A_R Aging Detail Report.csv',
)
const AP_FIXTURE = join(
  process.cwd(),
  'Western Highways Traffic Truck Products_A_P Aging Detail Report.xlsx',
)

const hasFixture = existsSync(FIXTURE)
const describeFixture = hasFixture ? describe : describe.skip

/** Re-encode the CSV fixture as a real .xlsx, so "accepts both formats" is tested for real. */
function asXlsx(csv: Buffer): Buffer {
  const wb = XLSX.read(csv, { type: 'buffer', raw: true })
  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as ArrayBuffer)
}

describeFixture('parseWhArFile — the real WH A/R Aging Detail export', () => {
  const buffer = hasFixture ? readFileSync(FIXTURE) : Buffer.alloc(0)

  it('parses 213 lines: 211 Invoice, 1 Credit Memo, 1 Check', () => {
    const result = parseWhArFile(buffer)
    expect(result.success).toBe(true)
    if (!result.success) return

    expect(result.data.lines).toHaveLength(213)
    expect(result.data.typeCounts).toEqual({ Invoice: 211, 'Credit Memo': 1, Check: 1 })
  })

  it('sums open balances to $678,768.26 and reconciles to the report TOTAL', () => {
    const result = parseWhArFile(buffer)
    expect(result.success).toBe(true)
    if (!result.success) return

    expect(result.data.sumOpenCents).toBe(67876826)
    expect(result.data.reportTotalCents).toBe(67876826)
    expect(result.data.reconciled).toBe(true)
  })

  it('reads the "As of" date out of the title block', () => {
    const result = parseWhArFile(buffer)
    expect(result.success).toBe(true)
    if (!result.success) return

    expect(result.data.reportAsOf).toBe('2026-09-23')
  })

  it('ignores the trailing generated-at timestamp line instead of treating it as a section', () => {
    const result = parseWhArFile(buffer)
    expect(result.success).toBe(true)
    if (!result.success) return

    // Every line landed in one of the five real buckets — nothing fell under a phantom
    // section opened by the "Wednesday, September 23, 2026 04:09 PM GMT-07:00" line, and no
    // line was created FROM that line.
    const buckets = new Set(result.data.lines.map((l) => l.agingBucket))
    expect([...buckets].sort()).toEqual(['>90', '1-30', '31-60', '61-90', 'Current'].sort())
    expect(result.data.lines.every((l) => l.agingBucket !== null)).toBe(true)
  })

  it('splits the five aging buckets', () => {
    const result = parseWhArFile(buffer)
    expect(result.success).toBe(true)
    if (!result.success) return

    const byBucket: Record<string, number> = {}
    for (const l of result.data.lines) {
      byBucket[l.agingBucket!] = (byBucket[l.agingBucket!] ?? 0) + l.openBalanceCents
    }
    expect(byBucket).toEqual({
      'Current': 11948792,
      '1-30':    -239824,
      '31-60':   24731045,
      '61-90':     916869,
      '>90':     30519944,
    })
    // The buckets are the total.
    expect(Object.values(byBucket).reduce((a, b) => a + b, 0)).toBe(67876826)
  })

  it('marks Invoice and Credit Memo receivable, and the Check not', () => {
    const result = parseWhArFile(buffer)
    expect(result.success).toBe(true)
    if (!result.success) return

    const receivable = result.data.lines.filter((l) => l.receivable)
    expect(receivable).toHaveLength(212)
    expect(receivable.every((l) => l.txnType === 'Invoice' || l.txnType === 'Credit Memo')).toBe(true)
    expect(result.data.lines.filter((l) => !l.receivable).map((l) => l.txnType)).toEqual(['Check'])
    expect(result.data.receivableTotalCents).toBe(67376826)
  })

  it('flags the Safety Network counterparties as intercompany', () => {
    const result = parseWhArFile(buffer)
    expect(result.success).toBe(true)
    if (!result.success) return

    const inter = result.data.lines.filter((l) => l.isIntercompany)
    expect(inter).toHaveLength(182)
    expect(inter.every((l) => /safety network/i.test(l.customerName))).toBe(true)
    // …and an outside customer is not swept in.
    expect(result.data.lines.some((l) => l.customerName.startsWith('Centerline Striping') && !l.isIntercompany)).toBe(true)
  })

  it('pulls the embedded CTM code out of the customer name', () => {
    const result = parseWhArFile(buffer)
    expect(result.success).toBe(true)
    if (!result.success) return

    const coded = result.data.lines.find((l) => l.customerName === 'Safety Network Holdings CTM-0000016')
    expect(coded?.customerCode).toBe('CTM-0000016')

    const uncoded = result.data.lines.find((l) => l.customerName === 'Western Traffic Control')
    expect(uncoded).toBeDefined()
    expect(uncoded?.customerCode).toBeNull()
  })

  it('reads dates and locations off the detail lines', () => {
    const result = parseWhArFile(buffer)
    expect(result.success).toBe(true)
    if (!result.success) return

    const first = result.data.lines[0]
    expect(first.txnDate).toBe('2023-04-25')
    expect(first.dueDate).toBe('2023-05-25')
    expect(first.num).toBe('INV-00000085.')
    expect(first.location).toBe('Western Highways')
    expect(first.openBalanceCents).toBe(436614)

    expect(new Set(result.data.lines.map((l) => l.location))).toEqual(
      new Set(['Western Highways', 'Western Highways Service Center', null]),
    )
  })

  it('parses the same file re-encoded as .xlsx to identical numbers', () => {
    const fromCsv = parseWhArFile(buffer)
    const fromXlsx = parseWhArFile(asXlsx(buffer))
    expect(fromCsv.success).toBe(true)
    expect(fromXlsx.success).toBe(true)
    if (!fromCsv.success || !fromXlsx.success) return

    expect(fromXlsx.data.lines).toHaveLength(213)
    expect(fromXlsx.data.sumOpenCents).toBe(fromCsv.data.sumOpenCents)
    expect(fromXlsx.data.reportTotalCents).toBe(fromCsv.data.reportTotalCents)
    expect(fromXlsx.data.reconciled).toBe(true)
    expect(fromXlsx.data.typeCounts).toEqual(fromCsv.data.typeCounts)
    expect(fromXlsx.data.receivableTotalCents).toBe(fromCsv.data.receivableTotalCents)
  })

  it('refuses the A/P report — its columns sit one place further right', () => {
    if (!existsSync(AP_FIXTURE)) return
    const result = parseWhArFile(readFileSync(AP_FIXTURE))
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error).toMatch(/A\/P/)
  })
})

describe('parseWhArFile — refusals that need no fixture', () => {
  it('refuses a file with no "Transaction type" header', () => {
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['hello', 'world'], [1, 2]]), 'Sheet1')
    const buf = Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as ArrayBuffer)

    const result = parseWhArFile(buf)
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error).toMatch(/Transaction type/)
  })

  it('refuses an empty file', () => {
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[]]), 'Sheet1')
    const buf = Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as ArrayBuffer)
    expect(parseWhArFile(buf).success).toBe(false)
  })

  it('classifies transaction types case-insensitively', () => {
    expect(isWhArReceivableType('Invoice')).toBe(true)
    expect(isWhArReceivableType('credit memo')).toBe(true)
    expect(isWhArReceivableType('Check')).toBe(false)
    expect(isWhArReceivableType('Bill')).toBe(false)
  })

  it('does not accept the A/P layout even when both parsers see the same header keyword', () => {
    const rows = [
      ['', 'Date', 'Transaction type', 'Num', 'Vendor display name', 'Location full name', 'Due date', 'Past due', 'Amount', 'Open balance'],
      ['CURRENT', '', '', '', '', '', '', '', '', ''],
      ['', '09/01/2026', 'Bill', '1', 'ACME', 'WH', '10/01/2026', 5, 100, 100],
      ['TOTAL', '', '', '', '', '', '', '', 100, 100],
    ]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Sheet1')
    const buf = Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as ArrayBuffer)

    expect(parseWhArFile(buf).success).toBe(false)
    expect(parseWhApFile(buf).success).toBe(true)
  })
})
