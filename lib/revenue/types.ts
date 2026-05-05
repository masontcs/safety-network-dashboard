export type ParsedRevenueRecord = {
  branchName: string     // normalized branch name
  entityCode: string     // INC | TCS | STS
  labor: number
  rental: number
  oneTimeCharges: number
  salesTax: number
  totalRevenue: number   // labor + rental + oneTimeCharges (never includes salesTax)
}

export type RevenueParseResult = {
  periodDate: string           // ISO date, always a Saturday
  records: ParsedRevenueRecord[]
  warnings: string[]
}
