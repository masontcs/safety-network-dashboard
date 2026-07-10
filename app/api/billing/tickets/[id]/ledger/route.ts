import { NextResponse } from 'next/server'
import { getAccessContext, guardAdminOnly } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { billingApiError } from '@/lib/billing/http'
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

/** Recompute the recurring tag: true iff any (item,variation) still has qty out. */
async function refreshRecurring(supabase: SB, ticketId: string) {
  const { data } = await supabase
    .from('billing_ticket_ledger')
    .select('item_id, variation_id, event_type, qty')
    .eq('ticket_id', ticketId)
  const bal = new Map<string, number>()
  for (const e of (data ?? []) as { item_id: string; variation_id: string | null; event_type: string; qty: number }[]) {
    const k = `${e.item_id}|${e.variation_id ?? ''}`
    bal.set(k, (bal.get(k) ?? 0) + (e.event_type === 'pickup' ? e.qty : -e.qty))
  }
  const recurring = [...bal.values()].some((q) => q > 0)
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
    }

    if (!body.itemId) return bad('An item is required')
    if (!body.eventType || !EVENTS.includes(body.eventType as EventType)) return bad('Event must be pickup, return, or lost')
    if (!body.eventDate) return bad('A date is required')
    if (!Number.isInteger(body.qty) || (body.qty as number) <= 0) return bad('Quantity must be a whole number greater than zero')
    const qty = body.qty as number
    const eventType = body.eventType as EventType

    const { data: item, error: iErr } = await supabase
      .from('billing_items')
      .select('id, tracked, rentable')
      .eq('id', body.itemId)
      .maybeSingle()
    if (iErr) throw new Error(iErr.message)
    if (!item) return bad('Item not found', 'NOT_FOUND', 404)
    if (!item.rentable) return bad('That item is sale-only — it can’t go on the equipment ledger. Add it as a Sale charge instead.')
    if (item.tracked && !body.equipmentId?.trim()) return bad('This item is tracked — an equipment ID is required')

    // Returns/losses can't exceed what's currently on rent for this (item, variation).
    if (eventType !== 'pickup') {
      let q = supabase
        .from('billing_ticket_ledger')
        .select('event_type, qty')
        .eq('ticket_id', params.id)
        .eq('item_id', body.itemId)
      // Match the same variation slot: a specific variation, or the "no variation" rows.
      q = body.variationId ? q.eq('variation_id', body.variationId) : q.is('variation_id', null)
      const { data: existing } = await q
      const onRent = ((existing ?? []) as { event_type: string; qty: number }[])
        .reduce((s, e) => s + (e.event_type === 'pickup' ? e.qty : -e.qty), 0)
      if (qty > onRent) return bad(`Only ${onRent} on rent for that item — can't ${eventType} ${qty}.`, 'CONFLICT', 409)
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
    })
    if (error) throw new Error(error.message)

    await refreshRecurring(supabase, params.id)
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

    const body = (await request.json()) as { eventId?: string; qty?: number; eventDate?: string; equipmentId?: string | null }
    if (!body.eventId) return bad('eventId is required')

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

    // Editing must not drive the (item, variation) balance negative at the end.
    let q = supabase
      .from('billing_ticket_ledger')
      .select('id, event_type, qty')
      .eq('ticket_id', params.id)
      .eq('item_id', event.item_id)
    q = event.variation_id ? q.eq('variation_id', event.variation_id) : q.is('variation_id', null)
    const { data: sibs } = await q
    const balance = ((sibs ?? []) as { id: string; event_type: string; qty: number }[]).reduce((s, e) => {
      const useQty = e.id === event.id ? newQty : e.qty
      return s + (e.event_type === 'pickup' ? useQty : -useQty)
    }, 0)
    if (balance < 0) return bad('That change would return/lose more than was ever picked up.', 'CONFLICT', 409)

    const patch: LedgerUpdate = { qty: newQty }
    if (body.eventDate !== undefined) patch.event_date = body.eventDate
    if (body.equipmentId !== undefined) patch.equipment_id = body.equipmentId?.trim() || null

    const { error } = await supabase.from('billing_ticket_ledger').update(patch).eq('id', body.eventId).eq('ticket_id', params.id)
    if (error) throw new Error(error.message)

    await refreshRecurring(supabase, params.id)
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

    await refreshRecurring(supabase, params.id)
    return NextResponse.json({ success: true })
  } catch (err) {
    return billingApiError(err)
  }
}
