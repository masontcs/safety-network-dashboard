import type { createServiceClient } from '@/lib/supabase/server'
import type { CmrLedgerPeriod, CmrPendingStatus, CmrPendingSource } from '@/lib/supabase/database.types'
import { formatCurrency } from '@/lib/utils/format'

/**
 * SN Cash Ledger (CMR) daily ledger — shared shapes, balance math and validation for
 * /api/cmr/ledger/* and the Daily ledger screen. Its only runtime import is the plain USD
 * formatter, so client components can import it too.
 *
 *   • Each (ledger_date, period) is its own INDEPENDENT snapshot: AM and PM each have their own
 *     beginning cash, adjustments and pending items. Nothing carries over (that's Phase 6).
 *   • A ledger row exists only once something is written; until then it is "virtual" (id null,
 *     beginning cash $0).
 *   • Current balance = beginning cash + Σ manual adjustments (signed) − Σ pending items.
 *     Pending items are stored positive and always subtract. The pending roll-up is derived
 *     here on read — never stored, never hand-edited.
 *   • Money is integer cents everywhere.
 */

export type { CmrLedgerPeriod, CmrPendingStatus, CmrPendingSource }

export const CMR_LEDGER_PERIODS: readonly CmrLedgerPeriod[] = ['am', 'pm'] as const
export const CMR_LEDGER_PERIOD_LABEL: Record<CmrLedgerPeriod, string> = { am: 'AM', pm: 'PM' }

export const CMR_ADJ_DESCRIPTION_MAX = 120
export const CMR_ADJ_NOTE_MAX = 500
export const CMR_ADJ_WARN_MAX = 80
export const CMR_PAYEE_MAX = 80
export const CMR_PENDING_NOTES_MAX = 500
/** $999,999,999.99 — mirrors the DB checks. */
export const CMR_LEDGER_MAX_CENTS = 99_999_999_999

/** Suggestions for the free-text warn note — not an enforced list. */
export const CMR_WARN_SUGGESTIONS = [
  'Needs to be covered by 11:00 AM',
  'Needs to be covered by 2:00 PM',
  'Not available until tomorrow',
  'Not available until Thu',
  'Confirm with bank',
] as const

// ── API shapes ──────────────────────────────────────────────────────────────

export interface CmrLedger {
  /** null while the ledger is virtual (nothing saved for this date/period yet). */
  id: string | null
  ledgerDate: string
  period: CmrLedgerPeriod
  beginningCashCents: number
  exists: boolean
  updatedAt: string | null
}

export interface CmrLedgerAdjustment {
  id: string
  description: string
  /** Signed: + adds to the balance, − takes away. */
  amountCents: number
  note: string | null
  warnNote: string | null
  sortOrder: number
  createdAt: string
}

export interface CmrPendingItem {
  id: string
  accountId: string
  accountName: string
  accountActive: boolean
  payee: string
  /** Positive; always subtracted from the balance. */
  amountCents: number
  status: CmrPendingStatus
  source: CmrPendingSource
  notes: string | null
  sortOrder: number
  createdAt: string
}

export interface CmrPendingGroup {
  accountId: string
  accountName: string
  accountType: string | null
  accountActive: boolean
  items: CmrPendingItem[]
  subtotalCents: number
}

export interface CmrLedgerTotals {
  beginningCashCents: number
  adjustmentsTotalCents: number
  pendingRollupCents: number
  currentBalanceCents: number
}

export interface CmrLedgerAccountRef {
  id: string
  name: string
  accountType: string | null
  active: boolean
  sortOrder: number
}

export interface CmrLedgerView {
  ledger: CmrLedger
  adjustments: CmrLedgerAdjustment[]
  pending: CmrPendingGroup[]
  totals: CmrLedgerTotals
  accounts: CmrLedgerAccountRef[]
  today: string
  canEdit: boolean
}

// ── DB rows ─────────────────────────────────────────────────────────────────

export type CmrDailyLedgerRow = {
  id: string
  ledger_date: string
  period: CmrLedgerPeriod
  beginning_cash_cents: number
  created_by: string | null
  created_at: string
  updated_at: string
}

export type CmrAdjustmentRow = {
  id: string
  daily_ledger_id: string
  description: string
  amount_cents: number
  note: string | null
  warn_note: string | null
  kind: 'manual' | 'pending_rollup'
  sort_order: number
  created_by: string | null
  created_at: string
}

export type CmrPendingRow = {
  id: string
  daily_ledger_id: string
  account_id: string
  payee: string
  amount_cents: number
  status: CmrPendingStatus
  /** The day the item was first dated. */
  original_date: string | null
  /** The ledger day the item currently sits on (advances when pushed forward, Phase 6). */
  effective_date: string | null
  paid_at: string | null
  paid_by: string | null
  source: CmrPendingSource
  source_ref_id: string | null
  notes: string | null
  sort_order: number
  created_by: string | null
  created_at: string
}

export const CMR_LEDGER_COLS = 'id, ledger_date, period, beginning_cash_cents, created_by, created_at, updated_at'
export const CMR_ADJUSTMENT_COLS =
  'id, daily_ledger_id, description, amount_cents, note, warn_note, kind, sort_order, created_by, created_at'
export const CMR_PENDING_COLS =
  'id, daily_ledger_id, account_id, payee, amount_cents, status, original_date, effective_date, paid_at, paid_by, source, source_ref_id, notes, sort_order, created_by, created_at'

// bigint columns: PostgREST sends JSON numbers (cents stay far below 2^53). Normalise defensively.
const cents = (v: number | string): number => Number(v)

export const virtualLedger = (ledgerDate: string, period: CmrLedgerPeriod): CmrLedger => ({
  id: null,
  ledgerDate,
  period,
  beginningCashCents: 0,
  exists: false,
  updatedAt: null,
})

export const toCmrLedger = (r: CmrDailyLedgerRow): CmrLedger => ({
  id: r.id,
  ledgerDate: r.ledger_date,
  period: r.period,
  beginningCashCents: cents(r.beginning_cash_cents),
  exists: true,
  updatedAt: r.updated_at,
})

export const toCmrAdjustment = (r: CmrAdjustmentRow): CmrLedgerAdjustment => ({
  id: r.id,
  description: r.description,
  amountCents: cents(r.amount_cents),
  note: r.note,
  warnNote: r.warn_note,
  sortOrder: r.sort_order,
  createdAt: r.created_at,
})

export function toCmrPendingItem(r: CmrPendingRow, accounts: Map<string, CmrLedgerAccountRef>): CmrPendingItem {
  const acc = accounts.get(r.account_id)
  return {
    id: r.id,
    accountId: r.account_id,
    accountName: acc?.name ?? 'Unknown account',
    accountActive: acc?.active ?? false,
    payee: r.payee,
    amountCents: cents(r.amount_cents),
    status: r.status,
    source: r.source,
    notes: r.notes,
    sortOrder: r.sort_order,
    createdAt: r.created_at,
  }
}

type Ordered = { sortOrder: number; createdAt: string; id: string }
/** Display order within a list: sort_order, then creation time, then id. */
export const compareOrdered = (a: Ordered, b: Ordered): number =>
  a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)

// ── the math ────────────────────────────────────────────────────────────────

/**
 * Whether a pending item still counts against the balance. Phase 3 only creates 'pending'
 * items. A 'paid' item stays in the day's breakdown (it left the bank that day); a 'pushed' one
 * has moved to another day and is counted there instead (Phase 6).
 */
export const countsTowardPending = (i: { status: CmrPendingStatus }): boolean => i.status !== 'pushed'

export function computeLedgerTotals(
  beginningCashCents: number,
  adjustments: { amountCents: number }[],
  pendingItems: { amountCents: number; status: CmrPendingStatus }[],
): CmrLedgerTotals {
  const adjustmentsTotalCents = adjustments.reduce((s, a) => s + a.amountCents, 0)
  const pendingRollupCents = pendingItems.reduce((s, i) => (countsTowardPending(i) ? s + i.amountCents : s), 0)
  return {
    beginningCashCents,
    adjustmentsTotalCents,
    pendingRollupCents,
    currentBalanceCents: beginningCashCents + adjustmentsTotalCents - pendingRollupCents,
  }
}

/**
 * The pending breakdown grouped by account, in account order (then name). Only accounts that
 * have items appear. Each group's subtotal uses the same rule as the roll-up, so the group
 * subtotals always add up to totals.pendingRollupCents.
 */
export function groupPendingByAccount(items: CmrPendingItem[], accounts: CmrLedgerAccountRef[]): CmrPendingGroup[] {
  const byId = new Map(accounts.map((a) => [a.id, a]))
  const groups = new Map<string, CmrPendingGroup>()
  for (const item of [...items].sort(compareOrdered)) {
    let g = groups.get(item.accountId)
    if (!g) {
      const acc = byId.get(item.accountId)
      g = {
        accountId: item.accountId,
        accountName: acc?.name ?? item.accountName,
        accountType: acc?.accountType ?? null,
        accountActive: acc?.active ?? false,
        items: [],
        subtotalCents: 0,
      }
      groups.set(item.accountId, g)
    }
    g.items.push(item)
    if (countsTowardPending(item)) g.subtotalCents += item.amountCents
  }
  const rank = (id: string) => byId.get(id)?.sortOrder ?? Number.MAX_SAFE_INTEGER
  return [...groups.values()].sort(
    (a, b) =>
      rank(a.accountId) - rank(b.accountId) ||
      a.accountName.localeCompare(b.accountName, undefined, { sensitivity: 'base' }) ||
      a.accountId.localeCompare(b.accountId),
  )
}

// ── formatting ──────────────────────────────────────────────────────────────

/** Integer cents → "$1,234.56" / "-$1,234.56" (the app-wide USD formatter). */
export const formatCents = (c: number): string => formatCurrency(c / 100)

/** Signed display for adjustment lines and totals: "+$1.00", "−$1.00" (true minus sign), "$0.00". */
export function formatSignedCents(c: number): string {
  if (c === 0) return formatCents(0)
  return `${c > 0 ? '+' : '−'}${formatCents(Math.abs(c))}`
}

/** A balance: "$1,234.56", or "−$1,234.56" (true minus) when negative. */
export const formatBalanceCents = (c: number): string => (c < 0 ? `\u2212${formatCents(-c)}` : formatCents(c))

/** 'YYYY-MM-DD' → "Wed, Sep 16, 2026" without any timezone shift. */
export function formatLedgerDate(d: string, opts: { year?: boolean } = {}): string {
  const [y, m, day] = d.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(opts.year === false ? {} : { year: 'numeric' }),
  })
}

/** Calendar arithmetic on 'YYYY-MM-DD' strings (no timezone involved). */
export function shiftLedgerDate(d: string, days: number): string {
  const [y, m, day] = d.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, day + days))
  return dt.toISOString().slice(0, 10)
}

export const ledgerLabel = (date: string, period: CmrLedgerPeriod): string => `${date} ${CMR_LEDGER_PERIOD_LABEL[period]}`

// ── validation ──────────────────────────────────────────────────────────────

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string }

const squash = (s: string) => s.replace(/\s+/g, ' ').trim()

export function isLedgerPeriod(v: unknown): v is CmrLedgerPeriod {
  return v === 'am' || v === 'pm'
}

export function parsePeriod(v: unknown): Parsed<CmrLedgerPeriod> {
  return isLedgerPeriod(v) ? { ok: true, value: v } : { ok: false, error: 'Choose AM or PM.' }
}

/** A real calendar date 'YYYY-MM-DD' between 2000 and 2100. */
export function parseLedgerDate(v: unknown): Parsed<string> {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return { ok: false, error: 'Choose a valid date.' }
  const [y, m, d] = v.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  if (y < 2000 || y > 2100 || dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    return { ok: false, error: 'Choose a valid date.' }
  }
  return { ok: true, value: v }
}

/**
 * Integer cents within ±$999,999,999.99. Only a JSON number that is already a whole number of
 * cents is accepted — the client converts dollars once (MoneyInput) and the server never
 * re-rounds. `signed` allows negatives (adjustments, beginning cash); otherwise ≥ 0 (pending).
 */
export function parseLedgerCents(v: unknown, label: string, opts: { signed: boolean }): Parsed<number> {
  if (typeof v !== 'number' || !Number.isSafeInteger(v)) return { ok: false, error: `${label} must be a dollar amount.` }
  if (!opts.signed && v < 0) return { ok: false, error: `${label} can't be negative.` }
  if (Math.abs(v) > CMR_LEDGER_MAX_CENTS) return { ok: false, error: `${label} is too large.` }
  return { ok: true, value: v }
}

/** Required single-line text: squashed, 1..max. */
export function parseRequiredText(v: unknown, label: string, max: number): Parsed<string> {
  if (typeof v !== 'string') return { ok: false, error: `Enter ${label.toLowerCase()}.` }
  const t = squash(v)
  if (!t) return { ok: false, error: `Enter ${label.toLowerCase()}.` }
  if (t.length > max) return { ok: false, error: `${label} can be at most ${max} characters.` }
  return { ok: true, value: t }
}

/** Optional free text: undefined/null/blank → null; otherwise squashed (multiline keeps line breaks), 1..max. */
export function parseOptionalText(v: unknown, label: string, max: number, opts: { multiline?: boolean } = {}): Parsed<string | null> {
  if (v === null || v === undefined) return { ok: true, value: null }
  if (typeof v !== 'string') return { ok: false, error: `${label} must be text.` }
  const t = opts.multiline
    ? v.replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(/[ \t]+/g, ' ').trimEnd()).join('\n').trim()
    : squash(v)
  if (!t) return { ok: true, value: null }
  if (t.length > max) return { ok: false, error: `${label} can be at most ${max} characters.` }
  return { ok: true, value: t }
}

// ── reorder RPCs ────────────────────────────────────────────────────────────

type Service = ReturnType<typeof createServiceClient>

/**
 * Rewrite sort_order in ONE statement (service role only). Called as a member of the client —
 * supabase-js rpc() needs `this`. Cast because the Database `Functions` type is deliberately
 * empty (see database.types.ts).
 */
async function rpc(supabase: Service, fn: string, args: Record<string, unknown>): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = (await (supabase as any).rpc(fn, args)) as { error: { message: string } | null }
  if (error) throw new Error(error.message)
}

export const reorderCmrAdjustments = (supabase: Service, ledgerId: string, ids: string[]) =>
  rpc(supabase, 'cmr_reorder_ledger_adjustments', { p_ledger_id: ledgerId, p_ids: ids })

export const reorderCmrPendingItems = (supabase: Service, ledgerId: string, ids: string[]) =>
  rpc(supabase, 'cmr_reorder_pending_items', { p_ledger_id: ledgerId, p_ids: ids })
