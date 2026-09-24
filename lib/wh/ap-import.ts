import {
  type SheetRow,
  type WhAgingBucket,
  type WhParseResult,
  addDays,
  bucketFor,
  cell,
  findAsOfDate,
  findHeaderRow,
  headerHas,
  isGrandTotalRow,
  isStructuralRow,
  readSheetRows,
  splitCounterparty,
  isIntercompanyName,
  toCents,
  toIsoDate,
} from './qbo'

/**
 * Western Highways — QuickBooks **Online** `A/P Aging Detail` parser.
 *
 * Built against the real export (`Western Highways Traffic Truck Products_A_P Aging Detail
 * Report.xlsx`). Its layout differs from the A/R report in two ways that matter:
 *
 *   1. **No title block at all.** The header is row 0, so there is no "As of …" line to read —
 *      see deriveApAsOf below for how the as-of date is recovered from the data instead.
 *   2. **An extra "Past due" (days) column** at index 7, which pushes Amount to 8 and
 *      Open balance to **9**. Reading index 8 (the A/R position) would import the face Amount
 *      as the open balance and inflate the total by ~$332k on the real file, so the header is
 *      verified before any row is read.
 *
 *   row 0     header: [1]Date [2]Transaction type [3]Num [4]Vendor display name
 *                     [5]Location full name [6]Due date [7]Past due [8]Amount [9]Open balance
 *   then      five aging sections, each opened by a group-header in column A and closed by a
 *             `Total for <group>` row, and finally a `TOTAL` row with the grand total
 *
 * Open balances are **signed** — Vendor Credits and reversing Journal Entries are negative.
 * Every line is kept so the import reconciles to the report's own TOTAL; only Bill and Vendor
 * Credit are *payable*, mirroring CMR A/P's payable concept.
 *
 * Pure function: buffer in, numbers out. No clock, no database.
 */

export interface WhApLine {
  txnDate: string | null
  /** Bill / Vendor Credit / Journal Entry / Bill Payment (Check) — kept verbatim. */
  txnType: string
  num: string | null
  /** Vendor name exactly as the report spells it, QBO code and all. */
  vendorName: string
  /** The `VDR-…` code embedded in the name, pulled out for display. */
  vendorCode: string | null
  location: string | null
  dueDate: string | null
  /** QBO's own "Past due" days. Negative when the bill is not due yet. */
  pastDueDays: number | null
  agingBucket: WhAgingBucket | null
  amountCents: number | null
  /** Signed integer cents: bills positive, vendor credits / reversing entries negative. */
  openBalanceCents: number
  /** True for Bill / Vendor Credit — what WH actually owes. */
  payable: boolean
  isIntercompany: boolean
}

export interface ParsedWhAp {
  /**
   * The report's as-of date (`yyyy-mm-dd`). The A/P export carries no title block, so this is
   * derived from the data (see deriveApAsOf) and is null only when it could not be.
   */
  reportAsOf: string | null
  /** How reportAsOf was obtained — surfaced in the import preview so the date is never silent. */
  reportAsOfSource: 'title' | 'derived' | 'none'
  /** How many lines agreed on the derived date (0 when it wasn't derived). */
  reportAsOfEvidence: number
  reportTotalCents: number | null
  sumOpenCents: number
  reconciled: boolean
  /** Σ of the payable (Bill + Vendor Credit) lines, in cents — what WH actually owes. */
  payableTotalCents: number
  lines: WhApLine[]
  typeCounts: Record<string, number>
}

/** Bill and Vendor Credit are payable; Journal Entry / Bill Payment are reconciliation-only. */
const PAYABLE_TYPES = new Set(['bill', 'vendor credit'])

export function isWhApPayableType(txnType: string): boolean {
  return PAYABLE_TYPES.has(txnType.trim().toLowerCase())
}

const AP_HEADER: Record<number, string> = {
  1: 'Date',
  2: 'Transaction type',
  4: 'Vendor display name',
  7: 'Past due',
  8: 'Amount',
  9: 'Open balance',
}

const COL = {
  date: 1, type: 2, num: 3, vendor: 4, location: 5, dueDate: 6,
  pastDue: 7, amount: 8, open: 9,
}

function toDays(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value) : null
  const s = String(value ?? '').trim()
  if (!s || !/^-?\d+$/.test(s)) return null
  return Number(s)
}

/**
 * Recover the report's as-of date from the rows themselves.
 *
 * QBO computes "Past due" as (as-of date − due date), so for any line that IS past due,
 * `due date + past due days` reproduces the as-of date. Every such line must agree; a single
 * disagreement means the assumption doesn't hold for this file and the caller is told nothing
 * could be derived rather than being handed a guess.
 *
 * Only strictly-positive past-due values are used: a 0 carries no information about the day it
 * was computed, and negatives (not yet due) are QBO's days-until-due, which invert the sum.
 *
 * On the real file all 655 past-due lines agree on 2026-09-24.
 */
export function deriveApAsOf(lines: Pick<WhApLine, 'dueDate' | 'pastDueDays'>[]): { date: string | null; agreeing: number } {
  let date: string | null = null
  let agreeing = 0

  for (const l of lines) {
    if (!l.dueDate || l.pastDueDays === null || l.pastDueDays <= 0) continue
    const candidate = addDays(l.dueDate, l.pastDueDays)
    if (!candidate) continue
    if (date === null) {
      date = candidate
      agreeing = 1
    } else if (candidate === date) {
      agreeing++
    } else {
      // The lines disagree — the derivation does not hold for this file.
      return { date: null, agreeing: 0 }
    }
  }

  return { date, agreeing }
}

export function parseWhApFile(buffer: Buffer): WhParseResult<ParsedWhAp> {
  let rows: SheetRow[]
  try {
    rows = readSheetRows(buffer)
  } catch (err) {
    return { success: false, error: `Could not read the file: ${String(err)}` }
  }

  if (rows.length === 0) {
    return { success: false, error: 'The file is empty.' }
  }

  const headerRow = findHeaderRow(rows)
  if (headerRow < 0) {
    return {
      success: false,
      error: 'This does not look like a QuickBooks Online A/P Aging Detail export — no "Transaction type" header row was found.',
    }
  }
  if (!headerHas(rows, headerRow, AP_HEADER)) {
    return {
      success: false,
      error: 'The header row does not match the A/P Aging Detail layout (expected Date · Transaction type · Num · Vendor display name · Location full name · Due date · Past due · Amount · Open balance). If this is the A/R report, upload it under A/R.',
    }
  }

  const lines: WhApLine[] = []
  const typeCounts: Record<string, number> = {}
  let bucket: WhAgingBucket | null = null
  let reportTotalCents: number | null = null

  for (let i = headerRow + 1; i < rows.length; i++) {
    const row = rows[i]
    if (!row) continue

    const colA = cell(row, 0)
    if (isStructuralRow(colA)) {
      const b = bucketFor(colA)
      if (b) {
        bucket = b
      } else if (isGrandTotalRow(colA)) {
        reportTotalCents = toCents(row[COL.open])
      }
      continue
    }

    const txnType = cell(row, COL.type)
    if (!txnType) continue

    const openBalanceCents = toCents(row[COL.open])
    if (openBalanceCents === null) continue

    const rawVendor = cell(row, COL.vendor)
    const { name, code } = splitCounterparty(rawVendor)

    lines.push({
      txnDate:        toIsoDate(row[COL.date]),
      txnType,
      num:            cell(row, COL.num) || null,
      vendorName:     name,
      vendorCode:     code,
      location:       cell(row, COL.location) || null,
      dueDate:        toIsoDate(row[COL.dueDate]),
      pastDueDays:    toDays(row[COL.pastDue]),
      agingBucket:    bucket,
      amountCents:    toCents(row[COL.amount]),
      openBalanceCents,
      payable:        isWhApPayableType(txnType),
      isIntercompany: isIntercompanyName(rawVendor),
    })

    typeCounts[txnType] = (typeCounts[txnType] ?? 0) + 1
  }

  if (lines.length === 0) {
    return { success: false, error: 'No A/P detail lines were found in the file.' }
  }

  const sumOpenCents = lines.reduce((s, l) => s + l.openBalanceCents, 0)
  const payableTotalCents = lines
    .filter((l) => l.payable)
    .reduce((s, l) => s + l.openBalanceCents, 0)

  // Prefer a real title-block date if a future export ever grows one; otherwise derive it.
  const titleAsOf = findAsOfDate(rows, headerRow)
  const derived = titleAsOf ? { date: null, agreeing: 0 } : deriveApAsOf(lines)

  return {
    success: true,
    data: {
      reportAsOf:         titleAsOf ?? derived.date,
      reportAsOfSource:   titleAsOf ? 'title' : derived.date ? 'derived' : 'none',
      reportAsOfEvidence: titleAsOf ? 0 : derived.agreeing,
      reportTotalCents,
      sumOpenCents,
      reconciled: reportTotalCents !== null && sumOpenCents === reportTotalCents,
      payableTotalCents,
      lines,
      typeCounts,
    },
  }
}
