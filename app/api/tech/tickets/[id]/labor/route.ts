import { NextResponse } from 'next/server'
import { getTechContext, loadAssignedTicket, techBad, isEditable } from '@/lib/api/tech'
import { createServiceClient } from '@/lib/supabase/server'
import { billingApiError } from '@/lib/billing/http'
import { timeToMinutes, minutesToTime, roundToQuarter, segmentMinutes } from '@/lib/billing/labor'

/**
 * A tech recording their time — the core loop of the app.
 *
 * Times, never sums: the API rounds start/end to the nearest quarter hour and derives
 * the duration (end < start = crossed midnight). See v2-labor-model.md.
 *
 * A crew tech may only touch **their own** segments. The LEAD may enter/remove time for
 * anyone on the crew — `entered_by` records who typed it, while the hours stay owned by
 * `technician_id`, so entering on behalf never rewrites who reported what.
 */

function normalise(start?: string, end?: string): { start: string; end: string } | string {
  if (!start || !end) return 'A start and end time are required'
  const s0 = timeToMinutes(start)
  const e0 = timeToMinutes(end)
  if (Number.isNaN(s0) || Number.isNaN(e0)) return 'Times must be valid (HH:MM)'
  const s = roundToQuarter(s0)
  const e = roundToQuarter(e0)
  if (s === e) return 'Start and end round to the same quarter hour — that segment has no length.'
  if (segmentMinutes(s, e) <= 0) return 'That segment has no length.'
  return { start: minutesToTime(s), end: minutesToTime(e) }
}

export async function POST(request: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  try {
    const ctx = await getTechContext()
    if (!ctx.ok) return ctx.response

    const supabase = createServiceClient()
    const ticket = await loadAssignedTicket(supabase, params.id, ctx.tech.technicianId)
    if (!ticket) return techBad('Ticket not found', 'NOT_FOUND', 404)
    if (!isEditable(ticket.status)) return techBad('This ticket has been submitted. Ask the office to reopen it.', 'CONFLICT', 409)

    const body = (await request.json()) as { activityTypeId?: string; startTime?: string; endTime?: string; technicianId?: string }
    if (!body.activityTypeId) return techBad('An activity is required')

    // Whose time is this? Only the lead may record for someone else.
    const forTech = body.technicianId ?? ctx.tech.technicianId
    if (forTech !== ctx.tech.technicianId) {
      if (!ticket.isLead) return techBad('Only the lead can enter time for someone else.', 'FORBIDDEN', 403)
      const { data: onCrew } = await supabase
        .from('billing_ticket_assignments')
        .select('id')
        .eq('ticket_id', params.id)
        .eq('technician_id', forTech)
        .maybeSingle()
      if (!onCrew) return techBad('That technician is not on this ticket.', 'VALIDATION_ERROR', 400)
    }

    const norm = normalise(body.startTime, body.endTime)
    if (typeof norm === 'string') return techBad(norm)

    const { error } = await supabase.from('billing_ticket_labor').insert({
      ticket_id: params.id,
      technician_id: forTech,
      activity_type_id: body.activityTypeId,
      start_time: norm.start,
      end_time: norm.end,
      // The hours belong to forTech; this only records who typed them.
      entered_by: ctx.tech.userId,
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

    const { data: entry } = await supabase
      .from('billing_ticket_labor')
      .select('id, technician_id')
      .eq('id', entryId)
      .eq('ticket_id', params.id)
      .maybeSingle()
    if (!entry) return techBad('Time entry not found', 'NOT_FOUND', 404)

    // Your own time, or anyone's if you're the lead.
    if (entry.technician_id !== ctx.tech.technicianId && !ticket.isLead) {
      return techBad('You can only remove your own time.', 'FORBIDDEN', 403)
    }

    const { error } = await supabase.from('billing_ticket_labor').delete().eq('id', entryId).eq('ticket_id', params.id)
    if (error) throw new Error(error.message)

    return NextResponse.json({ success: true })
  } catch (err) {
    return billingApiError(err)
  }
}
