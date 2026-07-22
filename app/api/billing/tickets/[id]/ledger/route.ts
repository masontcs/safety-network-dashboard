import { NextResponse } from 'next/server'
import { getAccessContext, guardAdminOnly } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { billingApiError } from '@/lib/billing/http'
import { fetchJobLedger, balanceFrom, onRentFor, onRentKey } from '@/lib/billing/onRent'
import type { Database } from '@/lib/supabase/database.types'

type LedgerUpdate = Database['public']['Tables']['billing_ticket_ledger']['Update']

/**
 * The ticket quantity ledger — the Equipment tab.
 *
 * pickup (+) / return (-) / lost (-). Rentals are DERIVED from this at invoice
 * time (per-batch, pickup + return day billed). Lost units leave the on-rent
 * pool AND drive a charge at item COST (also computed at invoice).
 *
 * A tracked item requires an equipment ID. Returns/losses can't exceed what's
 * on rent for that (item, variation).
 *
 * `recurring` (equipment still out) is recomputed whenever the ledger changes.
 */

const EVENTS = ['pickup', 'return', 'lost'] as const
type EventType = (typeof EVENTS)[number]

// Equipment cadences. 'flat' is a charge-item key, never a rental cadence.
const CADENCES = ['daily', 'weekly', 'monthly'] as const
type Cadence = (typeof CADENCES)[number]

function bad(error: string, code = 'VALIDATION_ERROR', status = 400) {
  return NextResponse.json({ success: false, error, code }, { status })
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SB = ReturnType<typeof createServiceClient>

async function loadTicket(supabase: SB, id: string) {
  const { data, error } = await supabase
    .from('billing_tickets')
    .select('id, status, job_id, billing_jobs(branch_id)')
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data as unknown as { id: string; status: string; job_id: string; billing_jobs: { branch_id: string } | null } | null
}

/**
 * Recompute the recurring tag: "this ticket put equipment out that is still out".
 *
 * The balance is measured across the JOB (equipment returns on a different ticket), but
 * keyed to what THIS ticket picked up — otherwise every ticket on the job, including the
 * return ticket, would light up. Attribution is necessarily approximate for fungible
 * quantities (two Add tickets, one pool of cones); this answers the useful question
 * "did this ticket's equipment come back?" rather than pretending to track individuals.
 */
async function refreshRecurring(supabase: SB, ticketId: string, jobId: string) {
  const rows = await fetchJobLedger(supabase, jobId)
  const bal = balanceFrom(rows)

  const { data: mine } = await supabase
    .from('billing_ticket_ledger')
    .select('item_id, variation_id, event_type')
    .eq('ticket_id', ticketId)
    .eq('event_type', 'pickup')

  const pickedUpHere = new Set(
    ((mine ?? []) as { item_id: string; variation_id: string | null }[])
      .map((e) => onRentKey(e.item_id, e.variation_id))
  )
  const recurring = [...pickedUpHere].some((k) => (bal.get(k) ?? 0) > 0)
  await supabase.from('billing_tickets').update({ recurring }).eq('id', ticketId)
}

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const guard = guardAdminOnly(ctx.access.role)
    if (guard) return guard

    const supabase = createServiceClient()
    const ticket = await loadTicket(supabase, params.id)
    if (!ticket) return bad('Ticket not found', 'NOT_FOUND', 404)
    if (ctx.access.branchIds !== null && (!ticket.billing_jobs || !ctx.access.branchIds.includes(ticket.billing_jobs.branch_id))) {
      return bad('You do not have access to this ticket’s branch.', 'FORBIDDEN', 403)
    }
    if (ticket.status === 'final_edit' || ticket.status === 'invoiced') {
      return bad('This ticket is locked. Reopen it to change equipment.', 'CONFLICT', 409)
    }

    const body = (await request.json()) as {
      itemId?: string
      variationId?: string | null
      eventType?: string
      eventDate?: string
      qty?: number
      equipmentId?: string | null
      billingType?: string | null
      returns?: { itemId?: string; variationId?: string | null; qty?: number }[]
    }

    /**
     * BULK RETURN — the return grid posts every row at once instead of one request per
     * item. Each quantity is checked against the LIVE job balance here, so a stale page
     * can never hand back more than went out. All-or-nothing: one bad row rejects the
     * batch rather than half-recording a return.
     */
    if (Array.isArray(body.returns)) {
      if (!body.eventDate) return bad('A date is required')
      const wanted = body.returns.filter((r) => r.itemId && Number.isInteger(r.qty) && (r.qty as number) > 0)
      if (wanted.length === 0) return bad('Enter a quantity to return.')

      const balances = balanceFrom(await fetchJobLedger(supabase, ticket.job_id))

      // Codes only so a rejection can name the item instead of an opaque id.
      const { data: itemRows } = await supabase
        .from('billing_items')
        .select('id, code')
        .in('id', [...new Set(wanted.map((r) => r.itemId as string))])
      const codeById = new Map((itemRows ?? []).map((i) => [i.id, i.code]))

      const rows = []
      for (const r of wanted) {
        const itemId = r.itemId as string
        const variationId = r.variationId ?? null
        const qty = r.qty as number
        const avail = balances.get(onRentKey(itemId, variationId)) ?? 0
        if (qty > avail) {
          return bad(`Only ${avail} of ${codeById.get(itemId) ?? 'that item'} on rent — can't return ${qty}.`, 'CONFLICT', 409)
        }
        rows.push({
          ticket_id: params.id,
          job_id: ticket.job_id,
          item_id: itemId,
          variation_id: variationId,
          event_type: 'return' as const,
          event_date: body.eventDate as string,
          qty,
          equipment_id: null,
          billing_type: null, // a return never carries a cadence
        })
      }

      const { error } = await supabase.from('billing_ticket_ledger').insert(rows)
      if (error) throw new Error(error.message)

      await refreshRecurring(supabase, params.id, ticket.job_id)
      return NextResponse.json({ success: true, data: { returned: rows.length } })
    }

    if (!body.itemId) return bad('An item is required')
    if (!body.eventType || !EVENTS.includes(body.eventType as EventType)) return bad('Event must be pickup, return, or lost')
    if (!body.eventDate) return bad('A date is required')
    if (!Number.isInteger(body.qty) || (body.qty as number) <= 0) return bad('Quantity must be a whole number greater than zero')
    const qty = body.qty as number
    const eventType = body.eventType as EventType

    // The rental cadence rides on the pickup — it's optional at add time (a tech can add
    // equipment without pricing it) and enforced before final edit. Never on return/lost.
    if (body.billingType != null && !CADENCES.includes(body.billingType as Cadence)) return bad('Billing type must be daily, weekly or monthly')
    const billingType = eventType === 'pickup' ? ((body.billingType as Cadence | null) ?? null) : null

    const { data: item, error: iErr } = await supabase
      .from('billing_items')
      .select('id, tracked, rentable')
      .eq('id', body.itemId)
      .maybeSingle()
    if (iErr) throw new Error(iErr.message)
    if (!item) return bad('Item not found', 'NOT_FOUND', 404)
    if (!item.rentable) return bad('That item is sale-only — it can’t go on the equipment ledger. Add it as a Sale charge instead.')
    if (item.tracked && !body.equipmentId?.trim()) return bad('This item is tracked — an equipment ID is required')

    // Returns/losses can't exceed what's on rent for this (item, variation) — measured
    // across the whole JOB, because equipment goes out on an Add ticket and comes back
    // on a separate Return ticket. See lib/billing/onRent.
    if (eventType !== 'pickup') {
      const onRent = await onRentFor(supabase, ticket.job_id, body.itemId, body.variationId ?? null)
      if (qty > onRent) {
        return bad(`Only ${onRent} on rent for that item on this job — can't ${eventType} ${qty}.`, 'CONFLICT', 409)
      }
    }

    const { error } = await supabase.from('billing_ticket_ledger').insert({
      ticket_id: params.id,
      job_id: ticket.job_id,
      item_id: body.itemId,
      variation_id: body.variationId ?? null,
      event_type: eventType,
      event_date: body.eventDate,
      qty,
      equipment_id: item.tracked ? body.equipmentId?.trim() ?? null : (body.equipmentId?.trim() || null),
      billing_type: billingType,
    })
    if (error) throw new Error(error.message)

    await refreshRecurring(supabase, params.id, ticket.job_id)
    return NextResponse.json({ success: true })
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
    const ticket = await loadTicket(supabase, params.id)
    if (!ticket) return bad('Ticket not found', 'NOT_FOUND', 404)
    if (ctx.access.branchIds !== null && (!ticket.billing_jobs || !ctx.access.branchIds.includes(ticket.billing_jobs.branch_id))) {
      return bad('You do not have access to this ticket’s branch.', 'FORBIDDEN', 403)
    }
    if (ticket.status === 'final_edit' || ticket.status === 'invoiced') {
      return bad('This ticket is locked. Reopen it to change equipment.', 'CONFLICT', 409)
    }

    const body = (await request.json()) as { eventId?: string; qty?: number; eventDate?: string; equipmentId?: string | null; billingType?: string | null }
    if (!body.eventId) return bad('eventId is required')
    if (body.billingType != null && !CADENCES.includes(body.billingType as Cadence)) return bad('Billing type must be daily, weekly or monthly')

    // Load the event being edited (to know its item/variation/type).
    const { data: ev, error: evErr } = await supabase
      .from('billing_ticket_ledger')
      .select('id, item_id, variation_id, event_type, qty, billing_items(tracked)')
      .eq('id', body.eventId)
      .eq('ticket_id', params.id)
      .maybeSingle()
    if (evErr) throw new Error(evErr.message)
    const event = ev as unknown as { id: string; item_id: string; variation_id: string | null; event_type: string; qty: number; billing_items: { tracked: boolean } | null } | null
    if (!event) return bad('Ledger entry not found', 'NOT_FOUND', 404)

    const newQty = body.qty ?? event.qty
    if (!Number.isInteger(newQty) || newQty <= 0) return bad('Quantity must be a whole number greater than zero')
    if (event.billing_items?.tracked && body.equipmentId !== undefined && !body.equipmentId?.trim()) {
      return bad('This item is tracked — an equipment ID is required')
    }

    // Editing must not drive the (item, variation) balance negative — measured across
    // the JOB, substituting the new qty for the row being edited.
    const jobRows = await fetchJobLedger(supabase, ticket.job_id)
    const balance = balanceFrom(jobRows, { id: event.id, qty: newQty })
      .get(onRentKey(event.item_id, event.variation_id)) ?? 0
    if (balance < 0) return bad('That change would return/lose more than was ever picked up on this job.', 'CONFLICT', 409)

    const patch: LedgerUpdate = { qty: newQty }
    if (body.eventDate !== undefined) patch.event_date = body.eventDate
    if (body.equipmentId !== undefined) patch.equipment_id = body.equipmentId?.trim() || null
    // Cadence is a pickup-only property; a return/lost row can never carry one.
    if (body.billingType !== undefined) patch.billing_type = event.event_type === 'pickup' ? (body.billingType as Cadence | null) : null

    const { error } = await supabase.from('billing_ticket_ledger').update(patch).eq('id', body.eventId).eq('ticket_id', params.id)
    if (error) throw new Error(error.message)

    await refreshRecurring(supabase, params.id, ticket.job_id)
    return NextResponse.json({ success: true })
  } catch (err) {
    return billingApiError(err)
  }
}

/**
 * Set the SAME date on every equipment row of this ticket. Used by the
 * "match the other items?" prompt after a single date edit — on a normal
 * add ticket everything is picked up the same day. Only event_date changes.
 */
export async function PUT(
  request: Request,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const guard = guardAdminOnly(ctx.access.role)
    if (guard) return guard

    const supabase = createServiceClient()
    const ticket = await loadTicket(supabase, params.id)
    if (!ticket) return bad('Ticket not found', 'NOT_FOUND', 404)
    if (ctx.access.branchIds !== null && (!ticket.billing_jobs || !ctx.access.branchIds.includes(ticket.billing_jobs.branch_id))) {
      return bad('You do not have access to this ticket’s branch.', 'FORBIDDEN', 403)
    }
    if (ticket.status === 'final_edit' || ticket.status === 'invoiced') {
      return bad('This ticket is locked. Reopen it to change equipment.', 'CONFLICT', 409)
    }

    const body = (await request.json()) as { eventDate?: string }
    if (!body.eventDate) return bad('A date is required')

    const patch: LedgerUpdate = { event_date: body.eventDate }
    const { error } = await supabase.from('billing_ticket_ledger').update(patch).eq('ticket_id', params.id)
    if (error) throw new Error(error.message)

    return NextResponse.json({ success: true })
  } catch (err) {
    return billingApiError(err)
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const guard = guardAdminOnly(ctx.access.role)
    if (guard) return guard

    const url = new URL(request.url)
    const eventId = url.searchParams.get('eventId')
    if (!eventId) return bad('eventId is required')

    const supabase = createServiceClient()
    const ticket = await loadTicket(supabase, params.id)
    if (!ticket) return bad('Ticket not found', 'NOT_FOUND', 404)
    if (ctx.access.branchIds !== null && (!ticket.billing_jobs || !ctx.access.branchIds.includes(ticket.billing_jobs.branch_id))) {
      return bad('You do not have access to this ticket’s branch.', 'FORBIDDEN', 403)
    }
    if (ticket.status === 'final_edit' || ticket.status === 'invoiced') {
      return bad('This ticket is locked.', 'CONFLICT', 409)
    }

    const { error } = await supabase.from('billing_ticket_ledger').delete().eq('id', eventId).eq('ticket_id', params.id)
    if (error) throw new Error(error.message)

    await refreshRecurring(supabase, params.id, ticket.job_id)
    return NextResponse.json({ success: true })
  } catch (err) {
    return billingApiError(err)
  }
}
