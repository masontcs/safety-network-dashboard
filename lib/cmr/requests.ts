import type { CmrRequestPlacedKind, CmrRequestStatus } from '@/lib/supabase/database.types'
import { CMR_PAYEE_MAX, formatCents, parseLedgerCents, parseOptionalText, parseRequiredText, type Parsed } from '@/lib/cmr/ledger'
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
 *
 * AP Phase 2 — a request is COMPOSED from the account's current A/P (lib/cmr/ap):
 *   • account → vendor (from that account's current A/P) → tick invoices. Credits are their own
 *     tickable lines with a negative balance. amount = Σ selected bills − Σ selected credits,
 *     computed on the server from the stored lines (cmr_compose_vendor_request) — a client amount
 *     is never used.
 *   • The ticked lines are SNAPSHOTTED into cmr_vendor_request_invoices, so a re-import that
 *     drops or pays them can't erase what the request was built from. The snapshot is the source
 *     of truth for the amount; an invoice that is no longer in the current A/P only gets a hint.
 *   • Requesters can ONLY compose from A/P. A Controller may still enter a vendor + amount by hand
 *     (and adds pending items / priorities straight on the ledger), so A/P never blocks them.
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
  /** The A/P invoices the request was built from (snapshot), bills then credits. Empty for a hand-entered request. */
  invoices: CmrRequestInvoice[]
  /** Built from A/P invoices (has a snapshot) — its amount can only change by re-picking invoices. */
  fromAp: boolean
  /** How many of its invoices are no longer in the account's current A/P. */
  staleInvoiceCount: number
}

/** One snapshotted invoice of a request, with where it stands in the account's CURRENT A/P. */
export interface CmrRequestInvoice {
  id: string
  /** The source A/P line while it still exists (null once a re-import replaced it). */
  apLineId: string | null
  vendorName: string
  invoiceNum: string | null
  docType: string
  billDate: string | null
  dueDate: string | null
  /** Signed, as snapshotted at submit: bills positive, credits negative. */
  openBalanceCents: number
  /** The matching payable line in the account's current A/P (same vendor, type, number, date). */
  inCurrentAp: boolean
  /** That current line's id — what an edit pre-ticks. */
  currentApLineId: string | null
  /** That current line's open balance, when it differs from the snapshot (e.g. part-paid); else null. */
  currentBalanceCents: number | null
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
  invoices: CmrRequestInvoice[] = [],
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
    invoices,
    fromAp: invoices.length > 0,
    staleInvoiceCount: invoices.filter((i) => !i.inCurrentAp).length,
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

// ── AP Phase 2: composing a request from A/P invoices ───────────────────────

/** The most invoices one request may carry (a sanity bound on the payload). */
export const CMR_REQUEST_MAX_INVOICES = 500
/** A/P vendor names are stored exactly as QuickBooks prints them, up to this long. */
export const CMR_AP_VENDOR_NAME_MAX = 200

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * The request's display vendor for an A/P vendor name: whitespace squashed (QuickBooks names
 * can carry double spaces — "OMEGA  ACCOUNTING SOLUTIONS") and cut to the request vendor limit.
 * Matching against the A/P lines always uses the EXACT name; this is only the label.
 */
export function requestVendorLabel(apVendorName: string): string {
  const t = apVendorName.replace(/\s+/g, ' ').trim()
  return t.length <= CMR_REQUEST_VENDOR_MAX ? t : `${cutCodePoints(t, CMR_REQUEST_VENDOR_MAX - 1).trimEnd()}…`
}

/**
 * The first `n` UTF-16 units of `s`, never splitting a surrogate pair (an emoji): a lone
 * surrogate is invalid JSON text for Postgres, and the write would fail.
 */
function cutCodePoints(s: string, n: number): string {
  let out = ''
  for (const ch of s) {
    if (out.length + ch.length > n) break
    out += ch
  }
  return out
}

/** The A/P vendor name, exactly as sent (it must match the stored lines byte for byte). */
export function parseApVendorName(v: unknown): Parsed<string> {
  if (typeof v !== 'string' || !v.trim()) return { ok: false, error: 'Choose a vendor.' }
  if (v.length > CMR_AP_VENDOR_NAME_MAX) return { ok: false, error: 'That vendor name is too long.' }
  return { ok: true, value: v }
}

/** The ticked A/P line ids: an array of 1…500 uuids, de-duplicated. */
export function parseApLineIds(v: unknown): Parsed<string[]> {
  if (!Array.isArray(v)) return { ok: false, error: 'Tick at least one invoice.' }
  if (v.some((x) => typeof x !== 'string' || !UUID.test(x))) return { ok: false, error: 'One of the invoices is not valid.' }
  const ids = [...new Set((v as string[]).map((x) => x.toLowerCase()))]
  if (!ids.length) return { ok: false, error: 'Tick at least one invoice.' }
  if (ids.length > CMR_REQUEST_MAX_INVOICES) return { ok: false, error: `A request can carry at most ${CMR_REQUEST_MAX_INVOICES} invoices.` }
  return { ok: true, value: ids }
}

/** The part of an A/P line composing needs. */
export interface CmrComposableLine {
  id: string
  accountId: string
  vendorName: string
  docType: string
  payable: boolean
  openBalanceCents: number
}

export type CmrComposeRefusal = 'NO_LINES' | 'STALE_LINES' | 'NOT_POSITIVE' | 'TOO_LARGE'

/** The request amount ceiling (cmr_vendor_requests_amount_chk). */
export const CMR_REQUEST_AMOUNT_MAX = 99_999_999_999

/**
 * THE compose rule, shared by the API's pre-check, the fake database in the tests and the
 * picker's running total (cmr_compose_vendor_request applies the same rule in SQL, with the
 * account locked, and is what actually decides):
 *
 *   • every ticked id must be a PAYABLE line of that vendor in that account's CURRENT A/P
 *     (`current` is exactly that account's current lines) — one that isn't refuses the whole
 *     request (STALE_LINES), it is never silently dropped;
 *   • amount = Σ balances (bills +, credits −), and it must come out above zero.
 */
export function composeFromAp<L extends CmrComposableLine>(
  current: L[],
  sel: { accountId: string; vendorName: string; apLineIds: string[] },
): { ok: true; lines: L[]; totalCents: number } | { ok: false; code: CmrComposeRefusal; staleIds: string[] } {
  const ids = [...new Set(sel.apLineIds.map((x) => x.toLowerCase()))]
  if (!ids.length) return { ok: false, code: 'NO_LINES', staleIds: [] }
  const byId = new Map(current.map((l) => [l.id.toLowerCase(), l]))
  const lines: L[] = []
  const staleIds: string[] = []
  for (const id of ids) {
    const l = byId.get(id)
    if (l && l.payable && l.accountId === sel.accountId && l.vendorName === sel.vendorName) lines.push(l)
    else staleIds.push(id)
  }
  if (staleIds.length) return { ok: false, code: 'STALE_LINES', staleIds }
  const totalCents = selectionTotal(lines)
  if (totalCents <= 0) return { ok: false, code: 'NOT_POSITIVE', staleIds: [] }
  if (totalCents > CMR_REQUEST_AMOUNT_MAX) return { ok: false, code: 'TOO_LARGE', staleIds: [] }
  return { ok: true, lines, totalCents }
}

/** Σ selected bills − Σ selected credits (credits are stored negative, so it is a plain sum). */
export function selectionTotal(lines: { openBalanceCents: number }[]): number {
  return lines.reduce((s, l) => s + l.openBalanceCents, 0)
}

/** The picker's running figures: bills, credits (negative) and the net. */
export function selectionBreakdown(lines: { docType: string; openBalanceCents: number }[]): {
  billsCents: number
  creditsCents: number
  totalCents: number
  billCount: number
  creditCount: number
} {
  let billsCents = 0, creditsCents = 0, billCount = 0, creditCount = 0
  for (const l of lines) {
    if (l.openBalanceCents < 0 || l.docType === 'Credit') { creditsCents += l.openBalanceCents; creditCount++ }
    else { billsCents += l.openBalanceCents; billCount++ }
  }
  return { billsCents, creditsCents, totalCents: billsCents + creditsCents, billCount, creditCount }
}

/** What the caller is told for each compose refusal. */
export function composeRefusalMessage(code: CmrComposeRefusal, ctx: { accountName?: string; staleCount?: number } = {}): string {
  switch (code) {
    case 'NO_LINES':
      return 'Tick at least one invoice.'
    case 'STALE_LINES': {
      const n = ctx.staleCount ?? 0
      const which = n === 1 ? 'One of the invoices you ticked is' : n > 1 ? `${n} of the invoices you ticked are` : 'Some of the invoices you ticked are'
      return `${which} no longer in ${ctx.accountName ?? 'this account'}’s current A/P — it may have been paid or re-imported. Reload the invoices and tick them again.`
    }
    case 'NOT_POSITIVE':
      return 'The credits you ticked cancel out the bills. Tick more bills or fewer credits — a request has to pay something.'
    case 'TOO_LARGE':
      return 'That total is larger than a request can hold.'
  }
}

/** The key an invoice is matched on across A/P re-imports (line ids change every import). */
export const invoiceMatchKey = (i: { vendorName: string; docType: string; invoiceNum: string | null; billDate: string | null }): string =>
  [i.vendorName, i.docType, i.invoiceNum ?? '', i.billDate ?? ''].join('\u0000')

/** "Bill 9421 · 1/24/25" style label for one invoice. */
export function invoiceLabel(i: { docType: string; invoiceNum: string | null }): string {
  return `${i.docType === 'Credit' ? 'Credit' : 'Bill'} ${i.invoiceNum ?? '(no number)'}`
}

/** Signed money: "$1,234.56" / "−$50.00". */
export const formatSignedCents = (c: number): string => (c < 0 ? `−${formatCents(-c)}` : formatCents(c))

/** Bills first (oldest first), then credits — the order a request lists its invoices. */
export function compareRequestInvoices(
  a: { docType: string; billDate: string | null; invoiceNum: string | null },
  b: { docType: string; billDate: string | null; invoiceNum: string | null },
): number {
  const ca = a.docType === 'Credit' ? 1 : 0
  const cb = b.docType === 'Credit' ? 1 : 0
  if (ca !== cb) return ca - cb
  if (a.billDate !== b.billDate) {
    if (a.billDate === null) return 1
    if (b.billDate === null) return -1
    return a.billDate < b.billDate ? -1 : 1
  }
  return (a.invoiceNum ?? '').localeCompare(b.invoiceNum ?? '', 'en-US', { numeric: true })
}

/** The notes limit of the row a placement creates (pending item / priority). */
export const CMR_PLACED_NOTES_MAX = 500

/**
 * The notes a PLACED request carries onto its pending item / priority: the request's own notes,
 * then its invoices ("Invoices: Bill 9421 $1,710.00; Credit CM −$6,008.14 = $12,223.16"). Cut to
 * the 500-character limit with "+N more" so the total always shows. A hand-entered request (no
 * invoices) keeps its notes unchanged.
 */
export function placedNotesFor(
  notes: string | null,
  invoices: { docType: string; invoiceNum: string | null; openBalanceCents: number }[],
  max = CMR_PLACED_NOTES_MAX,
): string | null {
  if (!invoices.length) return notes
  const parts = invoices.map((i) => `${invoiceLabel(i)} ${formatSignedCents(i.openBalanceCents)}`)
  const total = ` = ${formatSignedCents(selectionTotal(invoices))}`
  const head = notes ? `${notes} · ` : ''
  const label = invoices.length === 1 ? 'Invoice: ' : `Invoices (${invoices.length}): `
  const fits = (k: number) => {
    const shown = parts.slice(0, k).join('; ')
    const more = k < parts.length ? `${k ? '; ' : ''}+${parts.length - k} more` : ''
    return `${head}${label}${shown}${more}${total}`
  }
  for (let k = parts.length; k >= 0; k--) {
    const s = fits(k)
    if (s.length <= max) return s
  }
  // Even the bare summary is too long only if the request's own notes fill the space.
  const summary = `${label}+${parts.length} more${total}`
  const room = max - summary.length
  return room > 0 && notes ? `${cutCodePoints(notes, room - 4).trimEnd()}… · ${summary}` : summary.slice(0, max)
}
