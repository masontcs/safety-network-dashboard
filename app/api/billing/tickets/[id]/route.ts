import { NextResponse } from 'next/server'
import { getAccessContext, guardAdminOnly } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { billingApiError } from '@/lib/billing/http'
import { BILLING_TYPES } from '@/lib/billing/constants'
import { resolveItemLineRates } from '@/lib/billing/livePricing'
import { fetchJobLedger, balanceFrom } from '@/lib/billing/onRent'
import type { BillingItemCategory, BillingType, Database } from '@/lib/supabase/database.types'
import { broadcastBillingChanged } from '@/lib/realtime/broadcast'

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
  is_voided: boolean
  voided_at: string | null
  billing_jobs: { id: string; job_number: string; name: string | null; branch_id: string; profile_id: string; entities: { code: string } | null; billing_profiles: { name: string; billing_customers: { name: string } | null } | null } | null
}
interface LedgerRow {
  id: string; event_type: string; event_date: string; qty: number; equipment_id: string | null; billing_type: BillingType | null
  billing_items: { id: string; code: string; name: string; tracked: boolean } | null
  billing_item_variations: { id: string; name: string } | null
}
interface LineRow {
  id: string; kind: string; description: string; qty: number; units: number; unit_rate_cents: number | null; amount_cents: number | null; taxable: boolean
  item_id: string | null
  billing_items: { code: string; category: BillingItemCategory } | null
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
        billing_type, recurring, notes, entity_id, is_voided, voided_at,
        billing_jobs(id, job_number, name, branch_id, profile_id, entities(code), billing_profiles(name, billing_customers(name)))
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
      .select('id, event_type, event_date, qty, equipment_id, billing_type, billing_items(id, code, name, tracked), billing_item_variations(id, name)')
      .eq('ticket_id', params.id)
      .order('event_date')
    const ledger = (ledgerRaw ?? []) as unknown as LedgerRow[]

    const { data: linesRaw } = await supabase
      .from('billing_ticket_lines')
      .select('id, kind, description, qty, units, unit_rate_cents, amount_cents, taxable, item_id, billing_items(code, category)')
      .eq('ticket_id', params.id)
      .order('created_at')
    const lines = (linesRaw ?? []) as unknown as LineRow[]

    // Live pricing: Labor / Lump-Sum lines store no rate — resolve it from the price list
    // now, so the ticket shows the actual number instead of "from price list". Uses the
    // same compiled rates the invoice will. A stored rate (sale, misc) always wins.
    const priced = t.billing_jobs
      ? await resolveItemLineRates(supabase, {
          profileId: t.billing_jobs.profile_id,
          entityId: t.entity_id,
          lines: lines
            .filter((l) => l.unit_rate_cents === null)
            .map((l) => ({ id: l.id, itemId: l.item_id, category: l.billing_items?.category ?? null, qty: Number(l.qty), units: l.units })),
        })
      : new Map()

    /**
     * What's still out — a JOB fact, not a ticket one. Equipment goes out on an Add ticket
     * and comes back on a separate Return ticket, so a ticket-scoped balance shows a Return
     * ticket nothing to return. Ids are included so the return picker can post against them.
     */
    const jobRows = t.billing_jobs ? await fetchJobLedger(supabase, t.billing_jobs.id) : []
    const balances = balanceFrom(jobRows)

    // Names for whatever is on rent (may include items this ticket never touched).
    const outKeys = [...balances.entries()].filter(([, q]) => q > 0)
    const outItemIds = [...new Set(outKeys.map(([k]) => k.split('|')[0]))]
    const namesById = new Map<string, { code: string; name: string }>()
    const variationNameById = new Map<string, string>()
    if (outItemIds.length > 0) {
      const { data: its } = await supabase.from('billing_items').select('id, code, name').in('id', outItemIds)
      for (const i of (its ?? []) as { id: string; code: string; name: string }[]) namesById.set(i.id, { code: i.code, name: i.name })
      const varIds = outKeys.map(([k]) => k.split('|')[1]).filter(Boolean)
      if (varIds.length > 0) {
        const { data: vs } = await supabase.from('billing_item_variations').select('id, name').in('id', varIds)
        for (const v of (vs ?? []) as { id: string; name: string }[]) variationNameById.set(v.id, v.name)
      }
    }

    const onRent = outKeys.map(([key, qty]) => {
      const [itemId, variationId] = key.split('|')
      const meta = namesById.get(itemId)
      return {
        itemId,
        variationId: variationId || null,
        code: meta?.code ?? '',
        name: meta?.name ?? '',
        variation: variationId ? variationNameById.get(variationId) ?? null : null,
        qty,
      }
    })

    // Time-approval rollup — a parallel track to the billing status. Grouped by (tech, branch,
    // effective date), it reflects whether this ticket's logged time has been approved. A
    // returned batch surfaces its note so the office sees what the tech must fix.
    let timeApproval: { status: 'submitted' | 'returned' | 'approved'; note: string | null } | null = null
    const taBranch = t.billing_jobs?.branch_id
    if (taBranch) {
      const { data: lab } = await supabase.from('billing_ticket_labor').select('technician_id, work_date').eq('ticket_id', params.id)
      const labRows = (lab ?? []) as { technician_id: string; work_date: string | null }[]
      if (labRows.length) {
        const keys = [...new Set(labRows.map((l) => `${l.technician_id}|${l.work_date ?? t.ticket_date}`))]
        const techIds = [...new Set(labRows.map((l) => l.technician_id))]
        const dates = [...new Set(labRows.map((l) => l.work_date ?? t.ticket_date))]
        const { data: appr } = await supabase.from('billing_time_approvals')
          .select('technician_id, work_date, status, note')
          .eq('branch_id', taBranch).in('technician_id', techIds).in('work_date', dates)
        const map = new Map<string, { status: string; note: string | null }>()
        for (const a of (appr ?? []) as { technician_id: string; work_date: string; status: string; note: string | null }[]) map.set(`${a.technician_id}|${a.work_date}`, { status: a.status, note: a.note })
        let anyReturned = false, allApproved = true, returnedNote: string | null = null
        for (const k of keys) {
          const st = map.get(k)?.status ?? 'submitted'
          if (st === 'returned') { anyReturned = true; returnedNote = returnedNote ?? map.get(k)?.note ?? null }
          if (st !== 'approved') allApproved = false
        }
        timeApproval = anyReturned ? { status: 'returned', note: returnedNote } : allApproved ? { status: 'approved', note: null } : { status: 'submitted', note: null }
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        id: t.id,
        ticketNumber: t.ticket_number,
        date: t.ticket_date,
        status: t.status,
        timeApproval,
        // A voided ticket is fully read-only (restore it to edit) — same as a locked one.
        locked: isLocked(t.status) || t.is_voided,
        voided: t.is_voided,
        voidedAt: t.voided_at,
        featureAdd: t.feature_add,
        featureReturn: t.feature_return,
        featureDtc: t.feature_dtc,
        billingType: t.billing_type,
        recurring: t.recurring,
        notes: t.notes,
        job: t.billing_jobs ? { id: t.billing_jobs.id, number: t.billing_jobs.job_number, name: t.billing_jobs.name } : null,
        profileId: t.billing_jobs?.profile_id ?? null, // scopes the Lump-sum/Labor picker to this profile's custom items
        entityCode: t.billing_jobs?.entities?.code ?? '',
        customer: t.billing_jobs?.billing_profiles?.billing_customers?.name ?? null,
        statuses: STATUSES,
        billingTypes: BILLING_TYPES,
        ledger: ledger.map((e) => ({
          id: e.id, eventType: e.event_type, date: e.event_date, qty: e.qty, equipmentId: e.equipment_id,
          billingType: e.billing_type,
          item: e.billing_items ? { id: e.billing_items.id, code: e.billing_items.code, name: e.billing_items.name, tracked: e.billing_items.tracked } : null,
          variation: e.billing_item_variations ? { id: e.billing_item_variations.id, name: e.billing_item_variations.name } : null,
        })),
        // Every pickup needs a cadence before final edit. Surface how many still don't,
        // so the UI can gate the button and say what's missing.
        pickupsMissingBillingType: ledger.filter((e) => e.event_type === 'pickup' && e.billing_type == null).length,
        lines: lines.map((l) => {
          // A stored rate (sale, misc) is authoritative. An item-priced line has none, so
          // fall back to the live price-list resolution.
          const live = l.unit_rate_cents === null ? priced.get(l.id) : undefined
          const unitRateCents = l.unit_rate_cents ?? live?.unitRateCents ?? null
          const amountCents = l.amount_cents ?? live?.amountCents ?? null
          return {
            id: l.id, kind: l.kind, description: l.description, qty: Number(l.qty), units: l.units,
            unitRateCents, amountCents, taxable: l.taxable,
            itemCode: l.billing_items?.code ?? null,
            // true when the number shown was resolved from the price list, not stored.
            rateFromPriceList: l.unit_rate_cents === null && unitRateCents !== null,
          }
        }),
        onRent,
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
      .select('id, status, billing_type, feature_add, feature_return, feature_dtc, is_voided, billing_jobs(branch_id)')
      .eq('id', params.id)
      .maybeSingle()
    if (exErr) throw new Error(exErr.message)
    if (!existing) return bad('Ticket not found', 'NOT_FOUND', 404)
    const ex = existing as unknown as { status: Status; billing_type: BillingType | null; feature_add: boolean; feature_return: boolean; feature_dtc: boolean; is_voided: boolean; billing_jobs: { branch_id: string } | null }

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
      action?: 'void' | 'unvoid'
    }

    // ── Void / un-void ────────────────────────────────────────────────────────
    // Voiding removes the ticket from all billing and quantity counting. It's blocked
    // while the ticket is billed on a live (non-void) invoice — void that invoice first,
    // so its totals reverse before the ticket disappears. Un-void simply restores it.
    if (body.action === 'void' || body.action === 'unvoid') {
      const wantVoid = body.action === 'void'
      if (wantVoid === ex.is_voided) {
        return bad(wantVoid ? 'This ticket is already voided.' : 'This ticket is not voided.', 'CONFLICT', 409)
      }
      if (wantVoid) {
        const { data: invLines } = await supabase
          .from('billing_invoice_lines')
          .select('billing_invoices!inner(invoice_number, status)')
          .eq('ticket_id', params.id)
        const live = ((invLines ?? []) as unknown as { billing_invoices: { invoice_number: string; status: string } | null }[])
          .find((l) => l.billing_invoices && l.billing_invoices.status !== 'void')
        if (live) {
          return bad(`This ticket is billed on invoice ${live.billing_invoices!.invoice_number}. Void that invoice first, then void the ticket.`, 'CONFLICT', 409)
        }
      }
      const { error: vErr } = await supabase
        .from('billing_tickets')
        .update({ is_voided: wantVoid, voided_at: wantVoid ? new Date().toISOString() : null, voided_by: wantVoid ? ctx.access.userId : null })
        .eq('id', params.id)
      if (vErr) throw new Error(vErr.message)
      // Void/restore reflects everywhere live: dispatch board (greyed/removed), tickets
      // list, and the tech app (a voided ticket drops off the tech's list).
      await broadcastBillingChanged()
      return NextResponse.json({ success: true })
    }

    // Every other edit is blocked while voided — restore the ticket first.
    if (ex.is_voided) {
      return bad('This ticket is voided. Restore it before making changes.', 'CONFLICT', 409)
    }

    const patch: TicketUpdate = {}
    const editingContent = body.ticketDate !== undefined || body.featureAdd !== undefined ||
      body.featureReturn !== undefined || body.featureDtc !== undefined

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

    // Leaving DTC: its rows were auto-billed daily as one-day charges. Now that they become
    // an ongoing rental, the cadence must be chosen deliberately — clear it so the office is
    // prompted to (re)assign a billing type per item (final-edit already blocks on nulls).
    const leavingDtc = ex.feature_dtc && !dtc


    if (body.status !== undefined) {
      if (!STATUSES.includes(body.status as Status)) return bad('Unknown status')
      const target = body.status as Status
      // Final edit requires a cadence on every pickup — the rate can't be resolved without
      // it. The cadence now lives per equipment item, not on the ticket.
      if (target === 'final_edit') {
        const { count } = await supabase
          .from('billing_ticket_ledger')
          .select('id', { count: 'exact', head: true })
          .eq('ticket_id', params.id)
          .eq('event_type', 'pickup')
          .is('billing_type', null)
        if ((count ?? 0) > 0) {
          return bad('Set a billing type on every equipment item before final-editing this ticket.')
        }
      }
      patch.status = target
      patch.final_edited_at = target === 'final_edit' ? new Date().toISOString() : null
    }

    if (Object.keys(patch).length === 0) return bad('Nothing to update')

    const { error } = await supabase.from('billing_tickets').update(patch).eq('id', params.id)
    if (error) throw new Error(error.message)

    if (leavingDtc) {
      const { error: ledErr } = await supabase
        .from('billing_ticket_ledger')
        .update({ billing_type: null })
        .eq('ticket_id', params.id)
        .eq('event_type', 'pickup')
      if (ledErr) throw new Error(ledErr.message)
    }

    await broadcastBillingChanged()
    return NextResponse.json({ success: true })
  } catch (err) {
    return billingApiError(err)
  }
}
