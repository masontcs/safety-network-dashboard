import * as xlsx from 'xlsx'

export interface ParsedPayment {
  paymentDate: string        // ISO date YYYY-MM-DD
  referenceNumber: string | null
  amount: number
  qbCustomerName: string     // top-level customer name (before the colon in QB job names)
  memo: string | null
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
  // Adjust for UTC to avoid timezone shift
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

    // Detect column positions from header row (row 0)
    // Expected: Type=5, Date=7, Num=9, Name=11, Memo=13, Split=15, Account=17, Amount=19
    // But we find them dynamically in case QB shifts columns
    const header = rows[0] as (string | number)[]
    let colType = -1, colDate = -1, colNum = -1, colName = -1, colMemo = -1, colAmount = -1

    for (let i = 0; i < header.length; i++) {
      const h = String(header[i]).trim().toLowerCase()
      if (h === 'type')   colType   = i
      if (h === 'date')   colDate   = i
      if (h === 'num')    colNum    = i
      if (h === 'name')   colName   = i
      if (h === 'memo')   colMemo   = i
      if (h === 'amount') colAmount = i
    }

    if (colType === -1 || colDate === -1 || colAmount === -1) {
      return { success: false, error: 'Could not find required columns (Type, Date, Amount) in header row' }
    }

    const payments: ParsedPayment[] = []
    const dates: number[] = []

    for (let r = 1; r < rows.length; r++) {
      const row = rows[r] as (string | number)[]

      const type = String(row[colType] ?? '').trim()
      if (type !== 'Payment') continue

      const dateSerial = row[colDate]
      const paymentDate = typeof dateSerial === 'number' ? excelSerialToIso(dateSerial) : null
      if (!paymentDate) continue

      const amount = typeof row[colAmount] === 'number' ? row[colAmount] as number : parseFloat(String(row[colAmount]))
      if (!isFinite(amount) || amount <= 0) continue

      // Customer name: prefer Name column, which has "Customer:Job" format
      const rawName = colName !== -1 ? String(row[colName] ?? '').trim() : ''
      if (!rawName) continue
      const qbCustomerName = extractCustomerName(rawName)

      const referenceNumber = colNum !== -1 ? String(row[colNum] ?? '').trim() || null : null
      const memo = colMemo !== -1 ? String(row[colMemo] ?? '').trim() || null : null

      if (typeof dateSerial === 'number') dates.push(dateSerial)

      payments.push({ paymentDate, referenceNumber, amount, qbCustomerName, memo })
    }

    if (payments.length === 0) {
      return { success: false, error: 'No payment rows found in file. Make sure the file contains Payment type transactions.' }
    }

    const dateFrom = excelSerialToIso(Math.min(...dates))!
    const dateTo   = excelSerialToIso(Math.max(...dates))!

    return { success: true, payments, dateFrom, dateTo }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Failed to parse file' }
  }
}
