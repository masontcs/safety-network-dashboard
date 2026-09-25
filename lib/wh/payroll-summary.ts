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
 *
 * THE EMPLOYER SIDE. Four figures were promoted to columns of wh_payroll_lines — hours, gross,
 * employee taxes, net — but those are what the EMPLOYEE sees. What Western Highways actually
 * pays is gross plus the employer's own taxes plus its contributions, and every one of those
 * items has been sitting in wh_payroll_lines.detail since the first import. whCostsFromDetail
 * derives them from that jsonb, so surfacing the real cost of a payroll needs no re-import, no
 * parser change and no migration. A label the report left blank is simply $0 (coalesced), and
 * a caller with no detail at all gets zeros rather than a guess.
 */

// ── The report's own item labels ──────────────────────────────────────────────
// detail is keyed by the labels the QBO "Payroll summary by employee" report prints in its
// first column: 'Hours - …' items as decimal hours, every other item in cents.

export const WH_PAYROLL_ITEM = {
  grossTotal: 'Gross pay - total',
  employeeTaxesTotal: 'Employee taxes - total',
  employerTaxesTotal: 'Employer taxes - total',
  contributionsTotal: 'Company contributions - total',
  totalCost: 'Total payroll cost',
} as const

const PREFIX = {
  employerTax: 'Employer taxes - ',
  employeeTax: 'Employee taxes - ',
  earnings: 'Gross pay - ',
  contribution: 'Company contributions - ',
} as const

/** The employer taxes the WH report carries, by the exact label it uses for each. */
const EMPLOYER_TAX_LABELS = {
  socialSecurityCents: ['Social Security Employer'],
  medicareCents: ['Medicare Employer'],
  futaCents: ['FUTA Employer'],
  caEttCents: ['CA ETT'],
  caSuiCents: ['CA SUI Employer'],
} as const

/** The employee withholdings, likewise. CA SDI is spelled out in full on the real export. */
const EMPLOYEE_TAX_LABELS = {
  federalIncomeCents: ['Federal Income Tax'],
  socialSecurityCents: ['Social Security'],
  medicareCents: ['Medicare'],
  caIncomeCents: ['CA Income Tax'],
  caSdiCents: ['CA State Disability Ins', 'CA SDI'],
} as const

/** One line of a breakdown: the item's label with its ''- total'' prefix stripped. */
export interface WhPayrollBreakdownItem {
  label: string
  cents: number
}

export interface WhEmployerTaxBreakdown {
  socialSecurityCents: number
  medicareCents: number
  futaCents: number
  caEttCents: number
  caSuiCents: number
  /** Anything the report lists under 'Employer taxes - …' that is none of the five above. */
  otherCents: number
  totalCents: number
  /** Every non-zero employer-tax item, biggest first. The five named figures cover the zeros. */
  items: WhPayrollBreakdownItem[]
}

export interface WhEmployeeTaxBreakdown {
  federalIncomeCents: number
  socialSecurityCents: number
  medicareCents: number
  caIncomeCents: number
  caSdiCents: number
  otherCents: number
  /** Negative, like the column it reconciles with. */
  totalCents: number
  items: WhPayrollBreakdownItem[]
}

/**
 * The employer-side figures for one employee (or, summed, for a period).
 *
 * employerTaxesCents + contributionsCents are what the employee never sees; totalCostCents is
 * the report's own 'Total payroll cost' — gross + employer taxes + contributions.
 */
export interface WhPayrollEmployeeCosts {
  employerTaxesCents: number
  contributionsCents: number
  totalCostCents: number
  employerTaxes: WhEmployerTaxBreakdown
  employeeTaxes: WhEmployeeTaxBreakdown
  /** Non-zero 'Company contributions - …' items, biggest first. */
  contributions: WhPayrollBreakdownItem[]
  /** Non-zero 'Gross pay - …' items — Regular, Overtime, Holiday, Salary, … — biggest first. */
  earnings: WhPayrollBreakdownItem[]
}

export interface WhPayrollLineRow {
  id: string
  employeeName: string
  isActive: boolean
  hours: number
  grossCents: number
  /** Negative, as stored. */
  taxesCents: number
  netCents: number
  /**
   * The employer side, derived from `detail` by the server (whCostsFromDetail) so the client
   * never has to carry the raw jsonb. Optional: a caller that only has the four promoted
   * columns leaves it out, and the roll-ups then read zeros rather than inventing a cost.
   */
  costs?: WhPayrollEmployeeCosts
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
  /**
   * The period's employer side, derived from its lines' `detail` by the server. Optional for
   * the same reason as WhPayrollLineRow.costs — the periods table stores only the four
   * employee-facing totals, and nothing about this display change altered it.
   */
  employerTaxesTotalCents?: number
  contributionsTotalCents?: number
  totalCostTotalCents?: number
}

export type WhPayrollSort = 'gross' | 'hours' | 'net' | 'name' | 'cost'

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
  /** The employer side, summed over the rows below. */
  employerTaxesCents: number
  contributionsCents: number
  totalCostCents: number
  employerTaxes: WhEmployerTaxBreakdown
  employeeTaxes: WhEmployeeTaxBreakdown
  contributions: WhPayrollBreakdownItem[]
  earnings: WhPayrollBreakdownItem[]
  /**
   * True when gross + employer taxes + contributions is exactly the report's total payroll
   * cost — the identity the QBO report itself satisfies, checked here so a period that does
   * not add up can be shown as such instead of quietly mis-stating what WH paid.
   */
  reconciles: boolean
  rows: WhPayrollLineRow[]
}

// ── detail → the employer side ────────────────────────────────────────────────

/** A jsonb value that should be a number. Anything else — null, a string, NaN — is $0. */
function cents(v: unknown): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  return Number.isFinite(n) ? Math.round(n) : 0
}

type DetailMap = Record<string, unknown> | null | undefined

function has(detail: DetailMap, key: string): boolean {
  return !!detail && Object.prototype.hasOwnProperty.call(detail, key)
}

/** Every item under `prefix`, its own '…- total' row excluded, labels stripped of the prefix. */
function group(detail: DetailMap, prefix: string): WhPayrollBreakdownItem[] {
  if (!detail) return []
  const out: WhPayrollBreakdownItem[] = []
  for (const key of Object.keys(detail)) {
    if (!key.startsWith(prefix)) continue
    const label = key.slice(prefix.length)
    if (label.toLowerCase() === 'total') continue
    out.push({ label, cents: cents(detail[key]) })
  }
  return out
}

/** Biggest first by size, then alphabetically — jsonb does not keep the report's row order. */
function ranked(items: WhPayrollBreakdownItem[]): WhPayrollBreakdownItem[] {
  return items
    .filter((i) => i.cents !== 0)
    .sort((a, b) => Math.abs(b.cents) - Math.abs(a.cents) || a.label.localeCompare(b.label))
}

function pick(items: WhPayrollBreakdownItem[], labels: readonly string[]): number {
  return items
    .filter((i) => labels.some((l) => l.toLowerCase() === i.label.toLowerCase()))
    .reduce((s, i) => s + i.cents, 0)
}

function sumItems(items: WhPayrollBreakdownItem[]): number {
  return items.reduce((s, i) => s + i.cents, 0)
}

function namedTotal(items: WhPayrollBreakdownItem[], labelSets: Record<string, readonly string[]>): number {
  return Object.values(labelSets).reduce((s, labels) => s + pick(items, labels), 0)
}

export function whEmptyEmployerTaxes(): WhEmployerTaxBreakdown {
  return {
    socialSecurityCents: 0, medicareCents: 0, futaCents: 0, caEttCents: 0, caSuiCents: 0,
    otherCents: 0, totalCents: 0, items: [],
  }
}

export function whEmptyEmployeeTaxes(): WhEmployeeTaxBreakdown {
  return {
    federalIncomeCents: 0, socialSecurityCents: 0, medicareCents: 0, caIncomeCents: 0,
    caSdiCents: 0, otherCents: 0, totalCents: 0, items: [],
  }
}

/** Zeros — what a line with no `detail` contributes to a period. */
export function whEmptyCosts(): WhPayrollEmployeeCosts {
  return {
    employerTaxesCents: 0,
    contributionsCents: 0,
    totalCostCents: 0,
    employerTaxes: whEmptyEmployerTaxes(),
    employeeTaxes: whEmptyEmployeeTaxes(),
    contributions: [],
    earnings: [],
  }
}

/**
 * One employee's employer-side figures, read out of their `detail` column.
 *
 * Every figure prefers the report's OWN total row when the report wrote one, and falls back to
 * the sum of that group's items when it did not — the four employees on the real file with no
 * company contribution have no 'Company contributions - total' key at all, and $0 is the right
 * answer for them, not a gap. `totalCost` falls back to the identity the report satisfies
 * (gross + employer taxes + contributions) so a period always has a cost to show.
 *
 * `grossCents` and `taxesCents` are the line's promoted columns, used only as those fallbacks.
 */
export function whCostsFromDetail(
  detail: DetailMap,
  line: { grossCents: number; taxesCents: number },
): WhPayrollEmployeeCosts {
  const employerItems = group(detail, PREFIX.employerTax)
  const employeeItems = group(detail, PREFIX.employeeTax)
  const contributionItems = group(detail, PREFIX.contribution)
  const earningItems = group(detail, PREFIX.earnings)

  const employerTaxesCents = has(detail, WH_PAYROLL_ITEM.employerTaxesTotal)
    ? cents(detail![WH_PAYROLL_ITEM.employerTaxesTotal])
    : sumItems(employerItems)

  const contributionsCents = has(detail, WH_PAYROLL_ITEM.contributionsTotal)
    ? cents(detail![WH_PAYROLL_ITEM.contributionsTotal])
    : sumItems(contributionItems)

  const totalCostCents = has(detail, WH_PAYROLL_ITEM.totalCost)
    ? cents(detail![WH_PAYROLL_ITEM.totalCost])
    : line.grossCents + employerTaxesCents + contributionsCents

  const employeeTaxesCents = has(detail, WH_PAYROLL_ITEM.employeeTaxesTotal)
    ? cents(detail![WH_PAYROLL_ITEM.employeeTaxesTotal])
    : employeeItems.length > 0
      ? sumItems(employeeItems)
      : line.taxesCents

  return {
    employerTaxesCents,
    contributionsCents,
    totalCostCents,
    employerTaxes: {
      socialSecurityCents: pick(employerItems, EMPLOYER_TAX_LABELS.socialSecurityCents),
      medicareCents: pick(employerItems, EMPLOYER_TAX_LABELS.medicareCents),
      futaCents: pick(employerItems, EMPLOYER_TAX_LABELS.futaCents),
      caEttCents: pick(employerItems, EMPLOYER_TAX_LABELS.caEttCents),
      caSuiCents: pick(employerItems, EMPLOYER_TAX_LABELS.caSuiCents),
      otherCents: sumItems(employerItems) - namedTotal(employerItems, EMPLOYER_TAX_LABELS),
      totalCents: employerTaxesCents,
      items: ranked(employerItems),
    },
    employeeTaxes: {
      federalIncomeCents: pick(employeeItems, EMPLOYEE_TAX_LABELS.federalIncomeCents),
      socialSecurityCents: pick(employeeItems, EMPLOYEE_TAX_LABELS.socialSecurityCents),
      medicareCents: pick(employeeItems, EMPLOYEE_TAX_LABELS.medicareCents),
      caIncomeCents: pick(employeeItems, EMPLOYEE_TAX_LABELS.caIncomeCents),
      caSdiCents: pick(employeeItems, EMPLOYEE_TAX_LABELS.caSdiCents),
      otherCents: sumItems(employeeItems) - namedTotal(employeeItems, EMPLOYEE_TAX_LABELS),
      totalCents: employeeTaxesCents,
      items: ranked(employeeItems),
    },
    contributions: ranked(contributionItems),
    earnings: ranked(earningItems),
  }
}

/** A line's employer side, or zeros when the caller shipped none. */
export function whCostsOf(row: WhPayrollLineRow): WhPayrollEmployeeCosts {
  return row.costs ?? whEmptyCosts()
}

/** Label-keyed items added together, biggest first — how a period sums its employees' items. */
function mergeItems(lists: WhPayrollBreakdownItem[][]): WhPayrollBreakdownItem[] {
  const byLabel = new Map<string, number>()
  for (const list of lists) {
    for (const item of list) byLabel.set(item.label, (byLabel.get(item.label) ?? 0) + item.cents)
  }
  return ranked([...byLabel].map(([label, c]) => ({ label, cents: c })))
}

/** Several employees' employer-side figures added together. */
export function whSumCosts(all: WhPayrollEmployeeCosts[]): WhPayrollEmployeeCosts {
  const sum = (f: (c: WhPayrollEmployeeCosts) => number) => all.reduce((s, c) => s + f(c), 0)
  const et = (f: (t: WhEmployerTaxBreakdown) => number) => all.reduce((s, c) => s + f(c.employerTaxes), 0)
  const pt = (f: (t: WhEmployeeTaxBreakdown) => number) => all.reduce((s, c) => s + f(c.employeeTaxes), 0)

  return {
    employerTaxesCents: sum((c) => c.employerTaxesCents),
    contributionsCents: sum((c) => c.contributionsCents),
    totalCostCents: sum((c) => c.totalCostCents),
    employerTaxes: {
      socialSecurityCents: et((t) => t.socialSecurityCents),
      medicareCents: et((t) => t.medicareCents),
      futaCents: et((t) => t.futaCents),
      caEttCents: et((t) => t.caEttCents),
      caSuiCents: et((t) => t.caSuiCents),
      otherCents: et((t) => t.otherCents),
      totalCents: et((t) => t.totalCents),
      items: mergeItems(all.map((c) => c.employerTaxes.items)),
    },
    employeeTaxes: {
      federalIncomeCents: pt((t) => t.federalIncomeCents),
      socialSecurityCents: pt((t) => t.socialSecurityCents),
      medicareCents: pt((t) => t.medicareCents),
      caIncomeCents: pt((t) => t.caIncomeCents),
      caSdiCents: pt((t) => t.caSdiCents),
      otherCents: pt((t) => t.otherCents),
      totalCents: pt((t) => t.totalCents),
      items: mergeItems(all.map((c) => c.employeeTaxes.items)),
    },
    contributions: mergeItems(all.map((c) => c.contributions)),
    earnings: mergeItems(all.map((c) => c.earnings)),
  }
}

/**
 * The employer-side totals for EVERY period, from the periods' lines.
 *
 * The periods table stores only the four employee-facing totals, so the series' cost line is
 * derived here — from each line's `detail` — rather than from a new column. Lines whose period
 * is not in the list are ignored.
 */
export function whPeriodCostTotals(
  lines: { periodId: string; detail: DetailMap; grossCents: number; taxesCents: number }[],
): Map<string, { employerTaxesCents: number; contributionsCents: number; totalCostCents: number }> {
  const byPeriod = new Map<string, WhPayrollEmployeeCosts[]>()
  for (const l of lines) {
    const costs = whCostsFromDetail(l.detail, l)
    const list = byPeriod.get(l.periodId)
    if (list) list.push(costs)
    else byPeriod.set(l.periodId, [costs])
  }

  const out = new Map<string, { employerTaxesCents: number; contributionsCents: number; totalCostCents: number }>()
  for (const [periodId, list] of byPeriod) {
    const s = whSumCosts(list)
    out.set(periodId, {
      employerTaxesCents: s.employerTaxesCents,
      contributionsCents: s.contributionsCents,
      totalCostCents: s.totalCostCents,
    })
  }
  return out
}

/** A period's total cost: the stored figure when there is one, otherwise the identity. */
export function whPeriodTotalCostCents(p: WhPayrollPeriodRow): number {
  return (
    p.totalCostTotalCents ??
    p.grossTotalCents + (p.employerTaxesTotalCents ?? 0) + (p.contributionsTotalCents ?? 0)
  )
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
      case 'cost':  return whCostsOf(b).totalCostCents - whCostsOf(a).totalCostCents || a.employeeName.localeCompare(b.employeeName)
      default:      return b.grossCents - a.grossCents || a.employeeName.localeCompare(b.employeeName)
    }
  })

  const totalHours = sumHours(rows.map((r) => r.hours))
  const grossCents = rows.reduce((s, r) => s + r.grossCents, 0)
  const costs = whSumCosts(rows.map((r) => whCostsOf(r)))

  return {
    employeeCount: rows.length,
    activeCount: rows.filter((r) => r.isActive).length,
    inactiveCount: rows.filter((r) => !r.isActive).length,
    totalHours,
    grossCents,
    taxesCents: rows.reduce((s, r) => s + r.taxesCents, 0),
    netCents: rows.reduce((s, r) => s + r.netCents, 0),
    averageHourlyCents: totalHours > 0 ? Math.round(grossCents / totalHours) : null,
    employerTaxesCents: costs.employerTaxesCents,
    contributionsCents: costs.contributionsCents,
    totalCostCents: costs.totalCostCents,
    employerTaxes: costs.employerTaxes,
    employeeTaxes: costs.employeeTaxes,
    contributions: costs.contributions,
    earnings: costs.earnings,
    reconciles:
      grossCents + costs.employerTaxesCents + costs.contributionsCents === costs.totalCostCents,
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
  /** The employer side of the period — 0 when nothing was derived for it. */
  employerTaxesTotalCents: number
  contributionsTotalCents: number
  /** What WH actually paid: gross + employer taxes + contributions. */
  totalCostCents: number
  /** Change in gross from the period before it in the series — null for the earliest. */
  grossChangeCents: number | null
  /** The same change as a share of the previous period's gross — null if that was zero. */
  grossChangePct: number | null
  /** The same two, for total payroll cost — the line the trend is plotted on. */
  totalCostChangeCents: number | null
  totalCostChangePct: number | null
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
    const totalCostCents = whPeriodTotalCostCents(p)
    const prevCost = prev ? whPeriodTotalCostCents(prev) : null
    const totalCostChangeCents = prevCost === null ? null : totalCostCents - prevCost
    return {
      periodId: p.id,
      periodStart: p.periodStart,
      periodEnd: p.periodEnd,
      employeeCount: p.employeeCount,
      totalHours: p.totalHours,
      grossTotalCents: p.grossTotalCents,
      netTotalCents: p.netTotalCents,
      employerTaxesTotalCents: p.employerTaxesTotalCents ?? 0,
      contributionsTotalCents: p.contributionsTotalCents ?? 0,
      totalCostCents,
      grossChangeCents,
      grossChangePct:
        prev && prev.grossTotalCents !== 0 && grossChangeCents !== null
          ? (grossChangeCents / prev.grossTotalCents) * 100
          : null,
      totalCostChangeCents,
      totalCostChangePct:
        prevCost !== null && prevCost !== 0 && totalCostChangeCents !== null
          ? (totalCostChangeCents / prevCost) * 100
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
