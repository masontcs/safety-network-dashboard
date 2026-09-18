import type { createServiceClient } from '@/lib/supabase/server'
import type { CmrRecurringFrequency, CmrRecurringSection } from '@/lib/supabase/database.types'
import { formatCurrency } from '@/lib/utils/format'

/**
 * SN Cash Ledger (CMR) recurring vendors — shared shapes + validation for /api/cmr/recurring
 * and the Recurring screen. Its only runtime import is the plain USD formatter, so client
 * components can import it too.
 *
 *   • The section IS the frequency: weekly, monthly, quarterly, annually — plus urgent (Urgent
 *     Payment Plans), which has no schedule and is never suggested. Only urgent vendors may
 *     carry plan terms / a plan due date — the DB enforces this too.
 *   • Phase 7 replaced the free-text cadence with a real schedule the due engine can read:
 *     scheduleWeekday (weekly), scheduleDayOfMonth (monthly / quarterly / annually) and
 *     scheduleAnchorMonth (quarterly / annually). recurrenceDetail is DEPRECATED and unused —
 *     it is still selected only because the column is dropped in a later migration.
 *   • Money is integer cents everywhere; the UI enters dollars through the billing MoneyInput
 *     (which reports cents) and displays with formatCents().
 *   • No hard delete: a vendor is retired with active = false. on_hold is a separate pause flag.
 *   • sort_order is the position within the vendor's section.
 */

export type { CmrRecurringFrequency, CmrRecurringSection }

/** The scheduled frequencies, in display order. 'urgent' is not one of them. */
export const CMR_RECURRING_FREQUENCIES: readonly CmrRecurringFrequency[] = [
  'weekly',
  'monthly',
  'quarterly',
  'annually',
] as const

export const CMR_RECURRING_SECTIONS: readonly CmrRecurringSection[] = [
  ...CMR_RECURRING_FREQUENCIES,
  'urgent',
] as const

export const CMR_RECURRING_SECTION_LABEL: Record<CmrRecurringSection, string> = {
  weekly: 'Weekly',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  annually: 'Annually',
  urgent: 'Urgent Payment Plans',
}

export function isCmrRecurringFrequency(v: unknown): v is CmrRecurringFrequency {
  return typeof v === 'string' && (CMR_RECURRING_FREQUENCIES as readonly string[]).includes(v)
}

/** Sunday-first, matching schedule_weekday (0 = Sunday … 6 = Saturday) and lib/cmr/week. */
export const CMR_WEEKDAY_LABEL: readonly string[] = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const

export const CMR_WEEKDAY_SHORT: readonly string[] = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

/** 1 = January … 12 = December, matching schedule_anchor_month. */
export const CMR_MONTH_LABEL: readonly string[] = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const

/** "1st", "2nd", "21st", "31st" — for a day of the month. */
export function ordinal(n: number): string {
  const rem100 = n % 100
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`
  switch (n % 10) {
    case 1:
      return `${n}st`
    case 2:
      return `${n}nd`
    case 3:
      return `${n}rd`
    default:
      return `${n}th`
  }
}

export const CMR_VENDOR_NAME_MAX = 80
export const CMR_PLAN_TERMS_MAX = 200
export const CMR_VENDOR_NOTES_MAX = 500
/** $999,999,999.99 — mirrors the DB check. */
export const CMR_MAX_CENTS = 99_999_999_999

// ── the schedule ────────────────────────────────────────────────────────────

/**
 * A vendor's schedule, in the three columns the DB keeps. Exactly the columns its frequency
 * needs are set and the rest are null — the shape check enforces that, and parseSchedule below
 * builds nothing else.
 *
 * `null` for the whole schedule means a vendor that has none yet. The database tolerates that
 * (see the migration's deploy-window note); the API refuses to create or save one, and the due
 * engine skips it rather than guessing a date.
 */
export interface CmrRecurringSchedule {
  /** 0 = Sunday … 6 = Saturday. Weekly only. */
  weekday: number | null
  /** 1 … 31, clamped to the month's length when the occurrence is computed. */
  dayOfMonth: number | null
  /** 1 = January … 12 = December — the first month of the cycle. Quarterly / annually only. */
  anchorMonth: number | null
}

export const NO_SCHEDULE: CmrRecurringSchedule = { weekday: null, dayOfMonth: null, anchorMonth: null }

/** Whether a schedule carries everything `section` needs (urgent needs — and allows — nothing). */
export function isScheduleComplete(section: CmrRecurringSection, s: CmrRecurringSchedule): boolean {
  switch (section) {
    case 'weekly':
      return s.weekday !== null && s.dayOfMonth === null && s.anchorMonth === null
    case 'monthly':
      return s.dayOfMonth !== null && s.weekday === null && s.anchorMonth === null
    case 'quarterly':
    case 'annually':
      return s.dayOfMonth !== null && s.anchorMonth !== null && s.weekday === null
    case 'urgent':
      return s.weekday === null && s.dayOfMonth === null && s.anchorMonth === null
  }
}

/**
 * The schedule in the reader's terms: "Every Thursday", "The 15th of each month",
 * "The 10th of Feb, May, Aug, Nov", "The 31st of December each year". A section with no
 * schedule yet says so plainly.
 */
export function describeSchedule(section: CmrRecurringSection, s: CmrRecurringSchedule): string {
  if (section === 'urgent') return 'No fixed schedule'
  if (!isScheduleComplete(section, s)) return 'No schedule set'
  switch (section) {
    case 'weekly':
      return `Every ${CMR_WEEKDAY_LABEL[s.weekday as number]}`
    case 'monthly':
      return `The ${ordinal(s.dayOfMonth as number)} of each month`
    case 'quarterly': {
      const months = quarterMonths(s.anchorMonth as number)
        .map((m) => CMR_MONTH_LABEL[m - 1].slice(0, 3))
        .join(', ')
      return `The ${ordinal(s.dayOfMonth as number)} of ${months}`
    }
    case 'annually':
      return `The ${ordinal(s.dayOfMonth as number)} of ${CMR_MONTH_LABEL[(s.anchorMonth as number) - 1]} each year`
  }
}

/** The four months a quarterly vendor recurs in, starting at its anchor: [anchor, +3, +6, +9]. */
export function quarterMonths(anchorMonth: number): number[] {
  return [0, 3, 6, 9].map((k) => ((anchorMonth - 1 + k) % 12) + 1)
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
  schedule: CmrRecurringSchedule
  /** False when the section needs a schedule and this vendor has none (see CmrRecurringSchedule). */
  scheduleComplete: boolean
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
  schedule_weekday: number | null
  schedule_day_of_month: number | null
  schedule_anchor_month: number | null
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
  'id, account_id, vendor_name, amount_cents, section, schedule_weekday, schedule_day_of_month, schedule_anchor_month, last_amount_sent_cents, plan_terms, plan_due_date, notes, on_hold, active, sort_order, created_by, created_at'

export const scheduleOf = (r: {
  schedule_weekday: number | null
  schedule_day_of_month: number | null
  schedule_anchor_month: number | null
}): CmrRecurringSchedule => ({
  weekday: r.schedule_weekday,
  dayOfMonth: r.schedule_day_of_month,
  anchorMonth: r.schedule_anchor_month,
})

/** The schedule as the three DB columns, for an insert or update. */
export const scheduleColumns = (
  s: CmrRecurringSchedule,
): { schedule_weekday: number | null; schedule_day_of_month: number | null; schedule_anchor_month: number | null } => ({
  schedule_weekday: s.weekday,
  schedule_day_of_month: s.dayOfMonth,
  schedule_anchor_month: s.anchorMonth,
})

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
  const schedule = scheduleOf(r)
  return {
    id: r.id,
    accountId: r.account_id,
    accountName: acc?.name ?? 'Unknown account',
    accountActive: acc?.active ?? false,
    vendorName: r.vendor_name,
    amountCents: cents(r.amount_cents),
    section: r.section,
    schedule,
    scheduleComplete: isScheduleComplete(r.section, schedule),
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

const SECTION_RANK: Record<CmrRecurringSection, number> = {
  weekly: 0,
  monthly: 1,
  quarterly: 2,
  annually: 3,
  urgent: 4,
}

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
    : { ok: false, error: 'Choose a frequency: Weekly, Monthly, Quarterly, Annually or Urgent Payment Plans.' }
}

/**
 * The schedule for a section, from whatever the client sent. STRICTER THAN THE DATABASE: a
 * scheduled section must arrive complete (the DB also tolerates a schedule-less row, which only
 * exists so an insert from the build deployed at migration time can't error — see the
 * migration). Fields that don't belong to the section must be absent or null; anything else is
 * a mistake worth reporting rather than silently dropping.
 */
export function parseSchedule(section: CmrRecurringSection, src: Record<string, unknown>): Parsed<CmrRecurringSchedule> {
  const weekday = parseScheduleInt(src.scheduleWeekday, 'A day of the week', 0, 6)
  if (!weekday.ok) return weekday
  const dayOfMonth = parseScheduleInt(src.scheduleDayOfMonth, 'A day of the month', 1, 31)
  if (!dayOfMonth.ok) return dayOfMonth
  const anchorMonth = parseScheduleInt(src.scheduleAnchorMonth, 'A month', 1, 12)
  if (!anchorMonth.ok) return anchorMonth

  const given: CmrRecurringSchedule = {
    weekday: weekday.value,
    dayOfMonth: dayOfMonth.value,
    anchorMonth: anchorMonth.value,
  }

  if (section === 'urgent') {
    return given.weekday === null && given.dayOfMonth === null && given.anchorMonth === null
      ? { ok: true, value: NO_SCHEDULE }
      : { ok: false, error: SCHEDULE_URGENT_NONE }
  }
  if (section === 'weekly') {
    if (given.weekday === null) return { ok: false, error: 'Choose the day of the week this is paid.' }
    if (given.dayOfMonth !== null || given.anchorMonth !== null) return { ok: false, error: SCHEDULE_WRONG_FIELDS }
    return { ok: true, value: { weekday: given.weekday, dayOfMonth: null, anchorMonth: null } }
  }
  if (given.dayOfMonth === null) return { ok: false, error: 'Choose the day of the month this is paid.' }
  if (given.weekday !== null) return { ok: false, error: SCHEDULE_WRONG_FIELDS }
  if (section === 'monthly') {
    if (given.anchorMonth !== null) return { ok: false, error: SCHEDULE_WRONG_FIELDS }
    return { ok: true, value: { weekday: null, dayOfMonth: given.dayOfMonth, anchorMonth: null } }
  }
  if (given.anchorMonth === null) {
    return {
      ok: false,
      error: section === 'quarterly' ? 'Choose the first month of the quarter.' : 'Choose the month this is paid.',
    }
  }
  return { ok: true, value: { weekday: null, dayOfMonth: given.dayOfMonth, anchorMonth: given.anchorMonth } }
}

export const SCHEDULE_WRONG_FIELDS = 'That schedule does not match the frequency you chose.'
export const SCHEDULE_URGENT_NONE = 'Urgent Payment Plans do not have a recurring schedule.'

/** A whole number within [min, max]; missing / null → null. Nothing is rounded or coerced. */
function parseScheduleInt(v: unknown, label: string, min: number, max: number): Parsed<number | null> {
  if (v === undefined || v === null || v === '') return { ok: true, value: null }
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
    return { ok: false, error: `${label} is not valid.` }
  }
  return { ok: true, value: v }
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
