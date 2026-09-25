import {
  type SheetRow,
  type WhAgingBucket,
  bucketFor,
  cell,
  findHeaderRow,
  headerHas,
  isGrandTotalRow,
  isStructuralRow,
} from '@/lib/wh/qbo'
import {
  CMR_AP_BUCKET_MAX,
  CMR_AP_DOCTYPE_MAX,
  CMR_AP_INVOICE_MAX,
  CMR_AP_MAX_ABS_CENTS,
  CMR_AP_MAX_LINES,
  CMR_AP_NO_NAME,
  CMR_AP_VENDOR_MAX,
  cmrApCents,
  cmrApDay,
  isCmrApPayableType,
  summarizeCmrApLines,
  type CmrApParsedLine,
  type CmrApParseResult,
} from './ap-import'

/**
 * SN Cash Ledger (CMR) — the QuickBooks **Online** `A/P Aging Detail` parser.
 *
 * Every other CMR account exports from QuickBooks *Desktop*, whose A/P Aging Detail uses the
 * blank-spacer-column layout `lib/cmr/ap-import.ts` was built for. **WHWY** (Western Highways
 * Traffic Truck Products) is a separate QuickBooks *Online* company: same report, contiguous
 * columns, different labels. Rather than give WHWY its own model, this module parses the QBO
 * layout and **normalizes it into CMR's canonical A/P model**, so the rows it returns are
 * indistinguishable from Desktop rows downstream — same `CmrApParsedLine`, same summary, same
 * `cmr_ap_replace_import`, same `payable = doc_type in ('Bill','Credit')` rule in the database.
 * No schema, constraint or function change is needed.
 *
 * The layout (verified against the real export, `Western Highways Traffic Truck Products_A_P
 * Aging Detail Report.xlsx`):
 *
 *   row 0     header — there is NO title block on this report, but other QBO exports have one,
 *             so the header row is FOUND by locating "Transaction type" rather than assumed:
 *               [1]Date [2]Transaction type [3]Num [4]Vendor display name
 *               [5]Location full name [6]Due date [7]Past due [8]Amount [9]Open balance
 *   then      five aging sections, each opened by a group-header in column A
 *             ("CURRENT", "1 - 30 days past due", …) and closed by "Total for <group>"
 *   last      a "TOTAL" row carrying the report's grand total in column 9
 *
 * Two traps this module is built around:
 *
 *   1. **Open balance is column 9, not 8.** The A/P report has an extra "Past due" column that
 *      the A/R report does not, which pushes Amount to 8 and Open balance to 9. Reading column 8
 *      would silently import the face Amount and overstate the real file by ~$332k, so the
 *      header is verified at the exact indexes before a single row is read — and a QBO *A/R*
 *      export is refused here rather than mis-read.
 *   2. **Column A is structure, never data.** Only the five bucket group-headers open a section;
 *      "Total for <group>" is a subtotal, "TOTAL" is the grand total, and anything else in
 *      column A (a footer, a generated-at timestamp) is ignored rather than mistaken for either.
 *
 * The QBO reading primitives (finding the header, recognizing a bucket, telling structure from
 * data) are shared with the Western Highways section via `lib/wh/qbo.ts`, so there is one
 * description of the QBO layout in the repo. The *money, date and limit* rules are CMR's own
 * (`cmrApCents`, `cmrApDay`, the column-length ceilings), so a QBO import is held to exactly the
 * checks a Desktop import is.
 *
 * PURE: no database, no clock, no network.
 */

/** The QBO A/P columns, 0-based. Column 0 carries the group-header structure only. */
export const CMR_AP_QBO_COL = {
  date: 1,
  type: 2,
  num: 3,
  vendor: 4,
  location: 5,
  due: 6,
  pastDue: 7,
  amount: 8,
  balance: 9,
} as const

/**
 * The header labels that identify THIS report at THESE indexes. "Past due" at 7 and
 * "Open balance" at 9 are what separate the A/P layout from the A/R one — see trap 1 above.
 */
const QBO_AP_HEADER: Record<number, string> = {
  1: 'Date',
  2: 'Transaction type',
  4: 'Vendor display name',
  7: 'Past due',
  8: 'Amount',
  9: 'Open balance',
}

/**
 * QBO transaction type → CMR's canonical Desktop doc type.
 *
 * This is the whole reason no migration is needed: after normalization every CMR A/P row carries
 * a Desktop doc type, so the server-side rule `payable = doc_type in ('Bill','Credit')` — which
 * the database derives itself and a check constraint holds — is as true for a WHWY import as for
 * an STS one. An unrecognized QBO type keeps its own label and is therefore NOT payable, which
 * is the safe direction: an unknown document can be reconciled but never paid.
 */
const QBO_DOC_TYPE: Record<string, string> = {
  'bill': 'Bill',
  'vendor credit': 'Credit',
  'journal entry': 'General Journal',
  'bill payment (check)': 'Bill Pmt -Check',
}

/** The canonical doc type for a QBO transaction type, or the label itself when unrecognized. */
export function cmrApQboDocType(txnType: string): string {
  const key = txnType.replace(/\s+/g, ' ').trim().toLowerCase()
  return QBO_DOC_TYPE[key] ?? txnType.replace(/\s+/g, ' ').trim()
}

/**
 * QBO bucket → the bucket label the Desktop parser already emits, so both formats populate
 * `aging_bucket` with the same five strings and a view never has to know which one it came from.
 * (`lib/wh/qbo.ts` spells these '1-30' / '>90' for the WH section; CMR's own spelling, set by the
 * Desktop report, is '1 - 30' / '> 90'.) All five fit CMR_AP_BUCKET_MAX.
 */
const QBO_BUCKET: Record<WhAgingBucket, string> = {
  'Current': 'Current',
  '1-30': '1 - 30',
  '31-60': '31 - 60',
  '61-90': '61 - 90',
  '>90': '> 90',
}

/** The CMR bucket label a column-A group-header names, or null if the row is not a bucket header. */
export function cmrApQboBucket(colA: string): string | null {
  const wh = bucketFor(colA)
  return wh ? QBO_BUCKET[wh] : null
}

/** "Past due" days: a whole number (negative when not yet due), or null when blank. */
function pastDueDays(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(String(v).trim().replace(/,/g, ''))
  if (!Number.isFinite(n)) return null
  return Math.round(n)
}

const NOT_QBO_AP =
  'That file is a QuickBooks Online report, but not the A/P Aging Detail one. Export Reports → What you owe → A/P Aging Detail and upload that.'

/**
 * Is this sheet a QBO A/P Aging Detail report? Used by `parseCmrApWorkbook` to pick a parser,
 * and true ONLY for the A/P layout — a QBO A/R export has a "Transaction type" header too, so
 * the column check, not the header's presence, is what decides.
 */
export function isCmrApQboSheet(rows: SheetRow[]): boolean {
  const header = findHeaderRow(rows)
  return header >= 0 && headerHas(rows, header, QBO_AP_HEADER)
}

/**
 * Parse the rows of one QBO A/P Aging Detail sheet into CMR's canonical model.
 *
 * Mirrors `parseCmrApRows` exactly in what it returns and how it refuses: every detail row is
 * kept (whatever its type) so Σ(lines) can be checked against the report's own TOTAL, dollars
 * become signed integer cents, dates become 'YYYY-MM-DD' calendar days, and the same column
 * ceilings that match the `cmr_ap` migration's checks are enforced.
 */
export function parseCmrApQboRows(rows: SheetRow[]): CmrApParseResult {
  const header = findHeaderRow(rows)
  if (header < 0 || !headerHas(rows, header, QBO_AP_HEADER)) {
    return { ok: false, code: 'NOT_AP_AGING', error: NOT_QBO_AP }
  }

  const lines: CmrApParsedLine[] = []
  let bucket: string | null = null
  let reportTotalCents: number | null = null

  for (let i = header + 1; i < rows.length; i++) {
    const row = Array.isArray(rows[i]) ? rows[i] : []
    const colA = cell(row, 0)

    // Column A is structure, never data: a bucket header, a "Total for …" subtotal, the grand
    // TOTAL, or a footer line that is none of those and is simply skipped.
    if (isStructuralRow(colA)) {
      const b = cmrApQboBucket(colA)
      if (b) {
        bucket = b
        continue
      }
      if (isGrandTotalRow(colA)) {
        const total = cmrApCents(row[CMR_AP_QBO_COL.balance])
        if (total === null) {
          return { ok: false, code: 'NO_TOTAL', error: 'The TOTAL row has no amount in the Open balance column.' }
        }
        reportTotalCents = total
        break // nothing after the grand total belongs to the report
      }
      continue // "Total for <bucket>", a footer, a timestamp — not a line
    }

    const txnType = cell(row, CMR_AP_QBO_COL.type).replace(/\s+/g, ' ')
    if (!txnType) continue // spacer / blank row
    if (txnType.toLowerCase() === 'transaction type') continue // a repeated header

    // A detail line.
    const cents = cmrApCents(row[CMR_AP_QBO_COL.balance])
    const where = `Row ${i + 1} (${txnType})`
    if (cents === null) {
      return { ok: false, code: 'BAD_ROW', error: `${where} has no amount in the Open balance column.` }
    }
    if (Math.abs(cents) > CMR_AP_MAX_ABS_CENTS) {
      return { ok: false, code: 'BAD_ROW', error: `${where} has an open balance too large to be real.` }
    }
    const docType = cmrApQboDocType(txnType)
    if (docType.length > CMR_AP_DOCTYPE_MAX) {
      return { ok: false, code: 'BAD_ROW', error: `${where}: the Transaction type column is not a QuickBooks doc type.` }
    }
    // The full QBO display name is kept verbatim, embedded VDR- code and all, so the spelling
    // matches the report and a re-import maps to the same canonical vendor.
    const name = cell(row, CMR_AP_QBO_COL.vendor)
    if (name.length > CMR_AP_VENDOR_MAX) {
      return { ok: false, code: 'BAD_ROW', error: `${where}: the vendor name is longer than ${CMR_AP_VENDOR_MAX} characters.` }
    }
    const num = cell(row, CMR_AP_QBO_COL.num)
    if (num.length > CMR_AP_INVOICE_MAX) {
      return { ok: false, code: 'BAD_ROW', error: `${where}: the Num is longer than ${CMR_AP_INVOICE_MAX} characters.` }
    }

    lines.push({
      vendorName: name || CMR_AP_NO_NAME,
      invoiceNum: num || null,
      docType,
      billDate: cmrApDay(row[CMR_AP_QBO_COL.date]),
      dueDate: cmrApDay(row[CMR_AP_QBO_COL.due]),
      agingDays: pastDueDays(row[CMR_AP_QBO_COL.pastDue]),
      agingBucket: bucket && bucket.length <= CMR_AP_BUCKET_MAX ? bucket : null,
      openBalanceCents: cents,
      payable: isCmrApPayableType(docType),
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
