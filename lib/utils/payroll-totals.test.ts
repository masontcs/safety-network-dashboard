import { describe, it, expect } from 'vitest'
import { calcTotalPayroll, calcGrossProfit, calcGrossProfitPct } from './payroll-totals'

describe('calcTotalPayroll', () => {
  it('sums all three components', () => {
    expect(calcTotalPayroll({ directPayroll: 5000, adminPayroll: 3000, employerTaxes: 800 })).toBe(8800)
  })

  it('treats missing adminPayroll as 0', () => {
    expect(calcTotalPayroll({ directPayroll: 5000, employerTaxes: 500 })).toBe(5500)
  })

  it('treats missing employerTaxes as 0', () => {
    expect(calcTotalPayroll({ directPayroll: 5000, adminPayroll: 2000 })).toBe(7000)
  })

  it('treats all optional fields as 0 when only direct is provided', () => {
    expect(calcTotalPayroll({ directPayroll: 1234.56 })).toBe(1234.56)
  })

  it('card header total equals sum of direct + admin + taxes (consistency check)', () => {
    const direct = 12172.84
    const admin = 0
    const taxes = 0
    const cardHeaderTotal = calcTotalPayroll({ directPayroll: direct, adminPayroll: admin, employerTaxes: taxes })
    expect(cardHeaderTotal).toBe(direct + admin + taxes)
  })

  it('sparkline payroll data point uses the same formula as card header', () => {
    const weekData = { directTotal: 8000, adminTotal: 3000, taxTotal: 500 }
    // Card header calculation (AdminDashboard / DistrictDashboard aggregated totals)
    const cardTotal = weekData.directTotal + weekData.adminTotal + weekData.taxTotal
    // Sparkline calculation (now uses calcTotalPayroll via payrollByPeriod)
    const sparklineTotal = calcTotalPayroll({
      directPayroll: weekData.directTotal,
      adminPayroll: weekData.adminTotal,
      employerTaxes: weekData.taxTotal,
    })
    expect(sparklineTotal).toBe(cardTotal)
  })
})

describe('calcGrossProfit', () => {
  it('revenue minus total payroll minus fuel', () => {
    const gp = calcGrossProfit({ revenue: 100000, directPayroll: 40000, adminPayroll: 10000, employerTaxes: 2000, fuel: 5000 })
    expect(gp).toBe(43000)
  })

  it('uses all three payroll components (not just direct)', () => {
    const gpDirectOnly = 100000 - 40000 - 5000   // what the old buggy code computed
    const gpCorrect = calcGrossProfit({ revenue: 100000, directPayroll: 40000, adminPayroll: 10000, employerTaxes: 2000, fuel: 5000 })
    expect(gpCorrect).toBeLessThan(gpDirectOnly)
    expect(gpCorrect).toBe(43000)
  })

  it('returns negative value when costs exceed revenue', () => {
    const gp = calcGrossProfit({ revenue: 10000, directPayroll: 8000, adminPayroll: 3000, employerTaxes: 500, fuel: 1000 })
    expect(gp).toBe(-2500)
  })

  it('treats missing optional fields as 0', () => {
    const gp = calcGrossProfit({ revenue: 50000, directPayroll: 30000, fuel: 5000 })
    expect(gp).toBe(15000)
  })

  it('gross profit === revenue - (direct + admin + taxes) - fuel', () => {
    const data = { revenue: 75000, directPayroll: 30000, adminPayroll: 8000, employerTaxes: 1500, fuel: 4000 }
    const expected = data.revenue - (data.directPayroll + data.adminPayroll + data.employerTaxes) - data.fuel
    expect(calcGrossProfit(data)).toBe(expected)
  })
})

describe('calcGrossProfitPct', () => {
  it('returns correct percentage', () => {
    expect(calcGrossProfitPct(20000, 100000)).toBe(20)
  })

  it('returns 0 when revenue is 0 (no division by zero)', () => {
    expect(calcGrossProfitPct(0, 0)).toBe(0)
    expect(calcGrossProfitPct(5000, 0)).toBe(0)
  })

  it('returns negative percentage when gross profit is negative', () => {
    expect(calcGrossProfitPct(-5000, 100000)).toBe(-5)
  })

  it('profit % === gross profit / revenue × 100', () => {
    const gp = 15000
    const rev = 80000
    expect(calcGrossProfitPct(gp, rev)).toBeCloseTo((gp / rev) * 100, 10)
  })
})

describe('payroll calculation consistency', () => {
  it('all three formulas agree for a given branch+period', () => {
    const branchData = {
      revenue: 95000,
      directPayroll: 35000,
      adminPayroll: 12000,
      employerTaxes: 2800,
      fuel: 6500,
    }

    const totalPayroll = calcTotalPayroll(branchData)
    const grossProfit = calcGrossProfit(branchData)
    const gpPct = calcGrossProfitPct(grossProfit, branchData.revenue)

    // Card header and sparkline data point use the same total
    expect(totalPayroll).toBe(35000 + 12000 + 2800)

    // Gross profit equals revenue minus total payroll minus fuel
    expect(grossProfit).toBe(branchData.revenue - totalPayroll - branchData.fuel)

    // Profit % derived from gross profit and revenue
    expect(gpPct).toBeCloseTo((grossProfit / branchData.revenue) * 100, 10)
  })
})
