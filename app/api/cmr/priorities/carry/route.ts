import { NextResponse } from 'next/server'
import { getCmrContext, guardCmrController } from '@/lib/api/cmr'
import { createServiceClient } from '@/lib/supabase/server'
import { formatWeekRangeShort, shiftWeek } from '@/lib/cmr/week'
import { parseWeek, toCmrPriority, type CmrPriorityRow } from '@/lib/cmr/priorities'
import {
  CarryConflict,
  UUID_RE,
  auditor,
  bad,
  carryPriority,
  nextSortOrder,
  priorityById,
  readJson,
  serverError,
  weekRows,
} from '@/lib/cmr/priorities-server'

/**
 * SN Cash Ledger — carry a weekly priority forward. CONTROLLER ONLY.
 *
 *   POST { id, targetWeek? }
 *     → copies the priority into the target week and marks the original 'carried'.
 *       targetWeek defaults to the NEXT WEEK after the one it sits in; any date is normalised
 *       to the Sunday that starts its week.
 *
 * What the week it leaves keeps: the original row, greyed, marked 'carried'. It is no longer
 * `open`, so it drops straight out of "still needed this week" (Phase 4's totals) without being
 * deleted — the week still shows what was on the list. What the target week gets: an OPEN copy
 * with the same description, amount, due date, notes and Top flag, carrying carried_from_id
 * back to the row it came from.
 *
 * Only an OPEN priority carries: a resolved or paid one is finished, and a carried one already
 * has its copy. The copy + the original's status change happen in ONE database call
 * (cmr_carry_priority), which re-checks `open` while holding the row locked.
 *
 * NOTE (BUG-019): a route.ts may export only HTTP handlers + route config.
 */

export const dynamic = 'force-dynamic'

const REFUSAL: Record<CarryConflict['reason'], { error: string; code: string; status: 404 | 409 }> = {
  NOT_FOUND: { error: 'That priority does not exist.', code: 'NOT_FOUND', status: 404 },
  NOT_OPEN: { error: 'Only an open priority can be carried to another week.', code: 'NOT_OPEN', status: 409 },
  SAME_WEEK: { error: 'That priority is already in that week.', code: 'SAME_WEEK', status: 409 },
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
    if (!UUID_RE.test(id)) return bad('Choose a priority.')

    const supabase = createServiceClient()
    const before = await priorityById(supabase, id)
    if (!before) return bad('That priority does not exist.', 'NOT_FOUND', 404)
    if (before.status !== 'open') {
      return bad(
        before.status === 'carried'
          ? 'That priority was already carried to another week.'
          : `That priority is ${before.status} — reopen it first if it needs to move.`,
        'NOT_OPEN',
        409,
      )
    }

    // Default: the week after the one it is in. Any date the Controller picks resolves to its
    // Sunday, so "next Wednesday" and "next week" mean the same week.
    const raw = body.targetWeek ?? body.weekStart ?? body.date
    const week = raw === undefined || raw === null ? { ok: true as const, value: shiftWeek(before.week_start, 1) } : parseWeek(raw)
    if (!week.ok) return bad(week.error)
    if (week.value === before.week_start) return bad('That priority is already in that week.', 'SAME_WEEK', 409)

    const rowsInWeek = await weekRows(supabase, week.value)
    let newId: string
    try {
      newId = await carryPriority(supabase, {
        priorityId: id,
        actorId: ctx.userId,
        weekStart: week.value,
        sortOrder: nextSortOrder(rowsInWeek),
      })
    } catch (e) {
      if (e instanceof CarryConflict) {
        const r = REFUSAL[e.reason]
        return bad(r.error, r.code, r.status)
      }
      throw e
    }

    const copy = (await weekRows(supabase, week.value)).find((r) => r.id === newId) as CmrPriorityRow | undefined

    await auditor(ctx, request)('cmr.priority.carry', id, before.description, {
      from: { weekStart: before.week_start, label: formatWeekRangeShort(before.week_start) },
      to: { weekStart: week.value, label: formatWeekRangeShort(week.value) },
      newPriorityId: newId,
      amountCents: Number(before.amount_cents),
      isTopPriority: before.is_top_priority,
      before: { status: 'open' },
      after: { status: 'carried' },
    })

    return NextResponse.json({
      success: true,
      data: {
        carriedId: id,
        newPriorityId: newId,
        priority: copy ? toCmrPriority(copy) : null,
        from: { weekStart: before.week_start },
        to: { weekStart: week.value },
        where: formatWeekRangeShort(week.value),
      },
    })
  } catch (err) {
    return serverError('/carry', err)
  }
}
