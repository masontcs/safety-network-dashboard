import type { WhAgingBucket } from './qbo'

/**
 * What the WH upload endpoints hand back — the same shape for A/R and A/P, so one client
 * component renders either preview.
 *
 * The preview is the whole safety mechanism of a replace-style import: nothing is written
 * until the uploader has seen the counts, the two totals and whether the file reconciles to
 * its own TOTAL row. `mode: 'preview'` never touches the database.
 */

export interface WhImportSampleRow {
  txnDate: string | null
  txnType: string
  num: string | null
  counterparty: string
  location: string | null
  dueDate: string | null
  agingBucket: WhAgingBucket | null
  openBalanceCents: number
  isIntercompany: boolean
}

export interface WhImportPreview {
  report: 'ar' | 'ap'
  filename: string
  /** The report's as-of day (`yyyy-mm-dd`), or null when it could not be established. */
  reportAsOf: string | null
  /** Where reportAsOf came from — shown so an uploader never has to guess. */
  reportAsOfSource: 'title' | 'derived' | 'none'
  /** For a derived date: how many lines agreed on it. */
  reportAsOfEvidence: number
  lineCount: number
  typeCounts: Record<string, number>
  /** Σ of every line, in cents. */
  sumOpenCents: number
  /** The report's own TOTAL row, in cents. */
  reportTotalCents: number | null
  reconciled: boolean
  /** Σ of the receivable (A/R) or payable (A/P) lines, in cents. */
  openTotalCents: number
  openLineCount: number
  intercompanyCents: number
  outsideCents: number
  intercompanyLineCount: number
  locations: string[]
  buckets: Record<WhAgingBucket, number>
  sample: WhImportSampleRow[]
}

export interface WhImportCommitted extends WhImportPreview {
  importId: string | null
  /** The snapshot this upload replaced, if there was one. */
  replaced: { reportAsOf: string | null; filename: string | null; lineCount: number } | null
}

// ── Payroll ────────────────────────────────────────────────────────────────────
//
// Payroll gets its own preview shape rather than bending the aging one: it has no buckets, no
// counterparties and no intercompany split, and it has something the aging reports do not — a
// PAY PERIOD, which decides whether this upload replaces an existing period or adds a new one
// to the history. The preview says which of the two will happen before anything is written.

export interface WhPayrollPreviewEmployee {
  name: string
  isActive: boolean
  hours: number
  grossCents: number
  taxesCents: number
  netCents: number
}

export interface WhPayrollImportPreview {
  report: 'payroll'
  filename: string
  periodStart: string
  periodEnd: string
  employeeCount: number
  inactiveCount: number
  totalHours: number
  grossTotalCents: number
  /** Negative, as the report writes withholding. */
  taxesTotalCents: number
  adjustedGrossTotalCents: number
  netTotalCents: number
  /** The report's own Total column, for the reconciliation the uploader sees. */
  reportTotals: {
    hours: number
    grossCents: number
    taxesCents: number
    adjustedGrossCents: number
    netCents: number
  }
  /** Σ per-employee gross === the Total column's gross. */
  reconciled: boolean
  /** Every figure checked against the Total column. */
  checks: Record<'hours' | 'grossCents' | 'taxesCents' | 'adjustedGrossCents' | 'netCents', boolean>
  /**
   * The period this upload would replace, when one is already stored for the same dates — the
   * difference between "adds a week to the history" and "overwrites the week you have".
   */
  existingPeriod: {
    periodStart: string
    periodEnd: string
    filename: string | null
    employeeCount: number
    grossTotalCents: number
    importedAt: string | null
  } | null
  /** Every employee in the period, biggest gross first. */
  employees: WhPayrollPreviewEmployee[]
}

export interface WhPayrollImportCommitted extends WhPayrollImportPreview {
  periodId: string | null
  /** True when this upload replaced a period that was already stored. */
  replacedExisting: boolean
}
