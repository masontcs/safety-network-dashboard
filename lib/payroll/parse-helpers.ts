import { parse as parseDate, subDays, getDay, format, isValid } from 'date-fns'
import { ParseError } from '@/lib/utils/errors'

export type Rows = (unknown | null)[][]
export type EmployeeCol = { rawName: string; col: number }

export function cellStr(rows: Rows, r: number, c: number): string | null {
  const val = (rows[r] as unknown[] | undefined)?.[c]
  if (val === null || val === undefined || val === '') return null
  const s = String(val).trim()
  return s || null
}

export function cellNum(rows: Rows, r: number, c: number): number | null {
  const val = (rows[r] as unknown[] | undefined)?.[c]
  if (val === null || val === undefined) return null
  if (typeof val === 'number') return val
  const n = parseFloat(String(val))
  return Number.isNaN(n) ? null : n
}

// Row 2 (index 1): find "Week of MMM d, yyyy", subtract 1 day, validate Saturday.
export function extractPeriodDate(rows: Rows, warnings?: string[]): string {
  const headerRow = (rows[1] ?? []) as unknown[]
  let weekOfText: string | null = null

  for (const cell of headerRow) {
    if (typeof cell === 'string' && /week of/i.test(cell)) { weekOfText = cell; break }
  }

  if (!weekOfText) {
    throw new ParseError('Could not find the pay period date. Expected "Week of [date]" in row 2.')
  }

  const match = weekOfText.match(/week of\s+(.+)/i)
  if (!match) throw new ParseError('Could not parse date from "Week of" header.')

  const dateStr = match[1].trim()
  let parsed    = parseDate(dateStr, 'MMM d, yyyy', new Date())

  if (!isValid(parsed)) {
    throw new ParseError(`Could not parse date "${dateStr}". Expected format like "Mar 29, 2026".`)
  }

  // QuickBooks sometimes exports 2-digit years (e.g. "Mar 1, 26" instead of "Mar 1, 2026").
  // Auto-correct by adding 2000 rather than blocking the import.
  if (parsed.getFullYear() < 100) {
    const corrected = new Date(parsed)
    corrected.setFullYear(parsed.getFullYear() + 2000)
    warnings?.push(
      `Date "${dateStr}" had a 2-digit year (${parsed.getFullYear()}). ` +
      `Auto-corrected to ${corrected.getFullYear()}. Check your QuickBooks export settings.`
    )
    parsed = corrected
  }

  const periodDate = subDays(parsed, 1)

  if (getDay(periodDate) !== 6) {
    throw new ParseError(
      `Period date ${format(periodDate, 'yyyy-MM-dd')} is not a Saturday. ` +
      `Check the "Week of" date in the file.`
    )
  }

  return format(periodDate, 'yyyy-MM-dd')
}

// Col D (index 3), rows 5+ (index 4+). Stop at first blank cell.
export function extractPayrollItems(rows: Rows): string[] {
  const items: string[] = []
  for (let r = 4; r < rows.length; r++) {
    const name = cellStr(rows, r, 3)
    if (name === null) break
    items.push(name)
  }
  if (items.length === 0) {
    throw new ParseError('No payroll items found. Expected item names in column D starting at row 5.')
  }
  return items
}

// Row 1 (index 0), starting from col E (index 4).
// Non-null, non-TOTAL strings are employee names. Stop at TOTAL.
export function extractEmployeeColumns(rows: Rows): EmployeeCol[] {
  const row0 = (rows[0] ?? []) as unknown[]
  const cols: EmployeeCol[] = []

  for (let c = 4; c < row0.length; c++) {
    const cell = row0[c]
    if (cell === null || cell === undefined || cell === '') continue
    const name = String(cell).trim()
    if (name.toUpperCase() === 'TOTAL') break
    if (name) cols.push({ rawName: name, col: c })
  }

  if (cols.length === 0) {
    throw new ParseError('No employees found in row 1. Expected names starting at column E.')
  }
  return cols
}

// Scan col A (index 0) for the employer taxes summary row.
// The label lives in column A, not column D — column D holds payroll item names (rows 5+).
export function findTaxRowIndex(rows: Rows): number {
  for (let r = 0; r < rows.length; r++) {
    const label = cellStr(rows, r, 0)
    if (label && label.toLowerCase().includes('total employer taxes')) return r
  }
  throw new ParseError(
    '"Total Employer Taxes and Contributions" row not found. ' +
    'Check that the file is a complete QuickBooks Payroll Summary.'
  )
}
