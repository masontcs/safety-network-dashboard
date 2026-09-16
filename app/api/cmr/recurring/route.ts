import { NextResponse } from 'next/server'
import { getCmrContext, guardCmr, guardCmrController } from '@/lib/api/cmr'
import { createServiceClient } from '@/lib/supabase/server'
import { logAudit, getClientIp, type AuditAction } from '@/lib/audit/log'
import {
  CMR_PLAN_TERMS_MAX,
  CMR_RECURRENCE_MAX,
  CMR_RECURRING_COLS,
  CMR_VENDOR_NOTES_MAX,
  PLAN_FIELDS_URGENT_ONLY,
  compareVendors,
  parseCents,
  parseOptionalText,
  parsePlanDueDate,
  parseSection,
  parseVendorName,
  toCmrRecurringVendor,
  type CmrAccountRef,
  type CmrRecurringVendorRow,
} from '@/lib/cmr/recurring'

/**
 * SN Cash Ledger — recurring vendors (Weekly / Monthly / Urgent Payment Plans).
 *
 *   GET            → every vendor (inactive included) + the accounts to label/pick them.
 *                    ANY CMR role; `canEdit` is true only for a Controller.
 *   POST  {...}    → create at the end of its section. CONTROLLER.
 *   PATCH {id,...} → edit fields, move section, set last amount sent, hold/release,
 *                    (de)activate. CONTROLLER.
 *   (reorder lives at /api/cmr/recurring/reorder)
 *
 * There is deliberately NO DELETE: later phases reference these rows, so a vendor is retired
 * with active = false. Every mutation is written to audit_logs with before → after.
 *
 * NOTE (BUG-019): a route.ts may export only HTTP handlers + route config — helpers stay local
 * or live in lib/cmr/recurring.
 */

// Never statically render or cache a response from this route.
export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Supabase = ReturnType<typeof createServiceClient>
type Row = CmrRecurringVendorRow
type Editable = Omit<Row, 'id' | 'created_by' | 'created_at'>

function bad(error: string, code = 'VALIDATION_ERROR', status = 400) {
  return NextResponse.json({ success: false, error, code }, { status })
}

function serverError(err: unknown) {
  console.error('[api/cmr/recurring]', err)
  const message = err instanceof Error ? err.message : 'Unexpected error.'
  return NextResponse.json({ success: false, error: message, code: 'INTERNAL_ERROR' }, { status: 500 })
}

// A DB check / foreign-key rejection is the caller's input, not a server fault.
const isInputViolation = (e: { code?: string } | null) => !!e && (e.code === '23514' || e.code === '23503')

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = (await request.json()) as unknown
    return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null
  } catch {
    return null
  }
}

async function allAccounts(supabase: Supabase): Promise<Map<string, CmrAccountRef>> {
  const { data, error } = await supabase
    .from('cmr_accounts')
    .select('id, name, active, sort_order')
    .order('sort_order', { ascending: true })
  if (error) throw new Error(error.message)
  const rows = (data ?? []) as { id: string; name: string; active: boolean; sort_order: number }[]
  return new Map(rows.map((r) => [r.id, { id: r.id, name: r.name, active: r.active, sortOrder: r.sort_order }]))
}

async function vendorRows(supabase: Supabase, filter?: { col: 'id' | 'section'; val: string }): Promise<Row[]> {
  let q = supabase.from('cmr_recurring_vendors').select(CMR_RECURRING_COLS)
  if (filter) q = q.eq(filter.col, filter.val)
  const { data, error } = await q
    .order('section', { ascending: true })
    .order('sort_order', { ascending: true })
    .order('vendor_name', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as Row[]
}

async function endOfSection(supabase: Supabase, section: string): Promise<number> {
  const rows = await vendorRows(supabase, { col: 'section', val: section })
  return rows.reduce((m, r) => Math.max(m, r.sort_order), -1) + 1
}

/** The audit snapshot of the fields a person cares about, in API (camelCase) terms. */
function snapshot(r: Partial<Editable>, accounts: Map<string, CmrAccountRef>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if ('vendor_name' in r) out.vendorName = r.vendor_name
  if ('account_id' in r) {
    out.accountId = r.account_id
    out.accountName = accounts.get(r.account_id as string)?.name ?? null
  }
  if ('section' in r) out.section = r.section
  if ('amount_cents' in r) out.amountCents = r.amount_cents == null ? null : Number(r.amount_cents)
  if ('recurrence_detail' in r) out.recurrenceDetail = r.recurrence_detail
  if ('notes' in r) out.notes = r.notes
  if ('plan_terms' in r) out.planTerms = r.plan_terms
  if ('plan_due_date' in r) out.planDueDate = r.plan_due_date
  if ('last_amount_sent_cents' in r) out.lastAmountSentCents = r.last_amount_sent_cents == null ? null : Number(r.last_amount_sent_cents)
  if ('on_hold' in r) out.onHold = r.on_hold
  if ('active' in r) out.active = r.active
  if ('sort_order' in r) out.sortOrder = r.sort_order
  return out
}

const pick = <K extends keyof Editable>(r: Editable | Row, keys: K[]): Pick<Editable, K> =>
  Object.fromEntries(keys.map((k) => [k, r[k]])) as Pick<Editable, K>

export async function GET(): Promise<NextResponse> {
  try {
    const ctx = await getCmrContext()
    if (!ctx.ok) return ctx.response
    const guard = guardCmr(ctx)
    if (guard) return guard

    const supabase = createServiceClient()
    const [accounts, rows] = await Promise.all([allAccounts(supabase), vendorRows(supabase)])
    const vendors = rows.map((r) => toCmrRecurringVendor(r, accounts)).sort(compareVendors)
    return NextResponse.json({
      success: true,
      data: { vendors, accounts: [...accounts.values()], canEdit: ctx.role === 'controller' },
    })
  } catch (err) {
    return serverError(err)
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

    const accountId = typeof body.accountId === 'string' ? body.accountId.trim() : ''
    if (!UUID_RE.test(accountId)) return bad('Choose an account.')
    const vendorName = parseVendorName(body.vendorName)
    if (!vendorName.ok) return bad(vendorName.error)
    const section = parseSection(body.section)
    if (!section.ok) return bad(section.error)
    const amount = parseCents(body.amountCents, 'Amount')
    if (!amount.ok) return bad(amount.error)
    const recurrence = parseOptionalText(body.recurrenceDetail, 'Recurrence', CMR_RECURRENCE_MAX)
    if (!recurrence.ok) return bad(recurrence.error)
    const notes = parseOptionalText(body.notes, 'Notes', CMR_VENDOR_NOTES_MAX, { multiline: true })
    if (!notes.ok) return bad(notes.error)
    const planTerms = parseOptionalText(body.planTerms, 'Plan terms', CMR_PLAN_TERMS_MAX)
    if (!planTerms.ok) return bad(planTerms.error)
    const planDue = parsePlanDueDate(body.planDueDate)
    if (!planDue.ok) return bad(planDue.error)
    if (section.value !== 'urgent' && (planTerms.value !== null || planDue.value !== null)) {
      return bad(PLAN_FIELDS_URGENT_ONLY)
    }

    const supabase = createServiceClient()
    const accounts = await allAccounts(supabase)
    const account = accounts.get(accountId)
    if (!account) return bad('That account does not exist.', 'NOT_FOUND', 404)
    if (!account.active) {
      return bad(`${account.name} is inactive. Choose an active account.`, 'ACCOUNT_INACTIVE', 409)
    }

    const insert: Editable & { created_by: string } = {
      account_id: accountId,
      vendor_name: vendorName.value,
      amount_cents: amount.value as number,
      section: section.value,
      recurrence_detail: recurrence.value,
      last_amount_sent_cents: null,
      plan_terms: planTerms.value,
      plan_due_date: planDue.value,
      notes: notes.value,
      on_hold: false,
      active: true,
      sort_order: await endOfSection(supabase, section.value),
      created_by: ctx.userId,
    }

    const { data, error } = await supabase.from('cmr_recurring_vendors').insert(insert).select(CMR_RECURRING_COLS).single()
    if (isInputViolation(error)) return bad(`That vendor couldn't be saved: ${error?.message ?? 'invalid values'}.`)
    if (error || !data) throw new Error(error?.message ?? 'Could not create the vendor.')
    const row = data as unknown as Row

    await logAudit({
      userId: ctx.userId,
      userDisplayName: ctx.displayName,
      userRole: `cmr:${ctx.role}`,
      action: 'cmr.recurring.create',
      resourceType: 'cmr_recurring_vendors',
      resourceId: row.id,
      resourceLabel: row.vendor_name,
      metadata: { before: null, after: snapshot(row, accounts) },
      ipAddress: getClientIp(request),
    })

    return NextResponse.json({ success: true, data: { vendor: toCmrRecurringVendor(row, accounts) } }, { status: 201 })
  } catch (err) {
    return serverError(err)
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
    if (!UUID_RE.test(id)) return bad('Choose a vendor.')

    // ── parse whatever was sent ──
    const patch: Partial<Editable> = {}
    if ('accountId' in body) {
      const a = typeof body.accountId === 'string' ? body.accountId.trim() : ''
      if (!UUID_RE.test(a)) return bad('Choose an account.')
      patch.account_id = a
    }
    if ('vendorName' in body) {
      const n = parseVendorName(body.vendorName)
      if (!n.ok) return bad(n.error)
      patch.vendor_name = n.value
    }
    if ('section' in body) {
      const s = parseSection(body.section)
      if (!s.ok) return bad(s.error)
      patch.section = s.value
    }
    if ('amountCents' in body) {
      const c = parseCents(body.amountCents, 'Amount')
      if (!c.ok) return bad(c.error)
      patch.amount_cents = c.value as number
    }
    if ('lastAmountSentCents' in body) {
      const c = parseCents(body.lastAmountSentCents, 'Last amount sent', { nullable: true })
      if (!c.ok) return bad(c.error)
      patch.last_amount_sent_cents = c.value
    }
    if ('recurrenceDetail' in body) {
      const t = parseOptionalText(body.recurrenceDetail, 'Recurrence', CMR_RECURRENCE_MAX)
      if (!t.ok) return bad(t.error)
      patch.recurrence_detail = t.value
    }
    if ('notes' in body) {
      const t = parseOptionalText(body.notes, 'Notes', CMR_VENDOR_NOTES_MAX, { multiline: true })
      if (!t.ok) return bad(t.error)
      patch.notes = t.value
    }
    if ('planTerms' in body) {
      const t = parseOptionalText(body.planTerms, 'Plan terms', CMR_PLAN_TERMS_MAX)
      if (!t.ok) return bad(t.error)
      patch.plan_terms = t.value
    }
    if ('planDueDate' in body) {
      const d = parsePlanDueDate(body.planDueDate)
      if (!d.ok) return bad(d.error)
      patch.plan_due_date = d.value
    }
    if ('onHold' in body) {
      if (typeof body.onHold !== 'boolean') return bad('On hold must be true or false.')
      patch.on_hold = body.onHold
    }
    if ('active' in body) {
      if (typeof body.active !== 'boolean') return bad('Active must be true or false.')
      patch.active = body.active
    }
    if (!Object.keys(patch).length) return bad('Nothing to change.')

    const supabase = createServiceClient()
    const [accounts, found] = await Promise.all([allAccounts(supabase), vendorRows(supabase, { col: 'id', val: id })])
    const before = found[0]
    if (!before) return bad('That vendor does not exist.', 'NOT_FOUND', 404)

    // ── keep only real changes ──
    const changes: Partial<Editable> = {}
    for (const k of Object.keys(patch) as (keyof Editable)[]) {
      const next = patch[k]
      const prev = before[k]
      const same = k === 'amount_cents' || k === 'last_amount_sent_cents'
        ? (prev == null ? null : Number(prev)) === (next == null ? null : Number(next))
        : prev === next
      if (!same) (changes as Record<string, unknown>)[k] = next
    }

    const nextSection = changes.section ?? before.section
    if (nextSection !== 'urgent') {
      // Plan fields belong to Urgent Payment Plans only: refuse new values, clear old ones.
      if ((patch.plan_terms ?? null) !== null || (patch.plan_due_date ?? null) !== null) {
        return bad(PLAN_FIELDS_URGENT_ONLY)
      }
      if (before.plan_terms !== null && !('plan_terms' in changes)) changes.plan_terms = null
      if (before.plan_due_date !== null && !('plan_due_date' in changes)) changes.plan_due_date = null
    }

    if (!Object.keys(changes).length) {
      return NextResponse.json({ success: true, data: { vendor: toCmrRecurringVendor(before, accounts), changed: false } })
    }

    if (changes.account_id !== undefined) {
      const acc = accounts.get(changes.account_id)
      if (!acc) return bad('That account does not exist.', 'NOT_FOUND', 404)
      if (!acc.active) return bad(`${acc.name} is inactive. Choose an active account.`, 'ACCOUNT_INACTIVE', 409)
    }
    const after: Row = { ...before, ...changes }
    if (changes.active === true && !accounts.get(after.account_id)?.active) {
      const name = accounts.get(after.account_id)?.name ?? 'Its account'
      return bad(
        `Can't reactivate — ${name} is inactive. Reactivate the account first, or edit the vendor onto an active account.`,
        'ACCOUNT_INACTIVE',
        409,
      )
    }
    if (changes.section !== undefined) {
      changes.sort_order = await endOfSection(supabase, changes.section)
      after.sort_order = changes.sort_order
    }

    const { error } = await supabase.from('cmr_recurring_vendors').update(changes).eq('id', id)
    if (isInputViolation(error)) return bad(`That change couldn't be saved: ${error?.message ?? 'invalid values'}.`)
    if (error) throw new Error(error.message)

    // ── audit: one entry per kind of change, each with before → after of its fields ──
    const FIELD_KEYS: (keyof Editable)[] = ['vendor_name', 'account_id', 'amount_cents', 'recurrence_detail', 'notes']
    const MOVE_KEYS: (keyof Editable)[] = ['section', 'sort_order']
    const PLAN_KEYS: (keyof Editable)[] = ['plan_terms', 'plan_due_date']
    const changed = (keys: (keyof Editable)[]) => keys.filter((k) => k in changes)

    const entries: { action: AuditAction; keys: (keyof Editable)[] }[] = []
    const moved = changes.section !== undefined
    // Plan-field edits ride along with a section move (where they're cleared) or a plain update.
    const fieldKeys = [...changed(FIELD_KEYS), ...(moved ? [] : changed(PLAN_KEYS))]
    if (fieldKeys.length) entries.push({ action: 'cmr.recurring.update', keys: fieldKeys })
    if (moved) entries.push({ action: 'cmr.recurring.move', keys: [...changed(MOVE_KEYS), ...changed(PLAN_KEYS)] })
    if ('last_amount_sent_cents' in changes) entries.push({ action: 'cmr.recurring.last_sent', keys: ['last_amount_sent_cents'] })
    if ('on_hold' in changes) entries.push({ action: after.on_hold ? 'cmr.recurring.hold' : 'cmr.recurring.release', keys: ['on_hold'] })
    if ('active' in changes) entries.push({ action: after.active ? 'cmr.recurring.activate' : 'cmr.recurring.deactivate', keys: ['active'] })

    const ip = getClientIp(request)
    for (const e of entries) {
      await logAudit({
        userId: ctx.userId,
        userDisplayName: ctx.displayName,
        userRole: `cmr:${ctx.role}`,
        action: e.action,
        resourceType: 'cmr_recurring_vendors',
        resourceId: id,
        resourceLabel: after.vendor_name,
        metadata: {
          before: snapshot(pick(before, e.keys), accounts),
          after: snapshot(pick(after, e.keys), accounts),
        },
        ipAddress: ip,
      })
    }

    return NextResponse.json({ success: true, data: { vendor: toCmrRecurringVendor(after, accounts), changed: true } })
  } catch (err) {
    return serverError(err)
  }
}
