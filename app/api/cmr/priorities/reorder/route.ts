import { NextResponse } from 'next/server'
import { getCmrContext, guardCmrController } from '@/lib/api/cmr'
import { createServiceClient } from '@/lib/supabase/server'
import { formatWeekRangeShort } from '@/lib/cmr/week'
import { parseWeek, reorderCmrPriorities } from '@/lib/cmr/priorities'
import { auditor, bad, parseIdList, readJson, sameIdSet, serverError, weekRows } from '@/lib/cmr/priorities-server'

/**
 * SN Cash Ledger — reorder the priorities of ONE week. CONTROLLER ONLY.
 *
 *   POST { weekStart, ids: string[] }  → ids is EVERY priority id in that week (any status), in
 *                                        the new order. weekStart may be any day of the week.
 *
 * The list must be exactly the week's current set — if a priority was added or deleted in
 * another tab the request is refused with 409 STALE rather than guessing. The new order is
 * written in one statement (cmr_reorder_weekly_priorities, scoped to the week) and audited with
 * before → after.
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
    const week = parseWeek(body.weekStart ?? body.date)
    if (!week.ok) return bad(week.error)
    const ids = parseIdList(body.ids)
    if (!ids) return bad('Send the full list of priority ids for this week, in their new order.')
    if (new Set(ids).size !== ids.length) return bad('The order lists a priority twice.')

    const supabase = createServiceClient()
    const current = await weekRows(supabase, week.value)
    const beforeIds = current.map((r) => r.id)
    if (!sameIdSet(beforeIds, ids)) {
      return bad('This week’s priorities changed since you loaded them. Reload and try again.', 'STALE', 409)
    }
    const alreadyNormal = current.every((r, i) => r.sort_order === i)
    if (alreadyNormal && beforeIds.every((id, i) => id === ids[i])) {
      return NextResponse.json({ success: true, data: { changed: false } })
    }

    await reorderCmrPriorities(supabase, week.value, ids)

    const nameById = new Map(current.map((r) => [r.id, r.description]))
    await auditor(ctx, request)('cmr.priority.reorder', undefined, `Week of ${formatWeekRangeShort(week.value)}`, {
      weekStart: week.value,
      before: current.map((r) => r.description),
      after: ids.map((id) => nameById.get(id) ?? id),
      ids,
    })

    return NextResponse.json({ success: true, data: { changed: true } })
  } catch (err) {
    return serverError('/reorder', err)
  }
}
