import { describe, it, expect } from 'vitest'
import {
  summarizeWhPayrollPeriod,
  whPayrollTrend,
  whPeriodsNewestFirst,
  formatWhPeriod,
  sumHours,
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
