import type { CmrRequestPlacedKind, CmrRequestStatus } from '@/lib/supabase/database.types'
import { CMR_PAYEE_MAX, parseLedgerCents, parseOptionalText, parseRequiredText, type Parsed } from '@/lib/cmr/ledger'
import { parseDueDate } from '@/lib/cmr/priorities'

/**
 * SN Cash Ledger (CMR) vendor requests — shared shapes and validation for
 * /api/cmr/requests/* and the Requests screen. No server-only imports, so client components
 * can use it too.
 *
 *   • A request is a Requester (or the Controller) asking for a vendor to be paid. Submitting
 *     one is the ONLY write a non-Controller can make anywhere in Cash Ledger; a Viewer can't
 *     submit at all.
 *   • A queued request may be edited or withdrawn by its own submitter, or by the Controller.
 *     Once it is placed or declined it is history and nobody edits it.
 *   • The Controller PLACES a queued request into the daily pending list or a weekly priority,
 *     choosing the day/period or the week then (the request's due date only pre-fills it).
 *     The placed request records where it went (placedKind + placedRefId).
 *   • A placement can be UNDONE: the row it created is deleted and the request returns to the
 *     queue — but only while that row is untouched. Once it has been paid, or pushed / carried
 *     onward, undoing would erase work that has moved on, so it is refused and the row says why.
 *   • Money is integer cents; amount is optional and stored as 0 when there's no figure.
 */

export type { CmrRequestStatus, CmrRequestPlacedKind }

export const CMR_REQUEST_STATUSES: readonly CmrRequestStatus[] = ['queued', 'placed', 'paid', 'declined'] as const
export const CMR_REQUEST_PLACED_KINDS: readonly CmrRequestPlacedKind[] = ['pending', 'priority'] as const

export const CMR_REQUEST_STATUS_LABEL: Record<CmrRequestStatus, string> = {
  queued: 'Queued',
  placed: 'Placed',
  paid: 'Paid',
  declined: 'Declined',
}

export const CMR_REQUEST_PLACED_KIND_LABEL: Record<CmrRequestPlacedKind, string> = {
  pending: 'Daily pending',
  priority: 'Weekly priority',
}

/** Vendor shares the pending-item payee limit — a placed request becomes exactly that payee. */
export const CMR_REQUEST_VENDOR_MAX = CMR_PAYEE_MAX
export const CMR_REQUEST_NOTES_MAX = 500

// ── API shapes ──────────────────────────────────────────────────────────────

export interface CmrRequest {
  id: string
  requestedBy: string
  /** Display name of requestedBy, when known. */
  requestedByName: string | null
  accountId: string
  accountName: string
  accountActive: boolean
  vendor: string
  /** 0 when the request carries no dollar figure. */
  amountCents: number
  dueDate: string | null
  notes: string | null
  status: CmrRequestStatus
  placedKind: CmrRequestPlacedKind | null
  placedRefId: string | null
  placedAt: string | null
  placedBy: string | null
  placedByName: string | null
  createdAt: string
  /** Placed, and the row it created can still be removed (Controller only; the API re-checks). */
  canUnplace: boolean
  /** Why undoing is not possible, in the reader's terms — null when it is. */
  unplaceBlockedReason: string | null
}

export interface CmrRequestAccountRef {
  id: string
  name: string
  accountType: string | null
  active: boolean
  sortOrder: number
}

export interface CmrRequestTotals {
  queuedCount: number
  queuedCents: number
  historyCount: number
  placedCount: number
  declinedCount: number
  /** Queued requests submitted by the caller. */
  mineQueuedCount: number
}

export interface CmrRequestsView {
  /** Oldest first — the Controller works the queue from the top. */
  queued: CmrRequest[]
  /** Everything settled (placed / paid / declined), newest first. */
  history: CmrRequest[]
  totals: CmrRequestTotals
  /** Active accounts only would hide history; the full list is sent and the form filters. */
  accounts: CmrRequestAccountRef[]
  today: string
  thisWeekStart: string
  /** Controller — may place, decline, and edit/withdraw anyone's request. */
  canEdit: boolean
  /** Controller or Requester — may submit. */
  canRequest: boolean
  /** The caller, so the client knows which rows are their own. */
  userId: string
}

// ── DB row ──────────────────────────────────────────────────────────────────

export type CmrRequestRow = {
  id: string
  requested_by: string
  account_id: string
  vendor: string
  amount_cents: number
  due_date: string | null
  notes: string | null
  status: CmrRequestStatus
  placed_kind: CmrRequestPlacedKind | null
  placed_ref_id: string | null
  placed_at: string | null
  placed_by: string | null
  created_at: string
}

export const CMR_REQUEST_COLS =
  'id, requested_by, account_id, vendor, amount_cents, due_date, notes, status, placed_kind, placed_ref_id, placed_at, placed_by, created_at'

// bigint columns: PostgREST sends JSON numbers (cents stay far below 2^53). Normalise defensively.
const cents = (v: number | string): number => Number(v)

/** The live state of the row a placed request created (absent when nothing was looked up). */
export type CmrPlacedRowState =
  | { present: false }
  | { present: true; status: 'pending' | 'paid' | 'pushed' | 'open' | 'resolved' | 'carried' }

/**
 * Whether a placed request can be undone, and why not when it can't. THE rule of the undo:
 * a placement may be taken back only while the row it created is still untouched, because
 * undoing deletes that row.
 *
 *   • pending item — still 'pending' → yes; 'paid' or 'pushed' → no;
 *   • weekly priority — still 'open' → yes; 'paid', 'resolved' or 'carried' → no;
 *   • the row is already gone → yes (the request simply returns to the queue).
 *
 * Shared by the API (which enforces it, and the DB function re-checks it under a row lock) and
 * the client (which uses it to disable the button and say why).
 */
export function unplaceRefusal(
  r: { status: CmrRequestStatus },
  placed: CmrPlacedRowState | null,
): string | null {
  if (r.status !== 'placed') {
    return r.status === 'queued' ? 'That request is still in the queue.' : `That request was ${CMR_REQUEST_STATUS_LABEL[r.status].toLowerCase()}, not placed.`
  }
  if (!placed || !placed.present) return null
  switch (placed.status) {
    case 'paid':
      return 'It was already paid — undoing would erase the payment. Mark it unpaid first.'
    case 'pushed':
      return 'The pending item was pushed to another day. Undo the push there first.'
    case 'carried':
      return 'The priority was carried to another week. Undo the carry there first.'
    case 'resolved':
      return 'The priority was already resolved. Reopen it first.'
    default:
      return null
  }
}

export function toCmrRequest(
  r: CmrRequestRow,
  accounts: Map<string, CmrRequestAccountRef> = new Map(),
  names: Map<string, string> = new Map(),
  placed: Map<string, CmrPlacedRowState> = new Map(),
): CmrRequest {
  const acc = accounts.get(r.account_id)
  return {
    id: r.id,
    requestedBy: r.requested_by,
    requestedByName: names.get(r.requested_by) ?? null,
    accountId: r.account_id,
    accountName: acc?.name ?? 'Unknown account',
    accountActive: acc?.active ?? false,
    vendor: r.vendor,
    amountCents: cents(r.amount_cents),
    dueDate: r.due_date,
    notes: r.notes,
    status: r.status,
    placedKind: r.placed_kind,
    placedRefId: r.placed_ref_id,
    placedAt: r.placed_at,
    placedBy: r.placed_by,
    placedByName: r.placed_by ? names.get(r.placed_by) ?? null : null,
    createdAt: r.created_at,
    canUnplace: r.status === 'placed' && unplaceRefusal(r, r.placed_ref_id ? placed.get(r.placed_ref_id) ?? null : null) === null,
    unplaceBlockedReason:
      r.status === 'placed' ? unplaceRefusal(r, r.placed_ref_id ? placed.get(r.placed_ref_id) ?? null : null) : null,
  }
}

// ── the rules ───────────────────────────────────────────────────────────────

/** Still in the queue — the only state that can be edited, withdrawn, placed or declined. */
export const isQueued = (r: { status: CmrRequestStatus }): boolean => r.status === 'queued'

/**
 * Whether `userId` may edit or withdraw this request. THE access rule of this phase, shared by
 * the API (which enforces it) and the client (which only hides buttons):
 *
 *   • a Controller may edit or withdraw ANY request, but still only while it is queued —
 *     a placed request belongs to the ledger now, and a declined one is history;
 *   • a Requester may do so only on their OWN request, and only while it is queued;
 *   • a Viewer never may (they can't even reach this — guardCmrCanRequest refuses them).
 */
export function canModifyRequest(
  r: { requested_by: string; status: CmrRequestStatus },
  actor: { userId: string; role: 'controller' | 'requester' | 'viewer' },
): boolean {
  if (!isQueued(r)) return false
  if (actor.role === 'controller') return true
  if (actor.role === 'requester') return r.requested_by === actor.userId
  return false
}

/** Why a request can't be modified, in the caller's terms (null when it can). */
export function modifyRefusal(
  r: { requested_by: string; status: CmrRequestStatus },
  actor: { userId: string; role: 'controller' | 'requester' | 'viewer' },
): { error: string; code: string; status: 403 | 409 } | null {
  if (canModifyRequest(r, actor)) return null
  if (!isQueued(r)) {
    return {
      error: `That request was already ${CMR_REQUEST_STATUS_LABEL[r.status].toLowerCase()} and can’t be changed.`,
      code: 'NOT_EDITABLE',
      status: 409,
    }
  }
  return { error: 'You can only change your own requests.', code: 'FORBIDDEN', status: 403 }
}

export function computeRequestTotals(queued: CmrRequest[], history: CmrRequest[], userId: string): CmrRequestTotals {
  return {
    queuedCount: queued.length,
    queuedCents: queued.reduce((s, r) => s + r.amountCents, 0),
    historyCount: history.length,
    placedCount: history.filter((r) => r.status === 'placed' || r.status === 'paid').length,
    declinedCount: history.filter((r) => r.status === 'declined').length,
    mineQueuedCount: queued.filter((r) => r.requestedBy === userId).length,
  }
}

/** Queue order: oldest first (then id, so the order is total). */
export const compareQueued = (a: { createdAt: string; id: string }, b: { createdAt: string; id: string }): number =>
  a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)

/** History order: newest first. */
export const compareHistory = (a: { createdAt: string; id: string }, b: { createdAt: string; id: string }): number =>
  b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id)

// ── validation ──────────────────────────────────────────────────────────────

export type { Parsed }

export function isRequestStatus(v: unknown): v is CmrRequestStatus {
  return typeof v === 'string' && (CMR_REQUEST_STATUSES as readonly string[]).includes(v)
}

export function isPlacedKind(v: unknown): v is CmrRequestPlacedKind {
  return v === 'pending' || v === 'priority'
}

export const parseVendor = (v: unknown): Parsed<string> => parseRequiredText(v, 'A vendor name', CMR_REQUEST_VENDOR_MAX)

export const parseRequestNotes = (v: unknown): Parsed<string | null> =>
  parseOptionalText(v, 'Notes', CMR_REQUEST_NOTES_MAX, { multiline: true })

/** Optional amount: missing / null → 0 (no dollar figure). Never negative. */
export function parseRequestAmount(v: unknown): Parsed<number> {
  if (v === undefined || v === null) return { ok: true, value: 0 }
  return parseLedgerCents(v, 'Amount', { signed: false })
}

/** Optional due date — the same rules as a priority's. */
export const parseRequestDueDate = parseDueDate

/** The place target the Controller chose. */
export function parsePlaceTarget(v: unknown): Parsed<CmrRequestPlacedKind> {
  return isPlacedKind(v) ? { ok: true, value: v } : { ok: false, error: 'Choose the daily pending list or a weekly priority.' }
}
