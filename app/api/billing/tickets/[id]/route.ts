import { NextResponse } from 'next/server'
import { getAccessContext, guardAdminOnly } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { billingApiError } from '@/lib/billing/http'
import { BILLING_TYPES } from '@/lib/billing/constants'
import type { BillingType, Database } from '@/lib/supabase/database.types'

/**
 * A single ticket: its details, its quantity ledger (Equipment), and its
 * non-rental charge lines. Rentals and lost/stolen charges are DERIVED from the
 * ledger at invoice time and are not stored here.
 *
 * Lifecycle: active -> in_review -> final_edit -> invoiced.
 * Final-edit (and beyond) LOCKS the ledger and lines; editing then requires the
 * governed-adjustment flow. Moving to final_edit requires a billing type.
 */

type TicketUpdate = Database['public']['Tables']['billing_tickets']['Update']
const STATUSES = ['active', 'in_review', 'final_edit', 'invoiced'] as const
type Status = (typeof STATUSES)[number]

function bad(error: string, code = 'VALIDATION_ERROR', status = 400) {
  return NextResponse.json({ success: false, error, code }, { status })
}
// Local helper — must NOT be exported from a route file (Next.js only allows HTTP
// handlers / recognised route config to be exported; anything else fails the build).
const isLocked = (s: string) => s === 'final_edit' || s === 'invoiced'

interface TicketRow {
  id: string
  ticket_number: string
  ticket_date: string
  status: Status
  feature_add: boolean
  feature_return: boolean
  feature_dtc: boolean
  billing_type: BillingType | null
  recurring: boolean
  notes: string | null
  entity_id: string
  billing_jobs: { id: string; job_number: string; name: string | null; branch_id: string; entities: { code: string } | null; billing_profiles: { name: string; billing_customers: { name: string } | null } | null } | null
}
interface LedgerRow {
  id: string; event_type: string; event_date: string; qty: number; equipment_id: string | null
  billing_items: { id: string; code: string; name: string; tracked: boolean } | null
  billing_item_variations: { id: string; name: string } | null
}
interface LineRow {
  id: string; kind: string; description: string; qty: number; units: number; unit_rate_cents: number; amount_cents: number; taxable: boolean
  billing_items: { code: string } | null
}

export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response

    const supabase = createServiceClient()
    const { data, error } = await supabase
      .from('billing_tickets')
      .select(`
        id, ticket_number, ticket_date, status, feature_add, feature_return, feature_dtc,
        billing_type, recurring, notes, entity_id,
        billing_jobs(id, job_number, name, branch_id, entities(code), billing_profiles(name, billing_customers(name)))
      `)
      .eq('id', params.id)
      .maybeSingle()
    if (error) throw new Error(error.message)
    const t = data as unknown as TicketRow | null
    if (!t) return bad('Ticket not found', 'NOT_FOUND', 404)

    if (ctx.access.branchIds !== null && (!t.billing_jobs || !ctx.access.branchIds.includes(t.billing_jobs.branch_id))) {
      return bad('You do not have access to this ticket’s branch.', 'FORBIDDEN', 403)
    }

    const { data: ledgerRaw } = await supabase
      .from('billing_ticket_ledger')
      .select('id, event_type, event_date, qty, equipment_id, billing_items(id, code, name, tracked), billing_item_variations(id, name)')
      .eq('ticket_id', params.id)
      .order('event_date')
    const ledger = (ledgerRaw ?? []) as unknown as LedgerRow[]

    const { data: linesRaw } = await supabase
      .from('billing_ticket_lines')
      .select('id, kind, description, qty, units, unit_rate_cents, amount_cents, taxable, billing_items(code)')
      .eq('ticket_id', params.id)
      .order('created_at')
    const lines = (linesRaw ?? []) as unknown as LineRow[]

    // On-rent per (item, variation): pickups minus returns minus lost.
    const onRent = new Map<string, { code: string; name: string; variation: string | null; qty: number }>()
    for (const e of ledger) {
      if (!e.billing_items) continue
      const key = `${e.billing_items.id}|${e.billing_item_variations?.id ?? ''}`
      const cur = onRent.get(key) ?? { code: e.billing_items.code, name: e.billing_items.name, variation: e.billing_item_variations?.name ?? null, qty: 0 }
      cur.qty += e.event_type === 'pickup' ? e.qty : -e.qty
      onRent.set(key, cur)
    }

    return NextResponse.json({
      success: true,
      data: {
        id: t.id,
        ticketNumber: t.ticket_number,
        date: t.ticket_date,
        status: t.status,
        locked: isLocked(t.status),
        featureAdd: t.feature_add,
        featureReturn: t.feature_return,
        featureDtc: t.feature_dtc,
        billingType: t.billing_type,
        recurring: t.recurring,
        notes: t.notes,
        job: t.billing_jobs ? { id: t.billing_jobs.id, number: t.billing_jobs.job_number, name: t.billing_jobs.name } : null,
        entityCode: t.billing_jobs?.entities?.code ?? '',
        customer: t.billing_jobs?.billing_profiles?.billing_customers?.name ?? null,
        statuses: STATUSES,
        billingTypes: BILLING_TYPES,
        ledger: ledger.map((e) => ({
          id: e.id, eventType: e.event_type, date: e.event_date, qty: e.qty, equipmentId: e.equipment_id,
          item: e.billing_items ? { id: e.billing_items.id, code: e.billing_items.code, name: e.billing_items.name, tracked: e.billing_items.tracked } : null,
          variation: e.billing_item_variations ? { id: e.billing_item_variations.id, name: e.billing_item_variations.name } : null,
        })),
        lines: lines.map((l) => ({
          id: l.id, kind: l.kind, description: l.description, qty: Number(l.qty), units: l.units,
          unitRateCents: l.unit_rate_cents, amountCents: l.amount_cents, taxable: l.taxable,
          itemCode: l.billing_items?.code ?? null,
        })),
        onRent: [...onRent.values()].filter((r) => r.qty !== 0),
        isAdmin: ctx.access.role === 'admin',
      },
    })
  } catch (err) {
    return billingApiError(err)
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const guard = guardAdminOnly(ctx.access.role)
    if (guard) return guard

    const supabase = createServiceClient()
    const { data: existing, error: exErr } = await supabase
      .from('billing_tickets')
      .select('id, status, billing_type, feature_add, feature_return, feature_dtc, billing_jobs(branch_id)')
      .eq('id', params.id)
      .maybeSingle()
    if (exErr) throw new Error(exErr.message)
    if (!existing) return bad('Ticket not found', 'NOT_FOUND', 404)
    const ex = existing as unknown as { status: Status; billing_type: BillingType | null; feature_add: boolean; feature_return: boolean; feature_dtc: boolean; billing_jobs: { branch_id: string } | null }

    if (ctx.access.branchIds !== null && (!ex.billing_jobs || !ctx.access.branchIds.includes(ex.billing_jobs.branch_id))) {
      return bad('You do not have access to this ticket’s branch.', 'FORBIDDEN', 403)
    }

    const body = (await request.json()) as {
      ticketDate?: string
      featureAdd?: boolean
      featureReturn?: boolean
      featureDtc?: boolean
      billingType?: string | null
      notes?: string | null
      status?: string
    }

    const patch: TicketUpdate = {}
    const editingContent = body.ticketDate !== undefined || body.featureAdd !== undefined ||
      body.featureReturn !== undefined || body.featureDtc !== undefined || body.billingType !== undefined

    // Content edits are locked once final-edited/invoiced (status changes still allowed).
    if (editingContent && isLocked(ex.status)) {
      return bad('This ticket is final-edited and locked. Reopen it to change its details.', 'CONFLICT', 409)
    }

    if (body.ticketDate !== undefined) patch.ticket_date = body.ticketDate
    if (body.notes !== undefined) patch.notes = body.notes?.trim() || null

    // Feature toggles with DTC exclusivity.
    const add = body.featureAdd ?? ex.feature_add
    const ret = body.featureReturn ?? ex.feature_return
    const dtc = body.featureDtc ?? ex.feature_dtc
    if (body.featureAdd !== undefined || body.featureReturn !== undefined || body.featureDtc !== undefined) {
      if (dtc && (add || ret)) return bad('DTC cannot be combined with Add or Return')
      if (!add && !ret && !dtc) return bad('A ticket needs at least one feature')
      patch.feature_add = add; patch.feature_return = ret; patch.feature_dtc = dtc
    }

    if (body.billingType !== undefined) {
      if (body.billingType && !BILLING_TYPES.includes(body.billingType as BillingType)) return bad('Unknown billing type')
      patch.billing_type = (body.billingType as BillingType) ?? null
    }

    if (body.status !== undefined) {
      if (!STATUSES.includes(body.status as Status)) return bad('Unknown status')
      const target = body.status as Status
      // Moving into final_edit requires a billing type (the rate cadence).
      const effectiveBillingType = body.billingType !== undefined ? body.billingType : ex.billing_type
      if (target === 'final_edit' && !effectiveBillingType) {
        return bad('Choose a billing type before final-editing this ticket.')
      }
      patch.status = target
      patch.final_edited_at = target === 'final_edit' ? new Date().toISOString() : null
    }

    if (Object.keys(patch).length === 0) return bad('Nothing to update')

    const { error } = await supabase.from('billing_tickets').update(patch).eq('id', params.id)
    if (error) throw new Error(error.message)

    return NextResponse.json({ success: true })
  } catch (err) {
    return billingApiError(err)
  }
}
