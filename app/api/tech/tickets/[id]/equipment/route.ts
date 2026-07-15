import { NextResponse } from 'next/server'
import { getTechContext, loadAssignedTicket, techBad, isEditable, deriveEventType } from '@/lib/api/tech'
import { createServiceClient } from '@/lib/supabase/server'
import { billingApiError } from '@/lib/billing/http'
import { onRentFor } from '@/lib/billing/onRent'

/**
 * A tech recording equipment on a ticket.
 *
 * The event type is DERIVED from the ticket's features wherever it's unambiguous
 * (v2-tech-app-plan §9.3) — a DTC never asks pickup/return because that equipment is a
 * day charge, an Add-only ticket is always a pickup, a Return-only ticket is always a
 * return. Only an Add+Return ticket makes the tech choose.
 *
 * Returns and losses are checked against what's on rent for the whole JOB, because
 * equipment goes out on one ticket and comes back on another.
 *
 * Money-blind: no prices in, no prices out.
 */

export async function POST(request: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  try {
    const ctx = await getTechContext()
    if (!ctx.ok) return ctx.response

    const supabase = createServiceClient()
    const ticket = await loadAssignedTicket(supabase, params.id, ctx.tech.technicianId)
    if (!ticket) return techBad('Ticket not found', 'NOT_FOUND', 404)
    if (!isEditable(ticket.status)) return techBad('This ticket has been submitted. Ask the office to reopen it.', 'CONFLICT', 409)

    const body = (await request.json()) as {
      itemId?: string
      variationId?: string | null
      qty?: number
      eventType?: string
      equipmentId?: string | null
    }
    if (!body.itemId) return techBad('An item is required')
    if (!Number.isInteger(body.qty) || (body.qty as number) <= 0) return techBad('Quantity must be a whole number greater than zero')
    const qty = body.qty as number

    const derived = deriveEventType(
      { add: ticket.feature_add, return: ticket.feature_return, dtc: ticket.feature_dtc },
      body.eventType
    )
    if (!derived.ok) return techBad(derived.error)
    const eventType = derived.eventType

    const { data: item } = await supabase
      .from('billing_items')
      .select('id, tracked, rentable')
      .eq('id', body.itemId)
      .maybeSingle()
    if (!item) return techBad('Item not found', 'NOT_FOUND', 404)
    if (!item.rentable) return techBad('That item isn’t equipment.')
    if (item.tracked && !body.equipmentId?.trim()) return techBad('This item is tracked — an equipment ID is required')

    // You can only hand back (or lose) what's actually on rent for this JOB.
    if (eventType !== 'pickup') {
      const onRent = await onRentFor(supabase, ticket.job_id, body.itemId, body.variationId ?? null)
      if (qty > onRent) return techBad(`Only ${onRent} on rent for that item — can't ${eventType} ${qty}.`, 'CONFLICT', 409)
    }

    const { error } = await supabase.from('billing_ticket_ledger').insert({
      ticket_id: params.id,
      job_id: ticket.job_id,
      item_id: body.itemId,
      variation_id: body.variationId ?? null,
      event_type: eventType,
      event_date: ticket.ticket_date, // the crew records against the ticket's day
      qty,
      equipment_id: body.equipmentId?.trim() || null,
    })
    if (error) throw new Error(error.message)

    return NextResponse.json({ success: true })
  } catch (err) {
    return billingApiError(err)
  }
}

export async function DELETE(request: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  try {
    const ctx = await getTechContext()
    if (!ctx.ok) return ctx.response

    const url = new URL(request.url)
    const entryId = url.searchParams.get('entryId')
    if (!entryId) return techBad('entryId is required')

    const supabase = createServiceClient()
    const ticket = await loadAssignedTicket(supabase, params.id, ctx.tech.technicianId)
    if (!ticket) return techBad('Ticket not found', 'NOT_FOUND', 404)
    if (!isEditable(ticket.status)) return techBad('This ticket has been submitted. Ask the office to reopen it.', 'CONFLICT', 409)

    const { error } = await supabase
      .from('billing_ticket_ledger')
      .delete()
      .eq('id', entryId)
      .eq('ticket_id', params.id)
    if (error) throw new Error(error.message)

    return NextResponse.json({ success: true })
  } catch (err) {
    return billingApiError(err)
  }
}
