import { NextResponse } from 'next/server'
import { getAccessContext, guardBillingArea } from '@/lib/api/auth'
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
const iso = (dt: Date) => dt.toISOString().slice(0, 10)

type Range = 'day' | 'week' | 'month'

// The [start,end] date span and the day columns to render for a given range + anchor date.
// Week stays Mon–Fri (the work week). Day is one column. Month spans the calendar month, and
// its `days` is every date in the month (the client lays them out as a calendar grid).
function spanFor(range: Range, anchor: string): { start: string; end: string; days: string[] } {
  if (range === 'day') return { start: anchor, end: anchor, days: [anchor] }
  if (range === 'month') {
    const dt = new Date(anchor + 'T00:00:00Z')
    const start = iso(new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), 1)))
    const endDt = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0))
    const end = iso(endDt)
    const days: string[] = []
    for (let d = 1; d <= endDt.getUTCDate(); d++) days.push(iso(new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), d))))
    return { start, end, days }
  }
  const start = mondayOf(anchor)
  return { start, end: addDays(start, 4), days: Array.from({ length: 5 }, (_, i) => addDays(start, i)) }
}

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const supabase = createServiceClient()

    const url = new URL(request.url)
    // Anchor date: prefer `date`, fall back to the legacy `week` param, else today.
    const anchor = url.searchParams.get('date') || url.searchParams.get('week') || new Date().toISOString().slice(0, 10)
    const rangeParam = (url.searchParams.get('range') || 'week') as Range
    const range: Range = rangeParam === 'day' || rangeParam === 'month' ? rangeParam : 'week'
    const { start: rangeStart, end: rangeEnd, days } = spanFor(range, anchor)

    const { data: techRaw } = await supabase.from('billing_technicians').select('id, name').eq('is_active', true).order('name')
    const techs = (techRaw ?? []) as { id: string; name: string }[]

    const tq = supabase
      .from('billing_tickets')
      .select('id, ticket_number, ticket_date, feature_add, feature_return, feature_dtc, is_voided, billing_jobs(job_number, name, branch_id, billing_profiles(billing_customers(name)))')
      .gte('ticket_date', rangeStart).lte('ticket_date', rangeEnd)
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

    // Per-ticket job types — carried from the shift that published the ticket (billing_shifts
    // links back via ticket_id → billing_shift_job_types). Tickets not created from a shift have
    // none. Powers the "group by job type" view.
    const jobTypesByTicket = new Map<string, string[]>()
    if (tickets.length) {
      const { data: pubShifts } = await supabase.from('billing_shifts').select('id, ticket_id').in('ticket_id', tickets.map((t) => t.id))
      const shiftToTicket = new Map<string, string>()
      for (const s of (pubShifts ?? []) as { id: string; ticket_id: string | null }[]) if (s.ticket_id) shiftToTicket.set(s.id, s.ticket_id)
      if (shiftToTicket.size) {
        const { data: sjt } = await supabase.from('billing_shift_job_types').select('shift_id, job_type').in('shift_id', [...shiftToTicket.keys()])
        for (const r of (sjt ?? []) as { shift_id: string; job_type: string }[]) {
          const tid = shiftToTicket.get(r.shift_id); if (!tid) continue
          jobTypesByTicket.set(tid, [...(jobTypesByTicket.get(tid) ?? []), r.job_type])
        }
      }
    }

    // Yard shifts in range (no ticket). Branch-scoped when a branch is in effect; yard
    // shifts with no branch always show (they're unassigned to a branch).
    const { data: yardRaw } = await supabase
      .from('billing_yard_shifts')
      .select('id, technician_id, branch_id, shift_date')
      .gte('shift_date', rangeStart).lte('shift_date', rangeEnd)
    let yardShifts = (yardRaw ?? []) as { id: string; technician_id: string; branch_id: string | null; shift_date: string }[]
    if (effBranchIds !== null) {
      const allow = new Set(effBranchIds)
      yardShifts = yardShifts.filter((y) => y.branch_id === null || allow.has(y.branch_id))
    }

    return NextResponse.json({
      success: true,
      data: {
        range,
        rangeStart,
        rangeEnd,
        // `weekStart` kept for any caller still reading it; equals rangeStart.
        weekStart: rangeStart,
        days,
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
          jobTypes: jobTypesByTicket.get(t.id) ?? [],
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
    const guard = guardBillingArea(ctx.access, 'dispatch')
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
