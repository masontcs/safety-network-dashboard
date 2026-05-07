import { NextResponse } from 'next/server'
import { getAccessContext, guardAdminOnly } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { apiError } from '@/lib/utils/errors'
import { validateSplitTotal, isSaturday } from '@/lib/allocation/employee-allocation'

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
    const { splits, periodDate, notes } = body as {
      splits: Array<{ branchId: string; percentage: number }>
      periodDate: string
      notes?: string
    }

    if (!splits || !Array.isArray(splits) || splits.length === 0) {
      return NextResponse.json({ success: false, error: 'splits is required' }, { status: 400 })
    }
    if (!periodDate) {
      return NextResponse.json({ success: false, error: 'periodDate is required' }, { status: 400 })
    }
    if (!isSaturday(periodDate)) {
      return NextResponse.json({ success: false, error: 'periodDate must be a Saturday' }, { status: 400 })
    }

    const mapped = splits.map((s) => ({
      branchId: s.branchId,
      percentage: Number(s.percentage),
    }))
    if (!validateSplitTotal(mapped)) {
      return NextResponse.json({ success: false, error: 'Split percentages must sum to 100' }, { status: 400 })
    }

    const supabase = createServiceClient()

    const rows = splits.map((s) => ({
      employee_id: params.id,
      period_date: periodDate,
      branch_id: s.branchId,
      percentage: s.percentage,
      status: 'approved',
      requested_by: ctx.access.userId,
      approved_by: ctx.access.userId,
      notes: notes ?? null,
    }))

    // Upsert — admin override replaces any existing split for this period
    const { data, error } = await supabase
      .from('employee_allocation_overrides')
      .upsert(rows, { onConflict: 'employee_id,period_date,branch_id' })
      .select()

    if (error) throw new Error(error.message)

    return NextResponse.json({ success: true, data })
  } catch (err) {
    return apiError(err)
  }
}
