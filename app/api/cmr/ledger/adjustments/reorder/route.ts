import { NextResponse } from 'next/server'
import { getCmrContext, guardCmrController } from '@/lib/api/cmr'
import { createServiceClient } from '@/lib/supabase/server'
import { compareOrdered, ledgerLabel, reorderCmrAdjustments, toCmrAdjustment } from '@/lib/cmr/ledger'
import {
  adjustmentRows,
  auditor,
  bad,
  findLedger,
  parseIdList,
  parseLedgerKey,
  readJson,
  sameIdSet,
  serverError,
  touchLedger,
} from '@/lib/cmr/ledger-server'

/**
 * SN Cash Ledger — reorder the adjustment lines of one daily ledger. CONTROLLER ONLY.
 *
 *   POST { date, period, ids: string[] }  → ids is EVERY adjustment id on that ledger, in the
 *                                           new order.
 *
 * The list must be exactly the ledger's current set — if a line was added or removed in
 * another tab the request is refused with 409 STALE rather than guessing. The order is written
 * in one statement (cmr_reorder_ledger_adjustments) and audited with before → after.
 *
 * NOTE (BUG-019): a route.ts may export only HTTP handlers + route config.
 */

export const dynamic = 'force-dynamic'

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const ctx = await getCmrContext()
    if (!ctx.ok) return ctx.response
    const guard = guardCmrController(ctx)
    if (guard) return guard

    const body = await readJson(request)
    if (!body) return bad('Invalid request body.')
    const key = parseLedgerKey(body)
    if (!key.ok) return bad(key.error)
    const ids = parseIdList(body.ids)
    if (!ids) return bad('Send the full list of line ids, in their new order.')
    const { date, period } = key.value

    const supabase = createServiceClient()
    const ledger = await findLedger(supabase, date, period)
    if (!ledger) return bad('There are no lines on that ledger yet. Reload and try again.', 'STALE', 409)
    const current = (await adjustmentRows(supabase, ledger.id)).map(toCmrAdjustment).sort(compareOrdered)
    const beforeIds = current.map((a) => a.id)
    if (!sameIdSet(beforeIds, ids)) {
      return bad('The adjustment lines changed since you loaded them. Reload and try again.', 'STALE', 409)
    }
    if (current.every((a, i) => a.sortOrder === i && a.id === ids[i])) {
      return NextResponse.json({ success: true, data: { changed: false } })
    }

    await reorderCmrAdjustments(supabase, ledger.id, ids)
    await touchLedger(supabase, ledger.id)

    const nameById = new Map(current.map((a) => [a.id, a.description]))
    await auditor(ctx, request)('cmr.ledger.adjustment.reorder', 'cmr_daily_ledger', ledger.id, ledgerLabel(date, period), {
      ledgerDate: date,
      period,
      before: current.map((a) => a.description),
      after: ids.map((id) => nameById.get(id) ?? id),
      ids,
    })

    return NextResponse.json({ success: true, data: { changed: true } })
  } catch (err) {
    return serverError('/adjustments/reorder', err)
  }
}
