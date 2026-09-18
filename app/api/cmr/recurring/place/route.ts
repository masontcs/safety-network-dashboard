import { NextResponse } from 'next/server'
import { getCmrContext, guardCmrController } from '@/lib/api/cmr'
import { createServiceClient } from '@/lib/supabase/server'
import { ledgerLabel, parseLedgerDate, parsePeriod, toCmrPendingItem } from '@/lib/cmr/ledger'
import {
  auditor as ledgerAuditor,
  ensureLedger,
  loadAccounts,
  nextSortOrder,
  pendingRows,
  touchLedger,
} from '@/lib/cmr/ledger-server'
import { parseWeek, toCmrPriority } from '@/lib/cmr/priorities'
import { weekRows, nextSortOrder as nextPrioritySortOrder } from '@/lib/cmr/priorities-server'
import { formatWeekRangeShort, weekStartSunday } from '@/lib/cmr/week'
import { describeSchedule, scheduleOf, toCmrRecurringVendor } from '@/lib/cmr/recurring'
import {
  RecurringPlacementConflict,
  UUID_RE,
  auditor,
  bad,
  occurrenceOf,
  placeRecurringIntoPending,
  placeRecurringIntoPriority,
  placementRefusal,
  readJson,
  recurringAccounts,
  recurringVendorById,
  serverError,
} from '@/lib/cmr/recurring-server'

/**
 * SN Cash Ledger — accept a DUE recurring vendor. CONTROLLER ONLY.
 *
 *   POST { id, week, target: 'pending', date: 'YYYY-MM-DD', period: 'am' | 'pm' }
 *          → adds it to that day's pending breakdown, under the vendor's own account, as a
 *            source = 'recurring' item pointing back at the vendor.
 *   POST { id, week, target: 'priority', weekStart | date: 'YYYY-MM-DD' }
 *          → adds it to that week's priorities as an open priority stamped with the vendor.
 *
 * `week` is the week the suggestion was shown for; the server recomputes the occurrence and its
 * window from the VENDOR'S OWN schedule, so the client cannot widen or move the window that
 * decides whether this occurrence has already been handled. Either way the new row makes the
 * vendor handled, so it leaves the due list — and the placement function re-checks that window
 * with the vendor row locked, so two Controllers clicking Add cannot both write one.
 *
 * Nothing is ever added automatically: the engine suggests, the Controller confirms here.
 *
 * NOTE (BUG-019): a route.ts may export only HTTP handlers + route config — helpers live in
 * lib/cmr/recurring-server.
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
    const id = typeof body.id === 'string' ? body.id.trim() : ''
    if (!UUID_RE.test(id)) return bad('Choose a vendor.')
    const target = body.target === 'pending' || body.target === 'priority' ? body.target : null
    if (!target) return bad('Choose where to add it: a pending item or a weekly priority.')
    const shownWeek = parseWeek(body.week)
    if (!shownWeek.ok) return bad('Choose a valid week.')

    const supabase = createServiceClient()
    const row = await recurringVendorById(supabase, id)
    if (!row) return bad('That vendor does not exist.', 'NOT_FOUND', 404)

    if (row.section === 'urgent') {
      return bad(`${row.vendor_name} is an Urgent Payment Plan, which has no recurring schedule.`, 'NOT_SCHEDULED', 409)
    }
    if (!row.active) return bad(`${row.vendor_name} is inactive. Reactivate it first.`, 'INACTIVE', 409)
    if (row.on_hold) return bad(`${row.vendor_name} is on hold. Take it off hold first.`, 'ON_HOLD', 409)

    const occurrence = occurrenceOf(row, shownWeek.value)
    if (!occurrence) {
      return bad(`${row.vendor_name} has no schedule yet. Set one before adding it.`, 'NO_SCHEDULE', 409)
    }

    // What actually goes out is what was sent last time when that is known, otherwise the
    // vendor's standing amount — the same figure the suggestion showed.
    const amountCents = Number(row.last_amount_sent_cents ?? row.amount_cents)
    const audit = auditor(ctx, request)
    const scheduleText = describeSchedule(row.section, scheduleOf(row))

    // ── into the daily pending list ──────────────────────────────────────────
    if (target === 'pending') {
      const date = parseLedgerDate(body.date ?? occurrence.date)
      if (!date.ok) return bad(date.error)
      const period = parsePeriod(body.period ?? 'am')
      if (!period.ok) return bad(period.error)

      const accounts = await loadAccounts(supabase)
      const account = accounts.get(row.account_id)
      if (!account) return bad('That vendor’s account no longer exists.', 'NOT_FOUND', 404)
      if (!account.active) {
        return bad(
          `${account.name} is inactive. Reactivate it, or move ${row.vendor_name} onto an active account, before adding this.`,
          'ACCOUNT_INACTIVE',
          409,
        )
      }

      const ledger = await ensureLedger(supabase, date.value, period.value, ctx.userId, ledgerAuditor(ctx, request))
      const group = await pendingRows(supabase, ledger.id, row.account_id)

      let newId: string
      try {
        newId = await placeRecurringIntoPending(supabase, {
          vendorId: id,
          actorId: ctx.userId,
          ledgerId: ledger.id,
          accountId: row.account_id,
          payee: row.vendor_name,
          amountCents,
          notes: row.notes,
          date: date.value,
          sortOrder: nextSortOrder(group),
          window: occurrence.window,
          lastAmountCents: amountCents,
        })
      } catch (e) {
        if (e instanceof RecurringPlacementConflict) {
          const r = placementRefusal(e.reason, row.vendor_name)
          return bad(r.error, e.reason, r.status)
        }
        throw e
      }
      await touchLedger(supabase, ledger.id)

      const item = (await pendingRows(supabase, ledger.id, row.account_id)).find((r) => r.id === newId)

      await audit('cmr.recurring.place', id, row.vendor_name, {
        target: 'pending',
        week: shownWeek.value,
        schedule: scheduleText,
        occurrenceDate: occurrence.date,
        occurrenceWindow: occurrence.window,
        ledgerId: ledger.id,
        ledgerDate: date.value,
        period: period.value,
        label: ledgerLabel(date.value, period.value),
        placedRefId: newId,
        accountId: row.account_id,
        accountName: account.name,
        amountCents,
        before: null,
        after: { source: 'recurring', sourceRefId: id, payee: row.vendor_name, amountCents },
      })

      const vendorAfter = await recurringVendorById(supabase, id)
      return NextResponse.json({
        success: true,
        data: {
          placedKind: 'pending' as const,
          placedRefId: newId,
          where: ledgerLabel(date.value, period.value),
          item: item ? toCmrPendingItem(item, accounts) : null,
          vendor: vendorAfter ? toCmrRecurringVendor(vendorAfter, await recurringAccounts(supabase)) : null,
        },
      })
    }

    // ── into a weekly priority ───────────────────────────────────────────────
    const week = parseWeek(body.weekStart ?? body.date ?? occurrence.date)
    if (!week.ok) return bad('Choose a valid week.')

    const rowsInWeek = await weekRows(supabase, week.value)
    let newId: string
    try {
      newId = await placeRecurringIntoPriority(supabase, {
        vendorId: id,
        actorId: ctx.userId,
        weekStart: week.value,
        description: row.vendor_name,
        amountCents,
        dueDate: occurrence.date,
        notes: row.notes,
        sortOrder: nextPrioritySortOrder(rowsInWeek),
        window: occurrence.window,
        lastAmountCents: amountCents,
      })
    } catch (e) {
      if (e instanceof RecurringPlacementConflict) {
        const r = placementRefusal(e.reason, row.vendor_name)
        return bad(r.error, e.reason, r.status)
      }
      throw e
    }

    const priority = (await weekRows(supabase, week.value)).find((r) => r.id === newId)

    await audit('cmr.recurring.place', id, row.vendor_name, {
      target: 'priority',
      week: shownWeek.value,
      schedule: scheduleText,
      occurrenceDate: occurrence.date,
      occurrenceWindow: occurrence.window,
      weekStart: week.value,
      label: formatWeekRangeShort(week.value),
      placedRefId: newId,
      accountId: row.account_id,
      accountName: (await recurringAccounts(supabase)).get(row.account_id)?.name ?? null,
      amountCents,
      before: null,
      after: { sourceRecurringId: id, description: row.vendor_name, amountCents, weekStart: week.value },
    })

    const vendorAfter = await recurringVendorById(supabase, id)
    return NextResponse.json({
      success: true,
      data: {
        placedKind: 'priority' as const,
        placedRefId: newId,
        where: formatWeekRangeShort(weekStartSunday(week.value)),
        priority: priority ? toCmrPriority(priority) : null,
        vendor: vendorAfter ? toCmrRecurringVendor(vendorAfter, await recurringAccounts(supabase)) : null,
      },
    })
  } catch (err) {
    return serverError('/place', err)
  }
}
