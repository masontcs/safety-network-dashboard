import { WH_BUCKET_ORDER, type WhAgingBucket } from './qbo'

/**
 * Aging roll-ups for the Western Highways A/R and A/P views.
 *
 * Pure and shape-agnostic: the A/R and A/P pages hand in the same `WhAgingRow` (their lines
 * mapped once, at the edge), so bucket totals, the counterparty grouping and the
 * outside-vs-intercompany split are computed by one tested function rather than twice in two
 * components. The snapshots are small — 213 A/R lines and 684 A/P lines on the real files — so
 * the page ships the rows and filters them here, in the browser, with no extra round trip.
 */

export interface WhAgingRow {
  id: string
  txnDate: string | null
  txnType: string
  num: string | null
  /** Customer (A/R) or vendor (A/P), exactly as the report spells it. */
  counterpartyName: string
  counterpartyCode: string | null
  location: string | null
  dueDate: string | null
  /** A/P only — QuickBooks' own "Past due" days. Negative when not yet due. */
  pastDueDays: number | null
  agingBucket: WhAgingBucket | null
  openBalanceCents: number
  /** Receivable (A/R) or payable (A/P) — the normal open item. */
  open: boolean
  isIntercompany: boolean
}

/** Which side of the intercompany line to show. */
export type WhPartyFilter = 'all' | 'outside' | 'internal'

export interface WhAgingFilters {
  /** Exact location match; '' means every location. */
  location?: string
  party?: WhPartyFilter
  /** Only the normal open items (Invoice/Credit Memo, or Bill/Vendor Credit). */
  openOnly?: boolean
  /** Case-insensitive substring of the counterparty name. */
  search?: string
}

export interface WhCounterpartyGroup {
  name: string
  code: string | null
  totalCents: number
  lineCount: number
  isIntercompany: boolean
  /** Per-bucket totals, in WH_BUCKET_ORDER. */
  buckets: Record<WhAgingBucket, number>
  rows: WhAgingRow[]
}

export interface WhAgingSummary {
  bucketTotals: Record<WhAgingBucket, number>
  /** Σ of every row that passed the filters. */
  totalCents: number
  outsideCents: number
  intercompanyCents: number
  rowCount: number
  counterparties: WhCounterpartyGroup[]
}

function emptyBuckets(): Record<WhAgingBucket, number> {
  return { 'Current': 0, '1-30': 0, '31-60': 0, '61-90': 0, '>90': 0 }
}

export function filterWhRows(rows: WhAgingRow[], f: WhAgingFilters = {}): WhAgingRow[] {
  const search = f.search?.trim().toLowerCase() ?? ''
  return rows.filter((r) => {
    if (f.location && r.location !== f.location) return false
    if (f.party === 'outside' && r.isIntercompany) return false
    if (f.party === 'internal' && !r.isIntercompany) return false
    if (f.openOnly && !r.open) return false
    if (search && !r.counterpartyName.toLowerCase().includes(search)) return false
    return true
  })
}

/**
 * Bucket totals, the outside/intercompany split, and the counterparty grouping — all from one
 * pass over the filtered rows. Counterparties come back biggest first (by absolute amount, so
 * a net-credit vendor doesn't sink to the bottom of the list and get lost), and each carries
 * its own rows for the expandable detail.
 */
export function summarizeWhAging(rows: WhAgingRow[], filters: WhAgingFilters = {}): WhAgingSummary {
  const kept = filterWhRows(rows, filters)

  const bucketTotals = emptyBuckets()
  let totalCents = 0
  let outsideCents = 0
  let intercompanyCents = 0

  const groups = new Map<string, WhCounterpartyGroup>()

  for (const r of kept) {
    totalCents += r.openBalanceCents
    if (r.isIntercompany) intercompanyCents += r.openBalanceCents
    else outsideCents += r.openBalanceCents
    if (r.agingBucket) bucketTotals[r.agingBucket] += r.openBalanceCents

    let g = groups.get(r.counterpartyName)
    if (!g) {
      g = {
        name: r.counterpartyName,
        code: r.counterpartyCode,
        totalCents: 0,
        lineCount: 0,
        isIntercompany: r.isIntercompany,
        buckets: emptyBuckets(),
        rows: [],
      }
      groups.set(r.counterpartyName, g)
    }
    g.totalCents += r.openBalanceCents
    g.lineCount += 1
    g.rows.push(r)
    if (r.agingBucket) g.buckets[r.agingBucket] += r.openBalanceCents
    if (!g.code && r.counterpartyCode) g.code = r.counterpartyCode
  }

  const counterparties = [...groups.values()].sort(
    (a, b) => Math.abs(b.totalCents) - Math.abs(a.totalCents) || a.name.localeCompare(b.name),
  )

  // Oldest first within a counterparty — the line most worth chasing is at the top.
  for (const g of counterparties) {
    g.rows.sort((a, b) => (a.txnDate ?? '').localeCompare(b.txnDate ?? ''))
  }

  return {
    bucketTotals,
    totalCents,
    outsideCents,
    intercompanyCents,
    rowCount: kept.length,
    counterparties,
  }
}

/** Every location present in the snapshot, for the filter control. */
export function whLocations(rows: WhAgingRow[]): string[] {
  return [...new Set(rows.map((r) => r.location).filter((l): l is string => !!l))].sort()
}

export { WH_BUCKET_ORDER }
export type { WhAgingBucket }
