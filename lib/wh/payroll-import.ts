import {
  type SheetRow,
  type WhParseResult,
  cell,
  readSheetRows,
  toCents,
} from './qbo'

/**
 * Western Highways — QuickBooks **Online** `Payroll summary by employee` parser.
 *
 * Built against the real export (`WesternHighwaysTrafficTruckProducts_PayrollSummaryByEmployee_
 * 09242026_1134.xls`, an old-format .xls — SheetJS reads it, and .xlsx, through the same path).
 *
 * This report is shaped unlike anything else WH exports, and unlike the Safety Network Desktop
 * payroll files:
 *
 *   • It is a **MATRIX**: employees are **COLUMNS**, and each row is a labelled item.
 *
 *       row 3   From Sep 13, 2026 to Sep 19, 2026 for all employees from all locations
 *       row 4   [0]Item  [1]Total  [2..]employee names
 *       row 5+  Hours - total │ Hours - Regular Pay │ … │ Gross pay - total │ …
 *               Pretax deductions - … │ Adjusted gross │ Other pay - … │
 *               Employee taxes & deductions - total │ Employee taxes - total │ …
 *
 *     So the parser TRANSPOSES it: one row per employee, which is what the database stores.
 *   • **One value per cell — no rate column**, unlike the Desktop payroll's hours/rate/amount
 *     triplets.
 *   • Names are `Last First [Middle]` with **no comma** ("Flores Marcus R"), so the SN
 *     name-splitter (which expects one) is no use here. A leading `*` marks someone inactive /
 *     terminated in QuickBooks; it is a flag, not part of the name, and is stripped — keeping it
 *     would split one person into two names across periods the moment they were terminated.
 *   • Money arrives as native floats and is rounded at the cent by toCents, the same way the
 *     A/R and A/P parsers do. **Hours stay decimal hours**, not cents.
 *
 * Net pay is deliberately NOT `gross + taxes`: QuickBooks' net is
 * `Adjusted gross − |Employee taxes|`, and adjusted gross sits below gross for anyone with a
 * pretax deduction (five of the sixteen on the real file). Deriving it that way reproduces the
 * report's own `Net pay` row for every employee — which the tests assert, so the derivation is
 * checked against QuickBooks rather than against itself.
 *
 * Pure function: buffer in, numbers out. No clock, no database.
 */

// ── Shapes ─────────────────────────────────────────────────────────────────────

export interface WhPayrollEmployee {
  /** "Last First [Middle]", exactly as the report spells it, with the '*' stripped. */
  name: string
  /** False when the report prefixed the name with '*' (inactive / terminated). */
  isActive: boolean
  /** Decimal hours, e.g. 40.02 — not cents. */
  hours: number
  grossCents: number
  /** SIGNED: negative, the way the report writes withholding. */
  taxesCents: number
  /** Gross less pretax deductions — what the taxes were withheld from. */
  adjustedGrossCents: number
  /** adjustedGross − |taxes|. Reproduces the report's own Net pay row. */
  netCents: number
  /**
   * The employee's whole column, keyed by item label: 'Hours - …' items as decimal hours,
   * every other item in cents. Blank cells are omitted (a blank means "this item does not
   * apply to this person", which is not the same as a real zero).
   */
  detail: Record<string, number>
}

export interface WhPayrollTotals {
  hours: number
  grossCents: number
  taxesCents: number
  adjustedGrossCents: number
  netCents: number
}

export interface ParsedWhPayroll {
  /** The pay period, from the report's own period line. */
  periodStart: string
  periodEnd: string
  employees: WhPayrollEmployee[]
  /** The report's **Total column** (col 1) — QuickBooks' own arithmetic. */
  totals: WhPayrollTotals
  /** The same five figures summed across the per-employee columns. */
  sums: WhPayrollTotals
  /**
   * The gross reconciliation that matters: Σ per-employee gross === the Total column's gross.
   * If this is false the file was not read faithfully and nothing should be trusted.
   */
  reconciled: boolean
  /** Every figure checked against the Total column, for a preview that shows its work. */
  checks: Record<keyof WhPayrollTotals, boolean>
  /**
   * The report's own `Net pay` total, when it has that row — an independent check on the net
   * derivation. Null when a future export drops the row (net is still derived).
   */
  reportedNetCents: number | null
  /** How many employees the report marked inactive with a '*'. */
  inactiveCount: number
}

// ── Item labels ────────────────────────────────────────────────────────────────
//
// The five rows the dashboard is built on, by their exact labels. Everything else on the report
// is kept per employee in `detail` rather than promoted to a column.

const ITEM = {
  hours:         'hours - total',
  gross:         'gross pay - total',
  taxes:         'employee taxes - total',
  adjustedGross: 'adjusted gross',
  net:           'net pay',
} as const

/** 'Hours - …' items are decimal hours; every other item is money. */
export function isHoursItem(label: string): boolean {
  return /^hours\s*-/i.test(label.trim())
}

// ── Names ──────────────────────────────────────────────────────────────────────

/**
 * An employee column header → the name to store and whether they are active.
 *
 * The leading '*' is QuickBooks' inactive/terminated marker. It is stripped so the same person
 * keys to the same name in every period, and `isActive: false` carries the fact instead.
 */
export function parseEmployeeName(raw: string): { name: string; isActive: boolean } {
  const trimmed = raw.trim()
  const starred = trimmed.startsWith('*')
  return { name: (starred ? trimmed.slice(1) : trimmed).trim(), isActive: !starred }
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
 * The pay period, out of the report's period line:
 *
 *   "From Sep 13, 2026 to Sep 19, 2026 for all employees from all locations"
 *
 * Both a named month and a numeric M/D/YYYY are accepted, since the phrase around the dates is
 * the only part of that line QuickBooks keeps stable. Returns null when neither date is found —
 * the parser then refuses the file rather than storing an undated period.
 */
export function parsePayrollPeriod(rows: SheetRow[], limit = 12): { start: string; end: string } | null {
  for (let i = 0; i < Math.min(rows.length, limit); i++) {
    const row = rows[i]
    if (!row) continue
    const text = row.map((c) => String(c ?? '')).join(' ')
    if (!/from/i.test(text)) continue

    const named = /from\s+([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})\s+to\s+([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})/i.exec(text)
    if (named) {
      const m1 = MONTHS[named[1].slice(0, 3).toLowerCase()]
      const m2 = MONTHS[named[4].slice(0, 3).toLowerCase()]
      if (m1 && m2) {
        const start = iso(Number(named[3]), m1, Number(named[2]))
        const end = iso(Number(named[6]), m2, Number(named[5]))
        if (start && end) return { start, end }
      }
    }

    const numeric = /from\s+(\d{1,2})\/(\d{1,2})\/(\d{4})\s+to\s+(\d{1,2})\/(\d{1,2})\/(\d{4})/i.exec(text)
    if (numeric) {
      const start = iso(Number(numeric[3]), Number(numeric[1]), Number(numeric[2]))
      const end = iso(Number(numeric[6]), Number(numeric[4]), Number(numeric[5]))
      if (start && end) return { start, end }
    }
  }
  return null
}

// ── Numbers ────────────────────────────────────────────────────────────────────

/**
 * Decimal hours from a cell: a native number (what the .xls carries) or a string with thousands
 * separators. Null for a blank or unreadable cell, so "this item does not apply to this person"
 * stays distinguishable from a real 0.
 */
export function toHours(value: unknown): number | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value * 100) / 100 : null
  const s = String(value).trim().replace(/[,\s ]/g, '')
  if (!s) return null
  if (!/^-?\d+(\.\d+)?$|^-?\.\d+$/.test(s)) return null
  const n = parseFloat(s)
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null
}

// ── The header row ─────────────────────────────────────────────────────────────

/**
 * The 0-based index of the header row — `Item` in column 0 with `Total` beside it. Found rather
 * than assumed, exactly as the aging parsers find theirs, so a title block of a different height
 * changes nothing.
 */
export function findPayrollHeaderRow(rows: SheetRow[], limit = 30): number {
  for (let i = 0; i < Math.min(rows.length, limit); i++) {
    if (cell(rows[i], 0).toLowerCase() === 'item' && cell(rows[i], 1).toLowerCase() === 'total') return i
  }
  return -1
}

const COL_TOTAL = 1
const FIRST_EMPLOYEE_COL = 2

// ── The parser ─────────────────────────────────────────────────────────────────

function emptyTotals(): WhPayrollTotals {
  return { hours: 0, grossCents: 0, taxesCents: 0, adjustedGrossCents: 0, netCents: 0 }
}

export function parseWhPayrollFile(buffer: Buffer): WhParseResult<ParsedWhPayroll> {
  let rows: SheetRow[]
  try {
    rows = readSheetRows(buffer)
  } catch (err) {
    return { success: false, error: `Could not read the file: ${String(err)}` }
  }

  if (rows.length === 0) return { success: false, error: 'The file is empty.' }

  const headerRow = findPayrollHeaderRow(rows)
  if (headerRow < 0) {
    return {
      success: false,
      error: 'This does not look like a QuickBooks Online Payroll Summary by Employee export — no "Item / Total" header row was found. If this is an aging report, upload it under A/R or A/P.',
    }
  }

  const period = parsePayrollPeriod(rows, headerRow)
  if (!period) {
    return {
      success: false,
      error: 'The pay period could not be read from the report (expected a line like "From Sep 13, 2026 to Sep 19, 2026"). A payroll period cannot be imported without its dates.',
    }
  }

  // Employee columns: every non-blank header cell from index 2 onwards.
  const header = rows[headerRow] ?? []
  const columns: { index: number; name: string; isActive: boolean }[] = []
  for (let c = FIRST_EMPLOYEE_COL; c < header.length; c++) {
    const raw = cell(header, c)
    if (!raw) continue
    const { name, isActive } = parseEmployeeName(raw)
    if (name) columns.push({ index: c, name, isActive })
  }

  if (columns.length === 0) {
    return { success: false, error: 'The report has no employee columns — there is nothing to import.' }
  }
  const duplicate = columns.map((c) => c.name).find((n, i, all) => all.indexOf(n) !== i)
  if (duplicate) {
    return { success: false, error: `The report lists "${duplicate}" in two columns — the file cannot be imported without double-counting that employee.` }
  }

  // ── Walk the item rows once, filling the Total column and every employee's detail ──
  const totals = emptyTotals()
  const detail = new Map<string, Record<string, number>>(columns.map((c) => [c.name, {}]))
  const figures = new Map<string, Partial<Record<keyof typeof ITEM, number>>>(columns.map((c) => [c.name, {}]))
  let reportedNetCents: number | null = null
  let sawAnyItem = false

  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = rows[r]
    if (!row) continue
    const label = cell(row, 0)
    if (!label) continue

    const key = label.toLowerCase()
    const hoursRow = isHoursItem(label)
    const read = (v: unknown): number | null => (hoursRow ? toHours(v) : toCents(v))

    const totalValue = read(row[COL_TOTAL])
    if (totalValue !== null) {
      sawAnyItem = true
      if (key === ITEM.hours) totals.hours = totalValue
      else if (key === ITEM.gross) totals.grossCents = totalValue
      else if (key === ITEM.taxes) totals.taxesCents = totalValue
      else if (key === ITEM.adjustedGross) totals.adjustedGrossCents = totalValue
      else if (key === ITEM.net) reportedNetCents = totalValue
    }

    for (const col of columns) {
      const value = read(row[col.index])
      if (value === null) continue // blank: the item does not apply to this person
      detail.get(col.name)![label] = value
      if (key === ITEM.hours) figures.get(col.name)!.hours = value
      else if (key === ITEM.gross) figures.get(col.name)!.gross = value
      else if (key === ITEM.taxes) figures.get(col.name)!.taxes = value
      else if (key === ITEM.adjustedGross) figures.get(col.name)!.adjustedGross = value
      else if (key === ITEM.net) figures.get(col.name)!.net = value
    }
  }

  if (!sawAnyItem) {
    return { success: false, error: 'The report has no item rows below its header — there is nothing to import.' }
  }

  // ── Transpose into one row per employee ────────────────────────────────────
  const employees: WhPayrollEmployee[] = columns.map((col) => {
    const f = figures.get(col.name)!
    const grossCents = f.gross ?? 0
    // The report writes withholding negative; a file that ever wrote it positive is normalised
    // here rather than stored with the wrong sign (the database enforces taxes <= 0).
    const taxesCents = -Math.abs(f.taxes ?? 0)
    // Adjusted gross is below gross only where there are pretax deductions; where the report
    // omits the row entirely, gross IS the adjusted gross.
    const adjustedGrossCents = f.adjustedGross ?? grossCents
    const d = detail.get(col.name)!
    d.adjustedGrossCents = adjustedGrossCents

    return {
      name: col.name,
      isActive: col.isActive,
      hours: f.hours ?? 0,
      grossCents,
      taxesCents,
      adjustedGrossCents,
      // QuickBooks' own definition — see the note at the top of this file.
      netCents: adjustedGrossCents - Math.abs(taxesCents),
      detail: d,
    }
  })

  const sums: WhPayrollTotals = {
    // Hours are decimal, so they are summed in hundredths and divided back: 40.02 + 33.55 + …
    // in floating point would not land on 677.04 exactly.
    hours: employees.reduce((s, e) => s + Math.round(e.hours * 100), 0) / 100,
    grossCents: employees.reduce((s, e) => s + e.grossCents, 0),
    taxesCents: employees.reduce((s, e) => s + e.taxesCents, 0),
    adjustedGrossCents: employees.reduce((s, e) => s + e.adjustedGrossCents, 0),
    netCents: employees.reduce((s, e) => s + e.netCents, 0),
  }

  const checks: Record<keyof WhPayrollTotals, boolean> = {
    hours:              sums.hours === totals.hours,
    grossCents:         sums.grossCents === totals.grossCents,
    taxesCents:         sums.taxesCents === totals.taxesCents,
    adjustedGrossCents: sums.adjustedGrossCents === totals.adjustedGrossCents,
    netCents:           reportedNetCents === null ? true : sums.netCents === reportedNetCents,
  }

  return {
    success: true,
    data: {
      periodStart: period.start,
      periodEnd: period.end,
      employees,
      totals: { ...totals, netCents: reportedNetCents ?? sums.netCents },
      sums,
      // The gross reconciliation is the one that decides whether the file was read faithfully.
      reconciled: checks.grossCents,
      checks,
      reportedNetCents,
      inactiveCount: employees.filter((e) => !e.isActive).length,
    },
  }
}
