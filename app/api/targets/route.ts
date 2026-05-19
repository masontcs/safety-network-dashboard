import { NextResponse } from 'next/server'
import { getAccessContext, guardAdminOnly } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { canAccessBranch } from '@/lib/utils/access'
import { apiError } from '@/lib/utils/errors'
import { isValidDate } from '@/lib/utils/date'

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response

    const { access } = ctx
    const { searchParams } = new URL(request.url)
    const branchId = searchParams.get('branchId')
    const fiscalMonthId = searchParams.get('fiscalMonthId')
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')

    if (branchId && !canAccessBranch(access, branchId)) {
      return NextResponse.json(
        { success: false, error: 'Access to this branch is not permitted.', code: 'FORBIDDEN' },
        { status: 403 }
      )
    }

    const supabase = createServiceClient()

    // When startDate/endDate are provided, aggregate targets across all fiscal months
    // that overlap with the date range. Returns one row per branch with summed targets.
    if (startDate && endDate) {
      if (!isValidDate(startDate) || !isValidDate(endDate)) {
        return NextResponse.json({ success: false, error: 'Invalid date format' }, { status: 400 })
      }

      // Find all fiscal months overlapping the range
      const { data: months } = await supabase
        .from('fiscal_months')
        .select('id')
        .lte('start_date', endDate)
        .gte('end_date', startDate)

      const monthIds = (months ?? []).map((m) => m.id as string)
      if (monthIds.length === 0) {
        return NextResponse.json({ success: true, data: [] })
      }

      let query = supabase
        .from('branch_targets')
        .select('branch_id, revenue_target, profit_pct_target')
        .in('fiscal_month_id', monthIds)

      if (branchId) {
        query = query.eq('branch_id', branchId)
      } else if (access.branchIds !== null) {
        query = query.in('branch_id', access.branchIds)
      }

      const { data: rows, error } = await query
      if (error) throw new Error(error.message)

      // Aggregate by branch: sum revenue targets, weighted-average GP% target
      const byBranch = new Map<string, { revSum: number; revHasTarget: boolean; gpWeighted: number; gpRevWeight: number }>()
      for (const row of rows ?? []) {
        const bid = row.branch_id as string
        if (!byBranch.has(bid)) byBranch.set(bid, { revSum: 0, revHasTarget: false, gpWeighted: 0, gpRevWeight: 0 })
        const entry = byBranch.get(bid)!
        if (row.revenue_target != null) {
          entry.revSum += row.revenue_target
          entry.revHasTarget = true
          if (row.profit_pct_target != null) {
            entry.gpWeighted += row.profit_pct_target * row.revenue_target
            entry.gpRevWeight += row.revenue_target
          }
        }
      }

      const aggregated = [...byBranch.entries()].map(([bid, v]) => ({
        branchId: bid,
        revenueTarget: v.revHasTarget ? v.revSum : null,
        profitPctTarget: v.gpRevWeight > 0 ? Math.round((v.gpWeighted / v.gpRevWeight) * 10) / 10 : null,
      }))

      return NextResponse.json({ success: true, data: aggregated })
    }

    // Original behaviour: return raw target rows for the targets management page
    let query = supabase
      .from('branch_targets')
      .select('*, fiscal_months(id, name, start_date, end_date)')

    if (branchId) {
      query = query.eq('branch_id', branchId)
    } else if (access.branchIds !== null) {
      query = query.in('branch_id', access.branchIds)
    }

    if (fiscalMonthId) query = query.eq('fiscal_month_id', fiscalMonthId)

    const { data, error } = await query
    if (error) throw new Error(error.message)

    return NextResponse.json({ success: true, data: data ?? [] })
  } catch (err) {
    return apiError(err)
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response

    const guard = guardAdminOnly(ctx.access.role)
    if (guard) return guard

    const body = await request.json() as {
      branchId?: string
      fiscalMonthId?: string
      revenueTarget?: number | null
      profitPctTarget?: number | null
    }

    const { branchId, fiscalMonthId, revenueTarget = null, profitPctTarget = null } = body

    if (!branchId?.trim()) {
      return NextResponse.json({ success: false, error: 'branchId is required', code: 'VALIDATION_ERROR' }, { status: 400 })
    }
    if (!fiscalMonthId?.trim()) {
      return NextResponse.json({ success: false, error: 'fiscalMonthId is required', code: 'VALIDATION_ERROR' }, { status: 400 })
    }
    if (revenueTarget != null && (typeof revenueTarget !== 'number' || revenueTarget < 0)) {
      return NextResponse.json({ success: false, error: 'revenueTarget must be a non-negative number', code: 'VALIDATION_ERROR' }, { status: 400 })
    }
    if (profitPctTarget != null && (typeof profitPctTarget !== 'number' || profitPctTarget < 0 || profitPctTarget > 100)) {
      return NextResponse.json({ success: false, error: 'profitPctTarget must be between 0 and 100', code: 'VALIDATION_ERROR' }, { status: 400 })
    }

    const supabase = createServiceClient()

    // Verify fiscal month exists
    const { data: fm, error: fmErr } = await supabase
      .from('fiscal_months')
      .select('id')
      .eq('id', fiscalMonthId)
      .maybeSingle()
    if (fmErr) throw new Error(fmErr.message)
    if (!fm) {
      return NextResponse.json({ success: false, error: 'Fiscal month not found', code: 'NOT_FOUND' }, { status: 404 })
    }

    const { data, error } = await supabase
      .from('branch_targets')
      .insert({
        branch_id: branchId,
        fiscal_month_id: fiscalMonthId,
        revenue_target: revenueTarget,
        profit_pct_target: profitPctTarget,
        updated_by: ctx.access.userId,
      })
      .select('*, fiscal_months(id, name, start_date, end_date)')
      .single()

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json(
          { success: false, error: 'A target already exists for this branch and fiscal month.', code: 'DUPLICATE' },
          { status: 409 }
        )
      }
      throw new Error(error.message)
    }

    return NextResponse.json({ success: true, data }, { status: 201 })
  } catch (err) {
    return apiError(err)
  }
}
