import * as XLSX from 'xlsx'

/**
 * Shared QuickBooks **Online** report-parsing helpers for Western Highways (WH).
 *
 * WH is a separate QBO company, and its exports look nothing like the QuickBooks *Desktop*
 * files the Safety Network parsers (lib/ar/parser.ts, lib/payroll/…) were built for:
 *
 *   • A title block of 1–4 rows (company / report name / "As of …") — or NONE at all
 *     (the real A/P Aging Detail .xlsx starts straight at the header row), so the header row
 *     is found by looking for "Transaction type" rather than by a fixed offset.
 *   • Aging sections are marked by a **group-header row** carrying text in column A with the
 *     data columns blank, and closed by a `Total for <group>` row; a final `TOTAL` row carries
 *     the grand total.
 *   • Files arrive as **.xlsx OR .csv** — the A/R sample is CSV (money as "1,234.56" strings),
 *     the A/P sample is XLSX (money as native floats). Both are read through the same
 *     SheetJS path so a parser never cares which it got.
 *
 * Everything here is pure: no database, no clock, no I/O beyond the buffer handed in. That is
 * what lets the parsers be unit-tested against the real files with exact numbers.
 */

// ── Aging buckets ──────────────────────────────────────────────────────────────
//
// The five QBO group-header labels, verbatim. ONLY these five are buckets — the A/R CSV also
// carries a trailing generated-at timestamp line in column A ("Wednesday, September 23, 2026
// 04:09 PM GMT-07:00") which must be ignored rather than mistaken for a section. Any other
// column-A row (a `Total for …` subtotal, a blank spacer, a stray note) is likewise skipped.
//
// The short labels match lib/ar/parser.ts so WH and SN read the same in a UI.

export type WhAgingBucket = 'Current' | '1-30' | '31-60' | '61-90' | '>90'

export const WH_BUCKET_ORDER: readonly WhAgingBucket[] = [
  'Current', '1-30', '31-60', '61-90', '>90',
] as const

const BUCKET_HEADERS: Record<string, WhAgingBucket> = {
  'current':                   'Current',
  '1 - 30 days past due':      '1-30',
  '31 - 60 days past due':     '31-60',
  '61 - 90 days past due':     '61-90',
  '91 or more days past due':  '>90',
}

/** The bucket a column-A group-header names, or null if this row is not a bucket header. */
export function bucketFor(colA: string): WhAgingBucket | null {
  return BUCKET_HEADERS[colA.trim().toLowerCase()] ?? null
}

// ── Reading the file ───────────────────────────────────────────────────────────

export type SheetRow = unknown[]

/**
 * Both .xlsx and .csv become the same array-of-arrays. `raw: true` keeps native numbers as
 * numbers (the A/P xlsx) and leaves CSV cells as strings (the A/R csv) — toCents handles both.
 * Dates are deliberately NOT coerced to Date objects: QBO writes them as "MM/DD/YYYY" text in
 * both formats, and parsing them ourselves avoids a timezone shifting the day.
 */
export function readSheetRows(buffer: Buffer): SheetRow[] {
  const wb = XLSX.read(buffer, { type: 'buffer', raw: true, cellDates: false })
  const first = wb.SheetNames[0]
  if (!first) return []
  const ws = wb.Sheets[first]
  if (!ws) return []
  return XLSX.utils.sheet_to_json<SheetRow>(ws, { header: 1, defval: '', raw: true })
}

/** Cell → trimmed string ('' when blank/absent). */
export function cell(row: SheetRow | undefined, i: number): string {
  return String(row?.[i] ?? '').trim()
}

/**
 * The 0-based index of the header row — the row carrying "Transaction type". Row offsets differ
 * by report AND by format (4 in the A/R CSV, 0 in the A/P XLSX), so this is never assumed.
 * Returns -1 when the file has no such row, which is how a parser refuses a file that isn't the
 * expected QBO report.
 */
export function findHeaderRow(rows: SheetRow[], limit = 30): number {
  for (let i = 0; i < Math.min(rows.length, limit); i++) {
    const row = rows[i]
    if (!row) continue
    for (let c = 0; c < row.length; c++) {
      if (cell(row, c).toLowerCase() === 'transaction type') return i
    }
  }
  return -1
}

/**
 * Confirms the header row carries the columns this report is supposed to have, at the indexes
 * the parser will read. A file that parses as *some* QBO aging report but not *this* one (an
 * A/P export chosen in the A/R slot, say) is refused here rather than silently importing
 * garbage — the A/P layout has an extra "Past due" column, so its Open balance sits one column
 * further right and every amount would land in the wrong field.
 */
export function headerHas(rows: SheetRow[], headerRow: number, expected: Record<number, string>): boolean {
  const row = rows[headerRow]
  if (!row) return false
  for (const [idx, label] of Object.entries(expected)) {
    if (cell(row, Number(idx)).toLowerCase() !== label.toLowerCase()) return false
  }
  return true
}

// ── Money ──────────────────────────────────────────────────────────────────────

/**
 * Money → **signed integer cents**, from either a native number (xlsx) or a QBO money string
 * (csv): "1,234.56", "$678,768.26", "-129,729.53", "(1,234.56)" for a negative.
 *
 * Floats are rounded at the cent, which is what makes the acceptance numbers exact: the A/P
 * grand total arrives from SheetJS as 1243855.0699999994 and must become 124385507, not
 * 124385506. Returns null for a blank or unparseable cell so a caller can tell "no value" from
 * a real zero.
 */
export function toCents(value: unknown): number | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null
    return Math.round(value * 100)
  }

  let s = String(value).trim()
  if (!s) return null

  let negative = false
  if (s.startsWith('(') && s.endsWith(')')) {
    negative = true
    s = s.slice(1, -1)
  }
  s = s.replace(/[$,\s ]/g, '')
  if (s.startsWith('-')) {
    negative = true
    s = s.slice(1)
  } else if (s.startsWith('+')) {
    s = s.slice(1)
  }
  if (!/^\d+(\.\d+)?$|^\.\d+$/.test(s)) return null

  const cents = Math.round(parseFloat(s) * 100)
  if (!Number.isFinite(cents)) return null
  return negative ? -cents : cents
}

// ── Dates ──────────────────────────────────────────────────────────────────────

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
}

function iso(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1990 || y > 2100) return null
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/**
 * A QBO cell date → `yyyy-mm-dd`, or null. Handles "MM/DD/YYYY" (what both real files use) and,
 * defensively, an Excel serial number in case a future export writes real dates. No Date
 * arithmetic on the string form, so no timezone can move the day.
 */
export function toIsoDate(value: unknown): string | null {
  if (value === null || value === undefined) return null

  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 1) return null
    const d = new Date(Math.round((value - 25569) * 86400 * 1000))
    return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())
  }

  const s = String(value).trim()
  if (!s) return null

  const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s)
  if (slash) return iso(Number(slash[3]), Number(slash[1]), Number(slash[2]))

  const dash = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (dash) return iso(Number(dash[1]), Number(dash[2]), Number(dash[3]))

  return null
}

/** `yyyy-mm-dd` + n days, in plain UTC arithmetic (no local timezone involved). */
export function addDays(isoDate: string, days: number): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate)
  if (!m) return null
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/**
 * The report's "as of" date, read out of the title block ("As of Sep 23, 2026"). Returns null
 * when there is no title block at all — which is exactly the A/P export's case, and why
 * parseWhApFile derives its as-of date from the data instead.
 */
export function findAsOfDate(rows: SheetRow[], headerRow: number): string | null {
  for (let i = 0; i < headerRow; i++) {
    const row = rows[i]
    if (!row) continue
    const text = row.map((c) => String(c ?? '')).join(' ')

    const named = /as of\s+([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})/i.exec(text)
    if (named) {
      const month = MONTHS[named[1].slice(0, 3).toLowerCase()]
      if (month) {
        const d = iso(Number(named[3]), month, Number(named[2]))
        if (d) return d
      }
    }

    const numeric = /as of\s+(\d{1,2}\/\d{1,2}\/\d{4})/i.exec(text)
    if (numeric) {
      const d = toIsoDate(numeric[1])
      if (d) return d
    }
  }
  return null
}

// ── Counterparties ─────────────────────────────────────────────────────────────

/**
 * QBO appends its own reference code to many names — customers carry `CTM-0000016`, vendors
 * carry `VDR-0087`. The raw name is kept verbatim (so a view groups exactly the way the report
 * reads, and a re-import matches), and the code is pulled out alongside it for display and for
 * anyone who later wants to link WH counterparties to SN records.
 */
export function splitCounterparty(raw: string): { name: string; code: string | null } {
  const name = raw.trim()
  const m = /^(.*?)[\s,]+((?:CTM|VDR)-\d+)$/i.exec(name)
  if (!m) return { name, code: null }
  return { name, code: m[2].toUpperCase() }
}

/**
 * WH's AR and AP are overwhelmingly **intercompany** — the other Safety Network entities. Money
 * "owed to / by WH" is therefore mostly internal paper, not outside exposure, so every line
 * carries this flag and the views can separate the two. The rule is deliberately the plain one
 * from the brief: the counterparty's name contains "Safety Network".
 */
export function isIntercompanyName(raw: string): boolean {
  return /safety\s+network/i.test(raw)
}

// ── Result envelope ────────────────────────────────────────────────────────────

export type WhParseResult<T> =
  | { success: true; data: T }
  | { success: false; error: string }

/** Rows whose column A is non-empty are structure, never data. */
export function isStructuralRow(colA: string): boolean {
  return colA.length > 0
}

/** The grand-total row that closes a QBO aging report. Subtotals read `Total for <group>`. */
export function isGrandTotalRow(colA: string): boolean {
  return colA.trim().toLowerCase() === 'total'
}
