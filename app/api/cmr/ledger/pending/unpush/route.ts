import { NextResponse } from 'next/server'
import { getCmrContext, guardCmrController } from '@/lib/api/cmr'
import { createServiceClient } from '@/lib/supabase/server'
import { ledgerLabel, toCmrPendingItem, type CmrPendingRow } from '@/lib/cmr/ledger'
import {
  UnpushConflict,
  UUID_RE,
  auditor,
  bad,
  ledgerById,
  loadAccounts,
  pendingItemById,
  readJson,
  serverError,
  touchLedger,
  unpushPendingItem,
} from '@/lib/cmr/ledger-server'

/**
 * SN Cash Ledger — take a push back. CONTROLLER ONLY.
 *
 *   POST { id }   → `id` is the PUSHED ORIGINAL (the greyed history row on the day it left).
 *                   Deletes the forward copy and puts the original back to 'pending' on its own
 *                   day, so its amount counts there again and the target day loses it.
 *
 * This is what stops a push from ever losing money. Pushing takes an item out of its own day's
 * roll-up; without a way back, deleting the forward copy left the original stranded at 'pushed'
 * and its amount on no ledger at all. It also unsticks a request-sourced item: un-push first,
 * the original returns to 'pending', and the placement can then be undone normally.
 *
 * Refused, with the same codes the undo-placement route uses, once the copy has been PAID
 * (ROW_PAID) or pushed on again (ROW_MOVED) — taking it back then would erase real work. The
 * check happens inside cmr_unpush_pending_item with both rows locked, and the same verdict
 * rides on every pushed item in GET /api/cmr/ledger (canUnpush / unpushBlockedReason) so the
 * screen can disable the button and say why.
 *
 * NOTE (BUG-019): a route.ts may export only HTTP handlers + route config.
 */

export const dynamic = 'force-dynamic'

const REFUSAL: Record<UnpushConflict['reason'], { error: string; code: string; status: 404 | 409 }> = {
  NOT_FOUND: { error: 'That pending item does not exist.', code: 'NOT_FOUND', status: 404 },
  NOT_PUSHED: { error: 'That item wasn’t pushed anywhere, so there is nothing to take back.', code: 'NOT_PUSHED', status: 409 },
  ROW_PAID: {
    error: 'The item it became was already paid — taking the push back would erase the payment. Mark it unpaid first.',
    code: 'ROW_PAID',
    status: 409,
  },
  ROW_MOVED: {
    error: 'The item it became was pushed on to another day. Undo that push first.',
    code: 'ROW_MOVED',
    status: 409,
  },
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
    if (item.status !== 'pushed') {
      const r = REFUSAL.NOT_PUSHED
      return bad(r.error, r.code, r.status)
    }

    // The ledger the copy sits on, read BEFORE the delete so it can be touched after.
    const copy = await (async (): Promise<{ id: string; daily_ledger_id: string } | null> => {
      const { data, error } = await supabase.from('cmr_pending_items').select('id, daily_ledger_id').eq('pushed_from_id', id)
      if (error) throw new Error(error.message)
      return ((data ?? []) as unknown as { id: string; daily_ledger_id: string }[])[0] ?? null
    })()

    let removed: string | null
    try {
      removed = await unpushPendingItem(supabase, id)
    } catch (e) {
      if (e instanceof UnpushConflict) {
        const r = REFUSAL[e.reason]
        return bad(r.error, r.code, r.status)
      }
      throw e
    }

    const home = await ledgerById(supabase, item.daily_ledger_id)
    await Promise.all([
      touchLedger(supabase, item.daily_ledger_id),
      copy && copy.daily_ledger_id !== item.daily_ledger_id ? touchLedger(supabase, copy.daily_ledger_id) : Promise.resolve(),
    ])

    const back = await pendingItemById(supabase, id)
    await auditor(ctx, request)('cmr.pending.unpush', 'cmr_pending_items', id, item.payee, {
      ledgerId: item.daily_ledger_id,
      ledgerDate: home?.ledger_date ?? null,
      period: home?.period ?? null,
      label: home ? ledgerLabel(home.ledger_date, home.period) : null,
      accountId: item.account_id,
      accountName: accounts.get(item.account_id)?.name ?? null,
      amountCents: Number(item.amount_cents),
      removedCopyId: removed,
      copyWasAlreadyGone: removed === null,
      before: { status: 'pushed' },
      after: { status: 'pending' },
    })

    return NextResponse.json({
      success: true,
      data: {
        item: back ? toCmrPendingItem(back as CmrPendingRow, accounts) : null,
        removedCopyId: removed,
      },
    })
  } catch (err) {
    return serverError('/pending/unpush', err)
  }
}
