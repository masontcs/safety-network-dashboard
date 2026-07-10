import { NextResponse } from 'next/server'
import { getAccessContext, guardAdminOnly } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { apiError } from '@/lib/utils/errors'

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
      .select('id, tracked')
      .eq('id', body.itemId)
      .maybeSingle()
    if (iErr) throw new Error(iErr.message)
    if (!item) return bad('Item not found', 'NOT_FOUND', 404)
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
    return apiError(err)
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
    return apiError(err)
  }
}
