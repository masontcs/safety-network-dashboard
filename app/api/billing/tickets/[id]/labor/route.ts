import { NextResponse } from 'next/server'
import { getAccessContext, guardAdminOnly } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { billingApiError } from '@/lib/billing/http'
import { timeToMinutes, minutesToTime, roundToQuarter, segmentMinutes, minutesToHours } from '@/lib/billing/labor'
import type { Database } from '@/lib/supabase/database.types'

/**
 * Labor TIME SEGMENTS on a ticket (layer 1 — see v2-labor-model.md).
 *
 * Techs record times, not sums: `0700-1100 Transit`. Hours are always derived.
 * Times are normalised to the nearest quarter hour on save, and a segment may
 * cross midnight (end < start). These records are the source of truth — billing
 * rolls them up separately and never writes back here.
 */

type LaborUpdate = Database['public']['Tables']['billing_ticket_labor']['Update']

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
const isLocked = (s: string) => s === 'final_edit' || s === 'invoiced'

/** Validate + normalise a start/end pair to quarter hours. */
function normaliseTimes(start?: string, end?: string): { start: string; end: string; minutes: number } | string {
  if (!start || !end) return 'A start and end time are required'
  const s0 = timeToMinutes(start)
  const e0 = timeToMinutes(end)
  if (Number.isNaN(s0) || Number.isNaN(e0)) return 'Times must be valid (HH:MM)'
  const s = roundToQuarter(s0)
  const e = roundToQuarter(e0)
  if (s === e) return 'Start and end round to the same quarter hour — that segment has no length.'
  return { start: minutesToTime(s), end: minutesToTime(e), minutes: segmentMinutes(s, e) }
}

interface LaborRow {
  id: string
  start_time: string
  end_time: string
  billing_technicians: { id: string; name: string } | null
  billing_activity_types: { id: string; name: string } | null
}

export async function GET(_request: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response

    const supabase = createServiceClient()
    const ticket = await loadTicket(supabase, params.id)
    if (!ticket) return bad('Ticket not found', 'NOT_FOUND', 404)
    if (branchDenied(ctx, ticket)) return bad('You do not have access to this ticket’s branch.', 'FORBIDDEN', 403)

    const { data, error } = await supabase
      .from('billing_ticket_labor')
      .select('id, start_time, end_time, billing_technicians(id, name), billing_activity_types(id, name)')
      .eq('ticket_id', params.id)
      .order('start_time')
    if (error) throw new Error(error.message)
    const rows = (data ?? []) as unknown as LaborRow[]

    return NextResponse.json({
      success: true,
      data: rows.map((r) => {
        const mins = segmentMinutes(timeToMinutes(r.start_time), timeToMinutes(r.end_time))
        return {
          id: r.id,
          startTime: r.start_time.slice(0, 5),
          endTime: r.end_time.slice(0, 5),
          crossesMidnight: timeToMinutes(r.end_time) < timeToMinutes(r.start_time),
          minutes: mins,
          hours: minutesToHours(mins),
          technician: r.billing_technicians ? { id: r.billing_technicians.id, name: r.billing_technicians.name } : null,
          activityType: r.billing_activity_types ? { id: r.billing_activity_types.id, name: r.billing_activity_types.name } : null,
        }
      }),
    })
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
    if (isLocked(ticket.status)) return bad('This ticket is locked. Reopen it to change labor.', 'CONFLICT', 409)

    const body = (await request.json()) as { technicianId?: string; activityTypeId?: string; startTime?: string; endTime?: string }
    if (!body.technicianId) return bad('A technician is required')
    if (!body.activityTypeId) return bad('An activity type is required')

    const norm = normaliseTimes(body.startTime, body.endTime)
    if (typeof norm === 'string') return bad(norm)

    const { error } = await supabase.from('billing_ticket_labor').insert({
      ticket_id: params.id,
      technician_id: body.technicianId,
      activity_type_id: body.activityTypeId,
      start_time: norm.start,
      end_time: norm.end,
    })
    if (error) throw new Error(error.message)

    return NextResponse.json({ success: true })
  } catch (err) {
    return billingApiError(err)
  }
}

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
    if (isLocked(ticket.status)) return bad('This ticket is locked. Reopen it to change labor.', 'CONFLICT', 409)

    const body = (await request.json()) as { entryId?: string; technicianId?: string; activityTypeId?: string; startTime?: string; endTime?: string }
    if (!body.entryId) return bad('entryId is required')

    const { data: existing, error: exErr } = await supabase
      .from('billing_ticket_labor')
      .select('id, start_time, end_time')
      .eq('id', body.entryId)
      .eq('ticket_id', params.id)
      .maybeSingle()
    if (exErr) throw new Error(exErr.message)
    if (!existing) return bad('Labor entry not found', 'NOT_FOUND', 404)

    const patch: LaborUpdate = {}
    if (body.technicianId) patch.technician_id = body.technicianId
    if (body.activityTypeId) patch.activity_type_id = body.activityTypeId

    if (body.startTime !== undefined || body.endTime !== undefined) {
      const norm = normaliseTimes(body.startTime ?? existing.start_time, body.endTime ?? existing.end_time)
      if (typeof norm === 'string') return bad(norm)
      patch.start_time = norm.start
      patch.end_time = norm.end
    }

    const { error } = await supabase.from('billing_ticket_labor').update(patch).eq('id', body.entryId).eq('ticket_id', params.id)
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
    const entryId = url.searchParams.get('entryId')
    if (!entryId) return bad('entryId is required')

    const supabase = createServiceClient()
    const ticket = await loadTicket(supabase, params.id)
    if (!ticket) return bad('Ticket not found', 'NOT_FOUND', 404)
    if (branchDenied(ctx, ticket)) return bad('You do not have access to this ticket’s branch.', 'FORBIDDEN', 403)
    if (isLocked(ticket.status)) return bad('This ticket is locked.', 'CONFLICT', 409)

    const { error } = await supabase.from('billing_ticket_labor').delete().eq('id', entryId).eq('ticket_id', params.id)
    if (error) throw new Error(error.message)

    return NextResponse.json({ success: true })
  } catch (err) {
    return billingApiError(err)
  }
}
