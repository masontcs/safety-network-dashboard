export function calcTotalPayroll(data: {
  directPayroll: number
  adminPayroll?: number
  employerTaxes?: number
}): number {
  return (data.directPayroll ?? 0) + (data.adminPayroll ?? 0) + (data.employerTaxes ?? 0)
}

export function calcGrossProfit(data: {
  revenue: number
  directPayroll: number
  adminPayroll?: number
  employerTaxes?: number
  fuel: number
}): number {
  return data.revenue - calcTotalPayroll(data) - (data.fuel ?? 0)
}

export function calcGrossProfitPct(grossProfit: number, revenue: number): number {
  if (revenue === 0) return 0
  return (grossProfit / revenue) * 100
}
