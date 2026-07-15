import { NextResponse } from 'next/server'
import { getAccessContext, guardAdminOnly } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { billingApiError } from '@/lib/billing/http'

/**
 * Crew on a ticket — who worked it, and which of them is the LEAD.
 *
 * The lead is just the crew member with is_lead set, assigned per TICKET so it can
 * change day to day as crews shuffle. The lead is accountable for the whole crew's
 * time being in and is the only one who can submit the ticket from the tech app.
 *
 * A ticket with crew but no lead has nobody who can submit it, so the UI nudges for
 * one. (The office is admin and can always move status itself, so nothing is stranded.)
 */

function bad(error: string, code = 'VALIDATION_ERROR', status = 400) {
  return NextResponse.json({ success: false, error, code }, { status })
}
type SB = ReturnType<typeof createServiceClient>

async function loadTicket(supabase: SB, id: string) {
  const { data, error } = await supabase
    .from('billing_tickets')
    .select('id, status, billing_jobs(branch_id)')
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data as unknown as { id: string; status: string; billing_jobs: { branch_id: string } | null } | null
}

type Ctx = Extract<Awaited<ReturnType<typeof getAccessContext>>, { ok: true }>
function branchDenied(ctx: Ctx, ticket: { billing_jobs: { branch_id: string } | null }) {
  return ctx.access.branchIds !== null && (!ticket.billing_jobs || !ctx.access.branchIds.includes(ticket.billing_jobs.branch_id))
}

interface Row { id: string; is_lead: boolean; billing_technicians: { id: string; name: string } | null }

export async function GET(_request: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response

    const supabase = createServiceClient()
    const ticket = await loadTicket(supabase, params.id)
    if (!ticket) return bad('Ticket not found', 'NOT_FOUND', 404)
    if (branchDenied(ctx, ticket)) return bad('You do not have access to this ticket’s branch.', 'FORBIDDEN', 403)

    const { data, error } = await supabase
      .from('billing_ticket_assignments')
      .select('id, is_lead, billing_technicians(id, name)')
      .eq('ticket_id', params.id)
    if (error) throw new Error(error.message)
    const rows = (data ?? []) as unknown as Row[]

    // Lead first, then by name — the lead is the one people look for.
    const crew = rows
      .map((r) => ({ id: r.id, isLead: r.is_lead, technician: r.billing_technicians ? { id: r.billing_technicians.id, name: r.billing_technicians.name } : null }))
      .sort((a, b) => (Number(b.isLead) - Number(a.isLead)) || (a.technician?.name ?? '').localeCompare(b.technician?.name ?? ''))

    return NextResponse.json({ success: true, data: crew })
  } catch (err) {
    return billingApiError(err)
  }
}

export async function POST(request: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const guard = guardAdminOnly(ctx.access.role)
    if (guard) return guard

    const supabase = createServiceClient()
    const ticket = await loadTicket(supabase, params.id)
    if (!ticket) return bad('Ticket not found', 'NOT_FOUND', 404)
    if (branchDenied(ctx, ticket)) return bad('You do not have access to this ticket’s branch.', 'FORBIDDEN', 403)

    const body = (await request.json()) as { technicianId?: string; isLead?: boolean }
    if (!body.technicianId) return bad('A technician is required')

    const { data: dup } = await supabase
      .from('billing_ticket_assignments')
      .select('id')
      .eq('ticket_id', params.id)
      .eq('technician_id', body.technicianId)
      .maybeSingle()
    if (dup) return bad('That technician is already on this ticket', 'CONFLICT', 409)

    // Only one lead per ticket — stand the old one down first (the DB enforces it too).
    if (body.isLead) {
      const { error: clr } = await supabase
        .from('billing_ticket_assignments')
        .update({ is_lead: false })
        .eq('ticket_id', params.id)
        .eq('is_lead', true)
      if (clr) throw new Error(clr.message)
    }

    const { error } = await supabase.from('billing_ticket_assignments').insert({
      ticket_id: params.id,
      technician_id: body.technicianId,
      is_lead: body.isLead ?? false,
    })
    if (error) throw new Error(error.message)

    return NextResponse.json({ success: true })
  } catch (err) {
    return billingApiError(err)
  }
}

/** Promote a crew member to lead (demoting whoever held it). */
export async function PATCH(request: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const guard = guardAdminOnly(ctx.access.role)
    if (guard) return guard

    const supabase = createServiceClient()
    const ticket = await loadTicket(supabase, params.id)
    if (!ticket) return bad('Ticket not found', 'NOT_FOUND', 404)
    if (branchDenied(ctx, ticket)) return bad('You do not have access to this ticket’s branch.', 'FORBIDDEN', 403)

    const body = (await request.json()) as { assignmentId?: string }
    if (!body.assignmentId) return bad('assignmentId is required')

    const { data: row, error: rErr } = await supabase
      .from('billing_ticket_assignments')
      .select('id')
      .eq('id', body.assignmentId)
      .eq('ticket_id', params.id)
      .maybeSingle()
    if (rErr) throw new Error(rErr.message)
    if (!row) return bad('Crew member not found on this ticket', 'NOT_FOUND', 404)

    const { error: clr } = await supabase
      .from('billing_ticket_assignments')
      .update({ is_lead: false })
      .eq('ticket_id', params.id)
      .eq('is_lead', true)
    if (clr) throw new Error(clr.message)

    const { error } = await supabase
      .from('billing_ticket_assignments')
      .update({ is_lead: true })
      .eq('id', body.assignmentId)
      .eq('ticket_id', params.id)
    if (error) throw new Error(error.message)

    return NextResponse.json({ success: true })
  } catch (err) {
    return billingApiError(err)
  }
}

export async function DELETE(request: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const guard = guardAdminOnly(ctx.access.role)
    if (guard) return guard

    const url = new URL(request.url)
    const assignmentId = url.searchParams.get('assignmentId')
    if (!assignmentId) return bad('assignmentId is required')

    const supabase = createServiceClient()
    const ticket = await loadTicket(supabase, params.id)
    if (!ticket) return bad('Ticket not found', 'NOT_FOUND', 404)
    if (branchDenied(ctx, ticket)) return bad('You do not have access to this ticket’s branch.', 'FORBIDDEN', 403)

    // Don't strand logged time: a tech with hours on this ticket stays on the crew.
    const { data: assignment } = await supabase
      .from('billing_ticket_assignments')
      .select('technician_id')
      .eq('id', assignmentId)
      .eq('ticket_id', params.id)
      .maybeSingle()
    if (assignment) {
      const { count } = await supabase
        .from('billing_ticket_labor')
        .select('id', { count: 'exact', head: true })
        .eq('ticket_id', params.id)
        .eq('technician_id', assignment.technician_id)
      if ((count ?? 0) > 0) {
        return bad('That technician has time logged on this ticket. Remove their time first.', 'CONFLICT', 409)
      }
    }

    const { error } = await supabase.from('billing_ticket_assignments').delete().eq('id', assignmentId).eq('ticket_id', params.id)
    if (error) throw new Error(error.message)

    return NextResponse.json({ success: true })
  } catch (err) {
    return billingApiError(err)
  }
}
