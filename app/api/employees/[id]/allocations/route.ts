import { NextResponse } from 'next/server'
import { getAccessContext, guardAdminOnly } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { apiError } from '@/lib/utils/errors'
import { validateSplitTotal, isSaturday } from '@/lib/allocation/employee-allocation'

export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response

    const supabase = createServiceClient()

    const [allocationsRes, overridesRes] = await Promise.all([
      supabase
        .from('employee_allocations')
        .select('id, branch_id, percentage, effective_from, effective_to, status, notes, created_at, branches(name)')
        .eq('employee_id', params.id)
        .order('effective_from', { ascending: false }),
      supabase
        .from('employee_allocation_overrides')
        .select('id, period_date, branch_id, percentage, status, notes, created_at, branches(name)')
        .eq('employee_id', params.id)
        .order('period_date', { ascending: false })
        .limit(52),
    ])

    if (allocationsRes.error) throw new Error(allocationsRes.error.message)
    if (overridesRes.error) throw new Error(overridesRes.error.message)

    return NextResponse.json({
      success: true,
      data: {
        allocations: allocationsRes.data ?? [],
        overrides: overridesRes.data ?? [],
      },
    })
  } catch (err) {
    return apiError(err)
  }
}

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const guard = guardAdminOnly(ctx.access.role)
    if (guard) return guard

    const body = await request.json()
    const { splits, effectiveFrom, notes } = body as {
      splits: Array<{ branchId: string; percentage: number }>
      effectiveFrom: string
      notes?: string
    }

    if (!splits || !Array.isArray(splits) || splits.length === 0) {
      return NextResponse.json({ success: false, error: 'splits is required' }, { status: 400 })
    }
    if (!effectiveFrom) {
      return NextResponse.json({ success: false, error: 'effectiveFrom is required' }, { status: 400 })
    }
    if (!isSaturday(effectiveFrom)) {
      return NextResponse.json({ success: false, error: 'effectiveFrom must be a Saturday' }, { status: 400 })
    }

    const mapped = splits.map((s) => ({
      branchId: s.branchId,
      percentage: Number(s.percentage),
    }))
    if (!validateSplitTotal(mapped)) {
      return NextResponse.json({ success: false, error: 'Split percentages must sum to 100' }, { status: 400 })
    }

    const supabase = createServiceClient()

    // Close any currently-open default (effective_to = null) before inserting new
    await supabase
      .from('employee_allocations')
      .update({ effective_to: effectiveFrom })
      .eq('employee_id', params.id)
      .eq('status', 'approved')
      .is('effective_to', null)

    const rows = splits.map((s) => ({
      employee_id: params.id,
      branch_id: s.branchId,
      percentage: s.percentage,
      effective_from: effectiveFrom,
      effective_to: null,
      status: 'approved',
      requested_by: ctx.access.userId,
      approved_by: ctx.access.userId,
      notes: notes ?? null,
    }))

    const { data, error } = await supabase
      .from('employee_allocations')
      .insert(rows)
      .select()

    if (error) throw new Error(error.message)

    return NextResponse.json({ success: true, data })
  } catch (err) {
    return apiError(err)
  }
}
