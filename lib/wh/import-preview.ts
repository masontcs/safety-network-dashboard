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
