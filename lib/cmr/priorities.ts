import type { createServiceClient } from '@/lib/supabase/server'
import type { CmrPriorityStatus } from '@/lib/supabase/database.types'
import { parseLedgerDate, parseOptionalText, parseRequiredText, type Parsed } from '@/lib/cmr/ledger'
import { weekStartSunday } from '@/lib/cmr/week'

/**
 * SN Cash Ledger (CMR) weekly priorities — shared shapes, totals math and validation for
 * /api/cmr/priorities and the Weekly priorities screen. No server-only imports, so client
 * components can use it too.
 *
 *   • A week runs Sunday → Saturday and is keyed by its Sunday (lib/cmr/week).
 *   • amount is OPTIONAL: a priority can be a task with no dollar figure. It is stored as 0 and
 *     shown blank. Totals simply sum whatever amounts exist.
 *   • status: open ↔ resolved, open ↔ paid (paid stamps paid_at/paid_by; leaving paid clears
 *     them). 'carried' is reserved for Phase 6 (carry forward) and is never written here.
 *   • Money is integer cents everywhere.
 */

export type { CmrPriorityStatus }

export const CMR_PRIORITY_STATUSES: readonly CmrPriorityStatus[] = ['open', 'resolved', 'paid', 'carried'] as const
/** The statuses Phase 4 may write. */
export const CMR_PRIORITY_WRITABLE_STATUSES = ['open', 'resolved', 'paid'] as const
export type CmrPriorityWritableStatus = (typeof CMR_PRIORITY_WRITABLE_STATUSES)[number]

export const CMR_PRIORITY_STATUS_LABEL: Record<CmrPriorityStatus, string> = {
  open: 'Open',
  resolved: 'Resolved',
  paid: 'Paid',
  carried: 'Carried forward',
}

export const CMR_PRIORITY_DESCRIPTION_MAX = 120
export const CMR_PRIORITY_NOTES_MAX = 500
/** $999,999,999.99 — mirrors the DB check. */
export const CMR_PRIORITY_MAX_CENTS = 99_999_999_999

// ── API shapes ──────────────────────────────────────────────────────────────

export interface CmrPriority {
  id: string
  weekStart: string
  description: string
  /** 0 when the priority has no dollar figure. */
  amountCents: number
  dueDate: string | null
  notes: string | null
  isTopPriority: boolean
  status: CmrPriorityStatus
  carriedFromId: string | null
  paidAt: string | null
  paidBy: string | null
  /** Display name of paidBy, when known. */
  paidByName: string | null
  sortOrder: number
  createdAt: string
}

export interface CmrPriorityTotals {
  /** Σ amounts still open — what is still needed this week. */
  neededCents: number
  /** Σ amounts paid or resolved. */
  paidResolvedCents: number
  /** Σ every amount in the week. */
  totalCents: number
  count: number
  openCount: number
  /** Every priority flagged Top, whatever its status. */
  topPriorityCount: number
  /** Top priorities still open. */
  openTopPriorityCount: number
}

export interface CmrPrioritiesView {
  weekStart: string
  weekEnd: string
  /** Pacific today, and the Sunday of this week. */
  today: string
  thisWeekStart: string
  priorities: CmrPriority[]
  totals: CmrPriorityTotals
  canEdit: boolean
}

// ── DB row ──────────────────────────────────────────────────────────────────

export type CmrPriorityRow = {
  id: string
  week_start: string
  description: string
  amount_cents: number
  due_date: string | null
  notes: string | null
  is_top_priority: boolean
  status: CmrPriorityStatus
  carried_from_id: string | null
  paid_at: string | null
  paid_by: string | null
  sort_order: number
  created_by: string | null
  created_at: string
}

export const CMR_PRIORITY_COLS =
  'id, week_start, description, amount_cents, due_date, notes, is_top_priority, status, carried_from_id, paid_at, paid_by, sort_order, created_by, created_at'

// bigint columns: PostgREST sends JSON numbers (cents stay far below 2^53). Normalise defensively.
const cents = (v: number | string): number => Number(v)

export function toCmrPriority(r: CmrPriorityRow, names: Map<string, string> = new Map()): CmrPriority {
  return {
    id: r.id,
    weekStart: r.week_start,
    description: r.description,
    amountCents: cents(r.amount_cents),
    dueDate: r.due_date,
    notes: r.notes,
    isTopPriority: r.is_top_priority,
    status: r.status,
    carriedFromId: r.carried_from_id,
    paidAt: r.paid_at,
    paidBy: r.paid_by,
    paidByName: r.paid_by ? names.get(r.paid_by) ?? null : null,
    sortOrder: r.sort_order,
    createdAt: r.created_at,
  }
}

type Ordered = { sortOrder: number; createdAt: string; id: string }
/** Display order within a week: sort_order, then creation time, then id. */
export const comparePriorities = (a: Ordered, b: Ordered): number =>
  a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)

// ── the math ────────────────────────────────────────────────────────────────

export const isDone = (s: CmrPriorityStatus): boolean => s === 'paid' || s === 'resolved'

/**
 * Week totals. needed = Σ open; paid/resolved = Σ paid + resolved; total = Σ every row.
 * A priority with no dollar figure (0) adds nothing but still counts toward the counts.
 * ('carried' rows — Phase 6 — are in the total only; they are neither needed nor done here.)
 */
export function computePriorityTotals(items: { amountCents: number; status: CmrPriorityStatus; isTopPriority: boolean }[]): CmrPriorityTotals {
  const t: CmrPriorityTotals = {
    neededCents: 0,
    paidResolvedCents: 0,
    totalCents: 0,
    count: items.length,
    openCount: 0,
    topPriorityCount: 0,
    openTopPriorityCount: 0,
  }
  for (const i of items) {
    t.totalCents += i.amountCents
    if (i.status === 'open') {
      t.neededCents += i.amountCents
      t.openCount += 1
      if (i.isTopPriority) t.openTopPriorityCount += 1
    } else if (isDone(i.status)) {
      t.paidResolvedCents += i.amountCents
    }
    if (i.isTopPriority) t.topPriorityCount += 1
  }
  return t
}

/**
 * The columns a status change writes. → paid stamps paid_at/paid_by (keeping an existing stamp
 * if it was already paid); anything else clears them.
 */
export function statusPatch(
  prev: { status: CmrPriorityStatus; paid_at: string | null; paid_by: string | null },
  next: CmrPriorityWritableStatus,
  actorId: string,
  now: string,
): { status: CmrPriorityWritableStatus; paid_at: string | null; paid_by: string | null } {
  if (next === 'paid') {
    return prev.status === 'paid'
      ? { status: 'paid', paid_at: prev.paid_at ?? now, paid_by: prev.paid_by }
      : { status: 'paid', paid_at: now, paid_by: actorId }
  }
  return { status: next, paid_at: null, paid_by: null }
}

// ── formatting ──────────────────────────────────────────────────────────────

/** Initials for the paid stamp: "Mason Doty" → "MD". */
export function initialsOf(name: string | null | undefined): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean)
  if (!words.length) return ''
  const first = words[0][0] ?? ''
  const last = words.length > 1 ? words[words.length - 1][0] ?? '' : ''
  return (first + last).toUpperCase()
}

// ── validation ──────────────────────────────────────────────────────────────

export type { Parsed }

export function isPriorityStatus(v: unknown): v is CmrPriorityStatus {
  return typeof v === 'string' && (CMR_PRIORITY_STATUSES as readonly string[]).includes(v)
}

/**
 * A status this phase may set. 'carried' is refused with its own code — carrying a priority
 * forward is Phase 6 and needs the new-week copy that comes with it.
 */
export function parseWritableStatus(v: unknown): Parsed<CmrPriorityWritableStatus> & { code?: string } {
  if (v === 'carried') {
    return { ok: false, error: 'Carrying a priority to another week isn’t available yet.', code: 'CARRY_NOT_AVAILABLE' }
  }
  if (typeof v === 'string' && (CMR_PRIORITY_WRITABLE_STATUSES as readonly string[]).includes(v)) {
    return { ok: true, value: v as CmrPriorityWritableStatus }
  }
  return { ok: false, error: 'Status must be open, resolved or paid.' }
}

export const parseDescription = (v: unknown): Parsed<string> =>
  parseRequiredText(v, 'A description', CMR_PRIORITY_DESCRIPTION_MAX)

export const parsePriorityNotes = (v: unknown): Parsed<string | null> =>
  parseOptionalText(v, 'Notes', CMR_PRIORITY_NOTES_MAX, { multiline: true })

/**
 * The optional amount: missing / null → 0 (no dollar figure). Otherwise a JSON number that is
 * already whole cents, 0 … $999,999,999.99 — the client converts dollars once (MoneyInput).
 */
export function parsePriorityAmount(v: unknown): Parsed<number> {
  if (v === undefined || v === null) return { ok: true, value: 0 }
  if (typeof v !== 'number' || !Number.isSafeInteger(v)) return { ok: false, error: 'Amount must be a dollar amount.' }
  if (v < 0) return { ok: false, error: "Amount can't be negative." }
  if (v > CMR_PRIORITY_MAX_CENTS) return { ok: false, error: 'Amount is too large.' }
  return { ok: true, value: v }
}

/** Optional due date: missing / null / '' → null; otherwise a real 'YYYY-MM-DD'. */
export function parseDueDate(v: unknown): Parsed<string | null> {
  if (v === undefined || v === null || v === '') return { ok: true, value: null }
  const d = parseLedgerDate(v)
  return d.ok ? d : { ok: false, error: 'Due date must be a real date.' }
}

/** Any real date → the Sunday that starts its week. */
export function parseWeek(v: unknown): Parsed<string> {
  const d = parseLedgerDate(v)
  if (!d.ok) return { ok: false, error: 'Choose a valid week.' }
  return { ok: true, value: weekStartSunday(d.value) }
}

// ── reorder RPC ─────────────────────────────────────────────────────────────

/**
 * Rewrite sort_order for one week in ONE statement (cmr_reorder_weekly_priorities, service role
 * only). Called as a member of the client — supabase-js rpc() needs `this`. Cast because the
 * Database `Functions` type is deliberately empty (see database.types.ts).
 */
export async function reorderCmrPriorities(
  supabase: ReturnType<typeof createServiceClient>,
  weekStart: string,
  ids: string[],
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = (await (supabase as any).rpc('cmr_reorder_weekly_priorities', { p_week_start: weekStart, p_ids: ids })) as {
    error: { message: string } | null
  }
  if (error) throw new Error(error.message)
}
