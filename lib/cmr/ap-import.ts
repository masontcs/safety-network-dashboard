import * as XLSX from 'xlsx'
import { isCmrApQboSheet, parseCmrApQboRows } from './ap-import-qbo'

/**
 * SN Cash Ledger (CMR) — the QuickBooks **A/P Aging Detail** parser (AP Phase 1).
 *
 * PURE: no database, no clock, no network. It turns the rows of one exported report into the
 * lines that become an account's AP snapshot, plus the figures that prove the import is whole.
 * The import routes call it twice (Preview, then Commit) and the unit tests run it against the
 * real `STS AP 92226.xlsx`.
 *
 * TWO LAYOUTS. This file is the QuickBooks **Desktop** parser, which every CMR account but one
 * uses. WHWY is a separate QuickBooks **Online** company whose export of the same report uses
 * contiguous columns; `lib/cmr/ap-import-qbo.ts` parses that layout and normalizes it into the
 * model below, and `parseCmrApWorkbook` picks between the two from the sheet's own header row.
 * Everything under this comment describes the Desktop layout only.
 *
 * The layout (verified against the real export — see research/cmr-ap-build-brief.md):
 *   • Blank spacer columns. The data sits in 0-based columns 3, 5, 7, 9, 11, 13, 15:
 *       3 Type · 5 Date · 7 Num · 9 Name · 11 Due Date · 13 Aging · 15 Open Balance
 *   • A header row carrying exactly those seven labels in those seven columns. A workbook
 *     without it is not an A/P Aging Detail report and is refused.
 *   • Aging-bucket group headers in column 0 ("Current", "1 - 30", "31 - 60", "61 - 90",
 *     "> 90"), each followed by its detail rows and a "Total <bucket>" row (also column 0).
 *   • One final "TOTAL" row in column 0 with the report's grand total in column 15.
 *   • A detail row has its doc type in column 3 (Bill, Credit, General Journal,
 *     Bill Pmt -Check, …) and its open balance in column 15 — Bills positive, Credits negative.
 *
 * What the parser keeps:
 *   • EVERY detail row, whatever its type, so Σ(lines) can be checked against the report's
 *     TOTAL (`reconciled`). Only Bill and Credit lines are `payable`; General Journal,
 *     Bill Pmt -Check and any other type are stored for reconciliation and never requestable.
 *   • Dollars become signed integer cents, rounded half away from zero, so −$525.00 is −52500.
 *   • Dates become 'YYYY-MM-DD' calendar days (no time, no time zone). A blank due date or
 *     aging is null — QuickBooks leaves both empty on credits and journal lines.
 */

/** The seven data columns, 0-based. The columns between them are always empty. */
export const CMR_AP_COL = {
  type: 3,
  date: 5,
  num: 7,
  name: 9,
  due: 11,
  aging: 13,
  balance: 15,
} as const

/** The header labels, in the same columns, compared case- and space-insensitively. */
const HEADER: Record<keyof typeof CMR_AP_COL, string> = {
  type: 'type',
  date: 'date',
  num: 'num',
  name: 'name',
  due: 'due date',
  aging: 'aging',
  balance: 'open balance',
}

/** The only doc types that can ever be paid through Cash Ledger. Everything else is reconciliation-only. */
export const CMR_AP_PAYABLE_TYPES: readonly string[] = ['Bill', 'Credit'] as const

export const isCmrApPayableType = (docType: string): boolean => CMR_AP_PAYABLE_TYPES.includes(docType)

/** Vendor name stored when QuickBooks left the Name column empty (it does on some journal lines). */
export const CMR_AP_NO_NAME = '(No name)'

/** Hard limits — a real daily export is a few hundred lines. */
export const CMR_AP_MAX_LINES = 20_000
export const CMR_AP_MAX_FILE_BYTES = 10 * 1024 * 1024
/** Column lengths, matching the checks in the cmr_ap migration. */
export const CMR_AP_VENDOR_MAX = 200
export const CMR_AP_INVOICE_MAX = 100
export const CMR_AP_DOCTYPE_MAX = 40
export const CMR_AP_BUCKET_MAX = 20
/** |open balance| above this is not a real AP line ($999,999,999.99, the CMR money ceiling). */
export const CMR_AP_MAX_ABS_CENTS = 99_999_999_999

export interface CmrApParsedLine {
  vendorName: string
  invoiceNum: string | null
  docType: string
  billDate: string | null
  dueDate: string | null
  agingDays: number | null
  /** The group header the line sat under ("Current", "1 - 30", …), or null if above any. */
  agingBucket: string | null
  /** Signed: Bills positive, Credits negative. */
  openBalanceCents: number
  payable: boolean
}

export interface CmrApParsed {
  lines: CmrApParsedLine[]
  /** The report's own TOTAL row. */
  reportTotalCents: number
  /** Σ of every imported line, whatever its type. Equals reportTotalCents when reconciled. */
  importedTotalCents: number
  /** Σ of the Bill + Credit lines — what is actually owed through Cash Ledger. */
  payableTotalCents: number
  lineCount: number
  payableLineCount: number
  /** Distinct vendor names across ALL lines. */
  vendorCount: number
  /** Distinct vendor names that carry at least one payable line. */
  payableVendorCount: number
  /** Line count per doc type, e.g. { Bill: 116, Credit: 25, 'General Journal': 5 }. */
  docTypeCounts: Record<string, number>
  /** Σ(all lines) === the report's TOTAL. */
  reconciled: boolean
}

export type CmrApParseCode = 'NOT_AP_AGING' | 'NO_TOTAL' | 'BAD_ROW' | 'TOO_MANY_LINES' | 'UNREADABLE'

export type CmrApParseResult =
  | { ok: true; value: CmrApParsed }
  | { ok: false; code: CmrApParseCode; error: string }

const NOT_AP =
  'That file is not a QuickBooks A/P Aging Detail report. In QuickBooks Desktop export Reports → Vendors & Payables → A/P Aging Detail to Excel; in QuickBooks Online export Reports → What you owe → A/P Aging Detail. Upload that file.'

// ── cell readers ────────────────────────────────────────────────────────────

const text = (v: unknown): string => {
  if (v === null || v === undefined) return ''
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : ''
  if (v instanceof Date) return ''
  return String(v).trim()
}

const norm = (v: unknown): string => text(v).replace(/\s+/g, ' ').toLowerCase()

const isBlank = (v: unknown): boolean => text(v) === '' && !(v instanceof Date)

const pad = (n: number) => String(n).padStart(2, '0')

function validDay(y: number, m: number, d: number): string | null {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null
  if (y < 1900 || y > 2100) return null
  const dt = new Date(Date.UTC(y, m - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null
  return `${y}-${pad(m)}-${pad(d)}`
}

/**
 * A report date → 'YYYY-MM-DD', or null when blank / not a date. Accepts an Excel serial
 * (what SheetJS returns for a date cell), a JS Date (cellDates), 'M/D/YYYY' or 'YYYY-MM-DD'.
 * Serials are converted with UTC arithmetic so no server time zone can move the day.
 */
export function cmrApDay(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null
    return validDay(v.getUTCFullYear(), v.getUTCMonth() + 1, v.getUTCDate())
  }
  if (typeof v === 'number') {
    if (!Number.isFinite(v) || v < 1) return null
    // Excel's day 25569 is 1970-01-01 (the 1900 leap-year bug is already folded into it).
    const dt = new Date(Math.round((Math.floor(v) - 25569) * 86_400_000))
    return validDay(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate())
  }
  const s = String(v).trim()
  let m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s)
  if (m) return validDay(Number(m[3]), Number(m[1]), Number(m[2]))
  m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (m) return validDay(Number(m[1]), Number(m[2]), Number(m[3]))
  return null
}

/**
 * Dollars → signed integer cents, rounded half away from zero (so floating-point noise like
 * 1134.31 * 100 = 113430.99999… lands on 113431, and −0.005 on −1). Accepts a number or a
 * money string ("1,134.31", "$1,134.31", "(525.00)", "-525"). Blank / not money → null.
 */
export function cmrApCents(v: unknown): number | null {
  let n: number
  if (typeof v === 'number') {
    n = v
  } else if (typeof v === 'string') {
    let s = v.trim()
    if (!s) return null
    let neg = false
    if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1) }
    s = s.replace(/[$,\s]/g, '')
    if (s.startsWith('-')) { neg = !neg; s = s.slice(1) }
    if (!/^\d+(\.\d+)?$|^\.\d+$/.test(s)) return null
    n = Number(s) * (neg ? -1 : 1)
  } else {
    return null
  }
  if (!Number.isFinite(n)) return null
  const cents = Math.sign(n) * Math.round(Math.abs(n) * 100 + 1e-7)
  return cents === 0 ? 0 : cents // no −0
}

/** Aging days: a whole number, or null when blank. */
function agingDays(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(String(v).trim().replace(/,/g, ''))
  if (!Number.isFinite(n)) return null
  return Math.round(n)
}

/** "Current", "1 - 30", "31 - 60", "61 - 90", "> 90" — or any QB-style bucket label. */
const BUCKET_RE = /^(current|\d+\s*-\s*\d+|>\s*\d+|over\s+\d+)$/i

function bucketLabel(raw: string): string {
  const t = raw.replace(/\s+/g, ' ').trim()
  if (/^current$/i.test(t)) return 'Current'
  let m = /^(\d+)\s*-\s*(\d+)$/.exec(t)
  if (m) return `${m[1]} - ${m[2]}`
  m = /^(?:>|over)\s*(\d+)$/i.exec(t)
  if (m) return `> ${m[1]}`
  return t
}

// ── the parser ──────────────────────────────────────────────────────────────

function isHeaderRow(row: unknown[]): boolean {
  return (Object.keys(CMR_AP_COL) as (keyof typeof CMR_AP_COL)[]).every(
    (k) => norm(row[CMR_AP_COL[k]]) === HEADER[k],
  )
}

/** Where the header row is, looking at the first rows only (QB puts titles above it at most). */
export function findCmrApHeader(rows: unknown[][]): number {
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    if (Array.isArray(rows[i]) && isHeaderRow(rows[i])) return i
  }
  return -1
}

/**
 * Parse the rows of one sheet (a 2-D array of cell values, as SheetJS `sheet_to_json(header: 1)`
 * returns them). The core of the parser, and what the unit tests drive directly.
 */
export function parseCmrApRows(rows: unknown[][]): CmrApParseResult {
  const header = findCmrApHeader(rows)
  if (header < 0) return { ok: false, code: 'NOT_AP_AGING', error: NOT_AP }

  const lines: CmrApParsedLine[] = []
  let bucket: string | null = null
  let reportTotalCents: number | null = null

  for (let i = header + 1; i < rows.length; i++) {
    const row = Array.isArray(rows[i]) ? rows[i] : []
    const col0 = text(row[0])
    const type = text(row[CMR_AP_COL.type]).replace(/\s+/g, ' ')

    // Column 0 labels: a bucket header, a bucket subtotal, or the grand TOTAL.
    if (col0 && !type) {
      if (/^total$/i.test(col0)) {
        const total = cmrApCents(row[CMR_AP_COL.balance])
        if (total === null) {
          return { ok: false, code: 'NO_TOTAL', error: 'The TOTAL row has no amount in the Open Balance column.' }
        }
        reportTotalCents = total
        break // nothing after the grand total belongs to the report
      }
      if (/^total\b/i.test(col0)) continue // "Total 1 - 30" — a subtotal, not a line
      if (BUCKET_RE.test(col0.replace(/\s+/g, ' '))) bucket = bucketLabel(col0)
      continue
    }

    if (!type) continue // spacer / blank row
    if (norm(type) === 'type') continue // a repeated header (multi-page export)

    // A detail line.
    const cents = cmrApCents(row[CMR_AP_COL.balance])
    const where = `Row ${i + 1} (${type})`
    if (cents === null) {
      return { ok: false, code: 'BAD_ROW', error: `${where} has no amount in the Open Balance column.` }
    }
    if (Math.abs(cents) > CMR_AP_MAX_ABS_CENTS) {
      return { ok: false, code: 'BAD_ROW', error: `${where} has an open balance too large to be real.` }
    }
    if (type.length > CMR_AP_DOCTYPE_MAX) {
      return { ok: false, code: 'BAD_ROW', error: `${where}: the Type column is not a QuickBooks doc type.` }
    }
    const name = text(row[CMR_AP_COL.name])
    if (name.length > CMR_AP_VENDOR_MAX) {
      return { ok: false, code: 'BAD_ROW', error: `${where}: the vendor name is longer than ${CMR_AP_VENDOR_MAX} characters.` }
    }
    const num = text(row[CMR_AP_COL.num])
    if (num.length > CMR_AP_INVOICE_MAX) {
      return { ok: false, code: 'BAD_ROW', error: `${where}: the Num is longer than ${CMR_AP_INVOICE_MAX} characters.` }
    }

    lines.push({
      vendorName: name || CMR_AP_NO_NAME,
      invoiceNum: num || null,
      docType: type,
      billDate: cmrApDay(row[CMR_AP_COL.date]),
      dueDate: cmrApDay(row[CMR_AP_COL.due]),
      agingDays: isBlank(row[CMR_AP_COL.aging]) ? null : agingDays(row[CMR_AP_COL.aging]),
      agingBucket: bucket && bucket.length <= CMR_AP_BUCKET_MAX ? bucket : null,
      openBalanceCents: cents,
      payable: isCmrApPayableType(type),
    })
    if (lines.length > CMR_AP_MAX_LINES) {
      return { ok: false, code: 'TOO_MANY_LINES', error: `That report has more than ${CMR_AP_MAX_LINES.toLocaleString('en-US')} lines.` }
    }
  }

  if (reportTotalCents === null) {
    return {
      ok: false,
      code: 'NO_TOTAL',
      error: 'That report has no TOTAL row, so it cannot be checked. Export the full A/P Aging Detail report again.',
    }
  }

  return { ok: true, value: summarizeCmrApLines(lines, reportTotalCents) }
}

/** The figures a Preview shows and a Commit records, from a set of lines and the report TOTAL. */
export function summarizeCmrApLines(lines: CmrApParsedLine[], reportTotalCents: number): CmrApParsed {
  let importedTotalCents = 0
  let payableTotalCents = 0
  let payableLineCount = 0
  const vendors = new Set<string>()
  const payableVendors = new Set<string>()
  const docTypeCounts: Record<string, number> = {}
  for (const l of lines) {
    importedTotalCents += l.openBalanceCents
    vendors.add(l.vendorName)
    docTypeCounts[l.docType] = (docTypeCounts[l.docType] ?? 0) + 1
    if (l.payable) {
      payableTotalCents += l.openBalanceCents
      payableLineCount++
      payableVendors.add(l.vendorName)
    }
  }
  return {
    lines,
    reportTotalCents,
    importedTotalCents,
    payableTotalCents,
    lineCount: lines.length,
    payableLineCount,
    vendorCount: vendors.size,
    payableVendorCount: payableVendors.size,
    docTypeCounts,
    reconciled: importedTotalCents === reportTotalCents,
  }
}

/**
 * Parse an uploaded A/P Aging Detail export, in EITHER of the two layouts CMR accounts produce.
 *
 * Reads every sheet (QuickBooks sometimes adds a notes tab in front) and picks a parser by what
 * the sheet actually contains:
 *
 *   1. **QuickBooks Desktop** — the blank-spacer-column layout above, identified by the seven
 *      header labels in columns 3…15. Every CMR account but WHWY exports this.
 *   2. **QuickBooks Online** — the contiguous-column layout, identified by a "Transaction type"
 *      header row with "Past due" and "Open balance" at their A/P indexes. WHWY (Western
 *      Highways) is a separate QBO company; `parseCmrApQboRows` normalizes its rows into the
 *      same canonical model, so nothing downstream — preview, commit, `cmr_ap_replace_import`,
 *      the `payable` rule — can tell the two apart.
 *
 * Desktop is tried across every sheet FIRST, so a Desktop workbook takes exactly the path it
 * always has and its behaviour is unchanged. Formulas are not evaluated and nothing in the file
 * is executed — only cell values are read. A .csv (which QBO also exports) is read through the
 * same SheetJS path as an .xlsx, so neither parser cares which it was handed.
 */
export function parseCmrApWorkbook(data: ArrayBuffer | Uint8Array): CmrApParseResult {
  let wb: XLSX.WorkBook
  try {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
    // An .xlsx is a zip ("PK\x03\x04"); anything else reaching here is the .csv QBO also exports.
    // A CSV is read with `raw`, which keeps every cell the TEXT the file contains instead of
    // letting SheetJS infer types: without it a Num of "00085001" is read as the number 85001
    // and the invoice number silently loses its leading zeros (an .xlsx carries its own cell
    // types, so it needs no such help — and its read options are untouched).
    const isZip =
      bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04
    wb = isZip
      ? XLSX.read(bytes, { type: 'array', cellFormula: false, cellHTML: false, cellStyles: false })
      : XLSX.read(bytes, { type: 'array', cellFormula: false, cellHTML: false, cellStyles: false, raw: true })
  } catch {
    return { ok: false, code: 'UNREADABLE', error: 'That file could not be read as an Excel workbook.' }
  }

  const sheets: unknown[][][] = []
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name]
    if (!ws) continue
    sheets.push(
      XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '', raw: true, blankrows: true }) as unknown[][],
    )
  }

  for (const rows of sheets) {
    if (findCmrApHeader(rows) >= 0) return parseCmrApRows(rows)
  }
  for (const rows of sheets) {
    if (isCmrApQboSheet(rows)) return parseCmrApQboRows(rows)
  }
  return { ok: false, code: 'NOT_AP_AGING', error: NOT_AP }
}
