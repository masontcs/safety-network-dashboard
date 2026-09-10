import { NextResponse } from 'next/server'
import { getTechContext, loadAssignedTicket, techBad, isEditable } from '@/lib/api/tech'
import { createServiceClient } from '@/lib/supabase/server'
import { billingApiError } from '@/lib/billing/http'
import { broadcastBillingChanged } from '@/lib/realtime/broadcast'

/**
 * The lead hands the ticket back to the office: active → in_review.
 *
 * Only the LEAD on this ticket may submit. A crew tech logs their time and is done —
 * one accountable submitter means nobody can strand a colleague's hours by finishing
 * first.
 *
 * After this the ticket stops matching "assigned AND active", so it disappears from the
 * whole crew's app. If the office reopens it (back to active) it reappears — that's the
 * correction loop, and it needs no extra state.
 */
export async function POST(_request: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  try {
    const ctx = await getTechContext()
    if (!ctx.ok) return ctx.response

    const supabase = createServiceClient()
    const ticket = await loadAssignedTicket(supabase, params.id, ctx.tech.technicianId)
    if (!ticket) return techBad('Ticket not found', 'NOT_FOUND', 404)
    if (!isEditable(ticket.status)) return techBad('This ticket has already been submitted.', 'CONFLICT', 409)
    if (!ticket.isLead) return techBad('Only the lead can submit this ticket.', 'FORBIDDEN', 403)

    // Guard the pointless submit: no time at all almost certainly means a mistake.
    const { count } = await supabase
      .from('billing_ticket_labor')
      .select('id', { count: 'exact', head: true })
      .eq('ticket_id', params.id)
    if ((count ?? 0) === 0) {
      return techBad('No time has been logged on this ticket yet.', 'CONFLICT', 409)
    }

    const { error } = await supabase
      .from('billing_tickets')
      .update({ status: 'in_review' })
      .eq('id', params.id)
      .eq('status', 'active') // don't race a status change from the office
    if (error) throw new Error(error.message)

    // A resubmit after a return-to-adjust must clear the stale "Returned" label: any time-approval
    // batch that covers this ticket's logged time (per technician + work day) goes back to
    // 'submitted' so it re-enters the office review queue. Only 'returned' rows are touched —
    // approved batches are left alone.
    const { data: tkRow } = await supabase
      .from('billing_tickets')
      .select('ticket_date, billing_jobs!inner(branch_id)')
      .eq('id', params.id)
      .maybeSingle()
    const branchId = (tkRow as unknown as { billing_jobs: { branch_id: string } | null } | null)?.billing_jobs?.branch_id ?? null
    const ticketDate = (tkRow as unknown as { ticket_date: string } | null)?.ticket_date ?? null
    if (branchId && ticketDate) {
      const { data: lab } = await supabase
        .from('billing_ticket_labor')
        .select('technician_id, work_date')
        .eq('ticket_id', params.id)
      const pairs = new Map<string, { tech: string; date: string }>()
      for (const l of (lab ?? []) as { technician_id: string; work_date: string | null }[]) {
        const date = l.work_date ?? ticketDate
        pairs.set(`${l.technician_id}|${date}`, { tech: l.technician_id, date })
      }
      for (const { tech, date } of pairs.values()) {
        await supabase
          .from('billing_time_approvals')
          .update({ status: 'submitted', note: null, updated_at: new Date().toISOString() })
          .eq('technician_id', tech).eq('branch_id', branchId).eq('work_date', date).eq('status', 'returned')
      }
    }

    // Reflect the resubmit live on the office's Time Management + tickets views.
    await broadcastBillingChanged()

    return NextResponse.json({ success: true })
  } catch (err) {
    return billingApiError(err)
  }
}
