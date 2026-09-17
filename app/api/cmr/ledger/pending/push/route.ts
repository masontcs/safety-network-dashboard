import { NextResponse } from 'next/server'
import { getCmrContext, guardCmrController } from '@/lib/api/cmr'
import { createServiceClient } from '@/lib/supabase/server'
import {
  CMR_LEDGER_PERIOD_LABEL,
  ledgerLabel,
  parseLedgerDate,
  parsePeriod,
  shiftLedgerDate,
  toCmrPendingItem,
  type CmrLedgerPeriod,
  type CmrPendingRow,
} from '@/lib/cmr/ledger'
import {
  PushConflict,
  UUID_RE,
  auditor,
  bad,
  ensureLedger,
  ledgerById,
  loadAccounts,
  nextSortOrder,
  pendingItemById,
  pendingRows,
  pushPendingItem,
  readJson,
  serverError,
  touchLedger,
} from '@/lib/cmr/ledger-server'

/**
 * SN Cash Ledger — push a pending item to another day. CONTROLLER ONLY.
 *
 *   POST { id, targetDate?, targetPeriod? }
 *     → copies the item onto the target ledger and marks the original 'pushed'.
 *       targetDate defaults to the NEXT CALENDAR DAY after the day the item sits on;
 *       targetPeriod defaults to the SAME period. Both are the Controller's to change.
 *
 * What the day it leaves keeps: the original row, greyed, marked 'pushed'. Because the pending
 * roll-up already ignores 'pushed' items (Phase 3), it stops counting against that day's
 * balance the moment it is pushed — no other arithmetic changes. What the target day gets: a
 * plain pending item with the same account, payee, amount and notes, its original_date
 * preserved, and pushed_from_id pointing back at the row it came from.
 *
 * The target ledger is created on demand (the same ensureLedger every other write uses), and
 * the copy + the original's status change happen in ONE database call (cmr_push_pending_item),
 * which re-checks the item is still pending while holding its row locked.
 *
 * NOTE (BUG-019): a route.ts may export only HTTP handlers + route config.
 */

export const dynamic = 'force-dynamic'

const REFUSAL: Record<PushConflict['reason'], { error: string; code: string; status: 404 | 409 }> = {
  NOT_FOUND: { error: 'That pending item does not exist.', code: 'NOT_FOUND', status: 404 },
  NOT_PENDING: { error: 'That item is no longer pending, so it can’t be pushed.', code: 'NOT_PENDING', status: 409 },
  SAME_LEDGER: { error: 'That item is already on that day and snapshot.', code: 'SAME_LEDGER', status: 409 },
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
    if (!UUID_RE.test(id)) return bad('Choose a pending item.')

    const supabase = createServiceClient()
    const [accounts, item] = await Promise.all([loadAccounts(supabase), pendingItemById(supabase, id)])
    if (!item) return bad('That pending item does not exist.', 'NOT_FOUND', 404)
    if (item.status !== 'pending') {
      return bad(
        item.status === 'paid'
          ? 'That item is already paid. Mark it unpaid first if it needs to move.'
          : 'That item was already pushed to another day.',
        'NOT_PENDING',
        409,
      )
    }

    const from = await ledgerById(supabase, item.daily_ledger_id)
    if (!from) return bad('That item’s ledger no longer exists.', 'NOT_FOUND', 404)

    // Default: the next calendar day after the day it sits on, same snapshot. Either may be
    // overridden; parsePeriod / parseLedgerDate reject anything that isn't a real day or AM/PM.
    const date =
      body.targetDate === undefined || body.targetDate === null
        ? { ok: true as const, value: shiftLedgerDate(from.ledger_date, 1) }
        : parseLedgerDate(body.targetDate)
    if (!date.ok) return bad(date.error)
    const period =
      body.targetPeriod === undefined || body.targetPeriod === null
        ? { ok: true as const, value: from.period as CmrLedgerPeriod }
        : parsePeriod(body.targetPeriod)
    if (!period.ok) return bad(period.error)
    if (date.value === from.ledger_date && period.value === from.period) {
      return bad('That item is already on that day and snapshot.', 'SAME_LEDGER', 409)
    }

    // An inactive account may still be pushed: the item already exists and is only moving day.
    const audit = auditor(ctx, request)
    const target = await ensureLedger(supabase, date.value, period.value, ctx.userId, audit)
    const group = await pendingRows(supabase, target.id, item.account_id)

    let newId: string
    try {
      newId = await pushPendingItem(supabase, {
        itemId: id,
        actorId: ctx.userId,
        ledgerId: target.id,
        date: date.value,
        sortOrder: nextSortOrder(group),
      })
    } catch (e) {
      if (e instanceof PushConflict) {
        const r = REFUSAL[e.reason]
        return bad(r.error, r.code, r.status)
      }
      throw e
    }

    await Promise.all([touchLedger(supabase, from.id), touchLedger(supabase, target.id)])
    const copy = (await pendingRows(supabase, target.id, item.account_id)).find((r) => r.id === newId) as CmrPendingRow | undefined

    const fromLabel = ledgerLabel(from.ledger_date, from.period)
    const toLabel = ledgerLabel(date.value, period.value)
    await audit('cmr.pending.push', 'cmr_pending_items', id, item.payee, {
      accountId: item.account_id,
      accountName: accounts.get(item.account_id)?.name ?? null,
      amountCents: Number(item.amount_cents),
      from: { ledgerId: from.id, ledgerDate: from.ledger_date, period: from.period, label: fromLabel },
      to: { ledgerId: target.id, ledgerDate: date.value, period: period.value, label: toLabel },
      newItemId: newId,
      before: { status: 'pending' },
      after: { status: 'pushed' },
    })

    return NextResponse.json({
      success: true,
      data: {
        pushedId: id,
        newItemId: newId,
        item: copy ? toCmrPendingItem(copy, accounts) : null,
        from: { date: from.ledger_date, period: from.period },
        to: { date: date.value, period: period.value },
        where: `${date.value} ${CMR_LEDGER_PERIOD_LABEL[period.value]}`,
      },
    })
  } catch (err) {
    return serverError('/pending/push', err)
  }
}
