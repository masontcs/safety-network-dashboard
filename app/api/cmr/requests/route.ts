import { NextResponse } from 'next/server'
import { getCmrContext, guardCmr, guardCmrCanRequest } from '@/lib/api/cmr'
import { createServiceClient } from '@/lib/supabase/server'
import { loadAccounts } from '@/lib/cmr/ledger-server'
import {
  CMR_REQUEST_COLS,
  modifyRefusal,
  parseRequestAmount,
  parseRequestDueDate,
  parseRequestNotes,
  parseVendor,
  toCmrRequest,
  type CmrRequestRow,
} from '@/lib/cmr/requests'
import {
  UUID_RE,
  auditor,
  bad,
  buildRequestsView,
  isInputViolation,
  pick,
  readJson,
  requestById,
  serverError,
  snapshot,
} from '@/lib/cmr/requests-server'

/**
 * SN Cash Ledger — the vendor request inbox.
 *
 *   GET                → the whole queue + settled history, totals, accounts, and the caller's
 *                        own id with `canEdit` (Controller) / `canRequest` (Controller or
 *                        Requester). ANY CMR role reads everything.
 *   POST   { accountId, vendor, amountCents?, dueDate?, notes? }
 *                      → submit. CONTROLLER or REQUESTER (a Viewer is refused). requested_by is
 *                        ALWAYS the authenticated caller — a requestedBy in the body is ignored.
 *                        The account must exist and be active.
 *   PATCH  { id, accountId?, vendor?, amountCents?, dueDate?, notes? }
 *                      → edit. CONTROLLER or REQUESTER, and then only a request that is still
 *                        QUEUED — a Requester's OWN queued request, a Controller's any queued
 *                        one. This endpoint never touches status or the placement fields.
 *   DELETE ?id=        → withdraw (hard delete, audited). Same rule as PATCH.
 *
 *   (Placing and declining are Controller-only and live at /api/cmr/requests/place and
 *    /api/cmr/requests/decline.)
 *
 * Every mutation is written to audit_logs with before → after. A withdrawn request is deleted,
 * so its audit entry is the only record it ever existed.
 *
 * NOTE (BUG-019): a route.ts may export only HTTP handlers + route config — helpers live in
 * lib/cmr/requests-server.
 */

// Never statically render or cache a response from this route.
export const dynamic = 'force-dynamic'

type Row = CmrRequestRow
type Editable = Pick<Row, 'account_id' | 'vendor' | 'amount_cents' | 'due_date' | 'notes'>

const FIELD_KEYS = ['account_id', 'vendor', 'amount_cents', 'due_date', 'notes'] as const
const ALL_KEYS = [
  'requested_by',
  'account_id',
  'vendor',
  'amount_cents',
  'due_date',
  'notes',
  'status',
  'placed_kind',
  'placed_ref_id',
  'placed_at',
  'placed_by',
] as const

/** Fields nobody sets through this endpoint — status and placement move only via place/decline. */
const RESERVED = ['status', 'placedKind', 'placedRefId', 'placedAt', 'placedBy'] as const

function parseFields(
  body: Record<string, unknown>,
  required: boolean,
): { ok: true; value: Partial<Editable> } | { ok: false; error: string } {
  const out: Partial<Editable> = {}
  if (required || 'accountId' in body) {
    const a = typeof body.accountId === 'string' ? body.accountId.trim() : ''
    if (!UUID_RE.test(a)) return { ok: false, error: 'Choose an account.' }
    out.account_id = a
  }
  if (required || 'vendor' in body) {
    const v = parseVendor(body.vendor)
    if (!v.ok) return v
    out.vendor = v.value
  }
  if (required || 'amountCents' in body) {
    const c = parseRequestAmount(body.amountCents)
    if (!c.ok) return c
    out.amount_cents = c.value
  }
  if (required || 'dueDate' in body) {
    const d = parseRequestDueDate(body.dueDate)
    if (!d.ok) return d
    out.due_date = d.value
  }
  if (required || 'notes' in body) {
    const n = parseRequestNotes(body.notes)
    if (!n.ok) return n
    out.notes = n.value
  }
  return { ok: true, value: out }
}

export async function GET(): Promise<NextResponse> {
  try {
    const ctx = await getCmrContext()
    if (!ctx.ok) return ctx.response
    const guard = guardCmr(ctx)
    if (guard) return guard

    const view = await buildRequestsView(createServiceClient(), {
      userId: ctx.userId,
      canEdit: ctx.role === 'controller',
      canRequest: ctx.role === 'controller' || ctx.role === 'requester',
    })
    return NextResponse.json({ success: true, data: view })
  } catch (err) {
    return serverError('', err)
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const ctx = await getCmrContext()
    if (!ctx.ok) return ctx.response
    // The ONE place a non-Controller may write. A Viewer gets 403 here.
    const guard = guardCmrCanRequest(ctx)
    if (guard) return guard

    const body = await readJson(request)
    if (!body) return bad('Invalid request body.')
    for (const k of RESERVED) {
      if (k in body) return bad('A new request always starts queued. The Controller places or declines it.')
    }
    const fields = parseFields(body, true)
    if (!fields.ok) return bad(fields.error)
    const f = fields.value as Editable

    const supabase = createServiceClient()
    const accounts = await loadAccounts(supabase)
    const account = accounts.get(f.account_id)
    if (!account) return bad('That account does not exist.', 'NOT_FOUND', 404)
    if (!account.active) return bad(`${account.name} is inactive. Choose an active account.`, 'ACCOUNT_INACTIVE', 409)

    // requested_by is the authenticated caller, full stop — a requestedBy in the body never
    // reaches the insert, so a Requester can't file a request in someone else's name.
    const insert = { ...f, requested_by: ctx.userId, status: 'queued' as const }
    const { data, error } = await supabase.from('cmr_vendor_requests').insert(insert).select(CMR_REQUEST_COLS).single()
    if (isInputViolation(error)) return bad(`That request couldn't be saved: ${error?.message ?? 'invalid values'}.`)
    if (error || !data) throw new Error(error?.message ?? 'Could not submit the request.')
    const row = data as unknown as Row

    await auditor(ctx, request)('cmr.request.submit', row.id, row.vendor, {
      before: null,
      after: snapshot(pick(row, ALL_KEYS), accounts),
    })

    const names = new Map(ctx.displayName ? [[ctx.userId, ctx.displayName]] : [])
    return NextResponse.json({ success: true, data: { request: toCmrRequest(row, accounts, names) } }, { status: 201 })
  } catch (err) {
    return serverError('', err)
  }
}

export async function PATCH(request: Request): Promise<NextResponse> {
  try {
    const ctx = await getCmrContext()
    if (!ctx.ok) return ctx.response
    const guard = guardCmrCanRequest(ctx)
    if (guard) return guard

    const body = await readJson(request)
    if (!body) return bad('Invalid request body.')
    const id = typeof body.id === 'string' ? body.id.trim() : ''
    if (!UUID_RE.test(id)) return bad('Choose a request.')
    for (const k of RESERVED) {
      if (k in body) {
        return bad('Placing or declining a request is a separate action.', 'NOT_ALLOWED_HERE', 400)
      }
    }
    if ('requestedBy' in body) return bad('A request always stays with the person who submitted it.', 'NOT_ALLOWED_HERE', 400)

    const fields = parseFields(body, false)
    if (!fields.ok) return bad(fields.error)
    if (!Object.keys(fields.value).length) return bad('Nothing to change.')

    const supabase = createServiceClient()
    const [accounts, before] = await Promise.all([loadAccounts(supabase), requestById(supabase, id)])
    if (!before) return bad('That request does not exist.', 'NOT_FOUND', 404)

    // Own row + still queued (Controller: any queued row). Enforced HERE, not just in the UI.
    const refusal = modifyRefusal(before, ctx)
    if (refusal) return bad(refusal.error, refusal.code, refusal.status)

    const changes: Partial<Editable> = {}
    for (const k of Object.keys(fields.value) as (keyof Editable)[]) {
      const next = fields.value[k]
      const prev = before[k]
      const same = k === 'amount_cents' ? Number(prev) === Number(next) : prev === next
      if (!same) (changes as Record<string, unknown>)[k] = next
    }
    if (!Object.keys(changes).length) {
      return NextResponse.json({ success: true, data: { request: toCmrRequest(before, accounts), changed: false } })
    }

    if (changes.account_id !== undefined) {
      const acc = accounts.get(changes.account_id)
      if (!acc) return bad('That account does not exist.', 'NOT_FOUND', 404)
      if (!acc.active) return bad(`${acc.name} is inactive. Choose an active account.`, 'ACCOUNT_INACTIVE', 409)
    }

    const { error } = await supabase.from('cmr_vendor_requests').update(changes).eq('id', id)
    if (isInputViolation(error)) return bad(`That change couldn't be saved: ${error?.message ?? 'invalid values'}.`)
    if (error) throw new Error(error.message)
    const after: Row = { ...before, ...changes }

    const keys = FIELD_KEYS.filter((k) => k in changes)
    await auditor(ctx, request)('cmr.request.update', id, after.vendor, {
      requestedBy: before.requested_by,
      before: snapshot(pick(before, keys), accounts),
      after: snapshot(pick(after, keys), accounts),
    })

    return NextResponse.json({ success: true, data: { request: toCmrRequest(after, accounts), changed: true } })
  } catch (err) {
    return serverError('', err)
  }
}

export async function DELETE(request: Request): Promise<NextResponse> {
  try {
    const ctx = await getCmrContext()
    if (!ctx.ok) return ctx.response
    const guard = guardCmrCanRequest(ctx)
    if (guard) return guard

    const id = (new URL(request.url).searchParams.get('id') ?? '').trim()
    if (!UUID_RE.test(id)) return bad('Choose a request.')

    const supabase = createServiceClient()
    const [accounts, before] = await Promise.all([loadAccounts(supabase), requestById(supabase, id)])
    if (!before) return bad('That request does not exist.', 'NOT_FOUND', 404)

    const refusal = modifyRefusal(before, ctx)
    if (refusal) return bad(refusal.error, refusal.code, refusal.status)

    const { error } = await supabase.from('cmr_vendor_requests').delete().eq('id', id)
    if (error) throw new Error(error.message)

    // The row is gone — this entry is the only record the request ever existed.
    await auditor(ctx, request)('cmr.request.withdraw', id, before.vendor, {
      requestedBy: before.requested_by,
      before: snapshot(pick(before, ALL_KEYS), accounts),
      after: null,
    })

    return NextResponse.json({ success: true, data: { deleted: true } })
  } catch (err) {
    return serverError('', err)
  }
}
