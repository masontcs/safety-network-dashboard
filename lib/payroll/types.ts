export type PayrollLineItem = {
  itemName: string
  hours: number | null
  rate: number | null
  amount: number
}

export type ParsedEmployee = {
  rawName: string               // exactly as in report — stored as raw_name_in_report
  autoFirstName: string         // from splitLegalName — default preferred first name
  autoLastName: string          // from splitLegalName — default preferred last name
  nameFormatUnexpected: boolean // true if no comma found — needs admin review
  lineItems: PayrollLineItem[]
  taxAmount: number
}

export type PayrollParseResult = {
  periodDate: string      // ISO date string, always a Saturday
  entityCode: string      // INC | TCS | STS
  payrollItems: string[]  // ordered list of item names from col D
  employees: ParsedEmployee[]
  warnings: string[]
}
