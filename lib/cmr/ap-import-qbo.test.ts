import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import * as XLSX from 'xlsx'
import {
  CMR_AP_NO_NAME,
  parseCmrApWorkbook,
  type CmrApParsed,
} from './ap-import'
import { cmrApQboBucket, cmrApQboDocType, isCmrApQboSheet, parseCmrApQboRows } from './ap-import-qbo'

/**
 * The QuickBooks **Online** A/P Aging Detail parser — WHWY's format — and the auto-detection
 * that routes a file to it or to the Desktop parser.
 *
 * Pinned to the REAL export Mason supplied (`Western Highways Traffic Truck Products_A_P Aging
 * Detail Report.xlsx`, in the repo root, as re-exported 2026-09-25).
 *
 * Counted independently of this parser (openpyxl) from the same file:
 *   667 Bill · 5 Vendor Credit · 12 Journal Entry · 1 Bill Payment (Check) = 685 lines
 *   report TOTAL $1,244,845.54 = Σ all 685 lines  → reconciled
 *   payable (Bill + Vendor Credit) $1,225,943.46 across 672 lines
 *
 * NOTE ON THE PHASE PROMPT'S NUMBERS. The prompt specified 684 lines / 666 Bill /
 * $1,243,855.07 / $1,224,952.99 payable, which is the 2026-09-24 export — the same one
 * `lib/wh/ap-import.ts` is pinned to. The file now in the repo root is a 2026-09-25 re-export
 * containing exactly one additional bill (Valley Iron Inc, num 2643067, 09/23/2026, $990.47,
 * CURRENT). That single bill accounts for the whole difference in all three figures:
 *   685 − 684 = 1 line · $1,244,845.54 − $1,243,855.07 = $990.47 · payable likewise $990.47.
 * Every other count the prompt gave (5 credits, 12 journal entries, 1 bill payment) matches
 * exactly, and the file reconciles against its own TOTAL, so the parser agrees with the prompt;
 * only the export moved. The exact-number tests are pinned to the file that is actually here,
 * and `the one bill that moved the totals` below states the relationship explicitly.
 */

const FIXTURE = path.join(process.cwd(), 'Western Highways Traffic Truck Products_A_P Aging Detail Report.xlsx')
const HAS_REAL = existsSync(FIXTURE)

/** The Desktop fixture, so auto-detection can be shown choosing between the two for real files. */
const DESKTOP_FIXTURE = path.join(process.cwd(), 'STS AP 92226.xlsx')
const HAS_DESKTOP = existsSync(DESKTOP_FIXTURE)

function parse(bytes: Uint8Array): CmrApParsed {
  const r = parseCmrApWorkbook(bytes)
  if (!r.ok) throw new Error(`${r.code}: ${r.error}`)
  return r.value
}

const parseFixture = (): CmrApParsed => parse(readFileSync(FIXTURE))

/** The same report as QuickBooks Online's other export choice: .csv instead of .xlsx. */
function fixtureAsCsv(): Uint8Array {
  const wb = XLSX.read(readFileSync(FIXTURE), { type: 'buffer' })
  const first = wb.SheetNames[0]
  return new TextEncoder().encode(XLSX.utils.sheet_to_csv(wb.Sheets[first]))
}

// ── the real WHWY export ────────────────────────────────────────────────────

describe.runIf(HAS_REAL)('the real WHWY QBO A/P Aging Detail export (9/25/26)', () => {
  const p = HAS_REAL ? parseFixture() : (null as unknown as CmrApParsed)

  it('normalizes every QBO transaction type to a CMR doc type', () => {
    expect(p.docTypeCounts).toEqual({ Bill: 667, Credit: 5, 'General Journal': 12, 'Bill Pmt -Check': 1 })
    expect(p.lineCount).toBe(685)
    expect(p.lines).toHaveLength(685)
    // No raw QBO label survives normalization — that is what keeps the DB's payable rule valid.
    for (const raw of ['Vendor Credit', 'Journal Entry', 'Bill Payment (Check)']) {
      expect(p.docTypeCounts[raw]).toBeUndefined()
    }
  })

  it('reads the report TOTAL and reconciles to it', () => {
    expect(p.reportTotalCents).toBe(1_244_845_54)
    expect(p.importedTotalCents).toBe(1_244_845_54)
    expect(p.reconciled).toBe(true)
    // Σ computed here, independently of the parser's own running total.
    expect(p.lines.reduce((s, l) => s + l.openBalanceCents, 0)).toBe(1_244_845_54)
  })

  it('counts the payable (Bill + Credit) money', () => {
    expect(p.payableLineCount).toBe(672)
    expect(p.payableTotalCents).toBe(1_225_943_46)
    expect(p.payableLineCount).toBe(p.docTypeCounts.Bill + p.docTypeCounts.Credit)
  })

  it('holds the server-side payable rule on EVERY line', () => {
    // `payable = doc_type in ('Bill','Credit')` is derived in the database and held by a check
    // constraint. If normalization ever let another label through, this is what would catch it.
    for (const l of p.lines) {
      expect(l.payable).toBe(l.docType === 'Bill' || l.docType === 'Credit')
    }
  })

  it('uses the Desktop parser\'s own bucket labels', () => {
    const counts: Record<string, number> = {}
    for (const l of p.lines) counts[String(l.agingBucket)] = (counts[String(l.agingBucket)] ?? 0) + 1
    expect(counts).toEqual({ Current: 24, '1 - 30': 38, '31 - 60': 18, '61 - 90': 17, '> 90': 588 })
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(685)
    // Every line landed in a bucket — none leaked in above the first group header.
    expect(p.lines.every((l) => l.agingBucket !== null)).toBe(true)
  })

  it('keeps the full QBO vendor display name, embedded VDR- code and all', () => {
    expect(p.lines.filter((l) => /\bVDR-\d+$/.test(l.vendorName))).toHaveLength(173)
    expect(p.lines.some((l) => l.vendorName === 'VER-MAC VDR-0179')).toBe(true)
    // …and never falls back to the no-name placeholder on this file.
    expect(p.lines.some((l) => l.vendorName === CMR_AP_NO_NAME)).toBe(false)
    expect(p.vendorCount).toBe(63)
    expect(p.payableVendorCount).toBe(61)
  })

  it('maps Num, Date, Due date and Past due onto the CMR fields', () => {
    const bill = p.lines.find((l) => l.invoiceNum === '2643067')
    expect(bill).toMatchObject({
      vendorName: 'Valley Iron Inc',
      docType: 'Bill',
      billDate: '2026-09-23',
      dueDate: '2026-10-23',
      agingDays: -28, // QBO writes a negative "Past due" for a bill that is not due yet
      agingBucket: 'Current',
      openBalanceCents: 990_47,
      payable: true,
    })
    // The signed open balance survives: vendor credits and reversing entries stay negative.
    const credits = p.lines.filter((l) => l.docType === 'Credit')
    expect(credits.every((l) => l.openBalanceCents < 0)).toBe(true)
    expect(p.lines.filter((l) => l.openBalanceCents < 0).length).toBeGreaterThan(5)
    // A blank Due date / Past due becomes null rather than 0.
    expect(p.lines.filter((l) => l.dueDate === null)).toHaveLength(5)
    expect(p.lines.filter((l) => l.agingDays === null)).toHaveLength(5)
    expect(p.lines.filter((l) => l.invoiceNum === null)).toHaveLength(31)
  })

  it('the one bill that moved the totals since the 9/24 export', () => {
    // See the note at the top of this file: the phase prompt's 684 / $1,243,855.07 /
    // $1,224,952.99 describe the 9/24 export, and this single bill is the entire difference.
    const added = p.lines.filter((l) => l.invoiceNum === '2643067')
    expect(added).toHaveLength(1)
    expect(p.lineCount - 1).toBe(684)
    expect(p.reportTotalCents - added[0].openBalanceCents).toBe(1_243_855_07)
    expect(p.payableTotalCents - added[0].openBalanceCents).toBe(1_224_952_99)
    expect(p.docTypeCounts.Bill - 1).toBe(666)
  })

  it('parses byte-for-byte the same from the .csv export of the same report', () => {
    const csv = parse(fixtureAsCsv())
    // Money arrives as "-129,729.53" strings in CSV and as native floats in XLSX; the result
    // must not be able to tell.
    expect(csv.lineCount).toBe(p.lineCount)
    expect(csv.docTypeCounts).toEqual(p.docTypeCounts)
    expect(csv.reportTotalCents).toBe(p.reportTotalCents)
    expect(csv.importedTotalCents).toBe(p.importedTotalCents)
    expect(csv.payableTotalCents).toBe(p.payableTotalCents)
    expect(csv.payableLineCount).toBe(p.payableLineCount)
    expect(csv.vendorCount).toBe(p.vendorCount)
    expect(csv.reconciled).toBe(true)
    expect(csv.lines).toEqual(p.lines)
  })

  it('keeps an invoice number\'s leading zeros in the .csv too', () => {
    // A CSV writes Num bare ("00085001"), and SheetJS's type inference would read that as the
    // number 85001 — silently changing the invoice number a vendor is billed under, and
    // breaking the match against the same bill in the next import. parseCmrApWorkbook reads a
    // CSV as text to prevent it; this pins that.
    const withZeros = p.lines.filter((l) => l.invoiceNum !== null && /^0\d+$/.test(l.invoiceNum))
    expect(withZeros.length).toBeGreaterThan(0)
    expect(p.lines.some((l) => l.invoiceNum === '00085001')).toBe(true)

    const csv = parse(fixtureAsCsv())
    for (const l of withZeros) {
      expect(csv.lines.some((c) => c.invoiceNum === l.invoiceNum)).toBe(true)
    }
    expect(csv.lines.some((l) => l.invoiceNum === '85001')).toBe(false)
  })
})

// ── auto-detection between the two layouts ──────────────────────────────────

describe('format auto-detection', () => {
  it.runIf(HAS_REAL && HAS_DESKTOP)('routes each real export to its own parser, same entry point', () => {
    const qbo = parse(readFileSync(FIXTURE))
    const desktop = parse(readFileSync(DESKTOP_FIXTURE))
    // The QBO file normalized…
    expect(qbo.lineCount).toBe(685)
    expect(qbo.reportTotalCents).toBe(1_244_845_54)
    // …and the Desktop file exactly as lib/cmr/ap-import.test.ts has always pinned it.
    expect(desktop.docTypeCounts).toEqual({ Bill: 116, Credit: 25, 'General Journal': 5, 'Bill Pmt -Check': 1 })
    expect(desktop.lineCount).toBe(147)
    expect(desktop.reportTotalCents).toBe(176_038_56)
    expect(desktop.payableTotalCents).toBe(107_577_75)
    expect(desktop.reconciled).toBe(true)
  })

  it('prefers the Desktop layout when a workbook somehow carries both', () => {
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(qboSheet([qboLine('Bill', '01/02/2026', 'Q', 'QV', '02/01/2026', 5, 7)], 7)), 'QBO')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([DESKTOP_HEADER, dtLabel('Current'), dtLine('Bill', 46265, 'D', 'DV', 46295, '', 12.5), dtLabel('TOTAL', 12.5)]), 'Desktop')
    const r = parse(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer as never)
    expect(r.lines).toHaveLength(1)
    expect(r.lines[0].vendorName).toBe('DV')
  })

  it('isCmrApQboSheet is true only for the A/P layout, not the QBO A/R one', () => {
    expect(isCmrApQboSheet(qboSheet([], 0))).toBe(true)
    // The QBO A/R report has "Transaction type" too, but no "Past due" — its Open balance sits
    // at column 8. Reading it as A/P would import the face Amount.
    expect(isCmrApQboSheet([AR_HEADER])).toBe(false)
    expect(isCmrApQboSheet([['Customer', 'Amount']])).toBe(false)
  })
})

// ── synthetic QBO sheets: the edge cases ────────────────────────────────────

const QBO_HEADER = [
  '', 'Date', 'Transaction type', 'Num', 'Vendor display name',
  'Location full name', 'Due date', 'Past due', 'Amount', 'Open balance',
]
/** The QBO A/R layout: no "Past due", so Open balance lands at 8. Must never parse as A/P. */
const AR_HEADER = [
  '', 'Date', 'Transaction type', 'Num', 'Customer full name',
  'Location full name', 'Due date', 'Amount', 'Open balance',
]

const qboLine = (
  type: string, date: unknown, num: unknown, vendor: unknown,
  due: unknown, pastDue: unknown, open: unknown, amount: unknown = open,
) => ['', date, type, num, vendor, '', due, pastDue, amount, open]

/** A column-A structural row: a bucket header, a subtotal, the grand TOTAL, a footer. */
const qboLabel = (colA: string, open: unknown = '') => [colA, '', '', '', '', '', '', '', open, open]

/** header + optional bucket + the given lines + a TOTAL carrying `total` dollars. */
function qboSheet(lines: unknown[][], total: unknown, bucket = 'CURRENT'): unknown[][] {
  return [QBO_HEADER, qboLabel(bucket), ...lines, qboLabel(`Total for ${bucket}`, total), qboLabel('TOTAL', total)]
}

// the Desktop shapes, for the mixed-workbook test above
const DESKTOP_HEADER = ['', '', '', 'Type', '', 'Date', '', 'Num', '', 'Name', '', 'Due Date', '', 'Aging', '', 'Open Balance']
const dtLine = (type: string, date: unknown, num: unknown, name: unknown, due: unknown, aging: unknown, bal: unknown) =>
  ['', '', '', type, '', date, '', num, '', name, '', due, '', aging, '', bal]
const dtLabel = (col0: string, bal: unknown = '') => [col0, '', '', '', '', '', '', '', '', '', '', '', '', '', '', bal]

describe('the QBO parser, on synthetic sheets', () => {
  it('maps each QBO transaction type to its CMR doc type', () => {
    expect(cmrApQboDocType('Bill')).toBe('Bill')
    expect(cmrApQboDocType('Vendor Credit')).toBe('Credit')
    expect(cmrApQboDocType('Journal Entry')).toBe('General Journal')
    expect(cmrApQboDocType('Bill Payment (Check)')).toBe('Bill Pmt -Check')
    // case- and whitespace-insensitive
    expect(cmrApQboDocType('  vendor   credit ')).toBe('Credit')
    // unknown types keep their own label
    expect(cmrApQboDocType('Bill Payment (Credit Card)')).toBe('Bill Payment (Credit Card)')
  })

  it('maps each QBO bucket header to the Desktop bucket label', () => {
    expect(cmrApQboBucket('CURRENT')).toBe('Current')
    expect(cmrApQboBucket('1 - 30 days past due')).toBe('1 - 30')
    expect(cmrApQboBucket('31 - 60 days past due')).toBe('31 - 60')
    expect(cmrApQboBucket('61 - 90 days past due')).toBe('61 - 90')
    expect(cmrApQboBucket('91 or more days past due')).toBe('> 90')
    expect(cmrApQboBucket('Total for CURRENT')).toBeNull()
    expect(cmrApQboBucket('TOTAL')).toBeNull()
  })

  it('keeps an unknown QBO type (so it still reconciles) but never payable', () => {
    const r = parseCmrApQboRows(qboSheet([
      qboLine('Bill Payment (Credit Card)', '01/05/2026', '1', 'X', '', '', -3),
      qboLine('Bill', '01/05/2026', '2', 'X', '02/04/2026', 10, 3),
    ], 0))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.lines.map((l) => [l.docType, l.payable])).toEqual([
      ['Bill Payment (Credit Card)', false],
      ['Bill', true],
    ])
    expect(r.value.reconciled).toBe(true)
    expect(r.value.payableTotalCents).toBe(3_00)
  })

  it('ignores a footer line and bucket subtotals, and stops at the grand TOTAL', () => {
    const r = parseCmrApQboRows([
      QBO_HEADER,
      qboLabel('CURRENT'),
      qboLine('Bill', '01/05/2026', '1', 'A', '02/04/2026', 5, 10),
      qboLabel('Total for CURRENT', 10),
      qboLabel('1 - 30 days past due'),
      qboLine('Bill', '01/05/2026', '2', 'B', '02/04/2026', 20, 5),
      qboLabel('Total for 1 - 30 days past due', 5),
      qboLabel('TOTAL', 15),
      // QBO appends a generated-at line after the grand total on some exports.
      qboLabel('Thursday, September 25, 2026 11:05 AM GMT-07:00'),
      qboLine('Bill', '01/05/2026', '999', 'GHOST', '02/04/2026', 1, 9999),
    ])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.lineCount).toBe(2)
    expect(r.value.lines.map((l) => [l.vendorName, l.agingBucket])).toEqual([['A', 'Current'], ['B', '1 - 30']])
    expect(r.value.reportTotalCents).toBe(15_00)
    expect(r.value.reconciled).toBe(true)
  })

  it('finds the header row under a title block', () => {
    const r = parseCmrApQboRows([
      ['Western Highways Traffic Truck Products'],
      ['A/P Aging Detail'],
      ['As of September 25, 2026'],
      [],
      ...qboSheet([qboLine('Bill', '01/05/2026', '1', 'A', '02/04/2026', 5, 10)], 10),
    ])
    expect(r.ok && r.value.lineCount).toBe(1)
    expect(r.ok && r.value.reconciled).toBe(true)
  })

  it('reads money as cents from both native floats and QBO money strings', () => {
    const r = parseCmrApQboRows(qboSheet([
      qboLine('Bill', '01/05/2026', '1', 'A', '02/04/2026', 5, 1234.56),
      qboLine('Vendor Credit', '01/05/2026', '2', 'B', '', '', '-1,234.56'),
      qboLine('Bill', '01/05/2026', '3', 'C', '02/04/2026', 5, '$2,000.00'),
      qboLine('Vendor Credit', '01/05/2026', '4', 'D', '', '', '(2,000.00)'),
    ], 0))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.lines.map((l) => l.openBalanceCents)).toEqual([123_456, -123_456, 2_000_00, -2_000_00])
    expect(r.value.importedTotalCents).toBe(0)
    expect(r.value.reconciled).toBe(true)
  })

  it('an empty QBO report (header + TOTAL 0) is valid', () => {
    const r = parseCmrApQboRows([QBO_HEADER, qboLabel('TOTAL', 0)])
    expect(r.ok && r.value).toMatchObject({ lineCount: 0, reportTotalCents: 0, reconciled: true, vendorCount: 0 })
  })

  it('a blank vendor display name becomes the no-name placeholder', () => {
    const r = parseCmrApQboRows(qboSheet([qboLine('Journal Entry', '01/05/2026', '', '', '', '', 10)], 10))
    expect(r.ok && r.value.lines[0]).toMatchObject({
      vendorName: CMR_AP_NO_NAME, invoiceNum: null, docType: 'General Journal', payable: false,
      dueDate: null, agingDays: null,
    })
  })

  it('refuses the QBO A/R report rather than reading its Amount column as a balance', () => {
    const arRows = [AR_HEADER, ['', '01/05/2026', 'Invoice', '1', 'CUST', '', '02/04/2026', 500, 100]]
    expect(parseCmrApQboRows(arRows)).toMatchObject({ ok: false, code: 'NOT_AP_AGING' })
    // and through the public entry point too
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(arRows), 'AR')
    expect(parseCmrApWorkbook(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer))
      .toMatchObject({ ok: false, code: 'NOT_AP_AGING' })
  })

  it('refuses a report with no TOTAL row (it cannot be reconciled)', () => {
    expect(parseCmrApQboRows([
      QBO_HEADER, qboLabel('CURRENT'), qboLine('Bill', '01/05/2026', '1', 'A', '02/04/2026', 5, 10),
    ])).toMatchObject({ ok: false, code: 'NO_TOTAL' })
  })

  it('refuses a detail line with no amount', () => {
    expect(parseCmrApQboRows(qboSheet([qboLine('Bill', '01/05/2026', '1', 'A', '02/04/2026', 5, '')], 0)))
      .toMatchObject({ ok: false, code: 'BAD_ROW' })
  })

  it('refuses an open balance too large to be real', () => {
    expect(parseCmrApQboRows(qboSheet([qboLine('Bill', '01/05/2026', '1', 'A', '02/04/2026', 5, 1e12)], 0)))
      .toMatchObject({ ok: false, code: 'BAD_ROW' })
  })

  it('refuses an over-long vendor name or Num', () => {
    expect(parseCmrApQboRows(qboSheet([qboLine('Bill', '01/05/2026', '1', 'V'.repeat(201), '02/04/2026', 5, 1)], 1)))
      .toMatchObject({ ok: false, code: 'BAD_ROW' })
    expect(parseCmrApQboRows(qboSheet([qboLine('Bill', '01/05/2026', 'N'.repeat(101), 'A', '02/04/2026', 5, 1)], 1)))
      .toMatchObject({ ok: false, code: 'BAD_ROW' })
  })

  it('reads a repeated header row as structure, not as a line', () => {
    const r = parseCmrApQboRows([
      QBO_HEADER,
      qboLabel('CURRENT'),
      qboLine('Bill', '01/05/2026', '1', 'A', '02/04/2026', 5, 10),
      QBO_HEADER,
      qboLabel('TOTAL', 10),
    ])
    expect(r.ok && r.value.lineCount).toBe(1)
  })
})
