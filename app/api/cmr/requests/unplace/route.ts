import { NextResponse } from 'next/server'
import { getCmrContext, guardCmrController } from '@/lib/api/cmr'
import { createServiceClient } from '@/lib/supabase/server'
import { loadAccounts, touchLedger } from '@/lib/cmr/ledger-server'
import { CMR_REQUEST_PLACED_KIND_LABEL, toCmrRequest } from '@/lib/cmr/requests'
import {
  PlacementConflict,
  UUID_RE,
  auditor,
  bad,
  placedRowStates,
  readJson,
  requestById,
  serverError,
  snapshot,
  unplaceRequest,
  type Supabase,
} from '@/lib/cmr/requests-server'

/**
 * SN Cash Ledger — undo a placement. CONTROLLER ONLY.
 *
 *   POST { id }  → deletes the row the placement created (the cmr_pending_items or
 *                  cmr_weekly_priorities row named by placed_kind / placed_ref_id) and puts the
 *                  request back in the queue with its placement columns cleared.
 *
 * This closes the Phase 5 gap: a request placed on the wrong day, in the wrong week or by
 * mistake had nowhere to go — the line could be deleted but the request stayed "placed"
 * forever. Undoing is refused once that row has been PAID, or PUSHED / CARRIED onward: the
 * decision has moved on, and deleting it would take real work with it. The reason comes back to
 * the screen, which also shows it on the row (canUnplace / unplaceBlockedReason).
 *
 * The delete and the request's status change happen in ONE database call
 * (cmr_unplace_request), which re-checks both `placed` and the row's own state while holding
 * them locked. If the placed row is already gone, the request still returns to the queue.
 *
 * NOTE (BUG-019): a route.ts may export only HTTP handlers + route config.
 */

export const dynamic = 'force-dynamic'

const REFUSAL: Record<PlacementConflict['reason'], { error: string; code: string; status: 404 | 409 }> = {
  NOT_FOUND: { error: 'That request does not exist.', code: 'NOT_FOUND', status: 404 },
  // Shared with the place route's reason union; cmr_unplace_request never raises this one.
  NOT_QUEUED: { error: 'Only a placed request can be put back in the queue.', code: 'NOT_PLACED', status: 409 },
  NOT_PLACED: { error: 'Only a placed request can be put back in the queue.', code: 'NOT_PLACED', status: 409 },
  ROW_PAID: {
    error: 'What this request became was already paid — undoing would erase the payment. Mark it unpaid first.',
    code: 'ROW_PAID',
    status: 409,
  },
  ROW_MOVED: {
    error: 'What this request became has been moved to another day or week. Undo that move first.',
    code: 'ROW_MOVED',
    status: 409,
  },
  ROW_SETTLED: {
    error: 'What this request became was already resolved. Reopen it first.',
    code: 'ROW_SETTLED',
    status: 409,
  },
}

/** Keep the ledger's "updated …" honest when the row we removed lived on one. */
async function touchLedgerOf(supabase: Supabase, ledgerId: string | null): Promise<void> {
  if (ledgerId) await touchLedger(supabase, ledgerId)
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const ctx = await getCmrContext()
    if (!ctx.ok) return ctx.response
    const guard = guardCmrController(ctx)
    if (guard) return guard

    const body = await readJson(request)
    if (!body) return bad('Invalid request body.')
    const id = typeof body.id === 'string' ? body.id.trim() : ''
    if (!UUID_RE.test(id)) return bad('Choose a request.')

    const supabase = createServiceClient()
    const [accounts, before] = await Promise.all([loadAccounts(supabase), requestById(supabase, id)])
    if (!before) return bad('That request does not exist.', 'NOT_FOUND', 404)
    if (before.status !== 'placed') {
      const r = REFUSAL.NOT_PLACED
      return bad(r.error, r.code, r.status)
    }

    // The ledger the pending row sits on, read BEFORE the delete so it can be touched after.
    let ledgerId: string | null = null
    if (before.placed_kind === 'pending' && before.placed_ref_id) {
      const { data, error } = await supabase
        .from('cmr_pending_items')
        .select('daily_ledger_id')
        .eq('id', before.placed_ref_id)
        .maybeSingle()
      if (error) throw new Error(error.message)
      ledgerId = (data as { daily_ledger_id: string } | null)?.daily_ledger_id ?? null
    }

    let removed: string | null
    try {
      removed = await unplaceRequest(supabase, id)
    } catch (e) {
      if (e instanceof PlacementConflict) {
        const r = REFUSAL[e.reason]
        return bad(r.error, r.code, r.status)
      }
      throw e
    }
    await touchLedgerOf(supabase, ledgerId)

    const after = await requestById(supabase, id)
    await auditor(ctx, request)('cmr.request.unplace', id, before.vendor, {
      requestedBy: before.requested_by,
      placedKind: before.placed_kind,
      placedKindLabel: before.placed_kind ? CMR_REQUEST_PLACED_KIND_LABEL[before.placed_kind] : null,
      removedRowId: removed,
      rowWasAlreadyGone: removed === null,
      accountId: before.account_id,
      accountName: accounts.get(before.account_id)?.name ?? null,
      amountCents: Number(before.amount_cents),
      before: snapshot({
        status: before.status,
        placed_kind: before.placed_kind,
        placed_ref_id: before.placed_ref_id,
        placed_at: before.placed_at,
        placed_by: before.placed_by,
      }),
      after: { status: 'queued', placedKind: null, placedRefId: null, placedAt: null, placedBy: null },
    })

    const placed = after ? await placedRowStates(supabase, [after]) : new Map()
    return NextResponse.json({
      success: true,
      data: {
        request: after ? toCmrRequest(after, accounts, new Map(), placed) : null,
        removedRowId: removed,
      },
    })
  } catch (err) {
    return serverError('/unplace', err)
  }
}
