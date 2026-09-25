import { describe, it, expect } from 'vitest'
import {
  summarizeWhPayrollPeriod,
  whPayrollTrend,
  whPeriodsNewestFirst,
  whCostsFromDetail,
  whCostsOf,
  whEmptyCosts,
  whSumCosts,
  whPeriodCostTotals,
  whPeriodTotalCostCents,
  formatWhPeriod,
  sumHours,
  WH_PAYROLL_ITEM,
  type WhPayrollLineRow,
  type WhPayrollPeriodRow,
} from './payroll-summary'

const line = (
  name: string,
  hours: number,
  gross: number,
  taxes: number,
  net: number,
  isActive = true,
): WhPayrollLineRow => ({
  id: name, employeeName: name, isActive, hours, grossCents: gross, taxesCents: taxes, netCents: net,
})

const period = (id: string, start: string, end: string, employees: number, gross: number, net = gross): WhPayrollPeriodRow => ({
  id, periodStart: start, periodEnd: end, sourceFilename: null, importedAt: null, importedBy: null,
  employeeCount: employees, totalHours: 0, grossTotalCents: gross, taxesTotalCents: 0, netTotalCents: net,
})

describe('sumHours', () => {
  it('adds decimal hours exactly — the real file lands on 677.04, not 677.0399999', () => {
    expect(sumHours([40.02, 33.55, 39.47, 44.1, 42.63, 40, 46.13, 21.8, 40, 30.45, 40, 46.25, 42.13, 80, 48.04, 42.47]))
      .toBe(677.04)
    expect(sumHours([0.1, 0.2])).toBe(0.3)
    expect(sumHours([])).toBe(0)
  })
})

describe('summarizeWhPayrollPeriod', () => {
  const lines = [
    line('Bauer Lance', 40.02, 100050, -19549, 80501),
    line('Perez-Nunez Jr Moses', 80, 307692, -50560, 257132),
    line('Ivison Mindy A', 40, 272673, -18879, 217074, false),
  ]

  it('totals hours, gross, taxes and net, and counts the inactive employee', () => {
    const s = summarizeWhPayrollPeriod(lines)
    expect(s.employeeCount).toBe(3)
    expect(s.activeCount).toBe(2)
    expect(s.inactiveCount).toBe(1)
    expect(s.totalHours).toBe(160.02)
    expect(s.grossCents).toBe(680415)
    expect(s.taxesCents).toBe(-88988)
    expect(s.netCents).toBe(554707)
  })

  it('sorts biggest gross first by default', () => {
    expect(summarizeWhPayrollPeriod(lines).rows.map((r) => r.employeeName))
      .toEqual(['Perez-Nunez Jr Moses', 'Ivison Mindy A', 'Bauer Lance'])
  })

  it('sorts by hours, net or name on request', () => {
    expect(summarizeWhPayrollPeriod(lines, 'hours').rows[0].employeeName).toBe('Perez-Nunez Jr Moses')
    expect(summarizeWhPayrollPeriod(lines, 'net').rows[0].employeeName).toBe('Perez-Nunez Jr Moses')
    expect(summarizeWhPayrollPeriod(lines, 'name').rows.map((r) => r.employeeName))
      .toEqual(['Bauer Lance', 'Ivison Mindy A', 'Perez-Nunez Jr Moses'])
  })

  it('works out an average hourly rate, and reports none when nobody logged hours', () => {
    expect(summarizeWhPayrollPeriod([line('A', 40, 100000, -1000, 99000)]).averageHourlyCents).toBe(2500)
    expect(summarizeWhPayrollPeriod([line('A', 0, 100000, -1000, 99000)]).averageHourlyCents).toBeNull()
  })

  it('handles an empty period without dividing by zero', () => {
    const s = summarizeWhPayrollPeriod([])
    expect(s).toMatchObject({ employeeCount: 0, totalHours: 0, grossCents: 0, averageHourlyCents: null })
  })

  it('does not mutate the caller’s array', () => {
    const input = [...lines]
    summarizeWhPayrollPeriod(input, 'name')
    expect(input.map((r) => r.employeeName)).toEqual(lines.map((r) => r.employeeName))
  })

  it('reads zeros for the employer side when the lines carry no derived costs at all', () => {
    const s = summarizeWhPayrollPeriod(lines)
    expect(s.employerTaxesCents).toBe(0)
    expect(s.contributionsCents).toBe(0)
    expect(s.totalCostCents).toBe(0)
    expect(s.employerTaxes.items).toEqual([])
    // Nothing derived means nothing to reconcile: gross alone ≠ a zero cost, and the view says so
    // rather than implying WH paid nothing.
    expect(s.reconciles).toBe(false)
  })
})

// ────────────────────────────────────────────────────────────────────────────────
// The employer side, out of wh_payroll_lines.detail
//
// The fixtures below are taken from the imported Sep 13 – Sep 19, 2026 period — the QBO
// "Payroll summary by employee" export WesternHighwaysTrafficTruckProducts_PayrollSummaryBy
// Employee_09242026_1134.xls — using the report's own labels and its own values in cents.
// ────────────────────────────────────────────────────────────────────────────────

/** Two real employees, with the items the report wrote for them. */
const SIORDIA_DETAIL = {
  'Hours - total': 42.47,
  'Hours - Regular Pay': 32,
  'Hours - Overtime Pay': 9.07,
  'Hours - Double Overtime Pay': 1.4,
  'Gross pay - total': 125853,
  'Gross pay - Regular Pay': 83200,
  'Gross pay - Overtime Pay': 35373,
  'Gross pay - Double Overtime Pay': 7280,
  'Gross pay - Holiday Pay': 0,
  'Adjusted gross': 125853,
  'Employee taxes - total': -22174,
  'Employee taxes - Federal Income Tax': -10910,
  'Employee taxes - Social Security': -7803,
  'Employee taxes - Medicare': -1825,
  'Employee taxes - CA Income Tax': 0,
  'Employee taxes - CA State Disability Ins': -1636,
  'Net pay': 103679,
  'Employer taxes & contributions - total': 9628,
  'Employer taxes - total': 9628,
  'Employer taxes - FUTA Employer': 0,
  'Employer taxes - Social Security Employer': 7803,
  'Employer taxes - Medicare Employer': 1825,
  'Employer taxes - CA ETT': 0,
  'Employer taxes - CA SUI Employer': 0,
  'Total payroll cost': 135481,
  adjustedGrossCents: 125853,
}

/** An employee WITH a company contribution — four of the sixteen have one. */
const WITH_CONTRIBUTION_DETAIL = {
  'Gross pay - total': 200000,
  'Gross pay - Salary': 200000,
  'Employee taxes - total': -30000,
  'Employee taxes - Federal Income Tax': -20000,
  'Employee taxes - Social Security': -8000,
  'Employee taxes - Medicare': -2000,
  'Employer taxes - total': 10000,
  'Employer taxes - Social Security Employer': 8000,
  'Employer taxes - Medicare Employer': 2000,
  'Company contributions - total': 11149,
  'Company contributions - Pre Tax Benefit Deduction': 11149,
  'Total payroll cost': 221149,
}

describe('whCostsFromDetail', () => {
  it('reads the employer side out of one real employee’s column', () => {
    const c = whCostsFromDetail(SIORDIA_DETAIL, { grossCents: 125853, taxesCents: -22174 })
    expect(c.employerTaxesCents).toBe(9628)
    expect(c.contributionsCents).toBe(0)
    expect(c.totalCostCents).toBe(135481)
    // and it adds up the way the report does
    expect(125853 + c.employerTaxesCents + c.contributionsCents).toBe(c.totalCostCents)
  })

  it('names the five employer taxes, zeros included', () => {
    const { employerTaxes } = whCostsFromDetail(SIORDIA_DETAIL, { grossCents: 125853, taxesCents: -22174 })
    expect(employerTaxes.socialSecurityCents).toBe(7803)
    expect(employerTaxes.medicareCents).toBe(1825)
    expect(employerTaxes.futaCents).toBe(0)
    expect(employerTaxes.caEttCents).toBe(0)
    expect(employerTaxes.caSuiCents).toBe(0)
    expect(employerTaxes.otherCents).toBe(0)
    expect(employerTaxes.totalCents).toBe(9628)
    // the display list drops the zero rates; the named figures above carry them
    expect(employerTaxes.items).toEqual([
      { label: 'Social Security Employer', cents: 7803 },
      { label: 'Medicare Employer', cents: 1825 },
    ])
  })

  it('names the employee withholdings, CA SDI spelled out as the report spells it', () => {
    const { employeeTaxes } = whCostsFromDetail(SIORDIA_DETAIL, { grossCents: 125853, taxesCents: -22174 })
    expect(employeeTaxes.federalIncomeCents).toBe(-10910)
    expect(employeeTaxes.socialSecurityCents).toBe(-7803)
    expect(employeeTaxes.medicareCents).toBe(-1825)
    expect(employeeTaxes.caIncomeCents).toBe(0)
    expect(employeeTaxes.caSdiCents).toBe(-1636)
    expect(employeeTaxes.otherCents).toBe(0)
    expect(employeeTaxes.totalCents).toBe(-22174)
  })

  it('accepts the short CA SDI label too', () => {
    const c = whCostsFromDetail({ 'Employee taxes - CA SDI': -500 }, { grossCents: 0, taxesCents: -500 })
    expect(c.employeeTaxes.caSdiCents).toBe(-500)
    expect(c.employeeTaxes.otherCents).toBe(0)
  })

  it('breaks the earnings out by pay type, biggest first, zero rows dropped', () => {
    const { earnings } = whCostsFromDetail(SIORDIA_DETAIL, { grossCents: 125853, taxesCents: -22174 })
    expect(earnings).toEqual([
      { label: 'Regular Pay', cents: 83200 },
      { label: 'Overtime Pay', cents: 35373 },
      { label: 'Double Overtime Pay', cents: 7280 },
    ])
    expect(earnings.reduce((s, i) => s + i.cents, 0)).toBe(125853)
  })

  it('reads a company contribution when the employee has one', () => {
    const c = whCostsFromDetail(WITH_CONTRIBUTION_DETAIL, { grossCents: 200000, taxesCents: -30000 })
    expect(c.contributionsCents).toBe(11149)
    expect(c.contributions).toEqual([{ label: 'Pre Tax Benefit Deduction', cents: 11149 }])
    expect(c.totalCostCents).toBe(221149)
  })

  it('ignores the Hours items — they are hours, not cents', () => {
    const c = whCostsFromDetail(SIORDIA_DETAIL, { grossCents: 125853, taxesCents: -22174 })
    expect(c.earnings.some((i) => i.label.includes('Hours'))).toBe(false)
    expect(c.employerTaxesCents).toBe(9628)
  })

  describe('missing keys mean $0', () => {
    it('coalesces a blank contributions cell — no key at all — to zero, not a gap', () => {
      expect(WH_PAYROLL_ITEM.contributionsTotal in SIORDIA_DETAIL).toBe(false)
      const c = whCostsFromDetail(SIORDIA_DETAIL, { grossCents: 125853, taxesCents: -22174 })
      expect(c.contributionsCents).toBe(0)
      expect(c.contributions).toEqual([])
    })

    it('falls back to the sum of the items when the report wrote no total row', () => {
      const c = whCostsFromDetail(
        {
          'Employer taxes - Social Security Employer': 7803,
          'Employer taxes - Medicare Employer': 1825,
          'Company contributions - Pre Tax Benefit Deduction': 500,
        },
        { grossCents: 125853, taxesCents: -22174 },
      )
      expect(c.employerTaxesCents).toBe(9628)
      expect(c.contributionsCents).toBe(500)
      // no 'Total payroll cost' either, so the report's own identity supplies it
      expect(c.totalCostCents).toBe(125853 + 9628 + 500)
    })

    it('gives an employee with no detail at all a zero employer side', () => {
      for (const empty of [null, undefined, {}]) {
        const c = whCostsFromDetail(empty, { grossCents: 100000, taxesCents: -1000 })
        expect(c.employerTaxesCents).toBe(0)
        expect(c.contributionsCents).toBe(0)
        expect(c.totalCostCents).toBe(100000)
        expect(c.employerTaxes.items).toEqual([])
        expect(c.earnings).toEqual([])
      }
    })

    it('treats a null or unparseable value as zero rather than NaN', () => {
      const c = whCostsFromDetail(
        { 'Employer taxes - total': null, 'Company contributions - total': 'n/a', 'Total payroll cost': undefined },
        { grossCents: 100000, taxesCents: -1000 },
      )
      expect(c.employerTaxesCents).toBe(0)
      expect(c.contributionsCents).toBe(0)
      expect(c.totalCostCents).toBe(0)
      expect(Number.isNaN(c.totalCostCents)).toBe(false)
    })

    it('falls back to the promoted taxes column when detail has no withholdings', () => {
      const c = whCostsFromDetail({ 'Employer taxes - total': 100 }, { grossCents: 100000, taxesCents: -2500 })
      expect(c.employeeTaxes.totalCents).toBe(-2500)
    })
  })

  it('whEmptyCosts and whCostsOf agree about a line with nothing derived', () => {
    expect(whCostsOf(line('A', 1, 1, -1, 1))).toEqual(whEmptyCosts())
  })
})

// ── The whole imported period ─────────────────────────────────────────────────
//
// The sixteen employees of Sep 13 – Sep 19, 2026. Only the figures this module derives are
// carried here: per-employee gross, withheld taxes, the employer taxes (all of which are Social
// Security + Medicare — FUTA, CA ETT and CA SUI are zero for every one of them on this export),
// and the four company contributions. The totals asserted below are the report's own.

const SEP_13_19: [name: string, hours: number, gross: number, taxes: number, net: number, ssEr: number, medEr: number, contribution: number][] = [
  ['Bauer Lance', 40.02, 100050, -19549, 80501, 6203, 1451, 0],
  ['Dewitt Wesley', 33.55, 82198, -14816, 67382, 5096, 1192, 0],
  ['Flores Marcus R', 39.47, 102622, -20256, 82366, 6362, 1488, 0],
  ['Garrison Jr Jon E', 44.1, 153561, -27515, 126046, 9521, 2226, 0],
  ['Gonzalez Roberto', 42.63, 107300, -21545, 85755, 6653, 1555, 0],
  ['Greer Jacob A', 40, 189826, -24589, 131413, 9672, 2262, 33824],
  ['Ivison Mindy A', 46.13, 148013, -25904, 122109, 7627, 1783, 0],
  ['Ivison Thatcher R', 21.8, 59950, -9209, 50741, 3716, 869, 0],
  ['Ivison Travis', 40, 272673, -18879, 217074, 13079, 3058, 0],
  ['Lopez Anthony', 30.45, 86996, -12935, 74061, 5394, 1262, 0],
  ['Marcom Gregory', 40, 120000, -20875, 99125, 7440, 1740, 0],
  ['Mayberry Christine D', 46.25, 191425, -38436, 129048, 9647, 2256, 10772],
  ['Mayberry Heaven C', 42.13, 112788, -21671, 80643, 6344, 1483, 0],
  ['Perez-Nunez Jr Moses', 80, 307692, -50560, 257132, 19077, 4461, 0],
  ['Rodriguez Jacob J', 48.04, 198786, -40216, 149882, 9964, 2330, 0],
  ['Siordia Jr Michael', 42.47, 125853, -22174, 103679, 7803, 1825, 0],
]

/** Each employee as the server hands them to the view: costs derived from their detail. */
const sepLines: WhPayrollLineRow[] = SEP_13_19.map(([name, hours, gross, taxes, net, ssEr, medEr, contribution]) => {
  const employerTaxes = ssEr + medEr
  const detail: Record<string, number> = {
    'Hours - total': hours,
    'Gross pay - total': gross,
    'Gross pay - Regular Pay': gross,
    'Employee taxes - total': taxes,
    'Employer taxes - total': employerTaxes,
    'Employer taxes - Social Security Employer': ssEr,
    'Employer taxes - Medicare Employer': medEr,
    'Employer taxes - FUTA Employer': 0,
    'Employer taxes - CA ETT': 0,
    'Employer taxes - CA SUI Employer': 0,
    'Total payroll cost': gross + employerTaxes + contribution,
  }
  // The twelve employees with no company contribution have NO contributions key at all — the
  // report leaves the cell blank — which is exactly the coalescing case.
  if (contribution !== 0) {
    detail['Company contributions - total'] = contribution
    detail['Company contributions - Pre Tax Benefit Deduction'] = contribution
  }
  return {
    id: name,
    employeeName: name,
    isActive: name !== 'Ivison Mindy A',
    hours,
    grossCents: gross,
    taxesCents: taxes,
    netCents: net,
    costs: whCostsFromDetail(detail, { grossCents: gross, taxesCents: taxes }),
  }
})

describe('the imported Sep 13 – Sep 19, 2026 period', () => {
  const s = summarizeWhPayrollPeriod(sepLines)

  it('reproduces the four employee-facing totals', () => {
    expect(s.employeeCount).toBe(16)
    expect(s.totalHours).toBe(677.04)
    expect(s.grossCents).toBe(2359733)      // $23,597.33
    expect(s.taxesCents).toBe(-389129)      // -$3,891.29
    expect(s.netCents).toBe(1856957)
  })

  it('derives the employer taxes — $1,648.39, all Social Security and Medicare', () => {
    expect(s.employerTaxesCents).toBe(164839)
    expect(s.employerTaxes.socialSecurityCents).toBe(133598)  // $1,335.98
    expect(s.employerTaxes.medicareCents).toBe(31241)         // $312.41
    expect(s.employerTaxes.futaCents).toBe(0)
    expect(s.employerTaxes.caEttCents).toBe(0)
    expect(s.employerTaxes.caSuiCents).toBe(0)
    expect(s.employerTaxes.socialSecurityCents + s.employerTaxes.medicareCents).toBe(s.employerTaxesCents)
  })

  it('derives the company contributions — $445.96, from the two employees who have one', () => {
    expect(s.contributionsCents).toBe(44596)
    expect(s.contributions).toEqual([{ label: 'Pre Tax Benefit Deduction', cents: 44596 }])
    expect(sepLines.filter((l) => whCostsOf(l).contributionsCents !== 0)).toHaveLength(2)
  })

  it('derives the total payroll cost — $25,691.68 — and it reconciles', () => {
    expect(s.totalCostCents).toBe(2569168)
    expect(s.grossCents + s.employerTaxesCents + s.contributionsCents).toBe(s.totalCostCents)
    expect(s.reconciles).toBe(true)
    // the acceptance arithmetic, spelled out in dollars
    expect(23597.33 + 1648.39 + 445.96).toBeCloseTo(25691.68, 2)
  })

  it('costs a single employee: Siordia Jr Michael at $1,354.81', () => {
    const row = s.rows.find((r) => r.employeeName === 'Siordia Jr Michael')!
    const c = whCostsOf(row)
    expect(c.employerTaxesCents).toBe(9628)
    expect(c.contributionsCents).toBe(0)
    expect(c.totalCostCents).toBe(135481)
  })

  it('sorts by total cost when asked — the most expensive employee first', () => {
    const byCost = summarizeWhPayrollPeriod(sepLines, 'cost').rows
    expect(byCost[0].employeeName).toBe('Perez-Nunez Jr Moses')
    expect(whCostsOf(byCost[0]).totalCostCents).toBe(307692 + 19077 + 4461)   // $3,312.30
    expect(whCostsOf(byCost[0]).totalCostCents).toBeGreaterThan(whCostsOf(byCost[1]).totalCostCents)
  })

  it('still reconciles with the inactive employee filtered out', () => {
    const active = summarizeWhPayrollPeriod(sepLines.filter((l) => l.isActive))
    expect(active.employeeCount).toBe(15)
    expect(active.grossCents + active.employerTaxesCents + active.contributionsCents).toBe(active.totalCostCents)
    expect(active.reconciles).toBe(true)
    // Mindy A's own cost drops out of the total
    expect(s.totalCostCents - active.totalCostCents).toBe(148013 + 7627 + 1783)
  })
})

describe('whSumCosts', () => {
  it('is zero for nothing, and merges items by label', () => {
    expect(whSumCosts([])).toEqual(whEmptyCosts())
    const a = whCostsFromDetail({ 'Employer taxes - Social Security Employer': 100, 'Gross pay - Regular Pay': 1000 }, { grossCents: 1000, taxesCents: 0 })
    const b = whCostsFromDetail({ 'Employer taxes - Social Security Employer': 250, 'Gross pay - Overtime Pay': 500 }, { grossCents: 500, taxesCents: 0 })
    const sum = whSumCosts([a, b])
    expect(sum.employerTaxes.socialSecurityCents).toBe(350)
    expect(sum.employerTaxesCents).toBe(350)
    expect(sum.earnings).toEqual([
      { label: 'Regular Pay', cents: 1000 },
      { label: 'Overtime Pay', cents: 500 },
    ])
  })
})

describe('whPeriodCostTotals', () => {
  it('adds each period’s employer side up separately', () => {
    const totals = whPeriodCostTotals([
      { periodId: 'p1', grossCents: 1000, taxesCents: -100, detail: { 'Employer taxes - total': 80, 'Total payroll cost': 1080 } },
      { periodId: 'p1', grossCents: 2000, taxesCents: -200, detail: { 'Employer taxes - total': 160, 'Company contributions - total': 40, 'Total payroll cost': 2200 } },
      { periodId: 'p2', grossCents: 500, taxesCents: -50, detail: { 'Employer taxes - total': 40, 'Total payroll cost': 540 } },
      { periodId: 'p3', grossCents: 700, taxesCents: -70, detail: null },
    ])
    expect(totals.get('p1')).toEqual({ employerTaxesCents: 240, contributionsCents: 40, totalCostCents: 3280 })
    expect(totals.get('p2')).toEqual({ employerTaxesCents: 40, contributionsCents: 0, totalCostCents: 540 })
    // no detail: the identity still gives a cost, gross with nothing on top
    expect(totals.get('p3')).toEqual({ employerTaxesCents: 0, contributionsCents: 0, totalCostCents: 700 })
    expect(totals.has('p4')).toBe(false)
  })

  it('is empty for no lines', () => {
    expect(whPeriodCostTotals([]).size).toBe(0)
  })
})

describe('whPeriodTotalCostCents', () => {
  it('uses the derived cost when the server sent one', () => {
    expect(whPeriodTotalCostCents({ ...period('a', '2026-09-13', '2026-09-19', 16, 2359733), totalCostTotalCents: 2569168 }))
      .toBe(2569168)
  })

  it('falls back to gross + employer taxes + contributions, then to gross alone', () => {
    expect(whPeriodTotalCostCents({
      ...period('a', '2026-09-13', '2026-09-19', 16, 2359733),
      employerTaxesTotalCents: 164839,
      contributionsTotalCents: 44596,
    })).toBe(2569168)
    expect(whPeriodTotalCostCents(period('a', '2026-09-13', '2026-09-19', 16, 2359733))).toBe(2359733)
  })
})

describe('whPayrollTrend', () => {
  const periods = [
    period('c', '2026-09-20', '2026-09-26', 15, 2200000),
    period('a', '2026-09-06', '2026-09-12', 16, 2000000),
    period('b', '2026-09-13', '2026-09-19', 16, 2359733),
  ]

  it('returns the series oldest first, whatever order it was handed', () => {
    expect(whPayrollTrend(periods).map((p) => p.periodId)).toEqual(['a', 'b', 'c'])
  })

  it('carries each period’s change from the one before it', () => {
    const t = whPayrollTrend(periods)
    expect(t[0].grossChangeCents).toBeNull()
    expect(t[0].grossChangePct).toBeNull()
    expect(t[0].headcountChange).toBeNull()

    expect(t[1].grossChangeCents).toBe(359733)
    expect(t[1].grossChangePct).toBeCloseTo(17.99, 2)
    expect(t[1].headcountChange).toBe(0)

    expect(t[2].grossChangeCents).toBe(-159733)
    expect(t[2].headcountChange).toBe(-1)
  })

  it('reports no percentage when the previous period was zero', () => {
    const t = whPayrollTrend([period('x', '2026-09-06', '2026-09-12', 0, 0), period('y', '2026-09-13', '2026-09-19', 2, 5000)])
    expect(t[1].grossChangeCents).toBe(5000)
    expect(t[1].grossChangePct).toBeNull()
  })

  it('leaves a gap in the series as a gap, not a zero week', () => {
    const t = whPayrollTrend([period('x', '2026-09-06', '2026-09-12', 16, 100), period('y', '2026-09-27', '2026-10-03', 16, 120)])
    expect(t).toHaveLength(2)
    expect(t[1].grossChangeCents).toBe(20)
  })

  it('is empty for no periods and has no change for a single one', () => {
    expect(whPayrollTrend([])).toEqual([])
    expect(whPayrollTrend([period('only', '2026-09-13', '2026-09-19', 16, 100)])[0].grossChangeCents).toBeNull()
  })

  it('plots total payroll cost, with its own change from the period before', () => {
    const t = whPayrollTrend([
      { ...period('a', '2026-09-06', '2026-09-12', 16, 2000000), employerTaxesTotalCents: 140000, contributionsTotalCents: 40000, totalCostTotalCents: 2180000 },
      { ...period('b', '2026-09-13', '2026-09-19', 16, 2359733), employerTaxesTotalCents: 164839, contributionsTotalCents: 44596, totalCostTotalCents: 2569168 },
    ])
    expect(t[0].totalCostCents).toBe(2180000)
    expect(t[0].totalCostChangeCents).toBeNull()
    expect(t[0].totalCostChangePct).toBeNull()

    expect(t[1].employerTaxesTotalCents).toBe(164839)
    expect(t[1].contributionsTotalCents).toBe(44596)
    expect(t[1].totalCostCents).toBe(2569168)
    expect(t[1].totalCostChangeCents).toBe(389168)
    expect(t[1].totalCostChangePct).toBeCloseTo(17.85, 2)
  })

  it('shows zeros, and gross as the cost, for a period whose employer side was never derived', () => {
    const t = whPayrollTrend([period('a', '2026-09-13', '2026-09-19', 16, 2359733)])
    expect(t[0].employerTaxesTotalCents).toBe(0)
    expect(t[0].contributionsTotalCents).toBe(0)
    expect(t[0].totalCostCents).toBe(2359733)
  })
})

describe('whPeriodsNewestFirst', () => {
  it('puts the latest period first — the order the picker uses', () => {
    expect(whPeriodsNewestFirst([
      period('a', '2026-09-06', '2026-09-12', 16, 1),
      period('c', '2026-09-20', '2026-09-26', 16, 1),
      period('b', '2026-09-13', '2026-09-19', 16, 1),
    ]).map((p) => p.id)).toEqual(['c', 'b', 'a'])
  })
})

describe('formatWhPeriod', () => {
  it('names the year once when the period stays inside it', () => {
    expect(formatWhPeriod('2026-09-13', '2026-09-19')).toBe('Sep 13 – Sep 19, 2026')
  })

  it('names both years when the period straddles one', () => {
    expect(formatWhPeriod('2025-12-28', '2026-01-03')).toBe('Dec 28, 2025 – Jan 3, 2026')
  })
})
