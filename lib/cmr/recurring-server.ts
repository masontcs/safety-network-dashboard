import { NextResponse } from 'next/server'
import type { createServiceClient } from '@/lib/supabase/server'
import { logAudit, getClientIp, type AuditAction } from '@/lib/audit/log'
import type { CmrAccess } from '@/lib/api/cmr'
import {
  CMR_RECURRING_COLS,
  compareVendors,
  scheduleOf,
  toCmrRecurringVendor,
  type CmrAccountRef,
  type CmrRecurringVendor,
  type CmrRecurringVendorRow,
} from '@/lib/cmr/recurring'
import {
  computeDue,
  occurrenceForWeek,
  type CmrDueResult,
  type CmrDueWindow,
  type CmrHandledRow,
} from '@/lib/cmr/recurring-due'
import { addDays, weekEndSaturday, weekStartSunday } from '@/lib/cmr/week'

/**
 * Server-only helpers for the recurring "due" engine and for accepting a suggestion. They live
 * here, not in the route files, because a route.ts may export only HTTP handlers + route config
 * (BUG-019).
 *
 * Nothing here checks access — every handler calls getCmrContext() + guardCmr /
 * guardCmrController BEFORE touching any of these.
 */

export type Supabase = ReturnType<typeof createServiceClient>

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function bad(error: string, code = 'VALIDATION_ERROR', status = 400): NextResponse {
  return NextResponse.json({ success: false, error, code }, { status })
}

export function serverError(where: string, err: unknown): NextResponse {
  console.error(`[api/cmr/recurring${where}]`, err)
  const message = err instanceof Error ? err.message : 'Unexpected error.'
  return NextResponse.json({ success: false, error: message, code: 'INTERNAL_ERROR' }, { status: 500 })
}

export async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = (await request.json()) as unknown
    return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null
  } catch {
    return null
  }
}

export async function recurringAccounts(supabase: Supabase): Promise<Map<string, CmrAccountRef>> {
  const { data, error } = await supabase
    .from('cmr_accounts')
    .select('id, name, active, sort_order')
    .order('sort_order', { ascending: true })
  if (error) throw new Error(error.message)
  const rows = (data ?? []) as { id: string; name: string; active: boolean; sort_order: number }[]
  return new Map(rows.map((r) => [r.id, { id: r.id, name: r.name, active: r.active, sortOrder: r.sort_order }]))
}

export async function recurringVendorRows(supabase: Supabase, id?: string): Promise<CmrRecurringVendorRow[]> {
  let q = supabase.from('cmr_recurring_vendors').select(CMR_RECURRING_COLS)
  if (id) q = q.eq('id', id)
  const { data, error } = await q
    .order('section', { ascending: true })
    .order('sort_order', { ascending: true })
    .order('vendor_name', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as CmrRecurringVendorRow[]
}

export async function recurringVendorById(supabase: Supabase, id: string): Promise<CmrRecurringVendorRow | null> {
  const rows = await recurringVendorRows(supabase, id)
  return rows[0] ?? null
}

/**
 * The rows that could have handled a recurring occurrence, for the span the week's occurrences
 * can reach back into. A quarterly occurrence's window starts up to two months before the week
 * and an annual one up to a year, so the span is generous — it is one small indexed read per
 * table either way, and computeDue narrows it to each vendor's own window.
 */
export async function handledRows(supabase: Supabase, weekStart: string): Promise<CmrHandledRow[]> {
  const start = weekStartSunday(weekStart)
  const end = weekEndSaturday(start)
  // A year and a month back covers every window an occurrence in this week can own; the
  // forward edge covers a window that runs past the week (a quarter, a calendar year).
  const from = `${Number(start.slice(0, 4)) - 1}-01-01`
  const to = `${Number(end.slice(0, 4)) + 1}-12-31`

  const [pendingRes, priorityRes] = await Promise.all([
    supabase
      .from('cmr_pending_items')
      .select('source_ref_id, effective_date, status')
      .eq('source', 'recurring')
      .gte('effective_date', from)
      .lte('effective_date', to),
    supabase
      .from('cmr_weekly_priorities')
      .select('source_recurring_id, week_start')
      .gte('week_start', addDays(from, -7))
      .lte('week_start', to),
  ])
  if (pendingRes.error) throw new Error(pendingRes.error.message)
  if (priorityRes.error) throw new Error(priorityRes.error.message)

  const out: CmrHandledRow[] = []
  for (const r of (pendingRes.data ?? []) as unknown as {
    source_ref_id: string | null
    effective_date: string | null
  }[]) {
    if (r.source_ref_id && r.effective_date) out.push({ vendorId: r.source_ref_id, date: r.effective_date, kind: 'pending' })
  }
  for (const r of (priorityRes.data ?? []) as unknown as { source_recurring_id: string | null; week_start: string }[]) {
    if (r.source_recurring_id) out.push({ vendorId: r.source_recurring_id, date: r.week_start, kind: 'priority' })
  }
  return out
}

/** A vendor with its state for one week — what the rollup lists and what Add acts on. */
export interface CmrRecurringDue {
  vendor: CmrRecurringVendor
  result: CmrDueResult
}

/** Every vendor and its state for `weekStart`, in the screen's usual order. */
export async function buildRecurringDue(supabase: Supabase, weekStart: string): Promise<CmrRecurringDue[]> {
  const week = weekStartSunday(weekStart)
  const [accounts, rows, handled] = await Promise.all([
    recurringAccounts(supabase),
    recurringVendorRows(supabase),
    handledRows(supabase, week),
  ])
  const vendors = rows.map((r) => toCmrRecurringVendor(r, accounts)).sort(compareVendors)
  const results = computeDue(
    vendors.map((v) => ({ id: v.id, section: v.section, schedule: v.schedule, active: v.active, onHold: v.onHold })),
    week,
    handled,
  )
  return vendors.map((vendor, i) => ({ vendor, result: results[i] }))
}

/**
 * The occurrence a vendor's row is being accepted for, recomputed on the SERVER from the
 * vendor's own schedule — the client's idea of the window is never trusted, because the window
 * is what stops the same occurrence being added twice.
 */
export function occurrenceOf(row: CmrRecurringVendorRow, weekStart: string): { date: string; window: CmrDueWindow } | null {
  return occurrenceForWeek(row.section, scheduleOf(row), weekStartSunday(weekStart))
}

export function auditor(ctx: CmrAccess, request: Request) {
  const ip = getClientIp(request)
  return (action: AuditAction, resourceId: string, resourceLabel: string, metadata: Record<string, unknown>) =>
    logAudit({
      userId: ctx.userId,
      userDisplayName: ctx.displayName,
      userRole: `cmr:${ctx.role}`,
      action,
      resourceType: 'cmr_recurring_vendors',
      resourceId,
      resourceLabel,
      metadata,
      ipAddress: ip,
    })
}

// ── accepting a suggestion (the transactional half) ─────────────────────────

/**
 * An accept the DB refused: the vendor moved on, or that occurrence is already handled. The
 * window re-check happens inside the function with the vendor row locked, so two Controllers
 * clicking Add at the same moment can't both write a row.
 */
export type RecurringPlacementReason = 'NOT_FOUND' | 'NOT_SCHEDULED' | 'INACTIVE' | 'ON_HOLD' | 'ALREADY_HANDLED'

export class RecurringPlacementConflict extends Error {
  constructor(readonly reason: RecurringPlacementReason) {
    super(reason)
    this.name = 'RecurringPlacementConflict'
  }
}

const REASONS: readonly RecurringPlacementReason[] = [
  'ALREADY_HANDLED',
  'NOT_SCHEDULED',
  'INACTIVE',
  'ON_HOLD',
  'NOT_FOUND',
] as const

/**
 * Called as a member of the client — supabase-js rpc() needs `this`. Cast because the Database
 * `Functions` type is deliberately empty (see database.types.ts).
 */
async function rpc(supabase: Supabase, fn: string, args: Record<string, unknown>): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = (await (supabase as any).rpc(fn, args)) as { data: unknown; error: { message: string } | null }
  if (error) {
    for (const reason of REASONS) if (error.message.includes(reason)) throw new RecurringPlacementConflict(reason)
    throw new Error(error.message)
  }
  if (typeof data !== 'string' || !UUID_RE.test(data)) throw new Error('Adding the vendor did not return the new row.')
  return data
}

export const placeRecurringIntoPending = (
  supabase: Supabase,
  args: {
    vendorId: string
    actorId: string
    ledgerId: string
    accountId: string
    payee: string
    amountCents: number
    notes: string | null
    date: string
    sortOrder: number
    window: CmrDueWindow
    lastAmountCents: number | null
  },
): Promise<string> =>
  rpc(supabase, 'cmr_place_recurring_pending', {
    p_vendor_id: args.vendorId,
    p_actor: args.actorId,
    p_ledger_id: args.ledgerId,
    p_account_id: args.accountId,
    p_payee: args.payee,
    p_amount_cents: args.amountCents,
    p_notes: args.notes,
    p_date: args.date,
    p_sort_order: args.sortOrder,
    p_window_start: args.window.start,
    p_window_end: args.window.end,
    p_last_amount_cents: args.lastAmountCents,
  })

export const placeRecurringIntoPriority = (
  supabase: Supabase,
  args: {
    vendorId: string
    actorId: string
    weekStart: string
    description: string
    amountCents: number
    dueDate: string | null
    notes: string | null
    sortOrder: number
    window: CmrDueWindow
    lastAmountCents: number | null
  },
): Promise<string> =>
  rpc(supabase, 'cmr_place_recurring_priority', {
    p_vendor_id: args.vendorId,
    p_actor: args.actorId,
    p_week_start: args.weekStart,
    p_description: args.description,
    p_amount_cents: args.amountCents,
    p_due_date: args.dueDate,
    p_notes: args.notes,
    p_sort_order: args.sortOrder,
    p_window_start: args.window.start,
    p_window_end: args.window.end,
    p_last_amount_cents: args.lastAmountCents,
  })

/** The reason a refused accept gives the Controller, in their terms. */
export const placementRefusal = (reason: RecurringPlacementReason, vendorName: string): { error: string; status: number } => {
  switch (reason) {
    case 'NOT_FOUND':
      return { error: 'That vendor does not exist.', status: 404 }
    case 'NOT_SCHEDULED':
      return { error: `${vendorName} is an Urgent Payment Plan, which has no recurring schedule.`, status: 409 }
    case 'INACTIVE':
      return { error: `${vendorName} is inactive. Reactivate it first.`, status: 409 }
    case 'ON_HOLD':
      return { error: `${vendorName} is on hold. Take it off hold first.`, status: 409 }
    case 'ALREADY_HANDLED':
      return { error: `${vendorName} has already been added for this period.`, status: 409 }
  }
}
