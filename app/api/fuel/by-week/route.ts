import { NextResponse } from 'next/server'
import { getAccessContext } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { canAccessBranch } from '@/lib/utils/access'
import { apiError } from '@/lib/utils/errors'
import { isValidDate } from '@/lib/utils/date'

function snapToSaturday(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  const daysToSat = (6 - d.getDay() + 7) % 7
  d.setDate(d.getDate() + daysToSat)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response

    const { access } = ctx
    const { searchParams } = new URL(request.url)
    const branchId = searchParams.get('branchId')
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')

    if (!startDate || !endDate) {
      return NextResponse.json(
        { success: false, error: 'startDate and endDate are required', code: 'VALIDATION_ERROR' },
        { status: 400 },
      )
    }
    if (!isValidDate(startDate) || !isValidDate(endDate)) {
      return NextResponse.json(
        { success: false, error: 'startDate and endDate must be valid dates (YYYY-MM-DD)', code: 'VALIDATION_ERROR' },
        { status: 400 },
      )
    }

    if (branchId && !canAccessBranch(access, branchId)) {
      return NextResponse.json(
        { success: false, error: 'Access to this branch is not permitted.', code: 'FORBIDDEN' },
        { status: 403 },
      )
    }

    const supabase = createServiceClient()

    let query = supabase
      .from('fuel_transactions')
      .select('transaction_date, total_with_tax, gallons, mpg')
      .is('business_tag', null)
      .gte('transaction_date', startDate)
      .lte('transaction_date', endDate)

    if (branchId) {
      query = query.eq('branch_id', branchId)
    } else if (access.branchIds !== null) {
      query = query.in('branch_id', access.branchIds)
    }

    const { data, error } = await query
    if (error) throw new Error(error.message)

    type Row = { transaction_date: string; total_with_tax: number; gallons: number | null; mpg: number | null }
    const byWeek: Record<string, { cost: number; gallons: number; mpgSum: number; mpgCount: number }> = {}

    for (const t of (data ?? []) as Row[]) {
      const sat = snapToSaturday(t.transaction_date)
      if (!byWeek[sat]) byWeek[sat] = { cost: 0, gallons: 0, mpgSum: 0, mpgCount: 0 }
      byWeek[sat].cost += t.total_with_tax
      byWeek[sat].gallons += t.gallons ?? 0
      if (t.mpg != null && t.mpg > 0) {
        byWeek[sat].mpgSum += t.mpg
        byWeek[sat].mpgCount += 1
      }
    }

    const weeks = Object.entries(byWeek)
      .map(([weekEndDate, a]) => ({
        weekEndDate,
        totalCost: a.cost,
        totalGallons: a.gallons,
        avgMpg: a.mpgCount > 0 ? a.mpgSum / a.mpgCount : null,
      }))
      .sort((a, b) => a.weekEndDate.localeCompare(b.weekEndDate))

    return NextResponse.json({ success: true, data: weeks })
  } catch (err) {
    return apiError(err)
  }
}
