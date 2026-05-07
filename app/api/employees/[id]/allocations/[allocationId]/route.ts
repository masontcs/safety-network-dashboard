import { NextResponse } from 'next/server'
import { getAccessContext, guardAdminOnly } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { apiError } from '@/lib/utils/errors'

export async function PATCH(
  request: Request,
  { params }: { params: { id: string; allocationId: string } }
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

    // Get the allocation group (same employee_id + effective_from)
    const { data: target, error: fetchErr } = await supabase
      .from('employee_allocations')
      .select('employee_id, effective_from')
      .eq('id', params.allocationId)
      .eq('employee_id', params.id)
      .single()

    if (fetchErr || !target) {
      return NextResponse.json({ success: false, error: 'Allocation not found' }, { status: 404 })
    }

    // Update all rows in the group atomically
    const { error } = await supabase
      .from('employee_allocations')
      .update({
        status,
        approved_by: ctx.access.userId,
        notes: notes ?? null,
      })
      .eq('employee_id', target.employee_id)
      .eq('effective_from', target.effective_from)

    if (error) throw new Error(error.message)

    return NextResponse.json({ success: true })
  } catch (err) {
    return apiError(err)
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string; allocationId: string } }
): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const guard = guardAdminOnly(ctx.access.role)
    if (guard) return guard

    const supabase = createServiceClient()

    const { data: target, error: fetchErr } = await supabase
      .from('employee_allocations')
      .select('employee_id, effective_from, status')
      .eq('id', params.allocationId)
      .eq('employee_id', params.id)
      .single()

    if (fetchErr || !target) {
      return NextResponse.json({ success: false, error: 'Allocation not found' }, { status: 404 })
    }

    if (target.status === 'approved') {
      return NextResponse.json({ success: false, error: 'Cannot delete an approved allocation' }, { status: 400 })
    }

    const { error } = await supabase
      .from('employee_allocations')
      .delete()
      .eq('employee_id', target.employee_id)
      .eq('effective_from', target.effective_from)

    if (error) throw new Error(error.message)

    return NextResponse.json({ success: true })
  } catch (err) {
    return apiError(err)
  }
}
