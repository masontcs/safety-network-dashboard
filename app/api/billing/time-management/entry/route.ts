import { NextResponse } from 'next/server'
import { getAccessContext } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { billingApiError } from '@/lib/billing/http'
import { canApproveBranch } from '@/lib/billing/approvers'
import { broadcastBillingChanged } from '@/lib/realtime/broadcast'
import { timeToMinutes, minutesToTime, roundToQuarter, segmentMinutes } from '@/lib/billing/labor'

/**
 * Admin time edits live HERE, not on the ticket — because times drive payroll and must go
 * through the approver's surface. Editing or deleting an entry re-opens its (tech, branch,
 * day) batch for approval (an approved batch drops back to 'submitted'), so a change can
 * never silently ride an old approval into the export. Requires a branch grant.
 */

function bad(error: string, code = 'VALIDATION_ERROR', status = 400) {
  return NextResponse.json({ success: false, error, code }, { status })
}

function normalise(start?: string, end?: string): { start: string; end: string } | string {
  if (!start || !end) return 'A start and end time are required'
  const s0 = timeToMinutes(start), e0 = timeToMinutes(end)
  if (Number.isNaN(s0) || Number.isNaN(e0)) return 'Times must be valid (HH:MM)'
  const s = roundToQuarter(s0), e = roundToQuarter(e0)
  if (s === e || segmentMinutes(s, e) <= 0) return 'That segment has no length.'
  return { start: minutesToTime(s), end: minutesToTime(e) }
}

type Svc = ReturnType<typeof createServiceClient>

// Resolve an entry to (technician, branch, effective date) — for authority + approval reset.
async function locate(supabase: Svc, kind: string, id: string): Promise<{ tech: string; branch: string; date: string } | null> {
  if (kind === 'ticket') {
    const { data } = await supabase
      .from('billing_ticket_labor')
      .select('technician_id, work_date, billing_tickets!inner(ticket_date, billing_jobs!inner(branch_id))')
      .eq('id', id).maybeSingle()
    const r = data as unknown as { technician_id: string; work_date: string | null; billing_tickets: { ticket_date: string; billing_jobs: { branch_id: string } | null } | null } | null
    if (!r || !r.billing_tickets?.billing_jobs) return null
    return { tech: r.technician_id, branch: r.billing_tickets.billing_jobs.branch_id, date: r.work_date ?? r.billing_tickets.ticket_date }
  }
  const { data } = await supabase
    .from('billing_yard_time')
    .select('technician_id, work_date, billing_yard_shifts!inner(branch_id, shift_date)')
    .eq('id', id).maybeSingle()
  const r = data as unknown as { technician_id: string; work_date: string | null; billing_yard_shifts: { branch_id: string | null; shift_date: string } | null } | null
  if (!r || !r.billing_yard_shifts?.branch_id) return null
  return { tech: r.technician_id, branch: r.billing_yard_shifts.branch_id, date: r.work_date ?? r.billing_yard_shifts.shift_date }
}

// A change re-opens the batch: an approved day drops back to submitted for re-approval.
async function reopenBatch(supabase: Svc, tech: string, branch: string, date: string) {
  await supabase.from('billing_time_approvals')
    .update({ status: 'submitted', note: null, updated_at: new Date().toISOString() })
    .eq('technician_id', tech).eq('branch_id', branch).eq('work_date', date).eq('status', 'approved')
}

export async function PATCH(request: Request): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const supabase = createServiceClient()

    const body = (await request.json()) as { kind?: 'ticket' | 'yard'; id?: string; startTime?: string; endTime?: string; workDate?: string | null }
    if ((body.kind !== 'ticket' && body.kind !== 'yard') || !body.id) return bad('kind and id are required')

    const loc = await locate(supabase, body.kind, body.id)
    if (!loc) return bad('Time entry not found', 'NOT_FOUND', 404)
    if (!(await canApproveBranch(supabase, ctx.access.userId ?? '', loc.branch))) return bad('You are not an approver for this branch.', 'FORBIDDEN', 403)

    const norm = normalise(body.startTime, body.endTime)
    if (typeof norm === 'string') return bad(norm)
    if (body.workDate != null && body.workDate !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(body.workDate)) return bad('Date must be YYYY-MM-DD')

    const table = body.kind === 'ticket' ? 'billing_ticket_labor' : 'billing_yard_time'
    const patch: { start_time: string; end_time: string; work_date?: string | null } = { start_time: norm.start, end_time: norm.end }
    if (body.workDate !== undefined) patch.work_date = body.workDate || null
    const { error } = await supabase.from(table).update(patch).eq('id', body.id)
    if (error) throw new Error(error.message)

    await reopenBatch(supabase, loc.tech, loc.branch, loc.date)
    if (body.workDate && body.workDate !== loc.date) await reopenBatch(supabase, loc.tech, loc.branch, body.workDate)
    await broadcastBillingChanged()
    return NextResponse.json({ success: true })
  } catch (err) {
    return billingApiError(err)
  }
}

export async function DELETE(request: Request): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const supabase = createServiceClient()

    const url = new URL(request.url)
    const kind = url.searchParams.get('kind')
    const id = url.searchParams.get('id')
    if ((kind !== 'ticket' && kind !== 'yard') || !id) return bad('kind and id are required')

    const loc = await locate(supabase, kind, id)
    if (!loc) return bad('Time entry not found', 'NOT_FOUND', 404)
    if (!(await canApproveBranch(supabase, ctx.access.userId ?? '', loc.branch))) return bad('You are not an approver for this branch.', 'FORBIDDEN', 403)

    const table = kind === 'ticket' ? 'billing_ticket_labor' : 'billing_yard_time'
    const { error } = await supabase.from(table).delete().eq('id', id)
    if (error) throw new Error(error.message)

    await reopenBatch(supabase, loc.tech, loc.branch, loc.date)
    await broadcastBillingChanged()
    return NextResponse.json({ success: true })
  } catch (err) {
    return billingApiError(err)
  }
}
