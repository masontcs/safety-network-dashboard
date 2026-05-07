import { NextResponse } from 'next/server'
import { getAccessContext, guardAdminOnly } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { apiError } from '@/lib/utils/errors'

export async function PATCH(
  request: Request,
  { params }: { params: { id: string; overrideId: string } }
): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const guard = guardAdminOnly(ctx.access.role)
    if (guard) return guard

    const body = await request.json()
    const { status, notes } = body as { status: 'approved' | 'denied'; notes?: string }

    if (status !== 'approved' && status !== 'denied') {
      return NextResponse.json({ success: false, error: 'status must be approved or denied' }, { status: 400 })
    }

    const supabase = createServiceClient()

    const { data: target, error: fetchErr } = await supabase
      .from('employee_allocation_overrides')
      .select('employee_id, period_date')
      .eq('id', params.overrideId)
      .eq('employee_id', params.id)
      .single()

    if (fetchErr || !target) {
      return NextResponse.json({ success: false, error: 'Override not found' }, { status: 404 })
    }

    // Approve/deny entire period group atomically
    const { error } = await supabase
      .from('employee_allocation_overrides')
      .update({
        status,
        approved_by: ctx.access.userId,
        notes: notes ?? null,
      })
      .eq('employee_id', target.employee_id)
      .eq('period_date', target.period_date)

    if (error) throw new Error(error.message)

    return NextResponse.json({ success: true })
  } catch (err) {
    return apiError(err)
  }
}
