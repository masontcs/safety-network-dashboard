import * as xlsx from 'xlsx'

// QB row types we capture as cash receipts:
//   'Payment' — normal customer payment to the correct entity
//   'Deposit'  — cash received but deposited into the wrong QB company
// Excluded: 'Credit', 'General Journal', etc. — accounting entries, not real cash
const ACCEPTED_TYPES = new Set(['Payment', 'Deposit'])

export interface ParsedPayment {
  paymentDate: string        // ISO date YYYY-MM-DD
  referenceNumber: string | null
  amount: number
  qbCustomerName: string     // top-level customer name (before the colon in QB job names)
  memo: string | null
  paymentType: 'payment' | 'deposit'
}

export type PaymentParseResult =
  | {
      success: true
      payments: ParsedPayment[]
      dateFrom: string
      dateTo: string
    }
  | {
      success: false
      error: string
    }

// QB Desktop exports dates as Excel serial numbers (days since 1899-12-30)
function excelSerialToIso(serial: number): string | null {
  if (!serial || typeof serial !== 'number') return null
  const date = new Date(Math.round((serial - 25569) * 86400 * 1000))
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  const d = String(date.getUTCDate()).padStart(2, '0')
  if (y < 2000 || y > 2100) return null
  return `${y}-${m}-${d}`
}

// Extract the root customer name from a QB "Customer:Job" name
// e.g. "Sturgeon Electric California LLC:061822-Ashlan Project" → "Sturgeon Electric California LLC"
// e.g. "SW CONSTRUCTION" → "SW CONSTRUCTION"
function extractCustomerName(fullName: string): string {
  const colonIdx = fullName.indexOf(':')
  return colonIdx !== -1 ? fullName.slice(0, colonIdx).trim() : fullName.trim()
}

export function parsePaymentFile(buffer: Buffer): PaymentParseResult {
  try {
    const workbook = xlsx.read(buffer, { type: 'buffer' })
    const sheetName = workbook.SheetNames[0]
    if (!sheetName) return { success: false, error: 'No sheets found in workbook' }

    const sheet = workbook.Sheets[sheetName]
    const rows = xlsx.utils.sheet_to_json<(string | number)[]>(sheet, {
      header: 1,
      defval: '',
    })

    if (rows.length < 2) return { success: false, error: 'File appears to be empty' }

    // QB Desktop exports often include header rows above the column names
    // (company name, report title, date range). Scan all rows for the header row.
    let headerRowIdx = -1
    let colType = -1, colDate = -1, colNum = -1, colName = -1, colMemo = -1, colAmount = -1

    for (let r = 0; r < Math.min(rows.length, 20); r++) {
      const row = rows[r] as (string | number)[]
      let foundType = -1, foundDate = -1, foundAmount = -1
      let tmpNum = -1, tmpName = -1, tmpMemo = -1
      for (let i = 0; i < row.length; i++) {
        const h = String(row[i]).trim().toLowerCase()
        if (h === 'type')   foundType   = i
        if (h === 'date')   foundDate   = i
        if (h === 'num')    tmpNum      = i
        if (h === 'name')   tmpName     = i
        if (h === 'memo')   tmpMemo     = i
        if (h === 'amount') foundAmount = i
      }
      if (foundType !== -1 && foundDate !== -1 && foundAmount !== -1) {
        headerRowIdx = r
        colType = foundType; colDate = foundDate; colAmount = foundAmount
        colNum = tmpNum; colName = tmpName; colMemo = tmpMemo
        break
      }
    }

    if (headerRowIdx === -1) {
      return { success: false, error: 'Could not find required columns (Type, Date, Amount) in header row' }
    }

    const payments: ParsedPayment[] = []
    const dates: number[] = []

    for (let r = headerRowIdx + 1; r < rows.length; r++) {
      const row = rows[r] as (string | number)[]

      const rawType = String(row[colType] ?? '').trim()
      if (!ACCEPTED_TYPES.has(rawType)) continue   // skip Credit, General Journal, etc.

      const paymentType: 'payment' | 'deposit' = rawType === 'Deposit' ? 'deposit' : 'payment'

      const dateSerial = row[colDate]
      const paymentDate = typeof dateSerial === 'number' ? excelSerialToIso(dateSerial) : null
      if (!paymentDate) continue

      const amount = typeof row[colAmount] === 'number' ? row[colAmount] as number : parseFloat(String(row[colAmount]))
      if (!isFinite(amount) || amount <= 0) continue

      // Customer name: "Customer:Job" format — take the part before the colon
      const rawName = colName !== -1 ? String(row[colName] ?? '').trim() : ''
      if (!rawName) continue
      const qbCustomerName = extractCustomerName(rawName)

      const referenceNumber = colNum !== -1 ? String(row[colNum] ?? '').trim() || null : null
      const memo = colMemo !== -1 ? String(row[colMemo] ?? '').trim() || null : null

      if (typeof dateSerial === 'number') dates.push(dateSerial)

      payments.push({ paymentDate, referenceNumber, amount, qbCustomerName, memo, paymentType })
    }

    if (payments.length === 0) {
      return {
        success: false,
        error: 'No payment or deposit rows found in file. Make sure the file contains Payment or Deposit type transactions.',
      }
    }

    const dateFrom = excelSerialToIso(Math.min(...dates))!
    const dateTo   = excelSerialToIso(Math.max(...dates))!

    return { success: true, payments, dateFrom, dateTo }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Failed to parse file' }
  }
}
