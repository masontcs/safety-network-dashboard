import { NextResponse } from 'next/server'
import { getCmrContext, guardCmrController } from '@/lib/api/cmr'
import { createServiceClient } from '@/lib/supabase/server'
import { compareOrdered, ledgerLabel, reorderCmrPendingItems, toCmrPendingItem } from '@/lib/cmr/ledger'
import {
  UUID_RE,
  auditor,
  bad,
  findLedger,
  loadAccounts,
  parseIdList,
  parseLedgerKey,
  pendingRows,
  readJson,
  sameIdSet,
  serverError,
  touchLedger,
} from '@/lib/cmr/ledger-server'

/**
 * SN Cash Ledger — reorder the pending items of ONE account group on one daily ledger.
 * CONTROLLER ONLY.
 *
 *   POST { date, period, accountId, ids: string[] }  → ids is EVERY pending item id for that
 *                                                      account on that ledger, in the new order.
 *
 * The list must be exactly the group's current set (409 STALE otherwise). Written in one
 * statement (cmr_reorder_pending_items) and audited with before → after. Moving an item to
 * another account is a PATCH on /api/cmr/ledger/pending, not a reorder.
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
    const accountId = typeof body.accountId === 'string' ? body.accountId.trim() : ''
    if (!UUID_RE.test(accountId)) return bad('Choose an account.')
    const ids = parseIdList(body.ids)
    if (!ids) return bad('Send the full list of pending item ids for this account, in their new order.')
    const { date, period } = key.value

    const supabase = createServiceClient()
    const ledger = await findLedger(supabase, date, period)
    if (!ledger) return bad('There are no pending items on that ledger yet. Reload and try again.', 'STALE', 409)
    const [accounts, rows] = await Promise.all([loadAccounts(supabase), pendingRows(supabase, ledger.id, accountId)])
    const current = rows.map((r) => toCmrPendingItem(r, accounts)).sort(compareOrdered)
    if (!sameIdSet(current.map((i) => i.id), ids)) {
      return bad('The pending items for this account changed since you loaded them. Reload and try again.', 'STALE', 409)
    }
    if (current.every((it, i) => it.sortOrder === i && it.id === ids[i])) {
      return NextResponse.json({ success: true, data: { changed: false } })
    }

    await reorderCmrPendingItems(supabase, ledger.id, ids)
    await touchLedger(supabase, ledger.id)

    const nameById = new Map(current.map((i) => [i.id, i.payee]))
    const accountName = accounts.get(accountId)?.name ?? accountId
    await auditor(ctx, request)('cmr.ledger.pending.reorder', 'cmr_daily_ledger', ledger.id, `${ledgerLabel(date, period)} · ${accountName}`, {
      ledgerDate: date,
      period,
      accountId,
      accountName,
      before: current.map((i) => i.payee),
      after: ids.map((id) => nameById.get(id) ?? id),
      ids,
    })

    return NextResponse.json({ success: true, data: { changed: true } })
  } catch (err) {
    return serverError('/pending/reorder', err)
  }
}
