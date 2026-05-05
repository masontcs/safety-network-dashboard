import * as XLSX from 'xlsx'
import { parse as parseDate, format, isValid } from 'date-fns'
import { ParseError } from '@/lib/utils/errors'
import { round2 } from '@/lib/utils/format'
import type { ParsedFuelTransaction } from './types'
import type { BusinessTag } from '@/lib/supabase/database.types'

// "MM/DD/YYYY" → "yyyy-MM-dd"
function parseFlyersDate(raw: string): string {
  const parsed = parseDate(String(raw).trim(), 'MM/dd/yyyy', new Date())
  if (!isValid(parsed)) throw new ParseError(`Invalid transaction date "${raw}" in Flyers file.`)
  return format(parsed, 'yyyy-MM-dd')
}

// "HH:MM:SS" passes through; other formats are returned as-is
function parseFlyersTime(raw: string): string {
  return String(raw ?? '').trim() || '00:00:00'
}

function detectBusinessTag(row: Record<string, unknown>): BusinessTag | null {
  const cardDesc     = String(row['CardDescription'] ?? '').trim()
  const reportGroup  = String(row['ReportingGroup'] ?? '').trim().toUpperCase()

  if (
    cardDesc === 'WESTERN SHOP' ||
    reportGroup === 'WEST HWY'   ||
    reportGroup === 'WESTERN HIGHWAYS'
  ) {
    return 'western_highways'
  }

  return null
}

export function parseFlyersXLSX(buffer: Buffer): ParsedFuelTransaction[] {
  const workbook = XLSX.read(buffer, { type: 'buffer' })
  const sheet    = workbook.Sheets[workbook.SheetNames[0]]

  // Headers in row 2 (index 1), data starts at row 3 (index 2)
  const rawRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: null,
    raw: true,
  }) as unknown[][]

  if (rawRows.length < 3) throw new ParseError('Flyers XLSX file has no data rows.')

  // Build header→column index map from row index 1
  const headerRow = rawRows[1] as (string | null)[]
  const colIdx: Record<string, number> = {}
  headerRow.forEach((h, i) => { if (h) colIdx[h.trim()] = i })

  function get(row: unknown[], key: string): string {
    const i = colIdx[key]
    if (i === undefined) return ''
    const v = row[i]
    return v === null || v === undefined ? '' : String(v).trim()
  }

  const transactions: ParsedFuelTransaction[] = []

  for (let r = 2; r < rawRows.length; r++) {
    const row = rawRows[r]
    if (!row || row.every(c => c === null)) continue

    const cardName     = get(row, 'CardDescription')
    const rawDate      = get(row, 'Date')
    const rawTime      = get(row, 'Time')
    const product      = get(row, 'Product')
    const gallons      = parseFloat(get(row, 'Quantity') || '0') || 0
    const pricePer     = parseFloat(get(row, 'UnitPrice') || '0') || 0
    const tax          = parseFloat(get(row, 'TaxTotal') || '0') || 0
    const totalWithTax = parseFloat(get(row, 'TotalPrice') || '0') || 0
    const siteName     = get(row, 'SiteDescription')
    const siteCity     = get(row, 'SiteCity')
    const siteState    = get(row, 'State')

    if (!cardName || !rawDate) continue

    const totalPretax = round2(totalWithTax - tax)

    // Build a plain object for business tag detection
    const rowObj: Record<string, unknown> = {}
    Object.keys(colIdx).forEach(k => { rowObj[k] = row[colIdx[k]] })

    transactions.push({
      cardName:        cardName,
      transactionDate: parseFlyersDate(rawDate),
      transactionTime: parseFlyersTime(rawTime),
      siteName:        siteName,
      siteCity:        siteCity,
      siteState:       siteState,
      product:         product,
      gallons:         round2(gallons),
      pricePerGallon:  round2(pricePer),
      totalPretax,
      tax:             round2(tax),
      totalWithTax:    round2(totalWithTax),
      mpg:             null,
      businessTag:     detectBusinessTag(rowObj),
    })
  }

  if (transactions.length === 0) throw new ParseError('No transaction rows found in Flyers XLSX file.')
  return transactions
}
