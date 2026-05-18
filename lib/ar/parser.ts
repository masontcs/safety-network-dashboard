import * as XLSX from 'xlsx'

export interface ArInvoiceRow {
  qbName: string
  jobName: string | null
  rawClassCode: string
  invoiceNumber: string
  poNumber: string | null
  invoiceDate: string | null
  dueDate: string | null
  terms: string | null
  openBalance: number
  agingBucket: 'Current' | '1-30' | '31-60' | '61-90' | '>90'
  agingDays: number | null
}

export interface ParsedArFile {
  reportDate: string
  invoiceRows: ArInvoiceRow[]
  totalAr: number
}

type ParseResult =
  | { success: true; data: ParsedArFile }
  | { success: false; error: string }

function excelDateToIso(serial: unknown): string | null {
  if (typeof serial !== 'number' || serial < 1) return null
  return new Date((serial - 25569) * 86400 * 1000).toISOString().split('T')[0]
}

const BUCKET_HEADER_MAP: Record<string, ArInvoiceRow['agingBucket']> = {
  'current':  'Current',
  '1 - 30':   '1-30',
  '31 - 60':  '31-60',
  '61 - 90':  '61-90',
  '> 90':     '>90',
}

// Identifies the AR data sheet by looking for the "Type" column header in col D (index 3).
// QB exports often include a first tab with instructions — this skips it automatically.
function findDataSheet(wb: XLSX.WorkBook): XLSX.WorkSheet | null {
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name]
    if (!ws) continue
    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '', range: 0, }) as unknown[][]
    // Scan the first 10 rows for the "Type" header in column D (index 3)
    for (let i = 0; i < Math.min(rows.length, 10); i++) {
      if (String(rows[i]?.[3] ?? '').trim() === 'Type') return ws
    }
  }
  return null
}

export function parseArFile(buffer: Buffer, _entityCode: string): ParseResult {
  try {
    const wb = XLSX.read(buffer, { type: 'buffer' })
    const ws = findDataSheet(wb)
    if (!ws) return { success: false, error: 'Could not find AR data sheet — expected a sheet with a "Type" column header' }

    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '' }) as unknown[][]

    const invoiceRows: ArInvoiceRow[] = []
    let currentBucket: ArInvoiceRow['agingBucket'] = 'Current'
    let totalAr = 0

    for (const row of rows) {
      const col0 = String(row[0] ?? '').trim().toLowerCase()
      const col3 = String(row[3] ?? '').trim()

      // Section header (aging bucket label)
      if (col0 in BUCKET_HEADER_MAP) {
        currentBucket = BUCKET_HEADER_MAP[col0]
        continue
      }

      // Grand total row
      if (col0 === 'total') {
        totalAr = Number(row[21]) || 0
        continue
      }

      // Subtotal rows (e.g. "Total Current", "Total 1 - 30")
      if (col0.startsWith('total ')) continue

      // Only process invoice rows
      if (col3 !== 'Invoice') continue

      const rawName = String(row[11] ?? '').trim()
      if (!rawName) continue

      const colonIdx = rawName.indexOf(':')
      const qbName   = colonIdx >= 0 ? rawName.substring(0, colonIdx).trim() : rawName
      const jobName  = colonIdx >= 0 ? rawName.substring(colonIdx + 1).trim() || null : null

      const poRaw = String(row[9] ?? '').trim()
      const poNumber = poRaw && poRaw.toUpperCase() !== 'NA' && poRaw.toUpperCase() !== 'N/A'
        ? poRaw
        : null

      invoiceRows.push({
        qbName,
        jobName,
        rawClassCode:  String(row[17] ?? '').trim(),
        invoiceNumber: String(row[7] ?? '').trim(),
        poNumber,
        invoiceDate:   excelDateToIso(row[5]),
        dueDate:       excelDateToIso(row[15]),
        terms:         String(row[13] ?? '').trim() || null,
        openBalance:   Number(row[21]) || 0,
        agingBucket:   currentBucket,
        agingDays:     typeof row[19] === 'number' ? row[19] : null,
      })
    }

    if (invoiceRows.length === 0) {
      return { success: false, error: 'No invoices found in file' }
    }

    // Use today as the report date; caller can override via form field
    const reportDate = new Date().toISOString().split('T')[0]

    return { success: true, data: { reportDate, invoiceRows, totalAr } }
  } catch (err) {
    return { success: false, error: `Failed to parse file: ${String(err)}` }
  }
}
