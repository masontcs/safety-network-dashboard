import * as XLSX from 'xlsx'
import { parse as parseDate, getDay, format, isValid } from 'date-fns'
import { ParseError } from '@/lib/utils/errors'
import type { ParseResult } from '@/lib/utils/errors'
import { round2 } from '@/lib/utils/format'
import type { RevenueParseResult, ParsedRevenueRecord } from './types'

// QuickBooks company codes → entity codes
const ENTITY_MAP: Record<string, string> = {
  SAFETY1003: 'INC',
  SNTCS1503:  'TCS',
  SNTSIGN:    'STS',
}

// Remove " Sales" suffix and apply any branch merges.
// Update MERGED_BRANCHES whenever branches consolidate — add old name → surviving branch name.
function normalizeBranchName(raw: string): string {
  const withoutSales = raw.replace(/\s+sales$/i, '').trim()
  const MERGED_BRANCHES: Record<string, string> = {
    'Sacramento': 'Modesto',
  }
  return MERGED_BRANCHES[withoutSales] ?? withoutSales
}

type Rows = (unknown | null)[][]

function cellStr(rows: Rows, r: number, c: number): string | null {
  const val = (rows[r] as unknown[] | undefined)?.[c]
  if (val === null || val === undefined || val === '') return null
  const s = String(val).trim()
  return s || null
}

function cellNum(rows: Rows, r: number, c: number): number {
  const val = (rows[r] as unknown[] | undefined)?.[c]
  if (val === null || val === undefined) return 0
  if (typeof val === 'number') return val
  const n = parseFloat(String(val).replace(/[,$]/g, ''))
  return Number.isNaN(n) ? 0 : n
}

// ─── Step 1: Period date ───────────────────────────────────────────────────

// Row 3 (index 2), col A (index 0): "Date Range MM/DD/YYYY - MM/DD/YYYY"
// Use the END date — it is already a Saturday.
function extractPeriodDate(rows: Rows): string {
  const cell = cellStr(rows, 2, 0)

  if (!cell || !/date range/i.test(cell)) {
    throw new ParseError(
      'Could not find "Date Range" in row 3 of the revenue file. ' +
      'Check that this is a QuickBooks Invoice Summary by Month by Branch.'
    )
  }

  const match = cell.match(
    /(\d{1,2}\/\d{1,2}\/\d{4})\s*-\s*(\d{1,2}\/\d{1,2}\/\d{4})/
  )
  if (!match) {
    throw new ParseError(
      `Could not parse date range from "${cell}". Expected "MM/DD/YYYY - MM/DD/YYYY".`
    )
  }

  const endDateStr = match[2]
  const parsed = parseDate(endDateStr, 'M/d/yyyy', new Date())

  if (!isValid(parsed)) {
    throw new ParseError(`Could not parse end date "${endDateStr}".`)
  }

  if (getDay(parsed) !== 6) {
    throw new ParseError(
      `Period end date ${format(parsed, 'yyyy-MM-dd')} is not a Saturday. ` +
      `Check the date range in the file.`
    )
  }

  return format(parsed, 'yyyy-MM-dd')
}

// ─── Steps 2 & 3: Scan rows, collect records via Branch Totals rows ────────
//
// Strategy: Within each branch section (delimited by "Branch: X" headers),
// scan monthly rows only to track the last-seen company code. When "Branch Totals"
// is found, capture that row's values — it is the single correct aggregate for
// the branch+entity combination. Monthly rows are NOT accumulated directly.
//
// Branch Totals row column layout (same positions as monthly data rows):
//   A (0) = "Branch Totals"
//   B (1) = blank (month column, unused in totals)
//   C (2) = Labor total
//   D (3) = Rental total
//   E (4) = One Time Charges total
//   F (5) = Total w/o Sales Tax  ← ignored, we recalculate
//   G (6) = Sales Tax total
//   H (7) = blank (no company code on totals rows)

function extractRecords(rows: Rows, warnings: string[]): ParsedRevenueRecord[] {
  // Accumulate by "branchName|entityCode" key so BRANCH_MERGE sums correctly
  const acc = new Map<string, ParsedRevenueRecord>()
  let currentBranch: string | null = null
  let lastCompanyCode: string | null = null

  for (let r = 4; r < rows.length; r++) {
    const colA = cellStr(rows, r, 0)

    // Branch header row — reset tracking for the new section
    if (colA?.startsWith('Branch: ')) {
      const rawBranch = colA.slice('Branch: '.length).trim()
      currentBranch = normalizeBranchName(rawBranch)
      lastCompanyCode = null
      continue
    }

    // Skip report-level totals (col A = "Report Totals" OR col B = "Report Totals")
    const colB = cellStr(rows, r, 1)
    if ((colA && /report totals/i.test(colA)) || (colB && /report totals/i.test(colB))) continue

    // Monthly data rows: track company code but do NOT accumulate values
    // A row is a monthly row when col A is a year number OR col A is blank
    // but col B has a month name and col H has a company code.
    const colH = cellStr(rows, r, 7)
    const yearVal = (rows[r] as unknown[] | undefined)?.[0]
    const isYearRow = typeof yearVal === 'number' && yearVal > 2000 && yearVal < 2100
    const isBlankYearRow = (colA === null) && (cellStr(rows, r, 1) !== null)

    if ((isYearRow || isBlankYearRow) && colH) {
      lastCompanyCode = colH
      continue
    }

    // Branch Totals row — this is the authoritative aggregate for the branch
    if (colA && /^branch totals$/i.test(colA)) {
      if (!currentBranch) continue

      if (!lastCompanyCode) {
        warnings.push(`Branch Totals found for "${currentBranch}" but no company code was seen in this section — skipped.`)
        continue
      }

      const entityCode = ENTITY_MAP[lastCompanyCode]
      if (!entityCode) {
        warnings.push(`Unrecognized company code "${lastCompanyCode}" in "${currentBranch}" section — skipped.`)
        continue
      }

      const labor          = cellNum(rows, r, 2)
      const rental         = cellNum(rows, r, 3)
      const oneTimeCharges = cellNum(rows, r, 4)
      const salesTax       = cellNum(rows, r, 6)
      const totalRevenue   = round2(labor + rental + oneTimeCharges)

      const key = `${currentBranch}|${entityCode}`

      if (acc.has(key)) {
        // BRANCH_MERGE case: e.g. "Bakersfield Sales" → same key as "Bakersfield"
        const existing = acc.get(key)!
        existing.labor          = round2(existing.labor + labor)
        existing.rental         = round2(existing.rental + rental)
        existing.oneTimeCharges = round2(existing.oneTimeCharges + oneTimeCharges)
        existing.salesTax       = round2(existing.salesTax + salesTax)
        existing.totalRevenue   = round2(existing.labor + existing.rental + existing.oneTimeCharges)
      } else {
        acc.set(key, { branchName: currentBranch, entityCode, labor, rental, oneTimeCharges, salesTax, totalRevenue })
      }
      continue
    }

    // Year Totals — skip silently
  }

  const records = Array.from(acc.values())
  if (records.length === 0) {
    throw new ParseError('No revenue data found in this file. Check that the file contains branch data rows.')
  }
  return records
}

// ─── Public API ────────────────────────────────────────────────────────────

export function parseRevenueFile(buffer: Buffer): ParseResult<RevenueParseResult> {
  const warnings: string[] = []

  try {
    const workbook = XLSX.read(buffer, { type: 'buffer' })
    const sheet = workbook.Sheets[workbook.SheetNames[0]]
    const rows = XLSX.utils.sheet_to_json<(unknown | null)[]>(sheet, {
      header: 1,
      defval: null,
      raw: true,
    }) as Rows

    const periodDate = extractPeriodDate(rows)
    const records    = extractRecords(rows, warnings)

    return { success: true, data: { periodDate, records, warnings }, warnings }
  } catch (err) {
    if (err instanceof ParseError) {
      return { success: false, error: err.detail ?? err.message, warnings }
    }
    throw err
  }
}
