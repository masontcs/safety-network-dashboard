import {
  type SheetRow,
  type WhAgingBucket,
  type WhParseResult,
  bucketFor,
  cell,
  findAsOfDate,
  findHeaderRow,
  headerHas,
  isGrandTotalRow,
  isStructuralRow,
  readSheetRows,
  splitCounterparty,
  isIntercompanyName,
  toCents,
  toIsoDate,
} from './qbo'

/**
 * Western Highways — QuickBooks **Online** `A/R Aging Detail` parser.
 *
 * Built against the real export (`Western Highways Traffic Truck Products_A_R Aging Detail
 * Report.csv`), whose layout is:
 *
 *   row 0..2  title block — company / "A/R Aging Detail Report" / "As of Sep 23, 2026"
 *   row 3     blank
 *   row 4     header: [1]Date [2]Transaction type [3]Num [4]Customer full name
 *                     [5]Location full name [6]Due date [7]Amount [8]Open balance
 *   then      five aging sections, each opened by a group-header in column A and closed by a
 *             `Total for <group>` row, and finally a `TOTAL` row with the grand total
 *   last      a generated-at timestamp line in column A — ignored
 *
 * Note the column indexes: A/R has **no "Past due" column**, so open balance is index 8. The
 * A/P report has one and its open balance is index 9 — reading the wrong index would silently
 * import the Amount column as the balance, so the header is verified before any row is read.
 *
 * Pure function: buffer in, numbers out. No clock, no database.
 */

export interface WhArLine {
  /** Transaction date (`yyyy-mm-dd`), null if QBO left it blank. */
  txnDate: string | null
  /** Invoice / Credit Memo / Check / … — kept verbatim so every line reconciles. */
  txnType: string
  num: string | null
  /** Customer name exactly as the report spells it, QBO code and all. */
  customerName: string
  /** The `CTM-…` code embedded in the name, pulled out for display. */
  customerCode: string | null
  /** "Location full name" — WH's class / branch. */
  location: string | null
  dueDate: string | null
  agingBucket: WhAgingBucket | null
  /** The line's face Amount, in cents. Informational; the aging is driven by openBalance. */
  amountCents: number | null
  /** Signed integer cents: invoices positive, credit memos negative. */
  openBalanceCents: number
  /** True for Invoice / Credit Memo — the normal open receivable. */
  receivable: boolean
  /** Counterparty name contains "Safety Network" — internal paper, not outside exposure. */
  isIntercompany: boolean
}

export interface ParsedWhAr {
  /** The report's own "As of" date from the title block (`yyyy-mm-dd`), or null. */
  reportAsOf: string | null
  /** The report's `TOTAL` row open balance, in cents (null if the report had no TOTAL row). */
  reportTotalCents: number | null
  /** Σ of every line's open balance, in cents. */
  sumOpenCents: number
  /** Σ lines === the report's own TOTAL. False means the file was not read faithfully. */
  reconciled: boolean
  /** Σ of the receivable (Invoice + Credit Memo) lines, in cents. */
  receivableTotalCents: number
  lines: WhArLine[]
  /** Line count per transaction type, for the import preview. */
  typeCounts: Record<string, number>
}

/** Invoice and Credit Memo are the normal open receivable; anything else is reconciliation-only. */
const RECEIVABLE_TYPES = new Set(['invoice', 'credit memo'])

export function isWhArReceivableType(txnType: string): boolean {
  return RECEIVABLE_TYPES.has(txnType.trim().toLowerCase())
}

/**
 * Header columns this report must have, at the indexes the parser reads. Checked before any
 * data row, so an A/P export uploaded into the A/R slot is refused instead of mis-parsed.
 */
const AR_HEADER: Record<number, string> = {
  1: 'Date',
  2: 'Transaction type',
  4: 'Customer full name',
  7: 'Amount',
  8: 'Open balance',
}

const COL = { date: 1, type: 2, num: 3, customer: 4, location: 5, dueDate: 6, amount: 7, open: 8 }

export function parseWhArFile(buffer: Buffer): WhParseResult<ParsedWhAr> {
  let rows: SheetRow[]
  try {
    rows = readSheetRows(buffer)
  } catch (err) {
    return { success: false, error: `Could not read the file: ${String(err)}` }
  }

  if (rows.length === 0) {
    return { success: false, error: 'The file is empty.' }
  }

  const headerRow = findHeaderRow(rows)
  if (headerRow < 0) {
    return {
      success: false,
      error: 'This does not look like a QuickBooks Online A/R Aging Detail export — no "Transaction type" header row was found.',
    }
  }
  if (!headerHas(rows, headerRow, AR_HEADER)) {
    return {
      success: false,
      error: 'The header row does not match the A/R Aging Detail layout (expected Date · Transaction type · Num · Customer full name · Location full name · Due date · Amount · Open balance). If this is the A/P report, upload it under A/P.',
    }
  }

  const lines: WhArLine[] = []
  const typeCounts: Record<string, number> = {}
  let bucket: WhAgingBucket | null = null
  let reportTotalCents: number | null = null

  for (let i = headerRow + 1; i < rows.length; i++) {
    const row = rows[i]
    if (!row) continue

    const colA = cell(row, 0)

    // Column A carries structure only: a bucket group-header, a `Total for …` subtotal, the
    // grand `TOTAL`, or — in the CSV — the trailing generated-at timestamp. Never data.
    if (isStructuralRow(colA)) {
      const b = bucketFor(colA)
      if (b) {
        bucket = b
      } else if (isGrandTotalRow(colA)) {
        reportTotalCents = toCents(row[COL.open])
      }
      continue
    }

    // A real line always names a transaction type. Blank spacer rows fall out here.
    const txnType = cell(row, COL.type)
    if (!txnType) continue

    const openBalanceCents = toCents(row[COL.open])
    if (openBalanceCents === null) continue

    const rawCustomer = cell(row, COL.customer)
    const { name, code } = splitCounterparty(rawCustomer)

    lines.push({
      txnDate:          toIsoDate(row[COL.date]),
      txnType,
      num:              cell(row, COL.num) || null,
      customerName:     name,
      customerCode:     code,
      location:         cell(row, COL.location) || null,
      dueDate:          toIsoDate(row[COL.dueDate]),
      agingBucket:      bucket,
      amountCents:      toCents(row[COL.amount]),
      openBalanceCents,
      receivable:       isWhArReceivableType(txnType),
      isIntercompany:   isIntercompanyName(rawCustomer),
    })

    typeCounts[txnType] = (typeCounts[txnType] ?? 0) + 1
  }

  if (lines.length === 0) {
    return { success: false, error: 'No A/R detail lines were found in the file.' }
  }

  const sumOpenCents = lines.reduce((s, l) => s + l.openBalanceCents, 0)
  const receivableTotalCents = lines
    .filter((l) => l.receivable)
    .reduce((s, l) => s + l.openBalanceCents, 0)

  return {
    success: true,
    data: {
      reportAsOf: findAsOfDate(rows, headerRow),
      reportTotalCents,
      sumOpenCents,
      reconciled: reportTotalCents !== null && sumOpenCents === reportTotalCents,
      receivableTotalCents,
      lines,
      typeCounts,
    },
  }
}
