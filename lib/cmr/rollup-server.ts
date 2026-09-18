import { NextResponse } from 'next/server'
import type { createServiceClient } from '@/lib/supabase/server'
import { pacificToday } from '@/lib/utils/date'
import { addDays, weekEndSaturday, weekStartSunday } from '@/lib/cmr/week'
import {
  CMR_ADJUSTMENT_COLS,
  CMR_LEDGER_COLS,
  CMR_PENDING_COLS,
  computeLedgerTotals,
  countsTowardPending,
  type CmrAdjustmentRow,
  type CmrDailyLedgerRow,
  type CmrLedgerPeriod,
  type CmrPendingRow,
} from '@/lib/cmr/ledger'
import { CMR_PRIORITY_COLS, computePriorityTotals, type CmrPriorityRow } from '@/lib/cmr/priorities'
import { describeSchedule } from '@/lib/cmr/recurring'
import { buildRecurringDue, recurringAccounts } from '@/lib/cmr/recurring-server'
import {
  rollupCash,
  type CmrRollupAccountRef,
  type CmrRollupDay,
  type CmrRollupPendingTotals,
  type CmrRollupPriorityTotals,
  type CmrRollupSnapshot,
  type CmrRollupVendorState,
  type CmrRollupView,
} from '@/lib/cmr/rollup'

/**
 * Server-only helpers for /api/cmr/rollup. They live here, not in the route file, because a
 * route.ts may export only HTTP handlers + route config (BUG-019).
 *
 * Nothing here checks access — the handler calls getCmrContext() + guardCmr first.
 */

export type Supabase = ReturnType<typeof createServiceClient>

export function bad(error: string, code = 'VALIDATION_ERROR', status = 400): NextResponse {
  return NextResponse.json({ success: false, error, code }, { status })
}

export function serverError(err: unknown): NextResponse {
  console.error('[api/cmr/rollup]', err)
  const message = err instanceof Error ? err.message : 'Unexpected error.'
  return NextResponse.json({ success: false, error: message, code: 'INTERNAL_ERROR' }, { status: 500 })
}

/** The seven Pacific days of a Sunday-start week. */
export const weekDays = (weekStart: string): string[] =>
  Array.from({ length: 7 }, (_, i) => addDays(weekStartSunday(weekStart), i))

/**
 * Every saved snapshot of the week with its derived balance, plus the pending items behind
 * them. Days with nothing saved are present but empty — a week is always seven days on screen.
 */
async function weekLedgers(
  supabase: Supabase,
  weekStart: string,
): Promise<{ days: CmrRollupDay[]; pending: CmrRollupPendingTotals }> {
  const start = weekStartSunday(weekStart)
  const end = weekEndSaturday(start)

  const { data: ledgerData, error: ledgerError } = await supabase
    .from('cmr_daily_ledger')
    .select(CMR_LEDGER_COLS)
    .gte('ledger_date', start)
    .lte('ledger_date', end)
  if (ledgerError) throw new Error(ledgerError.message)
  const ledgers = (ledgerData ?? []) as unknown as CmrDailyLedgerRow[]
  const ids = ledgers.map((l) => l.id)

  let adjustments: CmrAdjustmentRow[] = []
  let items: CmrPendingRow[] = []
  if (ids.length) {
    const [adjRes, pendRes] = await Promise.all([
      supabase.from('cmr_ledger_adjustments').select(CMR_ADJUSTMENT_COLS).in('daily_ledger_id', ids),
      supabase.from('cmr_pending_items').select(CMR_PENDING_COLS).in('daily_ledger_id', ids),
    ])
    if (adjRes.error) throw new Error(adjRes.error.message)
    if (pendRes.error) throw new Error(pendRes.error.message)
    // The pending roll-up is derived on read; only hand-entered adjustment lines are summed.
    adjustments = ((adjRes.data ?? []) as unknown as CmrAdjustmentRow[]).filter((a) => a.kind === 'manual')
    items = (pendRes.data ?? []) as unknown as CmrPendingRow[]
  }

  const snapshotOf = (l: CmrDailyLedgerRow): CmrRollupSnapshot => {
    const mine = items.filter((i) => i.daily_ledger_id === l.id)
    const totals = computeLedgerTotals(
      Number(l.beginning_cash_cents),
      adjustments.filter((a) => a.daily_ledger_id === l.id).map((a) => ({ amountCents: Number(a.amount_cents) })),
      mine.map((i) => ({ amountCents: Number(i.amount_cents), status: i.status })),
    )
    return {
      period: l.period,
      beginningCashCents: totals.beginningCashCents,
      adjustmentsTotalCents: totals.adjustmentsTotalCents,
      pendingRollupCents: totals.pendingRollupCents,
      currentBalanceCents: totals.currentBalanceCents,
    }
  }

  const find = (date: string, period: CmrLedgerPeriod) => ledgers.find((l) => l.ledger_date === date && l.period === period)
  const days: CmrRollupDay[] = weekDays(start).map((date) => {
    const am = find(date, 'am')
    const pm = find(date, 'pm')
    return { date, am: am ? snapshotOf(am) : null, pm: pm ? snapshotOf(pm) : null }
  })

  const counted = items.filter(countsTowardPending)
  const pending: CmrRollupPendingTotals = {
    totalCents: counted.reduce((s, i) => s + Number(i.amount_cents), 0),
    paidCents: counted.filter((i) => i.status === 'paid').reduce((s, i) => s + Number(i.amount_cents), 0),
    openCents: counted.filter((i) => i.status === 'pending').reduce((s, i) => s + Number(i.amount_cents), 0),
    count: counted.length,
    openCount: counted.filter((i) => i.status === 'pending').length,
  }
  return { days, pending }
}

async function weekPriorities(supabase: Supabase, weekStart: string): Promise<CmrRollupPriorityTotals> {
  const { data, error } = await supabase.from('cmr_weekly_priorities').select(CMR_PRIORITY_COLS).eq('week_start', weekStart)
  if (error) throw new Error(error.message)
  const rows = (data ?? []) as unknown as CmrPriorityRow[]
  const t = computePriorityTotals(
    rows.map((r) => ({ amountCents: Number(r.amount_cents), status: r.status, isTopPriority: r.is_top_priority })),
  )
  return {
    neededCents: t.neededCents,
    paidResolvedCents: t.paidResolvedCents,
    totalCents: t.totalCents,
    count: t.count,
    openCount: t.openCount,
    openTopPriorityCount: t.openTopPriorityCount,
  }
}

/** Everything the Weekly rollup screen needs for one week. */
export async function buildRollupView(supabase: Supabase, weekStart: string, canEdit: boolean): Promise<CmrRollupView> {
  const week = weekStartSunday(weekStart)
  const [{ days, pending }, priorities, due, accountMap] = await Promise.all([
    weekLedgers(supabase, week),
    weekPriorities(supabase, week),
    buildRecurringDue(supabase, week),
    recurringAccounts(supabase),
  ])

  const recurring: CmrRollupVendorState[] = due.map(({ vendor, result }) => ({
    vendorId: vendor.id,
    vendorName: vendor.vendorName,
    accountId: vendor.accountId,
    accountName: vendor.accountName,
    accountActive: vendor.accountActive,
    section: vendor.section,
    scheduleText: describeSchedule(vendor.section, vendor.schedule),
    amountCents: vendor.amountCents,
    lastAmountSentCents: vendor.lastAmountSentCents,
    suggestedCents: vendor.lastAmountSentCents ?? vendor.amountCents,
    notes: vendor.notes,
    active: vendor.active,
    onHold: vendor.onHold,
    scheduleComplete: vendor.scheduleComplete,
    state: result.state,
    occurrenceDate: result.occurrence?.date ?? null,
    handledBy: result.handledBy,
  }))

  const accounts: CmrRollupAccountRef[] = [...accountMap.values()].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
  )
  const today = pacificToday()

  return {
    weekStart: week,
    weekEnd: weekEndSaturday(week),
    today,
    thisWeekStart: weekStartSunday(today),
    days,
    cash: rollupCash(days),
    pending,
    priorities,
    accounts,
    recurring,
    canEdit,
  }
}
