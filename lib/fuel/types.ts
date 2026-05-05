import type { BusinessTag, Vendor } from '@/lib/supabase/database.types'

export type ParsedFuelTransaction = {
  cardName: string
  transactionDate: string  // ISO date
  transactionTime: string  // "HH:MM:SS"
  siteName: string
  siteCity: string
  siteState: string
  product: string
  gallons: number
  pricePerGallon: number
  totalPretax: number
  tax: number
  totalWithTax: number
  mpg: number | null
  businessTag: BusinessTag | null
}

export type FuelParseResult = {
  vendor: Vendor
  dateRangeStart: string           // ISO date — earliest transaction in file
  dateRangeEnd: string             // ISO date — latest transaction in file
  transactions: ParsedFuelTransaction[]
  newCardNames: string[]           // card names not yet in fuel_card_assignments
  warnings: string[]
}
