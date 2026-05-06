import { NextResponse } from 'next/server'
import { getAccessContext, guardAdminOnly } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { canAccessBranch } from '@/lib/utils/access'
import { apiError } from '@/lib/utils/errors'

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response

    const { access } = ctx
    const { searchParams } = new URL(request.url)
    const branchId = searchParams.get('branchId')
    const fiscalMonthId = searchParams.get('fiscalMonthId')

    if (branchId && !canAccessBranch(access, branchId)) {
      return NextResponse.json(
        { success: false, error: 'Access to this branch is not permitted.', code: 'FORBIDDEN' },
        { status: 403 }
      )
    }

    const supabase = createServiceClient()

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
