import { NextResponse } from 'next/server'
import { getAccessContext, guardAdminOnly } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { billingApiError } from '@/lib/billing/http'
import { nextNumber } from '@/lib/billing/rpc'
import { broadcastDispatchChanged } from '@/lib/realtime/broadcast'

/**
 * Dispatch → ticket assignment. This is the hub of the tech workflow: dispatching a tech to
 * a day resolves to a ticket their time will log against.
 *
 *   mode 'ticket' — add the dispatched tech(s) to an existing ticket.
 *   mode 'job'    — GENERATE a ticket (defaults to DTC) for the job on that date, then add
 *                   the tech(s). (Creating a brand-new job first is done by the dialog via
 *                   POST /api/billing/jobs; it then calls this with the new jobId.)
 *
 * The first dispatched tech becomes the ticket's lead if it has none. Yard shifts have no
 * ticket and are handled elsewhere.
 */

function bad(error: string, code = 'VALIDATION_ERROR', status = 400) {
  return NextResponse.json({ success: false, error, code }, { status })
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const guard = guardAdminOnly(ctx.access.role)
    if (guard) return guard

    const body = (await request.json()) as {
      mode?: 'ticket' | 'job' | 'yard'
      date?: string
      technicianIds?: string[]
      ticketId?: string
      jobId?: string
      branchId?: string | null
    }
    const techIds = [...new Set((body.technicianIds ?? []).filter(Boolean))]
    if (body.mode !== 'ticket' && body.mode !== 'job' && body.mode !== 'yard') return bad('mode must be ticket, job, or yard')
    if (techIds.length === 0) return bad('At least one technician is required')

    const supabase = createServiceClient()

    // ── Yard: no ticket. One yard shift per tech per day; time logs there (excluded from
    // billing). Re-dispatching to yard is idempotent.
    if (body.mode === 'yard') {
      if (!body.date) return bad('A date is required')
      const { error } = await supabase
        .from('billing_yard_shifts')
        .upsert(
          techIds.map((id) => ({ technician_id: id, shift_date: body.date as string, branch_id: body.branchId || null })),
          { onConflict: 'technician_id,shift_date' }
        )
      if (error) throw new Error(error.message)
      await broadcastDispatchChanged()
      return NextResponse.json({ success: true, data: { yard: true, count: techIds.length } })
    }

    let ticketId: string
    let ticketNumber: string | null = null

    if (body.mode === 'ticket') {
      if (!body.ticketId) return bad('ticketId is required')
      const { data: tk } = await supabase
        .from('billing_tickets')
        .select('id, is_voided, billing_jobs(branch_id)')
        .eq('id', body.ticketId)
        .maybeSingle()
      const t = tk as unknown as { id: string; is_voided: boolean; billing_jobs: { branch_id: string } | null } | null
      if (!t) return bad('Ticket not found', 'NOT_FOUND', 404)
      if (t.is_voided) return bad('That ticket is voided.', 'CONFLICT', 409)
      if (ctx.access.branchIds !== null && (!t.billing_jobs || !ctx.access.branchIds.includes(t.billing_jobs.branch_id))) {
        return bad('You do not have access to this ticket’s branch.', 'FORBIDDEN', 403)
      }
      ticketId = t.id
    } else {
      // mode 'job' — generate a DTC ticket for the job on the shift date.
      if (!body.jobId) return bad('jobId is required')
      if (!body.date) return bad('A date is required')
      const { data: job } = await supabase
        .from('billing_jobs')
        .select('id, entity_id, branch_id')
        .eq('id', body.jobId)
        .maybeSingle()
      if (!job) return bad('Job not found', 'NOT_FOUND', 404)
      if (ctx.access.branchIds !== null && !ctx.access.branchIds.includes(job.branch_id)) {
        return bad('You do not have access to this job’s branch.', 'FORBIDDEN', 403)
      }
      const num = await nextNumber(supabase, 'ticket', job.entity_id, job.branch_id)
      const { data: created, error: cErr } = await supabase
        .from('billing_tickets')
        .insert({
          ticket_number: num,
          job_id: job.id,
          entity_id: job.entity_id,
          ticket_date: body.date,
          feature_add: false,
          feature_return: false,
          feature_dtc: true, // dispatch defaults to a day-charge ticket
        })
        .select('id, ticket_number')
        .single()
      if (cErr || !created) throw new Error(cErr?.message ?? 'Failed to generate ticket')
      ticketId = created.id
      ticketNumber = created.ticket_number
    }

    // Add the dispatched tech(s) to the ticket crew. The first becomes lead if the ticket
    // has none yet; techs already on the ticket are left as-is.
    const { data: existingCrew } = await supabase
      .from('billing_ticket_assignments')
      .select('technician_id, is_lead')
      .eq('ticket_id', ticketId)
    const onTicket = new Set((existingCrew ?? []).map((c) => c.technician_id))
    let hasLead = (existingCrew ?? []).some((c) => c.is_lead)

    const toAdd = techIds.filter((id) => !onTicket.has(id))
    for (const id of toAdd) {
      const makeLead = !hasLead
      const { error } = await supabase
        .from('billing_ticket_assignments')
        .insert({ ticket_id: ticketId, technician_id: id, is_lead: makeLead })
      if (error) throw new Error(error.message)
      if (makeLead) hasLead = true
    }

    await broadcastDispatchChanged()
    return NextResponse.json({ success: true, data: { ticketId, ticketNumber, added: toAdd.length } })
  } catch (err) {
    return billingApiError(err)
  }
}

/** Remove a yard shift (only if it has no logged time). */
export async function DELETE(request: Request): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const guard = guardAdminOnly(ctx.access.role)
    if (guard) return guard

    const id = new URL(request.url).searchParams.get('yardShiftId')
    if (!id) return bad('yardShiftId is required')

    const supabase = createServiceClient()
    const { count } = await supabase
      .from('billing_yard_time')
      .select('id', { count: 'exact', head: true })
      .eq('yard_shift_id', id)
    if ((count ?? 0) > 0) return bad('This yard shift has time logged. Remove the time first.', 'CONFLICT', 409)

    const { error } = await supabase.from('billing_yard_shifts').delete().eq('id', id)
    if (error) throw new Error(error.message)
    await broadcastDispatchChanged()
    return NextResponse.json({ success: true })
  } catch (err) {
    return billingApiError(err)
  }
}
