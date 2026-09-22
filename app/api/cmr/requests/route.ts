import { NextResponse } from 'next/server'
import { getCmrContext, guardCmr, guardCmrCanRequest } from '@/lib/api/cmr'
import { createServiceClient } from '@/lib/supabase/server'
import { loadAccounts } from '@/lib/cmr/ledger-server'
import { currentApLines } from '@/lib/cmr/ap-server'
import {
  CMR_REQUEST_COLS,
  composeFromAp,
  composeRefusalMessage,
  modifyRefusal,
  parseApLineIds,
  parseApVendorName,
  requestVendorLabel,
  type CmrRequestAccountRef,
  parseRequestAmount,
  parseRequestDueDate,
  parseRequestNotes,
  parseVendor,
  toCmrRequest,
  type CmrRequestRow,
} from '@/lib/cmr/requests'
import {
  ComposeRefused,
  UUID_RE,
  auditInvoices,
  auditor,
  bad,
  buildRequestsView,
  composeRequest,
  requestInvoicesFor,
  type Supabase,
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
 *   POST   { accountId, vendorName, apLineIds: [...], dueDate?, notes? }            (AP Phase 2)
 *                      → submit, COMPOSED FROM A/P. CONTROLLER or REQUESTER (a Viewer is
 *                        refused). The server re-reads the account's CURRENT A/P, keeps the
 *                        ticked payable lines of that vendor (any id that isn't one refuses the
 *                        whole request), sets amount = Σ bills − Σ credits and snapshots the
 *                        lines into cmr_vendor_request_invoices — all in ONE database call
 *                        (cmr_compose_vendor_request). An amountCents / vendor in the body is
 *                        ignored. requested_by is ALWAYS the authenticated caller.
 *   POST   { accountId, vendor, amountCents?, dueDate?, notes? }
 *                      → a hand-entered request — CONTROLLER ONLY (so A/P never blocks them).
 *                        A Requester gets 400 AP_REQUIRED: their requests come from A/P.
 *   PATCH  { id, accountId?, vendorName, apLineIds, dueDate?, notes? }
 *                      → re-compose a queued request from A/P (same rules as submit; its
 *                        snapshot is replaced).
 *   PATCH  { id, dueDate?, notes? }
 *                      → edit the note / needed-by date only (amount untouched).
 *   PATCH  { id, accountId?, vendor?, amountCents? }
 *                      → hand edit — Controller only, and only on a hand-entered request; one
 *                        built from invoices changes only by re-picking them (409 AP_COMPOSED).
 *                      Every PATCH: CONTROLLER or REQUESTER, and then only a request that is
 *                      still QUEUED — a Requester's OWN queued request, a Controller's any
 *                      queued one. This endpoint never touches status or the placement fields.
 *   DELETE ?id=        → withdraw (hard delete, audited; its invoice snapshot goes with it).
 *                        Same rule as PATCH.
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

type Compose = { accountId: string; vendorName: string; apLineIds: string[]; dueDate: string | null; notes: string | null }

/** The A/P-composed payload. Amounts are never read from it. */
function parseCompose(body: Record<string, unknown>): { ok: true; value: Compose } | { ok: false; error: string } {
  const a = typeof body.accountId === 'string' ? body.accountId.trim() : ''
  if (!UUID_RE.test(a)) return { ok: false, error: 'Choose an account.' }
  const v = parseApVendorName(body.vendorName)
  if (!v.ok) return v
  const ids = parseApLineIds(body.apLineIds)
  if (!ids.ok) return ids
  const d = parseRequestDueDate(body.dueDate)
  if (!d.ok) return d
  const n = parseRequestNotes(body.notes)
  if (!n.ok) return n
  return { ok: true, value: { accountId: a, vendorName: v.value, apLineIds: ids.value, dueDate: d.value, notes: n.value } }
}

const apRequired = (): NextResponse =>
  bad(
    'Requests are built from the account’s A/P: choose the vendor and tick the invoices to pay. The amount comes from them.',
    'AP_REQUIRED',
    400,
  )

/**
 * A friendly pre-check against the account's CURRENT A/P, so the caller hears WHICH problem it
 * is before anything is written. cmr_compose_vendor_request applies the same rule again with the
 * account locked — that call is what decides.
 */
async function precheck(supabase: Supabase, account: CmrRequestAccountRef, c: Compose): Promise<NextResponse | null> {
  const current = await currentApLines(supabase, [account.id], { vendorName: c.vendorName })
  const r = composeFromAp(current, c)
  if (r.ok) return null
  const status = r.code === 'STALE_LINES' ? 409 : 400
  return bad(composeRefusalMessage(r.code, { accountName: account.name, staleCount: r.staleIds.length }), r.code, status)
}

function composeConflict(e: ComposeRefused, account: CmrRequestAccountRef): NextResponse {
  switch (e.reason) {
    case 'NOT_FOUND':
      return bad('That request or account no longer exists.', 'NOT_FOUND', 404)
    case 'INACTIVE':
      return bad(`${account.name} is inactive. Choose an active account.`, 'ACCOUNT_INACTIVE', 409)
    case 'NOT_QUEUED':
      return bad('That request was already placed or declined and can’t be changed.', 'NOT_EDITABLE', 409)
    case 'FORBIDDEN':
      return bad('You can only change your own requests.', 'FORBIDDEN', 403)
    case 'STALE_LINES':
      return bad(composeRefusalMessage('STALE_LINES', { accountName: account.name }), 'STALE_LINES', 409)
    default:
      return bad(composeRefusalMessage(e.reason), e.reason, 400)
  }
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
    // ── composed from A/P (every Requester request, and the Controller's default) ──
    if ('apLineIds' in body || 'vendorName' in body) {
      const compose = parseCompose(body)
      if (!compose.ok) return bad(compose.error)
      const supabase = createServiceClient()
      const accounts = await loadAccounts(supabase)
      const account = accounts.get(compose.value.accountId)
      if (!account) return bad('That account does not exist.', 'NOT_FOUND', 404)
      if (!account.active) return bad(`${account.name} is inactive. Choose an active account.`, 'ACCOUNT_INACTIVE', 409)

      const pre = await precheck(supabase, account, compose.value)
      if (pre) return pre

      let id: string
      try {
        id = await composeRequest(supabase, {
          requestId: null,
          actor: ctx.userId,
          owner: null,
          accountId: account.id,
          vendorName: compose.value.vendorName,
          vendor: requestVendorLabel(compose.value.vendorName),
          apLineIds: compose.value.apLineIds,
          dueDate: compose.value.dueDate,
          notes: compose.value.notes,
        })
      } catch (e) {
        if (e instanceof ComposeRefused) return composeConflict(e, account)
        throw e
      }

      const row = await requestById(supabase, id)
      if (!row) throw new Error('The submitted request could not be read back.')
      const invoices = (await requestInvoicesFor(supabase, [row])).get(id) ?? []

      await auditor(ctx, request)('cmr.request.submit', row.id, row.vendor, {
        before: null,
        after: snapshot(pick(row, ALL_KEYS), accounts),
        fromAp: true,
        accountName: account.name,
        vendorName: compose.value.vendorName,
        lineCount: invoices.length,
        totalCents: Number(row.amount_cents),
        invoices: auditInvoices(invoices),
      })

      const names = new Map(ctx.displayName ? [[ctx.userId, ctx.displayName]] : [])
      return NextResponse.json({ success: true, data: { request: toCmrRequest(row, accounts, names, undefined, invoices) } }, { status: 201 })
    }

    // ── hand-entered (Controller only) ──
    if (ctx.role !== 'controller') return apRequired()

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

    // ── re-compose from A/P ──
    if ('apLineIds' in body || 'vendorName' in body) {
      const supabase = createServiceClient()
      const [accounts, before] = await Promise.all([loadAccounts(supabase), requestById(supabase, id)])
      if (!before) return bad('That request does not exist.', 'NOT_FOUND', 404)
      const refusal = modifyRefusal(before, ctx)
      if (refusal) return bad(refusal.error, refusal.code, refusal.status)

      // Unsent note / date / account keep their current values.
      const compose = parseCompose({
        accountId: before.account_id,
        dueDate: before.due_date,
        notes: before.notes,
        ...body,
      })
      if (!compose.ok) return bad(compose.error)
      const account = accounts.get(compose.value.accountId)
      if (!account) return bad('That account does not exist.', 'NOT_FOUND', 404)
      if (!account.active) return bad(`${account.name} is inactive. Choose an active account.`, 'ACCOUNT_INACTIVE', 409)

      const pre = await precheck(supabase, account, compose.value)
      if (pre) return pre

      const beforeInvoices = (await requestInvoicesFor(supabase, [before])).get(id) ?? []
      try {
        await composeRequest(supabase, {
          requestId: id,
          actor: ctx.userId,
          // The DB re-checks, with the row locked, that a Requester edits only their own.
          owner: ctx.role === 'controller' ? null : ctx.userId,
          accountId: account.id,
          vendorName: compose.value.vendorName,
          vendor: requestVendorLabel(compose.value.vendorName),
          apLineIds: compose.value.apLineIds,
          dueDate: compose.value.dueDate,
          notes: compose.value.notes,
        })
      } catch (e) {
        if (e instanceof ComposeRefused) return composeConflict(e, account)
        throw e
      }

      const after = await requestById(supabase, id)
      if (!after) return bad('That request does not exist.', 'NOT_FOUND', 404)
      const invoices = (await requestInvoicesFor(supabase, [after])).get(id) ?? []

      await auditor(ctx, request)('cmr.request.update', id, after.vendor, {
        requestedBy: before.requested_by,
        recomposed: true,
        before: { ...snapshot(pick(before, FIELD_KEYS), accounts), invoices: auditInvoices(beforeInvoices) },
        after: { ...snapshot(pick(after, FIELD_KEYS), accounts), invoices: auditInvoices(invoices) },
        lineCount: invoices.length,
        totalCents: Number(after.amount_cents),
      })

      return NextResponse.json({ success: true, data: { request: toCmrRequest(after, accounts, undefined, undefined, invoices), changed: true } })
    }

    const fields = parseFields(body, false)
    if (!fields.ok) return bad(fields.error)
    if (!Object.keys(fields.value).length) return bad('Nothing to change.')

    const supabase = createServiceClient()
    const [accounts, before] = await Promise.all([loadAccounts(supabase), requestById(supabase, id)])
    if (!before) return bad('That request does not exist.', 'NOT_FOUND', 404)

    // Own row + still queued (Controller: any queued row). Enforced HERE, not just in the UI.
    const refusal = modifyRefusal(before, ctx)
    if (refusal) return bad(refusal.error, refusal.code, refusal.status)

    // Vendor, amount and account are hand edits: a Requester's requests come from A/P, and a
    // request built from invoices changes those only by re-picking them. Note + date are free.
    const handEdit = ['account_id', 'vendor', 'amount_cents'].some((k) => k in fields.value)
    const invoicesNow = (await requestInvoicesFor(supabase, [before])).get(id) ?? []
    if (handEdit) {
      if (ctx.role !== 'controller') return apRequired()
      if (invoicesNow.length) {
        return bad(
          'This request is built from A/P invoices — its vendor, account and amount change only by re-picking the invoices.',
          'AP_COMPOSED',
          409,
        )
      }
    }

    const changes: Partial<Editable> = {}
    for (const k of Object.keys(fields.value) as (keyof Editable)[]) {
      const next = fields.value[k]
      const prev = before[k]
      const same = k === 'amount_cents' ? Number(prev) === Number(next) : prev === next
      if (!same) (changes as Record<string, unknown>)[k] = next
    }
    if (!Object.keys(changes).length) {
      return NextResponse.json({ success: true, data: { request: toCmrRequest(before, accounts, undefined, undefined, invoicesNow), changed: false } })
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

    return NextResponse.json({ success: true, data: { request: toCmrRequest(after, accounts, undefined, undefined, invoicesNow), changed: true } })
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

    const invoices = (await requestInvoicesFor(supabase, [before])).get(id) ?? []
    // Its invoice snapshot goes with it (ON DELETE CASCADE).
    const { error } = await supabase.from('cmr_vendor_requests').delete().eq('id', id)
    if (error) throw new Error(error.message)

    // The row is gone — this entry is the only record the request ever existed.
    await auditor(ctx, request)('cmr.request.withdraw', id, before.vendor, {
      requestedBy: before.requested_by,
      before: invoices.length
        ? { ...snapshot(pick(before, ALL_KEYS), accounts), invoices: auditInvoices(invoices) }
        : snapshot(pick(before, ALL_KEYS), accounts),
      after: null,
    })

    return NextResponse.json({ success: true, data: { deleted: true } })
  } catch (err) {
    return serverError('', err)
  }
}
