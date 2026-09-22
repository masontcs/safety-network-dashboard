import { NextResponse } from 'next/server'
import type { createServiceClient } from '@/lib/supabase/server'
import { logAudit, getClientIp, type AuditAction } from '@/lib/audit/log'
import type { CmrAccess } from '@/lib/api/cmr'
import { pacificToday } from '@/lib/utils/date'
import { thisWeekStart } from '@/lib/cmr/week'
import { loadAccounts } from '@/lib/cmr/ledger-server'
import { displayNames } from '@/lib/cmr/priorities-server'
import { currentApLines } from '@/lib/cmr/ap-server'
import type { CmrApLine } from '@/lib/cmr/ap'
import {
  CMR_REQUEST_COLS,
  compareRequestInvoices,
  invoiceMatchKey,
  type CmrComposeRefusal,
  type CmrRequestInvoice,
  compareHistory,
  compareQueued,
  computeRequestTotals,
  toCmrRequest,
  type CmrPlacedRowState,
  type CmrRequest,
  type CmrRequestAccountRef,
  type CmrRequestRow,
  type CmrRequestsView,
} from '@/lib/cmr/requests'

/**
 * Server-only helpers shared by the /api/cmr/requests route handlers. They live here, not in
 * the route files, because a route.ts may export only HTTP handlers + route config (BUG-019).
 *
 * Nothing here checks access — every handler calls getCmrContext() + guardCmr /
 * guardCmrCanRequest / guardCmrController BEFORE touching any of these, and the
 * own-row-and-still-queued rule (lib/cmr/requests → modifyRefusal) is applied on top for a
 * Requester.
 */

export type Supabase = ReturnType<typeof createServiceClient>

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function bad(error: string, code = 'VALIDATION_ERROR', status = 400): NextResponse {
  return NextResponse.json({ success: false, error, code }, { status })
}

export function serverError(where: string, err: unknown): NextResponse {
  console.error(`[api/cmr/requests${where}]`, err)
  const message = err instanceof Error ? err.message : 'Unexpected error.'
  return NextResponse.json({ success: false, error: message, code: 'INTERNAL_ERROR' }, { status: 500 })
}

// A DB check / foreign-key rejection is the caller's input, not a server fault.
export const isInputViolation = (e: { code?: string } | null): boolean => !!e && (e.code === '23514' || e.code === '23503')

export async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = (await request.json()) as unknown
    return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null
  } catch {
    return null
  }
}

export async function requestById(supabase: Supabase, id: string): Promise<CmrRequestRow | null> {
  const { data, error } = await supabase.from('cmr_vendor_requests').select(CMR_REQUEST_COLS).eq('id', id).maybeSingle()
  if (error) throw new Error(error.message)
  return (data as unknown as CmrRequestRow | null) ?? null
}

export async function allRequestRows(supabase: Supabase): Promise<CmrRequestRow[]> {
  const { data, error } = await supabase.from('cmr_vendor_requests').select(CMR_REQUEST_COLS).order('created_at', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as CmrRequestRow[]
}

/** The account list the screen shows, in the same order as everywhere else in CMR. */
export function sortedAccounts(map: Map<string, CmrRequestAccountRef>): CmrRequestAccountRef[] {
  return [...map.values()].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
}

/**
 * The live state of the row each PLACED request created, keyed by that row's id, so the screen
 * can tell whether the placement can still be undone (and say why not). Rows that have since
 * been deleted come back `{ present: false }`, which is undoable — the request just returns to
 * the queue.
 */
type PlacedStatus = Extract<CmrPlacedRowState, { present: true }>['status']

export async function placedRowStates(supabase: Supabase, rows: CmrRequestRow[]): Promise<Map<string, CmrPlacedRowState>> {
  const out = new Map<string, CmrPlacedRowState>()
  const idsOf = (kind: 'pending' | 'priority') => [
    ...new Set(
      rows
        .filter((r) => r.status === 'placed' && r.placed_kind === kind && r.placed_ref_id)
        .map((r) => r.placed_ref_id as string),
    ),
  ]
  const read = async (table: 'cmr_pending_items' | 'cmr_weekly_priorities', ids: string[]) => {
    if (!ids.length) return
    const { data, error } = await supabase.from(table).select('id, status').in('id', ids)
    if (error) throw new Error(error.message)
    const found = (data ?? []) as unknown as { id: string; status: PlacedStatus }[]
    for (const r of found) out.set(r.id, { present: true, status: r.status })
    for (const id of ids) if (!out.has(id)) out.set(id, { present: false })
  }
  await Promise.all([read('cmr_pending_items', idsOf('pending')), read('cmr_weekly_priorities', idsOf('priority'))])
  return out
}

/**
 * Everything the Requests screen needs: the queue oldest-first, the settled history
 * newest-first, the totals, and the accounts for the submit form.
 */
export async function buildRequestsView(
  supabase: Supabase,
  actor: { userId: string; canEdit: boolean; canRequest: boolean },
): Promise<CmrRequestsView> {
  const [accounts, rows] = await Promise.all([loadAccounts(supabase), allRequestRows(supabase)])
  const [names, placed, invoices] = await Promise.all([
    displayNames(supabase, [...rows.map((r) => r.requested_by), ...rows.map((r) => r.placed_by)]),
    placedRowStates(supabase, rows),
    requestInvoicesFor(supabase, rows),
  ])

  const all: CmrRequest[] = rows.map((r) => toCmrRequest(r, accounts, names, placed, invoices.get(r.id) ?? []))
  const queued = all.filter((r) => r.status === 'queued').sort(compareQueued)
  const history = all.filter((r) => r.status !== 'queued').sort(compareHistory)

  return {
    queued,
    history,
    totals: computeRequestTotals(queued, history, actor.userId),
    accounts: sortedAccounts(accounts),
    today: pacificToday(),
    thisWeekStart: thisWeekStart(),
    canEdit: actor.canEdit,
    canRequest: actor.canRequest,
    userId: actor.userId,
  }
}

/** The audit snapshot of a request's fields, in API (camelCase) terms. */
export function snapshot(r: Partial<CmrRequestRow>, accounts?: Map<string, CmrRequestAccountRef>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if ('requested_by' in r) out.requestedBy = r.requested_by
  if ('account_id' in r) {
    out.accountId = r.account_id
    if (accounts) out.accountName = accounts.get(r.account_id as string)?.name ?? null
  }
  if ('vendor' in r) out.vendor = r.vendor
  if ('amount_cents' in r) out.amountCents = r.amount_cents == null ? null : Number(r.amount_cents)
  if ('due_date' in r) out.dueDate = r.due_date
  if ('notes' in r) out.notes = r.notes
  if ('status' in r) out.status = r.status
  if ('placed_kind' in r) out.placedKind = r.placed_kind
  if ('placed_ref_id' in r) out.placedRefId = r.placed_ref_id
  if ('placed_at' in r) out.placedAt = r.placed_at
  if ('placed_by' in r) out.placedBy = r.placed_by
  return out
}

export function pick<K extends keyof CmrRequestRow>(r: CmrRequestRow, keys: readonly K[]): Pick<CmrRequestRow, K> {
  return Object.fromEntries(keys.map((k) => [k, r[k]])) as Pick<CmrRequestRow, K>
}

export function auditor(ctx: CmrAccess, request: Request) {
  const ip = getClientIp(request)
  return (action: AuditAction, resourceId: string | undefined, resourceLabel: string, metadata: Record<string, unknown>) =>
    logAudit({
      userId: ctx.userId,
      userDisplayName: ctx.displayName,
      userRole: `cmr:${ctx.role}`,
      action,
      resourceType: 'cmr_vendor_requests',
      resourceId,
      resourceLabel,
      metadata,
      ipAddress: ip,
    })
}

// ── placement RPCs ──────────────────────────────────────────────────────────

/**
 * A placement (or an undo) the DB refused: the request had already left the queue or vanished,
 * it is not placed at all, or the row the placement created has since been paid or moved on.
 */
export type PlacementConflictReason = 'NOT_QUEUED' | 'NOT_FOUND' | 'NOT_PLACED' | 'ROW_PAID' | 'ROW_MOVED' | 'ROW_SETTLED'

export class PlacementConflict extends Error {
  constructor(readonly reason: PlacementConflictReason) {
    super(reason)
    this.name = 'PlacementConflict'
  }
}

const CONFLICTS: readonly PlacementConflictReason[] = [
  'NOT_QUEUED',
  'NOT_PLACED',
  'ROW_PAID',
  'ROW_MOVED',
  'ROW_SETTLED',
  'NOT_FOUND',
] as const

function placementError(message: string): never {
  for (const reason of CONFLICTS) if (message.includes(reason)) throw new PlacementConflict(reason)
  throw new Error(message)
}

/**
 * Create the row AND mark the request placed in ONE database call, so a request is never
 * marked placed without its row (and never placed twice — the function re-checks `queued`
 * with the row locked). Both return the new row's id.
 *
 * Called as a member of the client — supabase-js rpc() needs `this`. Cast because the Database
 * `Functions` type is deliberately empty (see database.types.ts).
 */
async function rpc(supabase: Supabase, fn: string, args: Record<string, unknown>): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = (await (supabase as any).rpc(fn, args)) as { data: unknown; error: { message: string } | null }
  if (error) placementError(error.message)
  if (typeof data !== 'string' || !UUID_RE.test(data)) throw new Error('Placing the request did not return the new row.')
  return data
}

export const placeRequestIntoPending = (
  supabase: Supabase,
  args: {
    requestId: string
    placedBy: string
    ledgerId: string
    accountId: string
    payee: string
    amountCents: number
    notes: string | null
    date: string
    sortOrder: number
  },
): Promise<string> =>
  rpc(supabase, 'cmr_place_request_pending', {
    p_request_id: args.requestId,
    p_placed_by: args.placedBy,
    p_ledger_id: args.ledgerId,
    p_account_id: args.accountId,
    p_payee: args.payee,
    p_amount_cents: args.amountCents,
    p_notes: args.notes,
    p_date: args.date,
    p_sort_order: args.sortOrder,
  })

/**
 * Undo a placement: delete the row it created and put the request back in the queue, in ONE
 * database call (cmr_unplace_request), which re-checks `placed` and the row's own state while
 * holding both locked. Returns the id it removed, or null when that row was already gone.
 */
export async function unplaceRequest(supabase: Supabase, requestId: string): Promise<string | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = (await (supabase as any).rpc('cmr_unplace_request', { p_request_id: requestId })) as {
    data: unknown
    error: { message: string } | null
  }
  if (error) placementError(error.message)
  return typeof data === 'string' && UUID_RE.test(data) ? data : null
}

export const placeRequestIntoPriority = (
  supabase: Supabase,
  args: {
    requestId: string
    placedBy: string
    weekStart: string
    description: string
    amountCents: number
    dueDate: string | null
    notes: string | null
    sortOrder: number
  },
): Promise<string> =>
  rpc(supabase, 'cmr_place_request_priority', {
    p_request_id: args.requestId,
    p_placed_by: args.placedBy,
    p_week_start: args.weekStart,
    p_description: args.description,
    p_amount_cents: args.amountCents,
    p_due_date: args.dueDate,
    p_notes: args.notes,
    p_sort_order: args.sortOrder,
  })

// ── AP Phase 2: the invoice snapshot ───────────────────────────────────────

/** PostgREST's default row cap; snapshot rows are read in pages. */
const PAGE = 1000
/** Request ids per `in.(…)` filter (~37 URL characters each). */
export const ID_BATCH = 150

export type CmrRequestInvoiceRow = {
  id: string
  request_id: string
  ap_line_id: string | null
  vendor_name: string
  invoice_num: string | null
  doc_type: string
  bill_date: string | null
  due_date: string | null
  open_balance_cents: number | string
}

export const CMR_REQUEST_INVOICE_COLS =
  'id, request_id, ap_line_id, vendor_name, invoice_num, doc_type, bill_date, due_date, open_balance_cents'

/** The snapshot rows of the given requests. */
export async function requestInvoiceRows(supabase: Supabase, requestIds: string[]): Promise<CmrRequestInvoiceRow[]> {
  const ids = [...new Set(requestIds)]
  if (!ids.length) return []
  const out: CmrRequestInvoiceRow[] = []
  // The ids travel in the URL (PostgREST `in.(…)`), so they go in batches — the request list
  // grows forever and one filter with every id would outgrow the gateway's URL limit.
  for (let i = 0; i < ids.length; i += ID_BATCH) {
    const batch = ids.slice(i, i + ID_BATCH)
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from('cmr_vendor_request_invoices')
        .select(CMR_REQUEST_INVOICE_COLS)
        .in('request_id', batch)
        .order('id', { ascending: true })
        .range(from, from + PAGE - 1)
      if (error) throw new Error(error.message)
      const rows = (data ?? []) as unknown as CmrRequestInvoiceRow[]
      out.push(...rows)
      if (rows.length < PAGE) break
    }
  }
  return out
}

/**
 * Each snapshot row as the screen shows it, with where it stands in its account's CURRENT A/P.
 * Line ids change on every re-import, so an invoice is matched by vendor + type + number + bill
 * date (invoiceMatchKey); a snapshot row whose source line still exists matches by id first.
 */
export function toRequestInvoices(rows: CmrRequestInvoiceRow[], current: CmrApLine[]): CmrRequestInvoice[] {
  const byId = new Map(current.map((l) => [l.id, l]))
  const byKey = new Map<string, CmrApLine>()
  for (const l of current) {
    const k = invoiceMatchKey(l)
    if (!byKey.has(k)) byKey.set(k, l)
  }
  return rows
    .map((r): CmrRequestInvoice => {
      const snap = {
        vendorName: r.vendor_name,
        docType: r.doc_type,
        invoiceNum: r.invoice_num,
        billDate: r.bill_date,
      }
      const hit = (r.ap_line_id ? byId.get(r.ap_line_id) : undefined) ?? byKey.get(invoiceMatchKey(snap))
      const cents = Number(r.open_balance_cents)
      return {
        id: r.id,
        apLineId: r.ap_line_id,
        ...snap,
        dueDate: r.due_date,
        openBalanceCents: cents,
        inCurrentAp: !!hit,
        currentApLineId: hit?.id ?? null,
        currentBalanceCents: hit && hit.openBalanceCents !== cents ? hit.openBalanceCents : null,
      }
    })
    .sort(compareRequestInvoices)
}

/** Every request's invoices, keyed by request id, checked against the current A/P of its account. */
export async function requestInvoicesFor(
  supabase: Supabase,
  requests: Pick<CmrRequestRow, 'id' | 'account_id'>[],
): Promise<Map<string, CmrRequestInvoice[]>> {
  const out = new Map<string, CmrRequestInvoice[]>()
  const rows = await requestInvoiceRows(supabase, requests.map((r) => r.id))
  if (!rows.length) return out
  const accountOf = new Map(requests.map((r) => [r.id, r.account_id]))
  const withInvoices = [...new Set(rows.map((r) => accountOf.get(r.request_id)).filter((a): a is string => !!a))]
  const current = await currentApLines(supabase, withInvoices)
  const byAccount = new Map<string, CmrApLine[]>()
  for (const l of current) {
    const list = byAccount.get(l.accountId) ?? []
    list.push(l)
    byAccount.set(l.accountId, list)
  }
  const byRequest = new Map<string, CmrRequestInvoiceRow[]>()
  for (const r of rows) {
    const list = byRequest.get(r.request_id) ?? []
    list.push(r)
    byRequest.set(r.request_id, list)
  }
  for (const [id, list] of byRequest) out.set(id, toRequestInvoices(list, byAccount.get(accountOf.get(id) ?? '') ?? []))
  return out
}

/** The compact form of a request's invoices for an audit entry. */
export const auditInvoices = (invoices: { invoiceNum: string | null; docType: string; openBalanceCents: number; billDate: string | null }[]) =>
  invoices.map((i) => ({ num: i.invoiceNum, type: i.docType, date: i.billDate, cents: i.openBalanceCents }))

// ── composing (cmr_compose_vendor_request) ─────────────────────────────────

/** Refusals of the compose function that aren't about the selection itself. */
export type ComposeConflictReason = CmrComposeRefusal | 'NOT_FOUND' | 'INACTIVE' | 'NOT_QUEUED' | 'FORBIDDEN'

export class ComposeRefused extends Error {
  constructor(readonly reason: ComposeConflictReason) {
    super(reason)
    this.name = 'ComposeRefused'
  }
}

const COMPOSE_REASONS: readonly ComposeConflictReason[] = [
  'NO_LINES',
  'STALE_LINES',
  'NOT_POSITIVE',
  'TOO_LARGE',
  'NOT_QUEUED',
  'FORBIDDEN',
  'INACTIVE',
  'NOT_FOUND',
] as const

/**
 * Submit (requestId null) or re-compose (a still-queued request) in ONE database call: the
 * function locks the account, re-reads its CURRENT A/P lines, keeps only the ticked payable
 * lines of that vendor (refusing if any isn't one), sums them into amount_cents and snapshots
 * them. Nothing the caller sends is used as an amount. Returns the request id.
 */
export async function composeRequest(
  supabase: Supabase,
  args: {
    requestId: string | null
    actor: string
    /** The Requester's own id (an edit must be of their own request); null for a Controller. */
    owner: string | null
    accountId: string
    vendorName: string
    vendor: string
    apLineIds: string[]
    dueDate: string | null
    notes: string | null
  },
): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = (await (supabase as any).rpc('cmr_compose_vendor_request', {
    p_request_id: args.requestId,
    p_actor: args.actor,
    p_owner: args.owner,
    p_account_id: args.accountId,
    p_vendor_name: args.vendorName,
    p_vendor: args.vendor,
    p_ap_line_ids: args.apLineIds,
    p_due_date: args.dueDate,
    p_notes: args.notes,
  })) as { data: unknown; error: { message: string } | null }
  if (error) {
    for (const r of COMPOSE_REASONS) if (new RegExp(`\\b${r}\\b`).test(error.message)) throw new ComposeRefused(r)
    throw new Error(error.message)
  }
  if (typeof data !== 'string' || !UUID_RE.test(data)) throw new Error('Submitting the request did not return its id.')
  return data
}
