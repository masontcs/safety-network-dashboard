import { NextResponse } from 'next/server'
import { getAccessContext, guardAdminOnly } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { billingApiError } from '@/lib/billing/http'
import { broadcastDispatchChanged } from '@/lib/realtime/broadcast'

/**
 * Dispatch board — the week's tickets by lead technician × day.
 *
 * A ticket sits under its LEAD technician (billing_ticket_assignments.is_lead) on its
 * ticket_date. Dragging a card reassigns the lead and/or moves the date. Tickets are
 * branch-scoped via their job.
 */

function bad(error: string, code = 'VALIDATION_ERROR', status = 400) {
  return NextResponse.json({ success: false, error, code }, { status })
}

// Monday of the week containing `d` (UTC), as YYYY-MM-DD.
function mondayOf(d: string): string {
  const dt = new Date(d + 'T00:00:00Z')
  const dow = (dt.getUTCDay() + 6) % 7 // 0 = Monday
  dt.setUTCDate(dt.getUTCDate() - dow)
  return dt.toISOString().slice(0, 10)
}
const addDays = (d: string, n: number) => { const dt = new Date(d + 'T00:00:00Z'); dt.setUTCDate(dt.getUTCDate() + n); return dt.toISOString().slice(0, 10) }

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const supabase = createServiceClient()

    const url = new URL(request.url)
    const weekStart = mondayOf(url.searchParams.get('week') || new Date().toISOString().slice(0, 10))
    const weekEnd = addDays(weekStart, 4) // Mon–Fri

    const { data: techRaw } = await supabase.from('billing_technicians').select('id, name').eq('is_active', true).order('name')
    const techs = (techRaw ?? []) as { id: string; name: string }[]

    let tq = supabase
      .from('billing_tickets')
      .select('id, ticket_number, ticket_date, feature_add, feature_return, feature_dtc, is_voided, billing_jobs(job_number, name, branch_id, billing_profiles(billing_customers(name)))')
      .gte('ticket_date', weekStart).lte('ticket_date', weekEnd)
    const { data: tkRaw } = await tq
    let tickets = (tkRaw ?? []) as unknown as {
      id: string; ticket_number: string; ticket_date: string; feature_add: boolean; feature_return: boolean; feature_dtc: boolean; is_voided: boolean
      billing_jobs: { job_number: string; name: string | null; branch_id: string; billing_profiles: { billing_customers: { name: string } | null } | null } | null
    }[]
    const reqBranch = url.searchParams.get('branchId') || ''
    let effBranchIds = ctx.access.branchIds
    if (reqBranch) effBranchIds = effBranchIds === null ? [reqBranch] : effBranchIds.filter((b) => b === reqBranch)
    if (effBranchIds !== null) { const allow = new Set(effBranchIds); tickets = tickets.filter((t) => t.billing_jobs && allow.has(t.billing_jobs.branch_id)) }

    // Crew + lead per ticket. A ticket shows under EVERY crew member assigned to it
    // (billing_ticket_assignments), not just the lead — so each tech sees their day's work.
    const leadByTicket = new Map<string, string>()
    const crewByTicket = new Map<string, string[]>()
    if (tickets.length) {
      const { data: asg } = await supabase.from('billing_ticket_assignments').select('ticket_id, technician_id, is_lead').in('ticket_id', tickets.map((t) => t.id))
      for (const a of (asg ?? []) as { ticket_id: string; technician_id: string; is_lead: boolean }[]) {
        crewByTicket.set(a.ticket_id, [...(crewByTicket.get(a.ticket_id) ?? []), a.technician_id])
        if (a.is_lead) leadByTicket.set(a.ticket_id, a.technician_id)
      }
    }

    // Yard shifts this week (no ticket). Branch-scoped when a branch is in effect; yard
    // shifts with no branch always show (they're unassigned to a branch).
    const { data: yardRaw } = await supabase
      .from('billing_yard_shifts')
      .select('id, technician_id, branch_id, shift_date')
      .gte('shift_date', weekStart).lte('shift_date', weekEnd)
    let yardShifts = (yardRaw ?? []) as { id: string; technician_id: string; branch_id: string | null; shift_date: string }[]
    if (effBranchIds !== null) {
      const allow = new Set(effBranchIds)
      yardShifts = yardShifts.filter((y) => y.branch_id === null || allow.has(y.branch_id))
    }

    return NextResponse.json({
      success: true,
      data: {
        weekStart,
        days: Array.from({ length: 5 }, (_, i) => addDays(weekStart, i)),
        technicians: techs,
        yard: yardShifts.map((y) => ({ id: y.id, technicianId: y.technician_id, date: y.shift_date })),
        tickets: tickets.map((t) => ({
          id: t.id, ticketNumber: t.ticket_number, date: t.ticket_date,
          leadTechId: leadByTicket.get(t.id) ?? null,
          crewTechIds: crewByTicket.get(t.id) ?? [],
          feature: t.feature_dtc ? 'dtc' : t.feature_return ? 'return' : 'add',
          voided: t.is_voided,
          jobNumber: t.billing_jobs?.job_number ?? '',
          jobName: t.billing_jobs?.name ?? null,
          customer: t.billing_jobs?.billing_profiles?.billing_customers?.name ?? null,
        })),
        isAdmin: ctx.access.role === 'admin',
      },
    })
  } catch (err) {
    return billingApiError(err)
  }
}

export async function PATCH(request: Request): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const guard = guardAdminOnly(ctx.access.role)
    if (guard) return guard

    const body = (await request.json()) as { ticketId?: string; technicianId?: string | null; ticketDate?: string }
    if (!body.ticketId) return bad('ticketId is required')
    const supabase = createServiceClient()

    const { data: tk } = await supabase.from('billing_tickets').select('id, status, billing_jobs(branch_id)').eq('id', body.ticketId).maybeSingle()
    const t = tk as unknown as { id: string; status: string; billing_jobs: { branch_id: string } | null } | null
    if (!t) return bad('Ticket not found', 'NOT_FOUND', 404)
    if (ctx.access.branchIds !== null && (!t.billing_jobs || !ctx.access.branchIds.includes(t.billing_jobs.branch_id))) return bad('No access to this branch.', 'FORBIDDEN', 403)

    // Move the date (dropping on another day column).
    if (body.ticketDate) {
      const { error } = await supabase.from('billing_tickets').update({ ticket_date: body.ticketDate }).eq('id', body.ticketId)
      if (error) throw new Error(error.message)
    }

    // Reassign the lead technician. Demote whoever is currently lead, then make the target
    // the lead — via UPSERT so promoting an EXISTING crew member doesn't collide with the
    // unique (ticket_id, technician_id) row (a plain insert would throw for someone already
    // on the crew now that the board shows the whole crew).
    if (body.technicianId !== undefined) {
      await supabase.from('billing_ticket_assignments').update({ is_lead: false }).eq('ticket_id', body.ticketId).eq('is_lead', true)
      if (body.technicianId) {
        const { error } = await supabase
          .from('billing_ticket_assignments')
          .upsert({ ticket_id: body.ticketId, technician_id: body.technicianId, is_lead: true }, { onConflict: 'ticket_id,technician_id' })
        if (error) throw new Error(error.message)
      }
    }

    await broadcastDispatchChanged()
    return NextResponse.json({ success: true })
  } catch (err) {
    return billingApiError(err)
  }
}
