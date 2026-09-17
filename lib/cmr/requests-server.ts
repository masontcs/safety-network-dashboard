import { NextResponse } from 'next/server'
import type { createServiceClient } from '@/lib/supabase/server'
import { logAudit, getClientIp, type AuditAction } from '@/lib/audit/log'
import type { CmrAccess } from '@/lib/api/cmr'
import { pacificToday } from '@/lib/utils/date'
import { thisWeekStart } from '@/lib/cmr/week'
import { loadAccounts } from '@/lib/cmr/ledger-server'
import { displayNames } from '@/lib/cmr/priorities-server'
import {
  CMR_REQUEST_COLS,
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
  const [names, placed] = await Promise.all([
    displayNames(supabase, [...rows.map((r) => r.requested_by), ...rows.map((r) => r.placed_by)]),
    placedRowStates(supabase, rows),
  ])

  const all: CmrRequest[] = rows.map((r) => toCmrRequest(r, accounts, names, placed))
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
