import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import { parseFuelFile } from './parser'

// ─── Interstate CSV helpers ────────────────────────────────────────────────
// Uses the real column names from the Interstate Transaction Inquiry export.
// Columns after Z (Federal_Tax through Sales_Tax) are referenced by header name
// so position does not matter.

function buildInterstateCSV(rows: string[]): Buffer {
  const header = [
    'Division','Account_Number','Account_Name','Card_Number',
    'Card_Description',        // col 5  — driver name
    'Vehicle_Number','Vehicle_Description',
    'Trans_Date',              // col 8
    'Trans_Time',              // col 9
    'Site_Code',
    'Site_Name',               // col 11
    'Site_Region','Foreign_Site_Code','Foreign_Site_Description','Foreign_Region',
    'Pump_Number','Product_ID',
    'Product_Desc',            // col 18
    'Quantity',                // col 19
    'Price',                   // col 20
    'Odometer',
    'MPG',                     // col 22
    'Keyboard','MISC','Invoice_Number','Date_Invoiced','Fee_Code',
    'Federal_Tax',             // col 28
    'State_Tax',               // col 29
    'Local_Tax1',              // col 30
    'Local_Tax2',              // col 31
    'Sales_Tax',               // col 32
  ].join(',')
  return Buffer.from([header, ...rows].join('\n'))
}

// Helper: build a full 32-column Interstate data row with explicit per-tax values.
// Positional layout matches the header above (1-indexed):
//  1:Division  2:Account_Number  3:Account_Name  4:Card_Number
//  5:Card_Description  6:Vehicle_Number  7:Vehicle_Description
//  8:Trans_Date  9:Trans_Time  10:Site_Code  11:Site_Name  12:Site_Region
//  13:Foreign_Site_Code  14:Foreign_Site_Description  15:Foreign_Region
//  16:Pump_Number  17:Product_ID  18:Product_Desc  19:Quantity  20:Price
//  21:Odometer  22:MPG  23:Keyboard  24:MISC  25:Invoice_Number
//  26:Date_Invoiced  27:Fee_Code
//  28:Federal_Tax  29:State_Tax  30:Local_Tax1  31:Local_Tax2  32:Sales_Tax
function makeRow(
  card: string, date: string, time: string, product: string,
  qty: number, price: number, mpg: number,
  fedTax: number, stateTax: number, local1: number, local2: number, salesTax: number,
  site: string,
): string {
  return [
    '21','0072121','SAFETY NETWORK','4596758', // 1-4
    card,                                       // 5
    '','',                                      // 6-7
    date, time,                                 // 8-9
    '0246',                                     // 10
    site,                                       // 11
    '','','','',                                // 12-15
    '26','50',                                  // 16-17
    product,                                    // 18
    qty, price,                                 // 19-20
    '37220',                                    // 21 Odometer
    mpg,                                        // 22
    '00000000','','CL51495','12/31/2026','',    // 23-27
    fedTax, stateTax, local1, local2, salesTax, // 28-32
  ].join(',')
}

// Standard row: 100 gal × $4.25 + (10+15+5+5+7.50) tax = $425 + $42.50 = $467.50
const INTERSTATE_ROW = makeRow(
  'TRUCK 101','03/28/2026','09:30 AM','DIESEL',
  100, 4.250, 9.58,
  10.00, 15.00, 5.00, 5.00, 7.50,
  'CA-CITY OF BAKERSFIELD',
)

// Second card for new-card-name detection tests
const INTERSTATE_WH = makeRow(
  'WESTERN TRUCK','03/28/2026','10:00 AM','DIESEL',
  50, 4.250, 0,
  4.00, 8.00, 2.50, 2.00, 4.75,
  'CA-CITY OF FRESNO',
)

// ─── Flyers XLSX helpers ───────────────────────────────────────────────────

function buildFlyersBuffer(dataRows: unknown[][]): Buffer {
  const headers = [
    'CardDescription', 'Date', 'Time', 'Product',
    'Quantity', 'UnitPrice', 'TaxTotal', 'TotalPrice',
    'SiteDescription', 'SiteCity', 'State', 'ReportingGroup',
  ]
  const aoa: unknown[][] = [
    ['Flyers Fuel Report'],  // Row 0: title — must be non-empty so !ref starts at row 0
    headers,                  // Row 1: header row (where parseFlyersXLSX expects them)
    ...dataRows,
  ]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa))
  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }))
}

const FLYERS_ROW = [
  'TRUCK 101', '03/28/2026', '09:30:00', 'DIESEL',
  100, 4.25, 10.00, 435.00,
  'Flying J', 'Bakersfield', 'CA', 'STANDARD',
]

const FLYERS_WH_CARD = [
  'WESTERN SHOP', '03/28/2026', '10:00:00', 'DIESEL',
  50, 4.25, 5.00, 217.50,
  'WH Station', 'Fresno', 'CA', 'WEST HWY',
]

const FLYERS_WH_GROUP = [
  'TRUCK WH02', '03/28/2026', '11:00:00', 'DIESEL',
  30, 4.25, 3.00, 130.50,
  'WH Station', 'Modesto', 'CA', 'WESTERN HIGHWAYS',
]

// ─── Vendor detection ──────────────────────────────────────────────────────

describe('parseFuelFile — vendor detection', () => {
  it('returns interstate for .csv files', () => {
    const result = parseFuelFile(
      buildInterstateCSV([INTERSTATE_ROW]),
      'report.csv',
      new Set()
    )
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.vendor).toBe('interstate')
  })

  it('returns flyers for .xlsx files', () => {
    const result = parseFuelFile(
      buildFlyersBuffer([FLYERS_ROW]),
      'report.xlsx',
      new Set()
    )
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.vendor).toBe('flyers')
  })

  it('returns error (success=false) for unknown extension', () => {
    const result = parseFuelFile(Buffer.from(''), 'report.pdf', new Set())
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error).toMatch(/unsupported/i)
  })
})

// ─── Interstate site parsing ───────────────────────────────────────────────

describe('parseFuelFile — Interstate site parsing', () => {
  it('parses CA-CITY OF BAKERSFIELD into city and state', () => {
    const result = parseFuelFile(
      buildInterstateCSV([INTERSTATE_ROW]),
      'report.csv',
      new Set()
    )
    expect(result.success).toBe(true)
    if (!result.success) return
    const txn = result.data.transactions[0]
    expect(txn.siteCity).toBe('Bakersfield')
    expect(txn.siteState).toBe('CA')
  })

  it('parses CA-CITY OF SANTA MARIA correctly', () => {
    const row = makeRow('TRUCK 101','03/28/2026','09:30 AM','DIESEL',50,4.250,0,5,7.5,3,2.5,3.25,'CA-CITY OF SANTA MARIA')
    const result = parseFuelFile(buildInterstateCSV([row]), 'report.csv', new Set())
    expect(result.success).toBe(true)
    if (!result.success) return
    const txn = result.data.transactions[0]
    expect(txn.siteState).toBe('CA')
    expect(txn.siteCity.toLowerCase()).toContain('santa maria')
  })

  it('handles non-standard site name gracefully (no dash)', () => {
    const row = makeRow('TRUCK 101','03/28/2026','09:30 AM','DIESEL',50,4.250,0,5,7.5,3,2.5,3.25,'SOME TRUCK STOP')
    const result = parseFuelFile(buildInterstateCSV([row]), 'report.csv', new Set())
    expect(result.success).toBe(true)
    if (!result.success) return
    const txn = result.data.transactions[0]
    expect(txn.siteName).toBe('SOME TRUCK STOP')
    expect(txn.siteState).toBe('')
  })
})

// ─── Interstate financial calculations ─────────────────────────────────────

describe('parseFuelFile — Interstate calculations', () => {
  it('calculates total_pretax = gallons × price_per_gallon', () => {
    const result = parseFuelFile(
      buildInterstateCSV([INTERSTATE_ROW]),
      'report.csv',
      new Set()
    )
    expect(result.success).toBe(true)
    if (!result.success) return
    const txn = result.data.transactions[0]
    // 100 gallons × $4.25 = $425.00
    expect(txn.totalPretax).toBe(425.00)
    expect(txn.gallons).toBe(100)
    expect(txn.pricePerGallon).toBe(4.25)
  })

  it('sums all five tax columns (Federal + State + Local1 + Local2 + Sales)', () => {
    // INTERSTATE_ROW has: fedTax=10, stateTax=15, local1=5, local2=5, salesTax=7.50 → 42.50
    const result = parseFuelFile(
      buildInterstateCSV([INTERSTATE_ROW]),
      'report.csv',
      new Set()
    )
    expect(result.success).toBe(true)
    if (!result.success) return
    const txn = result.data.transactions[0]
    expect(txn.tax).toBe(42.50)
  })

  it('calculates total_with_tax = total_pretax + all-five-taxes', () => {
    const result = parseFuelFile(
      buildInterstateCSV([INTERSTATE_ROW]),
      'report.csv',
      new Set()
    )
    expect(result.success).toBe(true)
    if (!result.success) return
    const txn = result.data.transactions[0]
    expect(txn.totalWithTax).toBe(467.50)  // 425.00 + 42.50
  })

  it('treats missing tax columns as zero (no error thrown)', () => {
    // Row with only Sales_Tax column present — Federal/State/Local absent
    const minimalHeader = 'Card_Description,Trans_Date,Trans_Time,Product_Desc,Quantity,Price,MPG,Sales_Tax,Site_Name'
    const minimalRow = 'TRUCK 101,03/28/2026,09:30 AM,DIESEL,100.000,4.250,9.58,42.50,CA-CITY OF BAKERSFIELD'
    const result = parseFuelFile(
      Buffer.from([minimalHeader, minimalRow].join('\n')),
      'report.csv',
      new Set()
    )
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.transactions[0].tax).toBe(42.50)
  })

  it('stores MPG from the MPG column', () => {
    const result = parseFuelFile(
      buildInterstateCSV([INTERSTATE_ROW]),
      'report.csv',
      new Set()
    )
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.transactions[0].mpg).toBe(9.58)
  })

  it('stores null MPG when MPG column is zero or missing', () => {
    const row = makeRow('TRUCK 101','03/28/2026','09:30 AM','DIESEL',100,4.250,0,10,15,5,5,7.5,'CA-CITY OF BAKERSFIELD')
    const result = parseFuelFile(buildInterstateCSV([row]), 'report.csv', new Set())
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.transactions[0].mpg).toBeNull()
  })
})

// ─── Flyers financial calculations ─────────────────────────────────────────

describe('parseFuelFile — Flyers calculations', () => {
  it('calculates total_pretax = total_with_tax − tax', () => {
    const result = parseFuelFile(
      buildFlyersBuffer([FLYERS_ROW]),
      'report.xlsx',
      new Set()
    )
    expect(result.success).toBe(true)
    if (!result.success) return
    const txn = result.data.transactions[0]
    // 435.00 − 10.00 = 425.00
    expect(txn.totalPretax).toBe(425.00)
    expect(txn.totalWithTax).toBe(435.00)
    expect(txn.tax).toBe(10.00)
  })
})

// ─── Western Highways tagging ──────────────────────────────────────────────

describe('parseFuelFile — Western Highways business tag', () => {
  it('tags WESTERN SHOP card description as business_tag=western_highways', () => {
    const result = parseFuelFile(
      buildFlyersBuffer([FLYERS_WH_CARD]),
      'report.xlsx',
      new Set()
    )
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.transactions[0].businessTag).toBe('western_highways')
  })

  it('tags WEST HWY reporting group as business_tag=western_highways', () => {
    const result = parseFuelFile(
      buildFlyersBuffer([FLYERS_WH_CARD]),
      'report.xlsx',
      new Set()
    )
    expect(result.success).toBe(true)
    if (!result.success) return
    // FLYERS_WH_CARD has ReportingGroup = 'WEST HWY'
    expect(result.data.transactions[0].businessTag).toBe('western_highways')
  })

  it('tags WESTERN HIGHWAYS reporting group as business_tag=western_highways', () => {
    const result = parseFuelFile(
      buildFlyersBuffer([FLYERS_WH_GROUP]),
      'report.xlsx',
      new Set()
    )
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.transactions[0].businessTag).toBe('western_highways')
  })

  it('leaves businessTag null for regular transactions', () => {
    const result = parseFuelFile(
      buildFlyersBuffer([FLYERS_ROW]),
      'report.xlsx',
      new Set()
    )
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.transactions[0].businessTag).toBeNull()
  })

  it('Interstate transactions always have businessTag=null', () => {
    const result = parseFuelFile(
      buildInterstateCSV([INTERSTATE_ROW]),
      'report.csv',
      new Set()
    )
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.transactions[0].businessTag).toBeNull()
  })
})

// ─── New card name detection ───────────────────────────────────────────────

describe('parseFuelFile — new card name detection', () => {
  it('identifies card names not in the known set', () => {
    const csv = buildInterstateCSV([
      INTERSTATE_ROW,
      INTERSTATE_WH,
    ])
    const result = parseFuelFile(csv, 'report.csv', new Set(['TRUCK 101']))
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.newCardNames).toEqual(['WESTERN TRUCK'])
  })

  it('returns empty newCardNames when all cards are known', () => {
    const result = parseFuelFile(
      buildInterstateCSV([INTERSTATE_ROW]),
      'report.csv',
      new Set(['TRUCK 101'])
    )
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.newCardNames).toHaveLength(0)
  })

  it('deduplicates new card names that appear multiple times', () => {
    const csv = buildInterstateCSV([
      INTERSTATE_ROW,
      INTERSTATE_ROW, // same card twice
    ])
    const result = parseFuelFile(csv, 'report.csv', new Set())
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.newCardNames).toHaveLength(1)
    expect(result.data.newCardNames[0]).toBe('TRUCK 101')
  })
})

// ─── Date range ────────────────────────────────────────────────────────────

describe('parseFuelFile — date range', () => {
  it('reports dateRangeStart and dateRangeEnd from transaction dates', () => {
    const csv = buildInterstateCSV([
      makeRow('TRUCK 101','03/01/2026','08:00 AM','DIESEL',50,4.250,0,5,7.5,3,2.5,3.25,'CA-CITY OF BAKERSFIELD'),
      makeRow('TRUCK 101','03/28/2026','09:30 AM','DIESEL',100,4.250,9.58,10,15,5,5,7.5,'CA-CITY OF BAKERSFIELD'),
    ])
    const result = parseFuelFile(csv, 'report.csv', new Set())
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.dateRangeStart).toBe('2026-03-01')
    expect(result.data.dateRangeEnd).toBe('2026-03-28')
  })
})
