import { NextResponse } from 'next/server'
import { getAccessContext, guardAdminOnly } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { canAccessBranch } from '@/lib/utils/access'
import { apiError } from '@/lib/utils/errors'

function isSaturday(dateStr: string): boolean {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d).getDay() === 6
}

function isFirstOfMonth(dateStr: string): boolean {
  return dateStr.endsWith('-01')
}

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response

    const { access } = ctx
    const { searchParams } = new URL(request.url)
    const branchId = searchParams.get('branchId')
    const periodType = searchParams.get('periodType')
    const targetDate = searchParams.get('targetDate')

    // Branch access check
    if (branchId && !canAccessBranch(access, branchId)) {
      return NextResponse.json(
        { success: false, error: 'Access to this branch is not permitted.', code: 'FORBIDDEN' },
        { status: 403 }
      )
    }

    const supabase = createServiceClient()

    let query = supabase
      .from('branch_targets')
      .select('*')
      .order('target_date', { ascending: false })

    if (branchId) {
      query = query.eq('branch_id', branchId)
    } else if (access.branchIds !== null) {
      query = query.in('branch_id', access.branchIds)
    }

    if (periodType) query = query.eq('period_type', periodType)
    if (targetDate) query = query.eq('target_date', targetDate)

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
      periodType?: string
      targetDate?: string
      revenueTarget?: number | null
      profitPctTarget?: number | null
    }

    const { branchId, periodType, targetDate, revenueTarget = null, profitPctTarget = null } = body

    if (!branchId?.trim()) {
      return NextResponse.json({ success: false, error: 'branchId is required', code: 'VALIDATION_ERROR' }, { status: 400 })
    }
    if (periodType !== 'weekly' && periodType !== 'monthly') {
      return NextResponse.json({ success: false, error: 'periodType must be "weekly" or "monthly"', code: 'VALIDATION_ERROR' }, { status: 400 })
    }
    if (!targetDate) {
      return NextResponse.json({ success: false, error: 'targetDate is required', code: 'VALIDATION_ERROR' }, { status: 400 })
    }
    if (periodType === 'weekly' && !isSaturday(targetDate)) {
      return NextResponse.json({ success: false, error: 'targetDate must be a Saturday for weekly targets', code: 'VALIDATION_ERROR' }, { status: 400 })
    }
    if (periodType === 'monthly' && !isFirstOfMonth(targetDate)) {
      return NextResponse.json({ success: false, error: 'targetDate must be the first of the month for monthly targets', code: 'VALIDATION_ERROR' }, { status: 400 })
    }
    if (revenueTarget != null && (typeof revenueTarget !== 'number' || revenueTarget < 0)) {
      return NextResponse.json({ success: false, error: 'revenueTarget must be a non-negative number', code: 'VALIDATION_ERROR' }, { status: 400 })
    }
    if (profitPctTarget != null && (typeof profitPctTarget !== 'number' || profitPctTarget < 0 || profitPctTarget > 100)) {
      return NextResponse.json({ success: false, error: 'profitPctTarget must be between 0 and 100', code: 'VALIDATION_ERROR' }, { status: 400 })
    }

    const supabase = createServiceClient()

    const { data, error } = await supabase
      .from('branch_targets')
      .insert({
        branch_id: branchId,
        period_type: periodType,
        target_date: targetDate,
        revenue_target: revenueTarget,
        profit_pct_target: profitPctTarget,
      })
      .select()
      .single()

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json(
          { success: false, error: 'A target already exists for this branch and period.', code: 'DUPLICATE' },
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
