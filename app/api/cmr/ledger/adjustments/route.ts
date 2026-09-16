import { NextResponse } from 'next/server'
import { getCmrContext, guardCmrController } from '@/lib/api/cmr'
import { createServiceClient } from '@/lib/supabase/server'
import {
  CMR_ADJ_DESCRIPTION_MAX,
  CMR_ADJ_NOTE_MAX,
  CMR_ADJ_WARN_MAX,
  CMR_ADJUSTMENT_COLS,
  ledgerLabel,
  parseLedgerCents,
  parseOptionalText,
  parseRequiredText,
  toCmrAdjustment,
  type CmrAdjustmentRow,
} from '@/lib/cmr/ledger'
import {
  UUID_RE,
  adjustmentRows,
  auditor,
  bad,
  ensureLedger,
  isInputViolation,
  ledgerById,
  nextSortOrder,
  parseLedgerKey,
  readJson,
  serverError,
  touchLedger,
  type Supabase,
} from '@/lib/cmr/ledger-server'

/**
 * SN Cash Ledger — adjustment lines on a daily ledger. CONTROLLER ONLY (reads come with
 * GET /api/cmr/ledger, which every CMR role may call).
 *
 *   POST   { date, period, description, amountCents, note?, warnNote? }
 *            → add a line at the end; creates the (date, period) ledger on demand.
 *   PATCH  { id, description?, amountCents?, note?, warnNote? }  → edit a line.
 *   DELETE ?id=…                                                 → remove a line.
 *   (reorder lives at /api/cmr/ledger/adjustments/reorder)
 *
 * amountCents is SIGNED (+ adds to the balance, − takes away). Only kind='manual' lines are
 * written or editable — the pending roll-up is derived, never stored. Every change is audited
 * with before → after.
 *
 * NOTE (BUG-019): a route.ts may export only HTTP handlers + route config.
 */

export const dynamic = 'force-dynamic'

type Editable = Pick<CmrAdjustmentRow, 'description' | 'amount_cents' | 'note' | 'warn_note'>

function snapshot(r: Partial<Editable>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if ('description' in r) out.description = r.description
  if ('amount_cents' in r) out.amountCents = r.amount_cents == null ? null : Number(r.amount_cents)
  if ('note' in r) out.note = r.note
  if ('warn_note' in r) out.warnNote = r.warn_note
  return out
}

const ALL: (keyof Editable)[] = ['description', 'amount_cents', 'note', 'warn_note']
const pick = (r: Editable, keys: (keyof Editable)[]): Partial<Editable> => Object.fromEntries(keys.map((k) => [k, r[k]]))

async function adjustmentById(supabase: Supabase, id: string): Promise<CmrAdjustmentRow | null> {
  const { data, error } = await supabase.from('cmr_ledger_adjustments').select(CMR_ADJUSTMENT_COLS).eq('id', id).maybeSingle()
  if (error) throw new Error(error.message)
  return (data as unknown as CmrAdjustmentRow | null) ?? null
}

/** Parse whichever editable fields are present. `required` = POST (description + amount). */
function parseFields(body: Record<string, unknown>, required: boolean): { ok: true; value: Partial<Editable> } | { ok: false; error: string } {
  const out: Partial<Editable> = {}
  if (required || 'description' in body) {
    const d = parseRequiredText(body.description, 'Description', CMR_ADJ_DESCRIPTION_MAX)
    if (!d.ok) return d
    out.description = d.value
  }
  if (required || 'amountCents' in body) {
    const a = parseLedgerCents(body.amountCents, 'Amount', { signed: true })
    if (!a.ok) return a
    out.amount_cents = a.value
  }
  if (required || 'note' in body) {
    const n = parseOptionalText(body.note, 'Note', CMR_ADJ_NOTE_MAX, { multiline: true })
    if (!n.ok) return n
    out.note = n.value
  }
  if (required || 'warnNote' in body) {
    const w = parseOptionalText(body.warnNote, 'Warn note', CMR_ADJ_WARN_MAX)
    if (!w.ok) return w
    out.warn_note = w.value
  }
  return { ok: true, value: out }
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
    const { date, period } = key.value

    const supabase = createServiceClient()
    const audit = auditor(ctx, request)
    const ledger = await ensureLedger(supabase, date, period, ctx.userId, audit)
    const existing = await adjustmentRows(supabase, ledger.id)

    const insert = {
      ...(fields.value as Editable),
      daily_ledger_id: ledger.id,
      kind: 'manual' as const,
      sort_order: nextSortOrder(existing),
      created_by: ctx.userId,
    }
    const { data, error } = await supabase.from('cmr_ledger_adjustments').insert(insert).select(CMR_ADJUSTMENT_COLS).single()
    if (isInputViolation(error)) return bad(`That line couldn't be saved: ${error?.message ?? 'invalid values'}.`)
    if (error || !data) throw new Error(error?.message ?? 'Could not add the line.')
    const row = data as unknown as CmrAdjustmentRow
    await touchLedger(supabase, ledger.id)

    await audit('cmr.ledger.adjustment.create', 'cmr_ledger_adjustments', row.id, row.description, {
      ledgerId: ledger.id,
      ledgerDate: date,
      period,
      before: null,
      after: snapshot(row),
    })

    return NextResponse.json({ success: true, data: { adjustment: toCmrAdjustment(row) } }, { status: 201 })
  } catch (err) {
    return serverError('/adjustments', err)
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
    if (!UUID_RE.test(id)) return bad('Choose a line.')
    const fields = parseFields(body, false)
    if (!fields.ok) return bad(fields.error)
    if (!Object.keys(fields.value).length) return bad('Nothing to change.')

    const supabase = createServiceClient()
    const before = await adjustmentById(supabase, id)
    if (!before) return bad('That line does not exist.', 'NOT_FOUND', 404)
    if (before.kind !== 'manual') return bad('That line is calculated automatically and can’t be edited.', 'LOCKED', 409)

    const changes: Partial<Editable> = {}
    for (const k of Object.keys(fields.value) as (keyof Editable)[]) {
      const next = fields.value[k]
      const prev = before[k]
      const same = k === 'amount_cents' ? Number(prev) === Number(next) : prev === next
      if (!same) (changes as Record<string, unknown>)[k] = next
    }
    if (!Object.keys(changes).length) {
      return NextResponse.json({ success: true, data: { adjustment: toCmrAdjustment(before), changed: false } })
    }

    const { error } = await supabase.from('cmr_ledger_adjustments').update(changes).eq('id', id)
    if (isInputViolation(error)) return bad(`That change couldn't be saved: ${error?.message ?? 'invalid values'}.`)
    if (error) throw new Error(error.message)
    await touchLedger(supabase, before.daily_ledger_id)

    const after: CmrAdjustmentRow = { ...before, ...changes }
    const ledger = await ledgerById(supabase, before.daily_ledger_id)
    const keys = Object.keys(changes) as (keyof Editable)[]
    await auditor(ctx, request)('cmr.ledger.adjustment.update', 'cmr_ledger_adjustments', id, after.description, {
      ledgerId: before.daily_ledger_id,
      ledgerDate: ledger?.ledger_date ?? null,
      period: ledger?.period ?? null,
      before: snapshot(pick(before, keys)),
      after: snapshot(pick(after, keys)),
    })

    return NextResponse.json({ success: true, data: { adjustment: toCmrAdjustment(after), changed: true } })
  } catch (err) {
    return serverError('/adjustments', err)
  }
}

export async function DELETE(request: Request): Promise<NextResponse> {
  try {
    const ctx = await getCmrContext()
    if (!ctx.ok) return ctx.response
    const guard = guardCmrController(ctx)
    if (guard) return guard

    const id = (new URL(request.url).searchParams.get('id') ?? '').trim()
    if (!UUID_RE.test(id)) return bad('Choose a line.')

    const supabase = createServiceClient()
    const before = await adjustmentById(supabase, id)
    if (!before) return bad('That line does not exist.', 'NOT_FOUND', 404)
    if (before.kind !== 'manual') return bad('That line is calculated automatically and can’t be deleted.', 'LOCKED', 409)

    const { error } = await supabase.from('cmr_ledger_adjustments').delete().eq('id', id)
    if (error) throw new Error(error.message)
    await touchLedger(supabase, before.daily_ledger_id)

    const ledger = await ledgerById(supabase, before.daily_ledger_id)
    await auditor(ctx, request)('cmr.ledger.adjustment.delete', 'cmr_ledger_adjustments', id, before.description, {
      ledgerId: before.daily_ledger_id,
      ledgerDate: ledger?.ledger_date ?? null,
      period: ledger?.period ?? null,
      label: ledger ? ledgerLabel(ledger.ledger_date, ledger.period) : null,
      before: snapshot(pick(before, ALL)),
      after: null,
    })

    return NextResponse.json({ success: true, data: { deleted: true } })
  } catch (err) {
    return serverError('/adjustments', err)
  }
}
