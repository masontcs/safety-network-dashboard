/**
 * Roll-ups for the Western Highways payroll views.
 *
 * Payroll is the first WH area that is a SERIES rather than a position, so there are two
 * questions to answer and they want different shapes:
 *
 *   • one period — the per-employee table and its totals (summarizeWhPayrollPeriod)
 *   • across periods — the week-over-week trend, each period against the one before it
 *     (whPayrollTrend)
 *
 * Both are pure, so the numbers on the page are the numbers the tests check. A period is
 * sixteen rows and a year is fifty-two periods, so everything is computed in the browser from
 * the rows the page already shipped.
 */

export interface WhPayrollLineRow {
  id: string
  employeeName: string
  isActive: boolean
  hours: number
  grossCents: number
  /** Negative, as stored. */
  taxesCents: number
  netCents: number
}

export interface WhPayrollPeriodRow {
  id: string
  periodStart: string
  periodEnd: string
  sourceFilename: string | null
  importedAt: string | null
  importedBy: string | null
  employeeCount: number
  totalHours: number
  grossTotalCents: number
  taxesTotalCents: number
  netTotalCents: number
}

export type WhPayrollSort = 'gross' | 'hours' | 'net' | 'name'

export interface WhPayrollPeriodSummary {
  employeeCount: number
  activeCount: number
  inactiveCount: number
  totalHours: number
  grossCents: number
  /** Negative. */
  taxesCents: number
  netCents: number
  /** Gross ÷ hours, in cents per hour — null when nobody logged an hour. */
  averageHourlyCents: number | null
  rows: WhPayrollLineRow[]
}

/** Decimal hours summed in hundredths, so 40.02 + 33.55 + … lands exactly on 677.04. */
export function sumHours(values: number[]): number {
  return values.reduce((s, h) => s + Math.round(h * 100), 0) / 100
}

/**
 * One period's per-employee table and its totals. The rows come back in the requested order —
 * biggest gross first by default, which is how a payroll is read.
 */
export function summarizeWhPayrollPeriod(
  lines: WhPayrollLineRow[],
  sort: WhPayrollSort = 'gross',
): WhPayrollPeriodSummary {
  const rows = [...lines].sort((a, b) => {
    switch (sort) {
      case 'hours': return b.hours - a.hours || a.employeeName.localeCompare(b.employeeName)
      case 'net':   return b.netCents - a.netCents || a.employeeName.localeCompare(b.employeeName)
      case 'name':  return a.employeeName.localeCompare(b.employeeName)
      default:      return b.grossCents - a.grossCents || a.employeeName.localeCompare(b.employeeName)
    }
  })

  const totalHours = sumHours(rows.map((r) => r.hours))
  const grossCents = rows.reduce((s, r) => s + r.grossCents, 0)

  return {
    employeeCount: rows.length,
    activeCount: rows.filter((r) => r.isActive).length,
    inactiveCount: rows.filter((r) => !r.isActive).length,
    totalHours,
    grossCents,
    taxesCents: rows.reduce((s, r) => s + r.taxesCents, 0),
    netCents: rows.reduce((s, r) => s + r.netCents, 0),
    averageHourlyCents: totalHours > 0 ? Math.round(grossCents / totalHours) : null,
    rows,
  }
}

export interface WhPayrollTrendPoint {
  periodId: string
  periodStart: string
  periodEnd: string
  employeeCount: number
  totalHours: number
  grossTotalCents: number
  netTotalCents: number
  /** Change in gross from the period before it in the series — null for the earliest. */
  grossChangeCents: number | null
  /** The same change as a share of the previous period's gross — null if that was zero. */
  grossChangePct: number | null
  headcountChange: number | null
}

/**
 * The periods as a series, OLDEST FIRST, each carrying its change from the period before.
 *
 * Oldest-first is deliberate even though every list and picker in the UI shows newest first: a
 * trend is read left to right, and "change from the period before" only means anything in
 * chronological order. The caller reverses it for a table if it wants to.
 *
 * Periods are ordered by their end date. Gaps are not filled — a fortnight with no import shows
 * as two adjacent points, not as a zero, because a missing import is not a week of no payroll.
 */
export function whPayrollTrend(periods: WhPayrollPeriodRow[]): WhPayrollTrendPoint[] {
  const ordered = [...periods].sort(
    (a, b) => a.periodEnd.localeCompare(b.periodEnd) || a.periodStart.localeCompare(b.periodStart),
  )

  return ordered.map((p, i) => {
    const prev = i > 0 ? ordered[i - 1] : null
    const grossChangeCents = prev ? p.grossTotalCents - prev.grossTotalCents : null
    return {
      periodId: p.id,
      periodStart: p.periodStart,
      periodEnd: p.periodEnd,
      employeeCount: p.employeeCount,
      totalHours: p.totalHours,
      grossTotalCents: p.grossTotalCents,
      netTotalCents: p.netTotalCents,
      grossChangeCents,
      grossChangePct:
        prev && prev.grossTotalCents !== 0 && grossChangeCents !== null
          ? (grossChangeCents / prev.grossTotalCents) * 100
          : null,
      headcountChange: prev ? p.employeeCount - prev.employeeCount : null,
    }
  })
}

/** The periods newest first — the order the picker and the history table use. */
export function whPeriodsNewestFirst(periods: WhPayrollPeriodRow[]): WhPayrollPeriodRow[] {
  return [...periods].sort(
    (a, b) => b.periodEnd.localeCompare(a.periodEnd) || b.periodStart.localeCompare(a.periodStart),
  )
}

/** "Sep 13 – Sep 19, 2026", or with both years when the period straddles one. */
export function formatWhPeriod(start: string, end: string): string {
  const fmt = (iso: string, withYear: boolean) => {
    const [y, m, d] = iso.split('-')
    const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m) - 1] ?? m
    return `${month} ${Number(d)}${withYear ? `, ${y}` : ''}`
  }
  const sameYear = start.slice(0, 4) === end.slice(0, 4)
  return `${fmt(start, !sameYear)} – ${fmt(end, true)}`
}
