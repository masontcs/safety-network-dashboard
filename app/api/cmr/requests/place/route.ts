import { NextResponse } from 'next/server'
import { getCmrContext, guardCmrController } from '@/lib/api/cmr'
import { createServiceClient } from '@/lib/supabase/server'
import { ledgerLabel, parsePeriod, parseLedgerDate, toCmrPendingItem } from '@/lib/cmr/ledger'
import {
  auditor as ledgerAuditor,
  ensureLedger,
  loadAccounts,
  nextSortOrder,
  pendingRows,
  touchLedger,
} from '@/lib/cmr/ledger-server'
import { parseWeek, toCmrPriority, type CmrPriorityRow } from '@/lib/cmr/priorities'
import { weekRows, nextSortOrder as nextPrioritySortOrder } from '@/lib/cmr/priorities-server'
import { formatWeekRangeShort } from '@/lib/cmr/week'
import { CMR_REQUEST_COLS, parsePlaceTarget, toCmrRequest, type CmrRequestRow } from '@/lib/cmr/requests'
import {
  PlacementConflict,
  UUID_RE,
  auditor,
  bad,
  placeRequestIntoPending,
  placeRequestIntoPriority,
  readJson,
  requestById,
  serverError,
  snapshot,
} from '@/lib/cmr/requests-server'

/**
 * SN Cash Ledger — place a queued vendor request. CONTROLLER ONLY.
 *
 *   POST { id, target: 'pending', date: 'YYYY-MM-DD', period: 'am' | 'pm' }
 *          → adds it to that day's pending breakdown, under the request's own account, as a
 *            source = 'request' item pointing back at the request.
 *   POST { id, target: 'priority', weekStart | date: 'YYYY-MM-DD' }
 *          → adds it to that week's priorities (any day resolves to its Sunday) as an open
 *            priority described by the vendor.
 *
 * The Controller chooses the day/period or week HERE — the request's due date only pre-fills
 * the dialog. The new row and the request's status change happen in ONE database call
 * (cmr_place_request_pending / cmr_place_request_priority), which re-checks that the request
 * is still queued while holding its row locked: a request is never marked placed without its
 * row, and never placed twice.
 *
 * NOTE (BUG-019): a route.ts may export only HTTP handlers + route config.
 */

export const dynamic = 'force-dynamic'

const ALL_KEYS = ['status', 'placed_kind', 'placed_ref_id', 'placed_at', 'placed_by'] as const

const conflict = (e: PlacementConflict): NextResponse =>
  e.reason === 'NOT_FOUND'
    ? bad('That request does not exist.', 'NOT_FOUND', 404)
    : bad('That request has already been placed or declined.', 'NOT_QUEUED', 409)

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
    const target = parsePlaceTarget(body.target)
    if (!target.ok) return bad(target.error)

    const supabase = createServiceClient()
    const [accounts, req] = await Promise.all([loadAccounts(supabase), requestById(supabase, id)])
    if (!req) return bad('That request does not exist.', 'NOT_FOUND', 404)
    if (req.status !== 'queued') return bad('That request has already been placed or declined.', 'NOT_QUEUED', 409)

    const audit = auditor(ctx, request)

    // ── into the daily pending list ──────────────────────────────────────────
    if (target.value === 'pending') {
      const date = parseLedgerDate(body.date)
      if (!date.ok) return bad(date.error)
      const period = parsePeriod(body.period)
      if (!period.ok) return bad(period.error)

      // The request's own account — a placed item belongs to the account it was asked for.
      const account = accounts.get(req.account_id)
      if (!account) return bad('That request’s account no longer exists.', 'NOT_FOUND', 404)
      if (!account.active) {
        return bad(
          `${account.name} is inactive. Reactivate it, or change the request’s account, before placing this.`,
          'ACCOUNT_INACTIVE',
          409,
        )
      }

      const ledger = await ensureLedger(supabase, date.value, period.value, ctx.userId, ledgerAuditor(ctx, request))
      const group = await pendingRows(supabase, ledger.id, req.account_id)

      let newId: string
      try {
        newId = await placeRequestIntoPending(supabase, {
          requestId: id,
          placedBy: ctx.userId,
          ledgerId: ledger.id,
          accountId: req.account_id,
          payee: req.vendor,
          amountCents: Number(req.amount_cents),
          notes: req.notes,
          date: date.value,
          sortOrder: nextSortOrder(group),
        })
      } catch (e) {
        if (e instanceof PlacementConflict) return conflict(e)
        throw e
      }
      await touchLedger(supabase, ledger.id)

      const after = await requestById(supabase, id)
      const item = (await pendingRows(supabase, ledger.id, req.account_id)).find((r) => r.id === newId)

      await audit('cmr.request.place', id, req.vendor, {
        target: 'pending',
        ledgerId: ledger.id,
        ledgerDate: date.value,
        period: period.value,
        label: ledgerLabel(date.value, period.value),
        placedRefId: newId,
        accountId: req.account_id,
        accountName: account.name,
        amountCents: Number(req.amount_cents),
        before: snapshot({ status: req.status, placed_kind: null, placed_ref_id: null, placed_at: null, placed_by: null }),
        after: after ? snapshot(pick(after), accounts) : { status: 'placed', placedKind: 'pending', placedRefId: newId },
      })

      return NextResponse.json({
        success: true,
        data: {
          request: after ? toCmrRequest(after, accounts) : null,
          placedKind: 'pending' as const,
          placedRefId: newId,
          where: ledgerLabel(date.value, period.value),
          item: item ? toCmrPendingItem(item, accounts) : null,
        },
      })
    }

    // ── into a weekly priority ───────────────────────────────────────────────
    const week = parseWeek(body.weekStart ?? body.date)
    if (!week.ok) return bad(week.error)

    const rowsInWeek = await weekRows(supabase, week.value)
    let newId: string
    try {
      newId = await placeRequestIntoPriority(supabase, {
        requestId: id,
        placedBy: ctx.userId,
        weekStart: week.value,
        description: req.vendor,
        amountCents: Number(req.amount_cents),
        dueDate: req.due_date,
        notes: req.notes,
        sortOrder: nextPrioritySortOrder(rowsInWeek),
      })
    } catch (e) {
      if (e instanceof PlacementConflict) return conflict(e)
      throw e
    }

    const after = await requestById(supabase, id)
    const priority = (await weekRows(supabase, week.value)).find((r) => r.id === newId) as CmrPriorityRow | undefined

    await audit('cmr.request.place', id, req.vendor, {
      target: 'priority',
      weekStart: week.value,
      label: formatWeekRangeShort(week.value),
      placedRefId: newId,
      accountId: req.account_id,
      accountName: accounts.get(req.account_id)?.name ?? null,
      amountCents: Number(req.amount_cents),
      before: snapshot({ status: req.status, placed_kind: null, placed_ref_id: null, placed_at: null, placed_by: null }),
      after: after ? snapshot(pick(after), accounts) : { status: 'placed', placedKind: 'priority', placedRefId: newId },
    })

    return NextResponse.json({
      success: true,
      data: {
        request: after ? toCmrRequest(after, accounts) : null,
        placedKind: 'priority' as const,
        placedRefId: newId,
        where: formatWeekRangeShort(week.value),
        priority: priority ? toCmrPriority(priority) : null,
      },
    })
  } catch (err) {
    return serverError('/place', err)
  }
}

/** The placement half of a request row, for the audit `after` snapshot. */
function pick(r: CmrRequestRow): Partial<CmrRequestRow> {
  return Object.fromEntries(ALL_KEYS.map((k) => [k, r[k]])) as Partial<CmrRequestRow>
}
