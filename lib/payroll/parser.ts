import * as XLSX from 'xlsx'
import { ParseError } from '@/lib/utils/errors'
import type { ParseResult } from '@/lib/utils/errors'
import { splitLegalName } from './split-name'
import {
  cellNum,
  extractPeriodDate,
  extractPayrollItems,
  extractEmployeeColumns,
  findTaxRowIndex,
} from './parse-helpers'
import type { Rows } from './parse-helpers'
import type { PayrollParseResult, ParsedEmployee, PayrollLineItem } from './types'

// For each employee at column N: hours=row[N], rate=row[N+2], amount=row[N+4].
// Skip employees with all-zero amounts and zero tax.
function buildEmployees(
  rows: Rows,
  empCols: ReturnType<typeof extractEmployeeColumns>,
  itemNames: string[],
  taxRowIndex: number,
  warnings: string[]
): ParsedEmployee[] {
  const dataRowStart = 4
  const employees: ParsedEmployee[] = []

  for (const { rawName, col } of empCols) {
    const { firstName, lastName, unexpected } = splitLegalName(rawName)

    if (unexpected) {
      warnings.push(
        `Name "${rawName}" has no comma — stored in last_name, first_name left blank. Needs admin review.`
      )
    }

    const lineItems: PayrollLineItem[] = []

    for (let i = 0; i < itemNames.length; i++) {
      const r = dataRowStart + i
      const amount = cellNum(rows, r, col + 4) ?? 0
      if (amount === 0) continue

      const hours = cellNum(rows, r, col)
      const rate  = cellNum(rows, r, col + 2)

      if (rate === null && !/salary/i.test(itemNames[i])) {
        warnings.push(`Missing rate for "${rawName}" on item "${itemNames[i]}".`)
      }

      lineItems.push({ itemName: itemNames[i], hours, rate, amount })
    }

    const taxAmount = cellNum(rows, taxRowIndex, col + 4) ?? 0

    if (taxAmount === 0 && rows[taxRowIndex]) {
      const hasAnyValue =
        cellNum(rows, taxRowIndex, col) !== null ||
        cellNum(rows, taxRowIndex, col + 2) !== null
      if (!hasAnyValue && lineItems.length > 0) {
        warnings.push(`Missing tax value for "${rawName}".`)
      }
    }

    if (lineItems.length === 0 && taxAmount === 0) continue

    employees.push({
      rawName,
      autoFirstName:        firstName,
      autoLastName:         lastName,
      nameFormatUnexpected: unexpected,
      lineItems,
      taxAmount,
    })
  }

  if (employees.length === 0) {
    throw new ParseError('No employees with payroll data found in this file.')
  }

  return employees
}

export function parsePayrollFile(
  buffer: Buffer,
  entityCode: string
): ParseResult<PayrollParseResult> {
  const warnings: string[] = []

  try {
    const workbook = XLSX.read(buffer, { type: 'buffer' })
    const sheet    = workbook.Sheets[workbook.SheetNames[0]]
    const rows     = XLSX.utils.sheet_to_json<(unknown | null)[]>(sheet, {
      header: 1,
      defval: null,
      raw: true,
    }) as Rows

    const periodDate   = extractPeriodDate(rows, warnings)
    const payrollItems = extractPayrollItems(rows)
    const empCols      = extractEmployeeColumns(rows)
    const taxRowIndex  = findTaxRowIndex(rows)
    const employees    = buildEmployees(rows, empCols, payrollItems, taxRowIndex, warnings)

    return {
      success: true,
      data: { periodDate, entityCode, payrollItems, employees, warnings },
      warnings,
    }
  } catch (err) {
    if (err instanceof ParseError) {
      return { success: false, error: err.detail ?? err.message, warnings }
    }
    throw err
  }
}
