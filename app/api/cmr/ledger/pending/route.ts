import { NextResponse } from 'next/server'
import { getCmrContext, guardCmrController, type CmrAccess } from '@/lib/api/cmr'
import { createServiceClient } from '@/lib/supabase/server'
import {
  CMR_PAYEE_MAX,
  CMR_PENDING_COLS,
  CMR_PENDING_NOTES_MAX,
  checkoffPatch,
  ledgerLabel,
  parseCheckoff,
  parseLedgerCents,
  parseOptionalText,
  parseRequiredText,
  toCmrPendingItem,
  type CmrLedgerAccountRef,
  type CmrPendingRow,
} from '@/lib/cmr/ledger'
import {
  UUID_RE,
  auditor,
  bad,
  ensureLedger,
  isInputViolation,
  ledgerById,
  loadAccounts,
  nextSortOrder,
  parseLedgerKey,
  pendingItemById,
  pendingRows,
  readJson,
  serverError,
  touchLedger,
} from '@/lib/cmr/ledger-server'

/**
 * SN Cash Ledger — pending-in-bank items on a daily ledger, grouped by account. CONTROLLER
 * ONLY (reads come with GET /api/cmr/ledger, which every CMR role may call).
 *
 *   POST   { date, period, accountId, payee, amountCents, notes? }
 *            → add a manual item at the end of its account group; creates the (date, period)
 *              ledger on demand.
 *   PATCH  { id, accountId?, payee?, amountCents?, notes? }  → edit a manual item (changing the
 *              account moves it to the end of that group).
 *   PATCH  { id, status: 'paid' | 'pending' }                → the paid CHECK-OFF: 'paid' stamps
 *              paid_at + paid_by, going back to 'pending' clears them. This is the one write
 *              here that works on ANY item still sitting on its own day — hand-entered,
 *              recurring or placed from a request — because paying is about the money leaving
 *              the bank, not about where the line came from. A pushed item can't be paid: its
 *              forward copy is the live row. A check-off is sent on its own, never mixed with
 *              field edits.
 *   DELETE ?id=…                                             → remove a manual item. If it is a
 *              forward copy (pushed_from_id set), the DB trigger puts the item it was pushed
 *              from back to 'pending' in the same statement — deleting a copy can never strand
 *              its source off every ledger.
 *   (reorder within a group lives at /api/cmr/ledger/pending/reorder;
 *    push-to-another-day lives at /api/cmr/ledger/pending/push)
 *
 * amountCents is POSITIVE — a pending item is money leaving the bank and always reduces the
 * balance. Only an ACTIVE account can be chosen. Only still-pending, hand-entered items can be
 * edited or deleted here. Every change is audited with before → after.
 *
 * NOTE (BUG-019): a route.ts may export only HTTP handlers + route config.
 */

export const dynamic = 'force-dynamic'

type Editable = Pick<CmrPendingRow, 'account_id' | 'payee' | 'amount_cents' | 'notes'>
const ALL: (keyof Editable)[] = ['account_id', 'payee', 'amount_cents', 'notes']

function snapshot(r: Partial<Editable>, accounts: Map<string, CmrLedgerAccountRef>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if ('account_id' in r) {
    out.accountId = r.account_id
    out.accountName = accounts.get(r.account_id as string)?.name ?? null
  }
  if ('payee' in r) out.payee = r.payee
  if ('amount_cents' in r) out.amountCents = r.amount_cents == null ? null : Number(r.amount_cents)
  if ('notes' in r) out.notes = r.notes
  return out
}

const pick = (r: Editable, keys: (keyof Editable)[]): Partial<Editable> => Object.fromEntries(keys.map((k) => [k, r[k]]))

function parseFields(body: Record<string, unknown>, required: boolean): { ok: true; value: Partial<Editable> } | { ok: false; error: string } {
  const out: Partial<Editable> = {}
  if (required || 'accountId' in body) {
    const a = typeof body.accountId === 'string' ? body.accountId.trim() : ''
    if (!UUID_RE.test(a)) return { ok: false, error: 'Choose an account.' }
    out.account_id = a
  }
  if (required || 'payee' in body) {
    const p = parseRequiredText(body.payee, 'Payee', CMR_PAYEE_MAX)
    if (!p.ok) return p
    out.payee = p.value
  }
  if (required || 'amountCents' in body) {
    const c = parseLedgerCents(body.amountCents, 'Amount', { signed: false })
    if (!c.ok) return c
    out.amount_cents = c.value
  }
  if (required || 'notes' in body) {
    const n = parseOptionalText(body.notes, 'Notes', CMR_PENDING_NOTES_MAX, { multiline: true })
    if (!n.ok) return n
    out.notes = n.value
  }
  return { ok: true, value: out }
}

/** Why an item can't be changed here, or null. */
function notEditable(r: CmrPendingRow, verb: 'changed' | 'deleted'): string | null {
  if (r.status !== 'pending') return `That item is already ${r.status} and can’t be ${verb} here.`
  if (r.source !== 'manual') return `That item came from a recurring vendor or a request and can’t be ${verb} here.`
  return null
}

/** The body keys that edit the LINE (as opposed to checking it off). */
const EDITABLE_KEYS = ['accountId', 'payee', 'amountCents', 'notes'] as const

/**
 * PATCH { id, status } — the paid check-off. Separate from the field edit above because it
 * applies to a different set of items (any item still on its own day, whatever its source) and
 * writes a different set of columns (status + the paid stamp, nothing else).
 */
async function checkOff(request: Request, ctx: CmrAccess, id: string, status: unknown): Promise<NextResponse> {
  const next = parseCheckoff(status)
  if (!next.ok) return bad(next.error)

  const supabase = createServiceClient()
  const [accounts, before] = await Promise.all([loadAccounts(supabase), pendingItemById(supabase, id)])
  if (!before) return bad('That pending item does not exist.', 'NOT_FOUND', 404)
  if (before.status === 'pushed') {
    return bad('That item was pushed to another day — check it off there instead.', 'NOT_EDITABLE', 409)
  }
  if (before.status === next.value) {
    return NextResponse.json({ success: true, data: { item: toCmrPendingItem(before, accounts), changed: false } })
  }

  // Compare-and-swap on the status we just read. Push writes this same column from another
  // connection (and under a row lock), so an unguarded update here could pay an item that had
  // already been pushed away — the amount would then count on BOTH days. Matching zero rows
  // means it moved under us: say so and let the screen reload rather than writing anyway.
  const changes = checkoffPatch(before, next.value, ctx.userId, new Date().toISOString())
  const { data: written, error } = await supabase
    .from('cmr_pending_items')
    .update(changes)
    .eq('id', id)
    .eq('status', before.status)
    .select('id')
  if (isInputViolation(error)) return bad(`That change couldn't be saved: ${error?.message ?? 'invalid values'}.`)
  if (error) throw new Error(error.message)
  if (!((written ?? []) as unknown[]).length) {
    return bad('That item changed while you were looking at it — reload and try again.', 'STALE', 409)
  }
  await touchLedger(supabase, before.daily_ledger_id)

  const after: CmrPendingRow = { ...before, ...changes }
  const ledger = await ledgerById(supabase, before.daily_ledger_id)
  const stamp = (r: CmrPendingRow) => ({ status: r.status, paidAt: r.paid_at, paidBy: r.paid_by })
  await auditor(ctx, request)(next.value === 'paid' ? 'cmr.pending.pay' : 'cmr.pending.unpay', 'cmr_pending_items', id, after.payee, {
    ledgerId: before.daily_ledger_id,
    ledgerDate: ledger?.ledger_date ?? null,
    period: ledger?.period ?? null,
    label: ledger ? ledgerLabel(ledger.ledger_date, ledger.period) : null,
    accountId: before.account_id,
    accountName: accounts.get(before.account_id)?.name ?? null,
    amountCents: Number(before.amount_cents),
    before: stamp(before),
    after: stamp(after),
  })

  const names = new Map(after.paid_by === ctx.userId && ctx.displayName ? [[ctx.userId, ctx.displayName]] : [])
  return NextResponse.json({
    success: true,
    data: { item: toCmrPendingItem(after, accounts, undefined, names), changed: true },
  })
}

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
    const fields = parseFields(body, true)
    if (!fields.ok) return bad(fields.error)
    const f = fields.value as Editable
    const { date, period } = key.value

    const supabase = createServiceClient()
    const accounts = await loadAccounts(supabase)
    const account = accounts.get(f.account_id)
    if (!account) return bad('That account does not exist.', 'NOT_FOUND', 404)
    if (!account.active) return bad(`${account.name} is inactive. Choose an active account.`, 'ACCOUNT_INACTIVE', 409)

    const audit = auditor(ctx, request)
    const ledger = await ensureLedger(supabase, date, period, ctx.userId, audit)
    const group = await pendingRows(supabase, ledger.id, f.account_id)

    const insert = {
      ...f,
      daily_ledger_id: ledger.id,
      status: 'pending' as const,
      source: 'manual' as const,
      original_date: date,
      effective_date: date,
      sort_order: nextSortOrder(group),
      created_by: ctx.userId,
    }
    const { data, error } = await supabase.from('cmr_pending_items').insert(insert).select(CMR_PENDING_COLS).single()
    if (isInputViolation(error)) return bad(`That item couldn't be saved: ${error?.message ?? 'invalid values'}.`)
    if (error || !data) throw new Error(error?.message ?? 'Could not add the pending item.')
    const row = data as unknown as CmrPendingRow
    await touchLedger(supabase, ledger.id)

    await audit('cmr.ledger.pending.create', 'cmr_pending_items', row.id, row.payee, {
      ledgerId: ledger.id,
      ledgerDate: date,
      period,
      before: null,
      after: snapshot(row, accounts),
    })

    return NextResponse.json({ success: true, data: { item: toCmrPendingItem(row, accounts) } }, { status: 201 })
  } catch (err) {
    return serverError('/pending', err)
  }
}

export async function PATCH(request: Request): Promise<NextResponse> {
  try {
    const ctx = await getCmrContext()
    if (!ctx.ok) return ctx.response
    const guard = guardCmrController(ctx)
    if (guard) return guard

    const body = await readJson(request)
    if (!body) return bad('Invalid request body.')
    const id = typeof body.id === 'string' ? body.id.trim() : ''
    if (!UUID_RE.test(id)) return bad('Choose a pending item.')

    // ── the paid check-off, on its own ──
    if ('status' in body) {
      if (EDITABLE_KEYS.some((k) => k in body)) {
        return bad('Change the item, or check it off — not both in one request.')
      }
      return checkOff(request, ctx, id, body.status)
    }

    const fields = parseFields(body, false)
    if (!fields.ok) return bad(fields.error)
    if (!Object.keys(fields.value).length) return bad('Nothing to change.')

    const supabase = createServiceClient()
    const [accounts, before] = await Promise.all([loadAccounts(supabase), pendingItemById(supabase, id)])
    if (!before) return bad('That pending item does not exist.', 'NOT_FOUND', 404)
    const locked = notEditable(before, 'changed')
    if (locked) return bad(locked, 'NOT_EDITABLE', 409)

    const changes: Partial<Editable> & { sort_order?: number } = {}
    for (const k of Object.keys(fields.value) as (keyof Editable)[]) {
      const next = fields.value[k]
      const prev = before[k]
      const same = k === 'amount_cents' ? Number(prev) === Number(next) : prev === next
      if (!same) (changes as Record<string, unknown>)[k] = next
    }
    if (!Object.keys(changes).length) {
      return NextResponse.json({ success: true, data: { item: toCmrPendingItem(before, accounts), changed: false } })
    }

    if (changes.account_id !== undefined) {
      const acc = accounts.get(changes.account_id)
      if (!acc) return bad('That account does not exist.', 'NOT_FOUND', 404)
      if (!acc.active) return bad(`${acc.name} is inactive. Choose an active account.`, 'ACCOUNT_INACTIVE', 409)
      // Joins the end of its new account group.
      changes.sort_order = nextSortOrder(await pendingRows(supabase, before.daily_ledger_id, changes.account_id))
    }

    // Still pending when the write lands, or not at all — an edit that raced a push would
    // otherwise change the row that is now history and leave the forward copy stale.
    const { data: written, error } = await supabase
      .from('cmr_pending_items')
      .update(changes)
      .eq('id', id)
      .eq('status', 'pending')
      .select('id')
    if (isInputViolation(error)) return bad(`That change couldn't be saved: ${error?.message ?? 'invalid values'}.`)
    if (error) throw new Error(error.message)
    if (!((written ?? []) as unknown[]).length) {
      return bad('That item changed while you were looking at it — reload and try again.', 'STALE', 409)
    }
    await touchLedger(supabase, before.daily_ledger_id)

    const after: CmrPendingRow = { ...before, ...changes }
    const ledger = await ledgerById(supabase, before.daily_ledger_id)
    const keys = ALL.filter((k) => k in changes)
    await auditor(ctx, request)('cmr.ledger.pending.update', 'cmr_pending_items', id, after.payee, {
      ledgerId: before.daily_ledger_id,
      ledgerDate: ledger?.ledger_date ?? null,
      period: ledger?.period ?? null,
      before: snapshot(pick(before, keys), accounts),
      after: snapshot(pick(after, keys), accounts),
    })

    return NextResponse.json({ success: true, data: { item: toCmrPendingItem(after, accounts), changed: true } })
  } catch (err) {
    return serverError('/pending', err)
  }
}

export async function DELETE(request: Request): Promise<NextResponse> {
  try {
    const ctx = await getCmrContext()
    if (!ctx.ok) return ctx.response
    const guard = guardCmrController(ctx)
    if (guard) return guard

    const id = (new URL(request.url).searchParams.get('id') ?? '').trim()
    if (!UUID_RE.test(id)) return bad('Choose a pending item.')

    const supabase = createServiceClient()
    const [accounts, before] = await Promise.all([loadAccounts(supabase), pendingItemById(supabase, id)])
    if (!before) return bad('That pending item does not exist.', 'NOT_FOUND', 404)
    const locked = notEditable(before, 'deleted')
    if (locked) return bad(locked, 'NOT_EDITABLE', 409)

    const { error } = await supabase.from('cmr_pending_items').delete().eq('id', id)
    if (error) throw new Error(error.message)
    await touchLedger(supabase, before.daily_ledger_id)

    // Deleting a FORWARD COPY revives the item it was pushed from: the cmr_pending_items AFTER
    // DELETE trigger puts that source back to 'pending' in the same statement, so the amount
    // can never end up on no ledger at all. Nothing to do here but keep the source's day
    // honest — its total just changed — and record it.
    let revivedSourceId: string | null = null
    if (before.pushed_from_id) {
      const source = await pendingItemById(supabase, before.pushed_from_id)
      if (source) {
        revivedSourceId = source.id
        if (source.daily_ledger_id !== before.daily_ledger_id) await touchLedger(supabase, source.daily_ledger_id)
      }
    }

    const ledger = await ledgerById(supabase, before.daily_ledger_id)
    await auditor(ctx, request)('cmr.ledger.pending.delete', 'cmr_pending_items', id, before.payee, {
      ledgerId: before.daily_ledger_id,
      ledgerDate: ledger?.ledger_date ?? null,
      period: ledger?.period ?? null,
      label: ledger ? ledgerLabel(ledger.ledger_date, ledger.period) : null,
      pushedFromId: before.pushed_from_id,
      revivedSourceId,
      before: snapshot(pick(before, ALL), accounts),
      after: null,
    })

    return NextResponse.json({ success: true, data: { deleted: true, revivedSourceId } })
  } catch (err) {
    return serverError('/pending', err)
  }
}
