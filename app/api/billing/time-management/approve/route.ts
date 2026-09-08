import { NextResponse } from 'next/server'
import { getAccessContext } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { billingApiError } from '@/lib/billing/http'
import { canApproveBranch } from '@/lib/billing/approvers'
import { broadcastBillingChanged } from '@/lib/realtime/broadcast'
import { sendPushToTechnicians } from '@/lib/push/send'

/** Approve or return-to-adjust a (technician, branch, day) batch. Requires a branch grant. */

const addDays = (d: string, n: number) => { const dt = new Date(d + 'T00:00:00Z'); dt.setUTCDate(dt.getUTCDate() + n); return dt.toISOString().slice(0, 10) }

function bad(error: string, code = 'VALIDATION_ERROR', status = 400) {
  return NextResponse.json({ success: false, error, code }, { status })
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const supabase = createServiceClient()

    const body = (await request.json()) as { technicianId?: string; branchId?: string; workDate?: string; action?: 'approve' | 'return'; note?: string | null }
    if (!body.technicianId || !body.branchId || !body.workDate) return bad('technicianId, branchId and workDate are required')
    if (body.action !== 'approve' && body.action !== 'return') return bad('action must be approve or return')
    if (body.action === 'return' && !(body.note && body.note.trim())) return bad('A note is required when returning to adjust.')

    if (!(await canApproveBranch(supabase, ctx.access.userId ?? '', body.branchId))) {
      return bad('You are not an approver for this branch.', 'FORBIDDEN', 403)
    }

    const status = body.action === 'approve' ? 'approved' : 'returned'
    const { error } = await supabase.from('billing_time_approvals').upsert({
      technician_id: body.technicianId,
      branch_id: body.branchId,
      work_date: body.workDate,
      status,
      note: body.note?.trim() || null,
      approved_by: ctx.access.userId ?? null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'technician_id,branch_id,work_date' })
    if (error) throw new Error(error.message)

    // Returning to adjust must actually HAND THE WORK BACK to the tech: reopen the batch's
    // submitted tickets (in_review → active) so they reappear on the tech's app and are editable
    // again — this is the correction loop the tech submit flow relies on — and notify the tech.
    // (Approving just records the status; nothing to reopen.)
    if (body.action === 'return') {
      // The batch's tickets: those where THIS tech logged labor on THIS (branch, day). Bound the
      // scan to a ±1-day window around the work date to also catch overnight entries.
      const { data: laborRows } = await supabase
        .from('billing_ticket_labor')
        .select('ticket_id, work_date, billing_tickets!inner(status, ticket_date, is_voided, billing_jobs!inner(branch_id))')
        .eq('technician_id', body.technicianId)
        .gte('billing_tickets.ticket_date', addDays(body.workDate, -1))
        .lte('billing_tickets.ticket_date', addDays(body.workDate, 1))
      const reopen = new Set<string>()
      for (const l of (laborRows ?? []) as unknown as {
        ticket_id: string; work_date: string | null
        billing_tickets: { status: string; ticket_date: string; is_voided: boolean; billing_jobs: { branch_id: string } | null } | null
      }[]) {
        const tk = l.billing_tickets
        if (!tk || tk.is_voided || !tk.billing_jobs) continue
        if (tk.billing_jobs.branch_id !== body.branchId) continue
        if ((l.work_date ?? tk.ticket_date) !== body.workDate) continue
        if (tk.status === 'in_review') reopen.add(l.ticket_id)
      }
      if (reopen.size > 0) {
        // Only flip tickets still in_review — never disturb one the office already moved forward.
        const { error: rErr } = await supabase
          .from('billing_tickets')
          .update({ status: 'active' })
          .in('id', [...reopen])
          .eq('status', 'in_review')
        if (rErr) throw new Error(rErr.message)
      }

      // Tell the tech their time needs another look (best-effort; never blocks the return).
      const dateLabel = new Date(body.workDate + 'T00:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
      await sendPushToTechnicians([body.technicianId], {
        title: 'Time returned for adjustment',
        body: `Your ${dateLabel} time needs changes${body.note?.trim() ? `: ${body.note.trim()}` : '.'}`,
        url: '/tech',
        tag: `time-return-${body.technicianId}-${body.workDate}`,
      })
    }

    await broadcastBillingChanged()
    return NextResponse.json({ success: true })
  } catch (err) {
    return billingApiError(err)
  }
}
