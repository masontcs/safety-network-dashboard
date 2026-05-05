import { parse as parseCsv } from 'csv-parse/sync'
import { parse as parseDate, format, isValid } from 'date-fns'
import { ParseError } from '@/lib/utils/errors'
import { round2 } from '@/lib/utils/format'
import type { ParsedFuelTransaction } from './types'

// "CA-CITY OF BAKERSFIELD" → { state: "CA", city: "Bakersfield" }
// If the pattern doesn't match, store the full siteName as city and leave state empty.
function parseInterstateSite(siteName: string): { city: string; state: string } {
  const dashIdx = siteName.indexOf('-')
  if (dashIdx < 0) return { city: siteName.trim(), state: '' }

  const state = siteName.slice(0, dashIdx).trim()
  const rest  = siteName.slice(dashIdx + 1).trim()
  // Strip "CITY OF " prefix
  const city  = rest.replace(/^city of\s+/i, '').trim()

  if (state.length !== 2 || !city) return { city: siteName.trim(), state: '' }

  return {
    state,
    city: city.charAt(0).toUpperCase() + city.slice(1).toLowerCase(),
  }
}

// "MM/DD/YYYY" → "yyyy-MM-dd"
function parseInterstateDate(raw: string): string {
  const parsed = parseDate(raw.trim(), 'MM/dd/yyyy', new Date())
  if (!isValid(parsed)) throw new ParseError(`Invalid transaction date "${raw}" in Interstate file.`)
  return format(parsed, 'yyyy-MM-dd')
}

// "HH:MM AM/PM" → "HH:MM:SS" (24-hour, with :00 seconds)
function parseInterstateTime(raw: string): string {
  const parsed = parseDate(raw.trim(), 'hh:mm aa', new Date())
  if (!isValid(parsed)) return raw.trim()
  return format(parsed, 'HH:mm:ss')
}

export function parseInterstateCSV(buffer: Buffer): ParsedFuelTransaction[] {
  const rows = parseCsv(buffer, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as Record<string, string>[]

  if (rows.length === 0) throw new ParseError('Interstate CSV file is empty.')

  return rows.map((row, idx) => {
    const cardName    = row['Card_Description'] ?? ''
    const rawDate     = row['Trans_Date'] ?? ''
    const rawTime     = row['Trans_Time'] ?? ''
    const product     = row['Product_Desc'] ?? ''
    const gallons     = parseFloat(row['Quantity'] ?? '0') || 0
    const pricePer    = parseFloat(row['Price'] ?? '0') || 0
    const rawSiteName = row['Site_Name'] ?? ''
    const rawMpg      = row['MPG'] ?? ''

    if (!cardName) throw new ParseError(`Missing Card_Description in Interstate row ${idx + 2}.`)
    if (!rawDate)  throw new ParseError(`Missing Trans_Date in Interstate row ${idx + 2}.`)

    // Sum all five tax components — never read a pre-calculated total column
    const fedTax    = parseFloat(row['Federal_Tax']  ?? '0') || 0
    const stateTax  = parseFloat(row['State_Tax']    ?? '0') || 0
    const local1    = parseFloat(row['Local_Tax1']   ?? '0') || 0
    const local2    = parseFloat(row['Local_Tax2']   ?? '0') || 0
    const salesTax  = parseFloat(row['Sales_Tax']    ?? '0') || 0
    const tax       = round2(fedTax + stateTax + local1 + local2 + salesTax)

    const totalPretax  = round2(gallons * pricePer)
    const totalWithTax = round2(totalPretax + tax)
    const { city, state } = parseInterstateSite(rawSiteName)

    const mpgVal = parseFloat(rawMpg)
    const mpg = Number.isFinite(mpgVal) && mpgVal > 0 ? round2(mpgVal) : null

    return {
      cardName:        cardName.trim(),
      transactionDate: parseInterstateDate(rawDate),
      transactionTime: parseInterstateTime(rawTime),
      siteName:        rawSiteName.trim(),
      siteCity:        city,
      siteState:       state,
      product:         product.trim(),
      gallons:         round2(gallons),
      pricePerGallon:  round2(pricePer),
      totalPretax,
      tax,
      totalWithTax,
      mpg,
      businessTag:     null,
    }
  })
}
