/**
 * SN Cash Ledger (CMR) — canonical vendors across accounts (AP Phase 3a). Shared shapes and the
 * pure logic behind /api/cmr/vendors, the Vendors page and the request picker's grouping.
 * Dependency-free, so client components import it.
 *
 *   • A raw QuickBooks vendor name lives on each A/P line, per account. A CANONICAL vendor
 *     (cmr_vendors) sits on top: every line carries the vendor_id its raw name resolves to, and
 *     the raw name is never changed.
 *   • The only automatic link is a normalized-IDENTICAL spelling (normalizeVendorName — the same
 *     rule as the SQL cmr_vendor_normalize). Every other pairing is a Controller merge
 *     (AP Phase 3b), so "ACME INC" and "ACME LLC" stay two vendors here.
 *   • Amounts owed come from PAYABLE lines only (Bill positive, Credit negative), exactly as on
 *     the Accounts Payable page. Payments stay per-account: the rollup is a view only.
 *   • A line that has no vendor_id yet (it should not happen once the migration's backfill ran)
 *     is never dropped: it groups under its normalized raw name, so totals still add up.
 */

import { compareApLines, type CmrApAccountRef, type CmrApLine } from '@/lib/cmr/ap'

// ── normalization ─────────────────────────────────────────────────────────────

/**
 * The canonical-vendor match key. Conservative on purpose, and IDENTICAL to the SQL function
 * public.cmr_vendor_normalize (supabase/migrations/*_cmr_vendors.sql):
 *   1. ASCII a–z → A–Z (only ASCII: the SQL uses translate(), which ignores the DB locale)
 *   2. every run of whitespace — space, tab, LF, CR, FF, VT, no-break space — → one space
 *   3. trim leading/trailing spaces
 *   4. strip ONE trailing "." (unless the name is just ".")
 * Nothing else: no INC/LLC/CORP stripping, no punctuation removal, no fuzzy folding.
 */
export function normalizeVendorName(name: string): string {
  const t = name
    .replace(/[a-z]/g, (c) => c.toUpperCase())
    .replace(/[ \t\n\r\f\v\u00a0]+/g, ' ')
    .replace(/^ +| +$/g, '')
  return t.length > 1 && t.endsWith('.') ? t.slice(0, -1) : t
}

/** A display form of a name: whitespace runs squashed (QuickBooks names can carry double spaces). */
export const displayVendorName = (name: string): string => name.replace(/\s+/g, ' ').trim()

/** The grouping key of a line: its canonical vendor, or — unlinked — its normalized raw name. */
export const vendorKeyOf = (l: Pick<CmrApLine, 'vendorId' | 'vendorName'>): string =>
  l.vendorId ? `v:${l.vendorId}` : `raw:${normalizeVendorName(l.vendorName)}`

// ── the rollup ────────────────────────────────────────────────────────────────

export interface CmrVendorRef {
  id: string
  canonicalName: string
}

/** What GET /api/cmr/vendors returns. The rollup is computed from it in the browser. */
export interface CmrVendorsView {
  accounts: CmrApAccountRef[]
  /** Each account's current A/P import (only accounts that have one). */
  imports: { accountId: string; importedAt: string; sourceFilename: string | null }[]
  /** The canonical vendors referenced by `lines`. */
  vendors: CmrVendorRef[]
  /** Every PAYABLE line of every current import, with its vendorId. */
  lines: CmrApLine[]
}

/** One account's share of a canonical vendor. */
export interface CmrVendorAccountShare {
  accountId: string
  accountName: string
  owedCents: number
  billCount: number
  creditCount: number
  oldestAgingDays: number | null
  /** The raw QuickBooks spellings this account uses for the vendor. */
  rawNames: string[]
  lines: CmrApLine[]
}

/** One canonical vendor, across accounts (or within the filtered account). */
export interface CmrVendorRollupRow {
  key: string
  vendorId: string | null
  name: string
  /** Σ payable lines in scope — bills − credits. */
  owedCents: number
  billCount: number
  creditCount: number
  oldestAgingDays: number | null
  rawNames: string[]
  accounts: CmrVendorAccountShare[]
}

export type CmrVendorSort = 'owed' | 'name'

export interface CmrVendorRollupTotals {
  owedCents: number
  vendorCount: number
  /** Vendors with payable lines in more than one account. */
  multiAccountCount: number
  accountCount: number
  billCount: number
  creditCount: number
}

const nameCmp = (a: string, b: string) => a.localeCompare(b, 'en-US', { sensitivity: 'base' })
const olderOf = (a: number | null, b: number | null) => (a === null ? b : b === null ? a : Math.max(a, b))

/**
 * Canonical vendors with their amount owed across accounts, from PAYABLE lines only — one row
 * per vendor, each with per-account subtotals (in the accounts' own order) and their invoices.
 * `accountId` null = every account; otherwise only that account's lines count (the row and its
 * one share both show that account's figure).
 */
export function vendorRollup(
  view: Pick<CmrVendorsView, 'accounts' | 'vendors' | 'lines'>,
  accountId: string | null,
  sort: CmrVendorSort = 'owed',
): CmrVendorRollupRow[] {
  const accName = new Map(view.accounts.map((a) => [a.id, a.name]))
  const accOrder = new Map(view.accounts.map((a) => [a.id, a.sortOrder]))
  const canon = new Map(view.vendors.map((v) => [v.id, v.canonicalName]))
  const rows = new Map<string, CmrVendorRollupRow & { byAcc: Map<string, CmrVendorAccountShare> }>()

  for (const l of view.lines) {
    if (!l.payable) continue
    if (accountId !== null && l.accountId !== accountId) continue
    const key = vendorKeyOf(l)
    let r = rows.get(key)
    if (!r) {
      r = {
        key,
        vendorId: l.vendorId,
        // A vendor id the view has no name for falls back to the raw spelling.
        name: (l.vendorId && canon.get(l.vendorId)) || l.vendorName,
        owedCents: 0,
        billCount: 0,
        creditCount: 0,
        oldestAgingDays: null,
        rawNames: [],
        accounts: [],
        byAcc: new Map(),
      }
      rows.set(key, r)
    }
    let s = r.byAcc.get(l.accountId)
    if (!s) {
      s = {
        accountId: l.accountId,
        accountName: accName.get(l.accountId) ?? 'Unknown account',
        owedCents: 0,
        billCount: 0,
        creditCount: 0,
        oldestAgingDays: null,
        rawNames: [],
        lines: [],
      }
      r.byAcc.set(l.accountId, s)
    }
    const credit = l.docType === 'Credit'
    r.owedCents += l.openBalanceCents
    s.owedCents += l.openBalanceCents
    if (credit) { r.creditCount++; s.creditCount++ } else { r.billCount++; s.billCount++ }
    r.oldestAgingDays = olderOf(r.oldestAgingDays, l.agingDays)
    s.oldestAgingDays = olderOf(s.oldestAgingDays, l.agingDays)
    if (!r.rawNames.includes(l.vendorName)) r.rawNames.push(l.vendorName)
    if (!s.rawNames.includes(l.vendorName)) s.rawNames.push(l.vendorName)
    s.lines.push(l)
  }

  const out: CmrVendorRollupRow[] = []
  for (const { byAcc, ...r } of rows.values()) {
    const accounts = [...byAcc.values()].sort(
      (a, b) => (accOrder.get(a.accountId) ?? 0) - (accOrder.get(b.accountId) ?? 0) || nameCmp(a.accountName, b.accountName),
    )
    for (const s of accounts) { s.lines.sort(compareApLines); s.rawNames.sort(nameCmp) }
    r.rawNames.sort(nameCmp)
    out.push({ ...r, accounts })
  }
  out.sort((a, b) => {
    if (sort === 'owed' && a.owedCents !== b.owedCents) return b.owedCents - a.owedCents
    return nameCmp(a.name, b.name) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
  })
  return out
}

/** The headline figures of a rollup. */
export function vendorRollupTotals(rows: CmrVendorRollupRow[]): CmrVendorRollupTotals {
  const t: CmrVendorRollupTotals = { owedCents: 0, vendorCount: rows.length, multiAccountCount: 0, accountCount: 0, billCount: 0, creditCount: 0 }
  const accs = new Set<string>()
  for (const r of rows) {
    t.owedCents += r.owedCents
    t.billCount += r.billCount
    t.creditCount += r.creditCount
    if (r.accounts.length > 1) t.multiAccountCount++
    for (const s of r.accounts) accs.add(s.accountId)
  }
  t.accountCount = accs.size
  return t
}

/** Search: a vendor's canonical name, any of its raw spellings, or an invoice number. */
export function matchesVendorQuery(r: CmrVendorRollupRow, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  if (r.name.toLowerCase().includes(q)) return true
  if (r.rawNames.some((n) => n.toLowerCase().includes(q))) return true
  return r.accounts.some((s) => s.lines.some((l) => (l.invoiceNum ?? '').toLowerCase().includes(q)))
}

// ── the request picker: one account, grouped by canonical vendor ─────────────

/**
 * One canonical vendor within ONE account, for the request picker. A request is still for one
 * account and one exact QuickBooks name (cmr_compose_vendor_request matches lines on it), so the
 * group keeps its raw spellings: when a canonical vendor has more than one in this account the
 * picker asks which one, and `vendorName` is the first of them (A–Z).
 */
export interface CmrApPickerVendor {
  key: string
  vendorId: string | null
  canonicalName: string
  accountId: string
  accountName: string
  /** The first raw QuickBooks spelling (A–Z). */
  vendorName: string
  rawNames: string[]
  owedCents: number
  billCount: number
  creditCount: number
  oldestAgingDays: number | null
  lines: CmrApLine[]
}

/** The account's PAYABLE lines grouped by canonical vendor, A–Z by canonical name. */
export function pickerVendorGroups(lines: CmrApLine[], account: CmrApAccountRef, vendors: CmrVendorRef[]): CmrApPickerVendor[] {
  const rows = vendorRollup({ accounts: [account], vendors, lines }, account.id, 'name')
  return rows.map((r) => {
    const s = r.accounts[0]
    return {
      key: r.key,
      vendorId: r.vendorId,
      canonicalName: r.name,
      accountId: account.id,
      accountName: account.name,
      vendorName: s.rawNames[0],
      rawNames: s.rawNames,
      owedCents: s.owedCents,
      billCount: s.billCount,
      creditCount: s.creditCount,
      oldestAgingDays: s.oldestAgingDays,
      lines: s.lines,
    }
  })
}

/** The picker group a raw QuickBooks name belongs to, if any. */
export const pickerGroupOf = (groups: CmrApPickerVendor[], rawName: string): CmrApPickerVendor | null =>
  groups.find((g) => g.rawNames.includes(rawName)) ?? null
