import { NextResponse } from 'next/server'
import { getCmrContext, guardCmr, guardCmrController } from '@/lib/api/cmr'
import { createServiceClient } from '@/lib/supabase/server'
import type { AuditAction } from '@/lib/audit/log'
import { thisWeekStart } from '@/lib/cmr/week'
import {
  CMR_PRIORITY_COLS,
  parseDescription,
  parseDueDate,
  parsePriorityAmount,
  parsePriorityNotes,
  parseWeek,
  parseWritableStatus,
  statusPatch,
  toCmrPriority,
  type CmrPriorityRow,
} from '@/lib/cmr/priorities'
import {
  UUID_RE,
  auditor,
  bad,
  buildPrioritiesView,
  isInputViolation,
  nextSortOrder,
  pick,
  priorityById,
  readJson,
  serverError,
  snapshot,
  weekRows,
} from '@/lib/cmr/priorities-server'

/**
 * SN Cash Ledger — weekly priorities (one Sunday → Saturday week at a time).
 *
 *   GET    ?week=YYYY-MM-DD  → that week's priorities in order + totals (needed = Σ open,
 *          (any day; default    paid/resolved, total, counts), the resolved weekStart, and
 *           this week, Pacific) `canEdit`. ANY CMR role.
 *   POST   { weekStart|date, description, amountCents?, dueDate?, notes?, isTopPriority? }
 *                            → create at the end of that week. CONTROLLER.
 *   PATCH  { id, ...fields, isTopPriority?, status? }
 *                            → edit / flag / resolve / pay / reopen. → paid stamps paid_at +
 *                              paid_by; leaving paid clears them. status 'carried' is refused
 *                              (carry-forward is Phase 6). CONTROLLER.
 *   DELETE ?id=              → hard delete. CONTROLLER.
 *   (reorder lives at /api/cmr/priorities/reorder)
 *
 * Every mutation is written to audit_logs with before → after.
 *
 * NOTE (BUG-019): a route.ts may export only HTTP handlers + route config — helpers live in
 * lib/cmr/priorities-server.
 */

// Never statically render or cache a response from this route.
export const dynamic = 'force-dynamic'

type Row = CmrPriorityRow
type Editable = Pick<Row, 'description' | 'amount_cents' | 'due_date' | 'notes' | 'is_top_priority'>

const FIELD_KEYS = ['description', 'amount_cents', 'due_date', 'notes'] as const
const STATUS_KEYS = ['status', 'paid_at', 'paid_by'] as const
const ALL_KEYS = ['week_start', 'description', 'amount_cents', 'due_date', 'notes', 'is_top_priority', 'status', 'paid_at', 'paid_by', 'sort_order'] as const

const STATUS_ACTION: Record<'open' | 'resolved' | 'paid', AuditAction> = {
  open: 'cmr.priority.reopen',
  resolved: 'cmr.priority.resolve',
  paid: 'cmr.priority.pay',
}

const LOCKED = 'This priority was carried to another week and can’t be changed here.'

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const ctx = await getCmrContext()
    if (!ctx.ok) return ctx.response
    const guard = guardCmr(ctx)
    if (guard) return guard

    const raw = new URL(request.url).searchParams.get('week')
    const week = raw ? parseWeek(raw) : { ok: true as const, value: thisWeekStart() }
    if (!week.ok) return bad(week.error)

    const view = await buildPrioritiesView(createServiceClient(), week.value, ctx.role === 'controller')
    return NextResponse.json({ success: true, data: view })
  } catch (err) {
    return serverError('', err)
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const ctx = await getCmrContext()
    if (!ctx.ok) return ctx.response
    const guard = guardCmrController(ctx)
    if (guard) return guard

    const body = await readJson(request)
    if (!body) return bad('Invalid request body.')
    if ('status' in body || 'carriedFromId' in body) {
      return bad('A new priority always starts open. Set its status after it is added.')
    }
    const week = parseWeek(body.weekStart ?? body.date)
    if (!week.ok) return bad(week.error)
    const description = parseDescription(body.description)
    if (!description.ok) return bad(description.error)
    const amount = parsePriorityAmount(body.amountCents)
    if (!amount.ok) return bad(amount.error)
    const due = parseDueDate(body.dueDate)
    if (!due.ok) return bad(due.error)
    const notes = parsePriorityNotes(body.notes)
    if (!notes.ok) return bad(notes.error)
    if (body.isTopPriority !== undefined && typeof body.isTopPriority !== 'boolean') {
      return bad('Top priority must be true or false.')
    }

    const supabase = createServiceClient()
    const insert = {
      week_start: week.value,
      description: description.value,
      amount_cents: amount.value,
      due_date: due.value,
      notes: notes.value,
      is_top_priority: body.isTopPriority === true,
      status: 'open' as const,
      sort_order: nextSortOrder(await weekRows(supabase, week.value)),
      created_by: ctx.userId,
    }
    const { data, error } = await supabase.from('cmr_weekly_priorities').insert(insert).select(CMR_PRIORITY_COLS).single()
    if (isInputViolation(error)) return bad(`That priority couldn't be saved: ${error?.message ?? 'invalid values'}.`)
    if (error || !data) throw new Error(error?.message ?? 'Could not add the priority.')
    const row = data as unknown as Row

    await auditor(ctx, request)('cmr.priority.create', row.id, row.description, {
      weekStart: row.week_start,
      before: null,
      after: snapshot(pick(row, ALL_KEYS)),
    })

    return NextResponse.json({ success: true, data: { priority: toCmrPriority(row) } }, { status: 201 })
  } catch (err) {
    return serverError('', err)
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
    if (!UUID_RE.test(id)) return bad('Choose a priority.')
    if ('weekStart' in body || 'date' in body || 'carriedFromId' in body) {
      return bad('A priority stays in its week. Moving it to another week isn’t available yet.', 'CARRY_NOT_AVAILABLE')
    }

    // ── parse whatever was sent ──
    const patch: Partial<Editable> = {}
    if ('description' in body) {
      const d = parseDescription(body.description)
      if (!d.ok) return bad(d.error)
      patch.description = d.value
    }
    if ('amountCents' in body) {
      const a = parsePriorityAmount(body.amountCents)
      if (!a.ok) return bad(a.error)
      patch.amount_cents = a.value
    }
    if ('dueDate' in body) {
      const d = parseDueDate(body.dueDate)
      if (!d.ok) return bad(d.error)
      patch.due_date = d.value
    }
    if ('notes' in body) {
      const n = parsePriorityNotes(body.notes)
      if (!n.ok) return bad(n.error)
      patch.notes = n.value
    }
    if ('isTopPriority' in body) {
      if (typeof body.isTopPriority !== 'boolean') return bad('Top priority must be true or false.')
      patch.is_top_priority = body.isTopPriority
    }
    let nextStatus: 'open' | 'resolved' | 'paid' | undefined
    if ('status' in body) {
      const s = parseWritableStatus(body.status)
      if (!s.ok) return bad(s.error, s.code)
      nextStatus = s.value
    }
    if (!Object.keys(patch).length && nextStatus === undefined) return bad('Nothing to change.')

    const supabase = createServiceClient()
    const before = await priorityById(supabase, id)
    if (!before) return bad('That priority does not exist.', 'NOT_FOUND', 404)
    if (before.status === 'carried') return bad(LOCKED, 'NOT_EDITABLE', 409)

    // ── keep only real changes ──
    const changes: Partial<Row> = {}
    for (const k of Object.keys(patch) as (keyof Editable)[]) {
      const next = patch[k]
      const same = k === 'amount_cents' ? Number(before[k]) === Number(next) : before[k] === next
      if (!same) (changes as Record<string, unknown>)[k] = next
    }
    if (nextStatus !== undefined && nextStatus !== before.status) {
      Object.assign(changes, statusPatch(before, nextStatus, ctx.userId, new Date().toISOString()))
    }
    if (!Object.keys(changes).length) {
      return NextResponse.json({ success: true, data: { priority: toCmrPriority(before), changed: false } })
    }

    const { error } = await supabase.from('cmr_weekly_priorities').update(changes).eq('id', id)
    if (isInputViolation(error)) return bad(`That change couldn't be saved: ${error?.message ?? 'invalid values'}.`)
    if (error) throw new Error(error.message)
    const after: Row = { ...before, ...changes }

    // ── audit: one entry per kind of change, each with before → after of its fields ──
    const audit = auditor(ctx, request)
    const meta = (keys: readonly (keyof Row)[]) => ({
      weekStart: before.week_start,
      before: snapshot(pick(before, keys)),
      after: snapshot(pick(after, keys)),
    })
    const fieldKeys = FIELD_KEYS.filter((k) => k in changes)
    if (fieldKeys.length) await audit('cmr.priority.update', id, after.description, meta(fieldKeys))
    if ('is_top_priority' in changes) {
      await audit(after.is_top_priority ? 'cmr.priority.flag' : 'cmr.priority.unflag', id, after.description, meta(['is_top_priority']))
    }
    if ('status' in changes) {
      await audit(STATUS_ACTION[after.status as 'open' | 'resolved' | 'paid'], id, after.description, meta(STATUS_KEYS))
    }

    const names = new Map(after.paid_by === ctx.userId && ctx.displayName ? [[ctx.userId, ctx.displayName]] : [])
    return NextResponse.json({ success: true, data: { priority: toCmrPriority(after, names), changed: true } })
  } catch (err) {
    return serverError('', err)
  }
}

export async function DELETE(request: Request): Promise<NextResponse> {
  try {
    const ctx = await getCmrContext()
    if (!ctx.ok) return ctx.response
    const guard = guardCmrController(ctx)
    if (guard) return guard

    const id = (new URL(request.url).searchParams.get('id') ?? '').trim()
    if (!UUID_RE.test(id)) return bad('Choose a priority.')

    const supabase = createServiceClient()
    const before = await priorityById(supabase, id)
    if (!before) return bad('That priority does not exist.', 'NOT_FOUND', 404)
    if (before.status === 'carried') return bad(LOCKED, 'NOT_EDITABLE', 409)

    const { error } = await supabase.from('cmr_weekly_priorities').delete().eq('id', id)
    if (error) throw new Error(error.message)

    await auditor(ctx, request)('cmr.priority.delete', id, before.description, {
      weekStart: before.week_start,
      before: snapshot(pick(before, ALL_KEYS)),
      after: null,
    })

    return NextResponse.json({ success: true, data: { deleted: true } })
  } catch (err) {
    return serverError('', err)
  }
}
