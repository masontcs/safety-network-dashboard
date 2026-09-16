import type { createServiceClient } from '@/lib/supabase/server'
import type { CmrRecurringSection } from '@/lib/supabase/database.types'
import { formatCurrency } from '@/lib/utils/format'

/**
 * SN Cash Ledger (CMR) recurring vendors — shared shapes + validation for /api/cmr/recurring
 * and the Recurring screen. Its only runtime import is the plain USD formatter, so client
 * components can import it too.
 *
 *   • Three sections: weekly, monthly, urgent (Urgent Payment Plans). Only urgent vendors may
 *     carry plan terms / a plan due date — the DB enforces this too.
 *   • Money is integer cents everywhere; the UI enters dollars through the billing MoneyInput
 *     (which reports cents) and displays with formatCents().
 *   • No hard delete: a vendor is retired with active = false. on_hold is a separate pause flag.
 *   • sort_order is the position within the vendor's section.
 */

export type { CmrRecurringSection }

export const CMR_RECURRING_SECTIONS: readonly CmrRecurringSection[] = ['weekly', 'monthly', 'urgent'] as const

export const CMR_RECURRING_SECTION_LABEL: Record<CmrRecurringSection, string> = {
  weekly: 'Weekly',
  monthly: 'Monthly',
  urgent: 'Urgent Payment Plans',
}

export const CMR_VENDOR_NAME_MAX = 80
export const CMR_RECURRENCE_MAX = 80
export const CMR_PLAN_TERMS_MAX = 200
export const CMR_VENDOR_NOTES_MAX = 500
/** $999,999,999.99 — mirrors the DB check. */
export const CMR_MAX_CENTS = 99_999_999_999

/** Suggestions for the free-text recurrence field — not an enforced list. */
export const CMR_RECURRENCE_SUGGESTIONS: Record<CmrRecurringSection, readonly string[]> = {
  weekly: ['Every Monday', 'Every Tuesday', 'Every Wednesday', 'Every Thursday', 'Every Friday', 'Every other Friday'],
  monthly: ['1st of the month', '15th of the month', 'Last day of the month', '1st and 15th'],
  urgent: ['Weekly installment', 'Monthly installment', 'One-time payoff'],
}

export interface CmrRecurringVendor {
  id: string
  accountId: string
  accountName: string
  /** False when the vendor's account has since been deactivated. */
  accountActive: boolean
  vendorName: string
  amountCents: number
  section: CmrRecurringSection
  recurrenceDetail: string | null
  lastAmountSentCents: number | null
  planTerms: string | null
  planDueDate: string | null
  notes: string | null
  onHold: boolean
  active: boolean
  sortOrder: number
  createdAt: string
}

export type CmrRecurringVendorRow = {
  id: string
  account_id: string
  vendor_name: string
  amount_cents: number
  section: CmrRecurringSection
  recurrence_detail: string | null
  last_amount_sent_cents: number | null
  plan_terms: string | null
  plan_due_date: string | null
  notes: string | null
  on_hold: boolean
  active: boolean
  sort_order: number
  created_by: string | null
  created_at: string
}

export const CMR_RECURRING_COLS =
  'id, account_id, vendor_name, amount_cents, section, recurrence_detail, last_amount_sent_cents, plan_terms, plan_due_date, notes, on_hold, active, sort_order, created_by, created_at'

/** A minimal account shape for joining names and the picker. */
export interface CmrAccountRef {
  id: string
  name: string
  active: boolean
  sortOrder: number
}

export function isCmrRecurringSection(v: unknown): v is CmrRecurringSection {
  return typeof v === 'string' && (CMR_RECURRING_SECTIONS as readonly string[]).includes(v)
}

// bigint columns: PostgREST sends JSON numbers (cents stay far below 2^53). Normalise defensively.
const cents = (v: number): number => Number(v)

export function toCmrRecurringVendor(r: CmrRecurringVendorRow, accounts: Map<string, CmrAccountRef>): CmrRecurringVendor {
  const acc = accounts.get(r.account_id)
  return {
    id: r.id,
    accountId: r.account_id,
    accountName: acc?.name ?? 'Unknown account',
    accountActive: acc?.active ?? false,
    vendorName: r.vendor_name,
    amountCents: cents(r.amount_cents),
    section: r.section,
    recurrenceDetail: r.recurrence_detail,
    lastAmountSentCents: r.last_amount_sent_cents == null ? null : cents(r.last_amount_sent_cents),
    planTerms: r.plan_terms,
    planDueDate: r.plan_due_date,
    notes: r.notes,
    onHold: r.on_hold,
    active: r.active,
    sortOrder: r.sort_order,
    createdAt: r.created_at,
  }
}

const SECTION_RANK: Record<CmrRecurringSection, number> = { weekly: 0, monthly: 1, urgent: 2 }

type Sortable = { section: CmrRecurringSection; sortOrder: number; vendorName: string; id: string }

/** List order: section (weekly, monthly, urgent), sort_order, name (case-insensitive), id. */
export function compareVendors(a: Sortable, b: Sortable): number {
  return (
    SECTION_RANK[a.section] - SECTION_RANK[b.section] ||
    a.sortOrder - b.sortOrder ||
    a.vendorName.localeCompare(b.vendorName, undefined, { sensitivity: 'base' }) ||
    a.id.localeCompare(b.id)
  )
}

/** Sum of amounts for vendors that would actually be paid (active and not on hold). */
export function sectionTotalCents(vendors: { amountCents: number; active: boolean; onHold: boolean }[]): number {
  return vendors.reduce((sum, v) => (v.active && !v.onHold ? sum + v.amountCents : sum), 0)
}

/** Integer cents → "$1,234.56" (the app-wide USD formatter). Divided once, for display only. */
export const formatCents = (c: number): string => formatCurrency(c / 100)

/** 'YYYY-MM-DD' → "Oct 1, 2026" without any timezone shift. */
export function formatPlanDate(d: string): string {
  const [y, m, day] = d.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' })
}

// ── validation ──────────────────────────────────────────────────────────────

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string }

const squash = (s: string) => s.replace(/\s+/g, ' ').trim()

/** Trim and collapse inner runs of whitespace; 1..80 chars. */
export function parseVendorName(v: unknown): Parsed<string> {
  if (typeof v !== 'string') return { ok: false, error: 'Enter a vendor name.' }
  const name = squash(v)
  if (!name) return { ok: false, error: 'Enter a vendor name.' }
  if (name.length > CMR_VENDOR_NAME_MAX) return { ok: false, error: `Vendor names can be at most ${CMR_VENDOR_NAME_MAX} characters.` }
  return { ok: true, value: name }
}

export function parseSection(v: unknown): Parsed<CmrRecurringSection> {
  return isCmrRecurringSection(v)
    ? { ok: true, value: v }
    : { ok: false, error: 'Choose a section: Weekly, Monthly or Urgent Payment Plans.' }
}

/**
 * Integer cents, 0 … $999,999,999.99. Only a JSON number that is already a whole number of
 * cents is accepted — the client converts dollars once (MoneyInput) and the server never
 * re-rounds. `nullable` lets null clear the value (last amount sent).
 */
export function parseCents(v: unknown, label: string, opts: { nullable?: boolean } = {}): Parsed<number | null> {
  if (v === null && opts.nullable) return { ok: true, value: null }
  if (typeof v !== 'number' || !Number.isSafeInteger(v)) return { ok: false, error: `${label} must be a dollar amount.` }
  if (v < 0) return { ok: false, error: `${label} can't be negative.` }
  if (v > CMR_MAX_CENTS) return { ok: false, error: `${label} is too large.` }
  return { ok: true, value: v }
}

/** Optional free text: undefined/null/blank → null; otherwise squashed (notes keep line breaks), 1..max. */
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

/** Optional calendar date 'YYYY-MM-DD' (a real date). Blank/null → null. */
export function parsePlanDueDate(v: unknown): Parsed<string | null> {
  if (v === null || v === undefined || v === '') return { ok: true, value: null }
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return { ok: false, error: 'Plan due date must be a date.' }
  const [y, m, d] = v.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  if (y < 2000 || y > 2100 || dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    return { ok: false, error: 'Plan due date must be a real date.' }
  }
  return { ok: true, value: v }
}

export const PLAN_FIELDS_URGENT_ONLY = 'Plan terms and a plan due date only apply to Urgent Payment Plans.'

/**
 * Rewrite sort_order for one section from an ordered id list in ONE statement
 * (cmr_reorder_recurring_vendors, service role only). Called as a member of the client —
 * supabase-js rpc() needs `this`. Cast because the Database `Functions` type is deliberately
 * empty (see database.types.ts).
 */
export async function reorderCmrRecurringVendors(supabase: ReturnType<typeof createServiceClient>, ids: string[]): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = (await (supabase as any).rpc('cmr_reorder_recurring_vendors', { p_ids: ids })) as {
    error: { message: string } | null
  }
  if (error) throw new Error(error.message)
}
