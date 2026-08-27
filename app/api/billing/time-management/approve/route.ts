import { NextResponse } from 'next/server'
import { getAccessContext } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { billingApiError } from '@/lib/billing/http'
import { canApproveBranch } from '@/lib/billing/approvers'
import { broadcastBillingChanged } from '@/lib/realtime/broadcast'

/** Approve or return-to-adjust a (technician, branch, day) batch. Requires a branch grant. */

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

    await broadcastBillingChanged()
    return NextResponse.json({ success: true })
  } catch (err) {
    return billingApiError(err)
  }
}
