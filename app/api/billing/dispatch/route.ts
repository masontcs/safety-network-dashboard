import { NextResponse } from 'next/server'
import { getAccessContext, guardAdminOnly } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { billingApiError } from '@/lib/billing/http'

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
      .select('id, ticket_number, ticket_date, feature_add, feature_return, feature_dtc, billing_jobs(job_number, name, branch_id, billing_profiles(billing_customers(name)))')
      .gte('ticket_date', weekStart).lte('ticket_date', weekEnd)
    const { data: tkRaw } = await tq
    let tickets = (tkRaw ?? []) as unknown as {
      id: string; ticket_number: string; ticket_date: string; feature_add: boolean; feature_return: boolean; feature_dtc: boolean
      billing_jobs: { job_number: string; name: string | null; branch_id: string; billing_profiles: { billing_customers: { name: string } | null } | null } | null
    }[]
    const reqBranch = url.searchParams.get('branchId') || ''
    let effBranchIds = ctx.access.branchIds
    if (reqBranch) effBranchIds = effBranchIds === null ? [reqBranch] : effBranchIds.filter((b) => b === reqBranch)
    if (effBranchIds !== null) { const allow = new Set(effBranchIds); tickets = tickets.filter((t) => t.billing_jobs && allow.has(t.billing_jobs.branch_id)) }

    // lead technician per ticket
    const leadByTicket = new Map<string, string>()
    if (tickets.length) {
      const { data: asg } = await supabase.from('billing_ticket_assignments').select('ticket_id, technician_id, is_lead').in('ticket_id', tickets.map((t) => t.id)).eq('is_lead', true)
      for (const a of (asg ?? []) as { ticket_id: string; technician_id: string }[]) leadByTicket.set(a.ticket_id, a.technician_id)
    }

    return NextResponse.json({
      success: true,
      data: {
        weekStart,
        days: Array.from({ length: 5 }, (_, i) => addDays(weekStart, i)),
        technicians: techs,
        tickets: tickets.map((t) => ({
          id: t.id, ticketNumber: t.ticket_number, date: t.ticket_date,
          leadTechId: leadByTicket.get(t.id) ?? null,
          feature: t.feature_dtc ? 'dtc' : t.feature_return ? 'return' : 'add',
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

    // Reassign the lead technician: clear the current lead, set the new one.
    if (body.technicianId !== undefined) {
      await supabase.from('billing_ticket_assignments').delete().eq('ticket_id', body.ticketId).eq('is_lead', true)
      if (body.technicianId) {
        const { error } = await supabase.from('billing_ticket_assignments').insert({ ticket_id: body.ticketId, technician_id: body.technicianId, is_lead: true })
        if (error) throw new Error(error.message)
      }
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    return billingApiError(err)
  }
}
