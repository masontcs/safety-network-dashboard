import { NextResponse } from 'next/server'
import type { createServiceClient } from '@/lib/supabase/server'
import { logAudit, getClientIp, type AuditAction } from '@/lib/audit/log'
import type { CmrAccess } from '@/lib/api/cmr'
import { pacificToday } from '@/lib/utils/date'
import {
  CMR_ADJUSTMENT_COLS,
  CMR_LEDGER_COLS,
  CMR_PENDING_COLS,
  compareOrdered,
  computeLedgerTotals,
  groupPendingByAccount,
  ledgerLabel,
  parseLedgerDate,
  parsePeriod,
  toCmrAdjustment,
  toCmrLedger,
  toCmrPendingItem,
  virtualLedger,
  type CmrAdjustmentRow,
  type CmrDailyLedgerRow,
  type CmrLedgerAccountRef,
  type CmrLedgerPeriod,
  type CmrLedgerView,
  type CmrPendingLinks,
  type CmrPendingRow,
  type CmrPendingStatus,
  type CmrPendingWhere,
  type Parsed,
} from '@/lib/cmr/ledger'
import { displayNames } from '@/lib/cmr/priorities-server'

/**
 * Server-only helpers shared by the /api/cmr/ledger/* route handlers. They live here, not in
 * the route files, because a route.ts may export only HTTP handlers + route config (BUG-019).
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
  console.error(`[api/cmr/ledger${where}]`, err)
  const message = err instanceof Error ? err.message : 'Unexpected error.'
  return NextResponse.json({ success: false, error: message, code: 'INTERNAL_ERROR' }, { status: 500 })
}

// A DB check / foreign-key rejection is the caller's input, not a server fault.
export const isInputViolation = (e: { code?: string } | null): boolean => !!e && (e.code === '23514' || e.code === '23503')

export async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = (await request.json()) as unknown
    return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/** `{ date, period }` from a JSON body or query string. */
export function parseLedgerKey(src: { date?: unknown; period?: unknown }): Parsed<{ date: string; period: CmrLedgerPeriod }> {
  const date = parseLedgerDate(src.date)
  if (!date.ok) return date
  const period = parsePeriod(src.period)
  if (!period.ok) return period
  return { ok: true, value: { date: date.value, period: period.value } }
}

export async function loadAccounts(supabase: Supabase): Promise<Map<string, CmrLedgerAccountRef>> {
  const { data, error } = await supabase
    .from('cmr_accounts')
    .select('id, name, account_type, active, sort_order')
    .order('sort_order', { ascending: true })
  if (error) throw new Error(error.message)
  const rows = (data ?? []) as { id: string; name: string; account_type: string | null; active: boolean; sort_order: number }[]
  return new Map(
    rows.map((r) => [r.id, { id: r.id, name: r.name, accountType: r.account_type, active: r.active, sortOrder: r.sort_order }]),
  )
}

export async function findLedger(supabase: Supabase, date: string, period: CmrLedgerPeriod): Promise<CmrDailyLedgerRow | null> {
  const { data, error } = await supabase
    .from('cmr_daily_ledger')
    .select(CMR_LEDGER_COLS)
    .eq('ledger_date', date)
    .eq('period', period)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return (data as unknown as CmrDailyLedgerRow | null) ?? null
}

export async function ledgerById(supabase: Supabase, id: string): Promise<CmrDailyLedgerRow | null> {
  const { data, error } = await supabase.from('cmr_daily_ledger').select(CMR_LEDGER_COLS).eq('id', id).maybeSingle()
  if (error) throw new Error(error.message)
  return (data as unknown as CmrDailyLedgerRow | null) ?? null
}

export async function adjustmentRows(supabase: Supabase, ledgerId: string): Promise<CmrAdjustmentRow[]> {
  const { data, error } = await supabase
    .from('cmr_ledger_adjustments')
    .select(CMR_ADJUSTMENT_COLS)
    .eq('daily_ledger_id', ledgerId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) throw new Error(error.message)
  // The pending roll-up is derived on read; only hand-entered lines are listed or summed.
  return ((data ?? []) as unknown as CmrAdjustmentRow[]).filter((r) => r.kind === 'manual')
}

export async function pendingRows(supabase: Supabase, ledgerId: string, accountId?: string): Promise<CmrPendingRow[]> {
  let q = supabase.from('cmr_pending_items').select(CMR_PENDING_COLS).eq('daily_ledger_id', ledgerId)
  if (accountId) q = q.eq('account_id', accountId)
  const { data, error } = await q.order('sort_order', { ascending: true }).order('created_at', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as CmrPendingRow[]
}

export const nextSortOrder = (rows: { sort_order: number }[]): number =>
  rows.reduce((m, r) => Math.max(m, r.sort_order), -1) + 1

export function auditor(ctx: CmrAccess, request: Request) {
  const ip = getClientIp(request)
  return (
    action: AuditAction,
    resourceType: 'cmr_daily_ledger' | 'cmr_ledger_adjustments' | 'cmr_pending_items',
    resourceId: string,
    resourceLabel: string,
    metadata: Record<string, unknown>,
  ) =>
    logAudit({
      userId: ctx.userId,
      userDisplayName: ctx.displayName,
      userRole: `cmr:${ctx.role}`,
      action,
      resourceType,
      resourceId,
      resourceLabel,
      metadata,
      ipAddress: ip,
    })
}

export type Audit = ReturnType<typeof auditor>

/**
 * The ledger row for (date, period), creating it on demand. Race-safe: the insert is an
 * upsert on the (ledger_date, period) unique key that ignores a duplicate, so two first writes
 * can't make two rows. A creation is audited (cmr.ledger.create).
 */
export async function ensureLedger(
  supabase: Supabase,
  date: string,
  period: CmrLedgerPeriod,
  userId: string,
  audit: Audit,
): Promise<CmrDailyLedgerRow> {
  const found = await findLedger(supabase, date, period)
  if (found) return found

  const { data, error } = await supabase
    .from('cmr_daily_ledger')
    .upsert(
      { ledger_date: date, period, beginning_cash_cents: 0, created_by: userId },
      { onConflict: 'ledger_date,period', ignoreDuplicates: true },
    )
    .select(CMR_LEDGER_COLS)
  if (error) throw new Error(error.message)
  const inserted = ((data ?? []) as unknown as CmrDailyLedgerRow[])[0]
  if (inserted) {
    await audit('cmr.ledger.create', 'cmr_daily_ledger', inserted.id, ledgerLabel(date, period), {
      ledgerDate: date,
      period,
      before: null,
      after: { beginningCashCents: 0 },
    })
    return inserted
  }
  // Someone else created it between our read and the upsert.
  const again = await findLedger(supabase, date, period)
  if (!again) throw new Error('Could not open the ledger for that date.')
  return again
}

/** Record that something on this ledger changed (shown as "updated …" on the screen). */
export async function touchLedger(supabase: Supabase, ledgerId: string): Promise<void> {
  const { error } = await supabase.from('cmr_daily_ledger').update({ updated_at: new Date().toISOString() }).eq('id', ledgerId)
  if (error) throw new Error(error.message)
}

/** Everything the Daily ledger screen needs for one date/period, with the derived totals. */
export async function buildLedgerView(
  supabase: Supabase,
  date: string,
  period: CmrLedgerPeriod,
  canEdit: boolean,
): Promise<CmrLedgerView> {
  const [accountMap, row] = await Promise.all([loadAccounts(supabase), findLedger(supabase, date, period)])
  const ledger = row ? toCmrLedger(row) : virtualLedger(date, period)
  const [adjRows, pendRows] = row
    ? await Promise.all([adjustmentRows(supabase, row.id), pendingRows(supabase, row.id)])
    : [[], []]

  const [links, names] = await Promise.all([
    pendingLinks(supabase, pendRows),
    displayNames(supabase, pendRows.map((r) => r.paid_by)),
  ])
  const adjustments = adjRows.map(toCmrAdjustment).sort(compareOrdered)
  const items = pendRows.map((r) => toCmrPendingItem(r, accountMap, links, names))
  const accounts = [...accountMap.values()].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))

  return {
    ledger,
    adjustments,
    pending: groupPendingByAccount(items, accounts),
    totals: computeLedgerTotals(ledger.beginningCashCents, adjustments, items),
    accounts,
    today: pacificToday(),
    canEdit,
  }
}

export async function pendingItemById(supabase: Supabase, id: string): Promise<CmrPendingRow | null> {
  const { data, error } = await supabase.from('cmr_pending_items').select(CMR_PENDING_COLS).eq('id', id).maybeSingle()
  if (error) throw new Error(error.message)
  return (data as unknown as CmrPendingRow | null) ?? null
}

/**
 * Resolve the two ends of every push touching these rows:
 *
 *   • a 'pushed' original → the day/period its forward copy sits on ("pushed to …");
 *   • a forward copy (pushed_from_id set) → the day/period it came from ("pushed from …").
 *
 * Both ends live on OTHER ledgers, so this is two id lookups plus one ledger lookup, and only
 * when such rows exist. Rows whose other end has since been deleted simply have no link.
 */
export async function pendingLinks(supabase: Supabase, rows: CmrPendingRow[]): Promise<CmrPendingLinks> {
  const links: CmrPendingLinks = { pushedTo: new Map(), pushedFrom: new Map(), copyStatus: new Map() }
  const pushedIds = rows.filter((r) => r.status === 'pushed').map((r) => r.id)
  const fromIds = [...new Set(rows.map((r) => r.pushed_from_id).filter((x): x is string => !!x))]
  if (!pushedIds.length && !fromIds.length) return links

  type Lite = { id: string; daily_ledger_id: string; pushed_from_id: string | null; status: CmrPendingStatus }
  const lite = async (col: 'id' | 'pushed_from_id', ids: string[]): Promise<Lite[]> => {
    if (!ids.length) return []
    const { data, error } = await supabase.from('cmr_pending_items').select('id, daily_ledger_id, pushed_from_id, status').in(col, ids)
    if (error) throw new Error(error.message)
    return (data ?? []) as unknown as Lite[]
  }
  const [copies, sources] = await Promise.all([lite('pushed_from_id', pushedIds), lite('id', fromIds)])

  const ledgerIds = [...new Set([...copies, ...sources].map((r) => r.daily_ledger_id))]
  const where = new Map<string, CmrPendingWhere>()
  if (ledgerIds.length) {
    const { data, error } = await supabase.from('cmr_daily_ledger').select('id, ledger_date, period').in('id', ledgerIds)
    if (error) throw new Error(error.message)
    for (const l of (data ?? []) as unknown as { id: string; ledger_date: string; period: CmrLedgerPeriod }[]) {
      where.set(l.id, { date: l.ledger_date, period: l.period })
    }
  }

  for (const c of copies) {
    if (!c.pushed_from_id) continue
    const w = where.get(c.daily_ledger_id)
    if (w) links.pushedTo.set(c.pushed_from_id, w)
    // The copy's own state decides whether the push can still be taken back.
    links.copyStatus.set(c.pushed_from_id, c.status)
  }
  for (const srcRow of sources) {
    const w = where.get(srcRow.daily_ledger_id)
    if (!w) continue
    for (const r of rows) if (r.pushed_from_id === srcRow.id) links.pushedFrom.set(r.id, w)
  }
  return links
}

// ── push (service role only) ────────────────────────────────────────────────

/** A push the DB refused: the item had already moved on, or the target is where it already is. */
export class PushConflict extends Error {
  constructor(readonly reason: 'NOT_FOUND' | 'NOT_PENDING' | 'SAME_LEDGER') {
    super(reason)
    this.name = 'PushConflict'
  }
}

/**
 * Copy a still-pending item onto another day's ledger AND mark the original pushed in ONE
 * database call (cmr_push_pending_item), which re-checks the item is still pending while
 * holding its row locked — so it can never be pushed twice or half-pushed. Returns the new id.
 *
 * Called as a member of the client — supabase-js rpc() needs `this`. Cast because the Database
 * `Functions` type is deliberately empty (see database.types.ts).
 */
export async function pushPendingItem(
  supabase: Supabase,
  args: { itemId: string; actorId: string; ledgerId: string; date: string; sortOrder: number },
): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = (await (supabase as any).rpc('cmr_push_pending_item', {
    p_item_id: args.itemId,
    p_actor: args.actorId,
    p_ledger_id: args.ledgerId,
    p_date: args.date,
    p_sort_order: args.sortOrder,
  })) as { data: unknown; error: { message: string } | null }
  if (error) {
    for (const reason of ['NOT_FOUND', 'NOT_PENDING', 'SAME_LEDGER'] as const) {
      if (error.message.includes(reason)) throw new PushConflict(reason)
    }
    throw new Error(error.message)
  }
  if (typeof data !== 'string' || !UUID_RE.test(data)) throw new Error('Pushing the item did not return the new row.')
  return data
}

/** An un-push the DB refused: it wasn't pushed, or the copy has been paid or moved on. */
export class UnpushConflict extends Error {
  constructor(readonly reason: 'NOT_FOUND' | 'NOT_PUSHED' | 'ROW_PAID' | 'ROW_MOVED') {
    super(reason)
    this.name = 'UnpushConflict'
  }
}

/**
 * Reverse a push: delete the forward copy and put the pushed original back to 'pending', in ONE
 * database call (cmr_unpush_pending_item), which locks both rows and re-checks that the copy is
 * still untouched. Returns the id it removed, or null when that copy was already gone — in
 * which case the original is simply put back. The AFTER DELETE trigger on cmr_pending_items is
 * the wider safety net: whatever route deletes a forward copy, its source is revived with it.
 */
export async function unpushPendingItem(supabase: Supabase, itemId: string): Promise<string | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = (await (supabase as any).rpc('cmr_unpush_pending_item', { p_item_id: itemId })) as {
    data: unknown
    error: { message: string } | null
  }
  if (error) {
    for (const reason of ['NOT_PUSHED', 'ROW_PAID', 'ROW_MOVED', 'NOT_FOUND'] as const) {
      if (error.message.includes(reason)) throw new UnpushConflict(reason)
    }
    throw new Error(error.message)
  }
  return typeof data === 'string' && UUID_RE.test(data) ? data : null
}

/** Same members, any order, no duplicates on either side. */
export function sameIdSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const s = new Set(a)
  return s.size === a.length && new Set(b).size === b.length && b.every((id) => s.has(id))
}

export function parseIdList(v: unknown): string[] | null {
  if (!Array.isArray(v) || v.length === 0 || v.length > 500) return null
  if (!v.every((x) => typeof x === 'string' && UUID_RE.test(x))) return null
  return v as string[]
}
