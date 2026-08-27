import { NextResponse } from 'next/server'
import { getAccessContext } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { billingApiError } from '@/lib/billing/http'
import { canApproveBranch } from '@/lib/billing/approvers'
import { broadcastBillingChanged } from '@/lib/realtime/broadcast'

/** Mark a per-diem paid / unpaid. Admins anywhere; approvers within their granted branch. */

function bad(error: string, code = 'VALIDATION_ERROR', status = 400) {
  return NextResponse.json({ success: false, error, code }, { status })
}

export async function PATCH(request: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const supabase = createServiceClient()

    const { data: pd } = await supabase.from('billing_per_diem').select('id, branch_id, status').eq('id', params.id).maybeSingle()
    const row = pd as { id: string; branch_id: string | null; status: string } | null
    if (!row) return bad('Per diem not found', 'NOT_FOUND', 404)

    const isAdmin = ctx.access.role === 'admin'
    if (!isAdmin) {
      if (!row.branch_id || !(await canApproveBranch(supabase, ctx.access.userId ?? '', row.branch_id))) {
        return bad('You cannot manage per diem for this branch.', 'FORBIDDEN', 403)
      }
    }

    const body = (await request.json()) as { status?: 'paid' | 'pending' }
    if (body.status !== 'paid' && body.status !== 'pending') return bad('status must be paid or pending')

    const { error } = await supabase
      .from('billing_per_diem')
      .update({ status: body.status, paid_at: body.status === 'paid' ? new Date().toISOString() : null })
      .eq('id', params.id)
    if (error) throw new Error(error.message)

    await broadcastBillingChanged()
    return NextResponse.json({ success: true })
  } catch (err) {
    return billingApiError(err)
  }
}
