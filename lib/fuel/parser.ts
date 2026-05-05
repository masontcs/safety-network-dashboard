import { ParseError } from '@/lib/utils/errors'
import type { ParseResult } from '@/lib/utils/errors'
import { parseInterstateCSV } from './interstate'
import { parseFlyersXLSX } from './flyers'
import type { FuelParseResult, ParsedFuelTransaction } from './types'

const ALLOWED_EXTENSIONS = new Set(['csv', 'xlsx'])

function dateRange(txns: ParsedFuelTransaction[]): { start: string; end: string } {
  const dates = txns.map(t => t.transactionDate).sort()
  return { start: dates[0], end: dates[dates.length - 1] }
}

// Identifies card names not yet present in the DB.
// knownCardNames: Set built by the import API route from fuel_card_assignments.
function findNewCardNames(
  txns: ParsedFuelTransaction[],
  knownCardNames: Set<string>
): string[] {
  const seen = new Set<string>()
  const newNames: string[] = []
  for (const t of txns) {
    if (!seen.has(t.cardName) && !knownCardNames.has(t.cardName)) {
      seen.add(t.cardName)
      newNames.push(t.cardName)
    }
  }
  return newNames
}

// Auto-detects vendor by file extension: .csv → interstate, .xlsx → flyers
export function parseFuelFile(
  buffer: Buffer,
  fileName: string,
  knownCardNames: Set<string>
): ParseResult<FuelParseResult> {
  const warnings: string[] = []

  try {
    const ext = fileName.split('.').pop()?.toLowerCase() ?? ''

    if (!ALLOWED_EXTENSIONS.has(ext)) {
      throw new ParseError(
        `Unsupported fuel file type ".${ext}". Expected .csv (Interstate) or .xlsx (Flyers).`
      )
    }

    const vendor = ext === 'csv' ? 'interstate' : 'flyers'

    const transactions =
      vendor === 'interstate'
        ? parseInterstateCSV(buffer)
        : parseFlyersXLSX(buffer)

    const { start, end } = dateRange(transactions)
    const newCardNames   = findNewCardNames(transactions, knownCardNames)

    return {
      success: true,
      data: { vendor, dateRangeStart: start, dateRangeEnd: end, transactions, newCardNames, warnings },
      warnings,
    }
  } catch (err) {
    if (err instanceof ParseError) {
      return { success: false, error: err.detail ?? err.message, warnings }
    }
    throw err
  }
}
