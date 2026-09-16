import { NextResponse } from 'next/server'
import { getCmrContext, guardCmr, guardCmrController } from '@/lib/api/cmr'
import { createServiceClient } from '@/lib/supabase/server'
import { pacificToday } from '@/lib/utils/date'
import { ledgerLabel, parseLedgerCents, toCmrLedger, virtualLedger } from '@/lib/cmr/ledger'
import {
  auditor,
  bad,
  buildLedgerView,
  ensureLedger,
  findLedger,
  isInputViolation,
  parseLedgerKey,
  readJson,
  serverError,
} from '@/lib/cmr/ledger-server'

/**
 * SN Cash Ledger — the daily ledger for one (date, period).
 *
 *   GET ?date=YYYY-MM-DD&period=am|pm   → the ledger (or a virtual empty one), its adjustment
 *        (defaults: Pacific today, am)     lines, the pending breakdown grouped by account, the
 *                                         derived totals, and `canEdit`. ANY CMR role.
 *   PUT { date, period, beginningCashCents } → set beginning cash, creating the ledger row on
 *                                         demand (upsert on (ledger_date, period)). CONTROLLER.
 *
 * AM and PM are independent snapshots. Current balance = beginning + Σ adjustments − Σ pending.
 * Adjustment lines live at /api/cmr/ledger/adjustments, pending items at /api/cmr/ledger/pending.
 *
 * NOTE (BUG-019): a route.ts may export only HTTP handlers + route config — helpers live in
 * lib/cmr/ledger-server.
 */

// Never statically render or cache a response from this route.
export const dynamic = 'force-dynamic'

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const ctx = await getCmrContext()
    if (!ctx.ok) return ctx.response
    const guard = guardCmr(ctx)
    if (guard) return guard

    const params = new URL(request.url).searchParams
    const key = parseLedgerKey({
      date: params.get('date') || pacificToday(),
      period: params.get('period') || 'am',
    })
    if (!key.ok) return bad(key.error)

    const view = await buildLedgerView(createServiceClient(), key.value.date, key.value.period, ctx.role === 'controller')
    return NextResponse.json({ success: true, data: view })
  } catch (err) {
    return serverError('', err)
  }
}

export async function PUT(request: Request): Promise<NextResponse> {
  try {
    const ctx = await getCmrContext()
    if (!ctx.ok) return ctx.response
    const guard = guardCmrController(ctx)
    if (guard) return guard

    const body = await readJson(request)
    if (!body) return bad('Invalid request body.')
    const key = parseLedgerKey(body)
    if (!key.ok) return bad(key.error)
    const amount = parseLedgerCents(body.beginningCashCents, 'Beginning cash', { signed: true })
    if (!amount.ok) return bad(amount.error)
    const { date, period } = key.value

    const supabase = createServiceClient()
    const existing = await findLedger(supabase, date, period)
    const beforeCents = existing ? Number(existing.beginning_cash_cents) : 0
    if (beforeCents === amount.value) {
      // Nothing to change — and setting $0 on an unsaved ledger doesn't create one.
      return NextResponse.json({
        success: true,
        data: { ledger: existing ? toCmrLedger(existing) : virtualLedger(date, period), changed: false },
      })
    }

    const audit = auditor(ctx, request)
    const row = existing ?? (await ensureLedger(supabase, date, period, ctx.userId, audit))
    const updatedAt = new Date().toISOString()
    const { error } = await supabase
      .from('cmr_daily_ledger')
      .update({ beginning_cash_cents: amount.value, updated_at: updatedAt })
      .eq('id', row.id)
    if (isInputViolation(error)) return bad(`Beginning cash couldn't be saved: ${error?.message ?? 'invalid value'}.`)
    if (error) throw new Error(error.message)

    await audit('cmr.ledger.beginning_cash', 'cmr_daily_ledger', row.id, ledgerLabel(date, period), {
      ledgerDate: date,
      period,
      before: { beginningCashCents: Number(row.beginning_cash_cents) },
      after: { beginningCashCents: amount.value },
    })

    return NextResponse.json({
      success: true,
      data: {
        ledger: toCmrLedger({ ...row, beginning_cash_cents: amount.value, updated_at: updatedAt }),
        changed: true,
      },
    })
  } catch (err) {
    return serverError('', err)
  }
}
