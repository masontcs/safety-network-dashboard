/**
 * SN Cash Ledger (CMR) Accounts Payable — shared shapes and the pure view logic for
 * /api/cmr/ap and the AP screen (AP Phase 1). Dependency-free, so client components import it.
 *
 *   • An account's AP is a SNAPSHOT: its current QuickBooks A/P Aging Detail import. A new
 *     upload replaces it (cmr_ap_replace_import).
 *   • Every line of the report is stored so the import reconciles to the report's TOTAL, but
 *     only Bill and Credit lines are PAYABLE. Vendors and "amount owed" are built from payable
 *     lines only; the rest (General Journal, Bill Pmt -Check, adjustment accounts) are shown
 *     separately as reconciliation lines and are never requestable.
 *   • Money is signed integer cents: Bills positive, Credits negative. A vendor's amount owed
 *     is Σ(payable lines) — bills minus credits — so it can be negative (a vendor in credit).
 */

export interface CmrApAccountRef {
  id: string
  name: string
  active: boolean
  sortOrder: number
}

export interface CmrApLine {
  id: string
  importId: string
  accountId: string
  vendorName: string
  invoiceNum: string | null
  docType: string
  billDate: string | null
  dueDate: string | null
  agingDays: number | null
  agingBucket: string | null
  openBalanceCents: number
  payable: boolean
}

/** An account's current import, with its reconciliation figures. */
export interface CmrApImport {
  id: string
  accountId: string
  sourceFilename: string | null
  /** The report's own TOTAL row. */
  reportTotalCents: number
  /** Σ Bill + Credit lines. */
  payableTotalCents: number
  /** Σ of every stored line. Equals reportTotalCents when the import reconciles. */
  importedTotalCents: number
  lineCount: number
  payableLineCount: number
  /** Distinct vendors with at least one payable line. */
  vendorCount: number
  importedAt: string
  importedByName: string | null
  reconciled: boolean
}

export interface CmrApView {
  accounts: CmrApAccountRef[]
  imports: CmrApImport[]
  lines: CmrApLine[]
  /** Controller only — decides whether the Import control renders. The API re-checks. */
  canImport: boolean
}

/** One vendor's payable lines within one account. */
export interface CmrApVendorGroup {
  key: string
  accountId: string
  accountName: string
  vendorName: string
  /** Σ payable lines (bills − credits). */
  owedCents: number
  billCount: number
  creditCount: number
  /** The largest aging (days) among its lines, or null if none carries one. */
  oldestAgingDays: number | null
  lines: CmrApLine[]
}

export type CmrApVendorSort = 'owed' | 'name'

/** The QuickBooks aging groups, newest first. */
export const CMR_AP_BUCKET_ORDER: readonly string[] = ['Current', '1 - 30', '31 - 60', '61 - 90', '> 90'] as const

/** Invoices inside a vendor: oldest bill first (by bill date), undated last, then by number. */
export function compareApLines(a: CmrApLine, b: CmrApLine): number {
  if (a.billDate !== b.billDate) {
    if (a.billDate === null) return 1
    if (b.billDate === null) return -1
    return a.billDate < b.billDate ? -1 : 1
  }
  const n = (a.invoiceNum ?? '').localeCompare(b.invoiceNum ?? '', 'en-US', { numeric: true })
  if (n) return n
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

const nameCmp = (a: string, b: string) => a.localeCompare(b, 'en-US', { sensitivity: 'base' })

/**
 * Vendors with their amount owed, from PAYABLE lines only, for one account (`accountId`) or all
 * (null). The same vendor name under two accounts is two groups — it is two different payables.
 */
export function apVendorGroups(
  lines: CmrApLine[],
  accounts: CmrApAccountRef[],
  accountId: string | null,
  sort: CmrApVendorSort = 'owed',
): CmrApVendorGroup[] {
  const accName = new Map(accounts.map((a) => [a.id, a.name]))
  const groups = new Map<string, CmrApVendorGroup>()
  for (const l of lines) {
    if (!l.payable) continue
    if (accountId !== null && l.accountId !== accountId) continue
    const key = `${l.accountId}\u0000${l.vendorName}`
    let g = groups.get(key)
    if (!g) {
      g = {
        key,
        accountId: l.accountId,
        accountName: accName.get(l.accountId) ?? 'Unknown account',
        vendorName: l.vendorName,
        owedCents: 0,
        billCount: 0,
        creditCount: 0,
        oldestAgingDays: null,
        lines: [],
      }
      groups.set(key, g)
    }
    g.owedCents += l.openBalanceCents
    if (l.docType === 'Credit') g.creditCount++
    else g.billCount++
    if (l.agingDays !== null && (g.oldestAgingDays === null || l.agingDays > g.oldestAgingDays)) g.oldestAgingDays = l.agingDays
    g.lines.push(l)
  }
  const out = [...groups.values()]
  for (const g of out) g.lines.sort(compareApLines)
  const accOrder = new Map(accounts.map((a) => [a.id, a.sortOrder]))
  out.sort((a, b) => {
    if (sort === 'owed' && a.owedCents !== b.owedCents) return b.owedCents - a.owedCents
    const n = nameCmp(a.vendorName, b.vendorName)
    if (n) return n
    return (accOrder.get(a.accountId) ?? 0) - (accOrder.get(b.accountId) ?? 0)
  })
  return out
}

/** The non-payable (reconciliation-only) lines, for one account or all, oldest first. */
export function apReconciliationLines(lines: CmrApLine[], accountId: string | null): CmrApLine[] {
  return lines
    .filter((l) => !l.payable && (accountId === null || l.accountId === accountId))
    .sort((a, b) => nameCmp(a.vendorName, b.vendorName) || compareApLines(a, b))
}

export interface CmrApTotals {
  payableCents: number
  billsCents: number
  creditsCents: number
  otherCents: number
  importedCents: number
  reportCents: number
  billCount: number
  creditCount: number
  otherCount: number
  vendorCount: number
  /** Every import in scope reconciles to its report TOTAL. */
  reconciled: boolean
  importCount: number
}

/** The headline figures for one account or all accounts. */
export function apTotals(view: Pick<CmrApView, 'lines' | 'imports'>, accountId: string | null): CmrApTotals {
  const t: CmrApTotals = {
    payableCents: 0, billsCents: 0, creditsCents: 0, otherCents: 0, importedCents: 0, reportCents: 0,
    billCount: 0, creditCount: 0, otherCount: 0, vendorCount: 0, reconciled: true, importCount: 0,
  }
  const vendors = new Set<string>()
  for (const l of view.lines) {
    if (accountId !== null && l.accountId !== accountId) continue
    t.importedCents += l.openBalanceCents
    if (!l.payable) { t.otherCents += l.openBalanceCents; t.otherCount++; continue }
    t.payableCents += l.openBalanceCents
    vendors.add(`${l.accountId}\u0000${l.vendorName}`)
    if (l.docType === 'Credit') { t.creditsCents += l.openBalanceCents; t.creditCount++ }
    else { t.billsCents += l.openBalanceCents; t.billCount++ }
  }
  for (const i of view.imports) {
    if (accountId !== null && i.accountId !== accountId) continue
    t.importCount++
    t.reportCents += i.reportTotalCents
    if (!i.reconciled) t.reconciled = false
  }
  t.vendorCount = vendors.size
  return t
}

/** What an import's reconciliation says, in words. */
export function describeReconciliation(i: Pick<CmrApImport, 'importedTotalCents' | 'reportTotalCents' | 'reconciled'>): string {
  if (i.reconciled) return 'Reconciled to the report TOTAL'
  const diff = i.importedTotalCents - i.reportTotalCents
  return `Off by ${diff > 0 ? '+' : '−'}${(Math.abs(diff) / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })} against the report TOTAL`
}

/** Aging in words: "11 days", "1 day", or "—" when QuickBooks left it blank. */
export function formatAging(days: number | null): string {
  if (days === null) return '—'
  return `${days} ${Math.abs(days) === 1 ? 'day' : 'days'}`
}

/** 'YYYY-MM-DD' → "8/31/26" (the way the QuickBooks report prints it). */
export function formatApDate(d: string | null): string {
  if (!d) return '—'
  const [y, m, day] = d.split('-')
  return `${Number(m)}/${Number(day)}/${y.slice(2)}`
}

/** What a Preview reports about a parsed file (/api/cmr/ap/import/preview). */
export interface CmrApPreviewSummary {
  lineCount: number
  payableLineCount: number
  vendorCount: number
  payableVendorCount: number
  docTypeCounts: Record<string, number>
  reportTotalCents: number
  importedTotalCents: number
  payableTotalCents: number
  differenceCents: number
  reconciled: boolean
  sampleVendors: { vendorName: string; owedCents: number; lineCount: number }[]
}

/** The account a QuickBooks export's file name starts with ("STS AP 92226.xlsx" → STS), if any. */
export function accountFromFileName(fileName: string, accounts: CmrApAccountRef[]): CmrApAccountRef | null {
  const first = fileName.trim().split(/[\s_.-]+/)[0]?.toLowerCase() ?? ''
  if (!first) return null
  return accounts.find((a) => a.name.trim().toLowerCase() === first) ?? null
}
