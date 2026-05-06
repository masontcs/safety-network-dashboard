import { NextResponse } from 'next/server'
import { getAccessContext } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { apiError } from '@/lib/utils/errors'

function weeksInFiscalMonth(startDate: string, endDate: string): number {
  const [sy, sm, sd] = startDate.split('-').map(Number)
  const [ey, em, ed] = endDate.split('-').map(Number)
  const startMs = new Date(sy, sm - 1, sd).getTime()
  const endMs = new Date(ey, em - 1, ed).getTime()
  // +1 day to make the range inclusive, then divide by 7 days
  return Math.round((endMs - startMs + 86_400_000) / (7 * 86_400_000))
}

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response

    const { access } = ctx
    const { searchParams } = new URL(request.url)
    const periodDate = searchParams.get('periodDate')

    if (!periodDate || !/^\d{4}-\d{2}-\d{2}$/.test(periodDate)) {
      return NextResponse.json(
        { success: false, error: 'periodDate is required (YYYY-MM-DD)', code: 'VALIDATION_ERROR' },
        { status: 400 }
      )
    }

    const supabase = createServiceClient()

    // Find the fiscal month that contains this date
    const { data: fiscalMonth, error: fmErr } = await supabase
      .from('fiscal_months')
      .select('*')
      .lte('start_date', periodDate)
      .gte('end_date', periodDate)
      .maybeSingle()

    if (fmErr) throw new Error(fmErr.message)

    if (!fiscalMonth) {
      return NextResponse.json({ success: true, data: null })
    }

    const weeks = weeksInFiscalMonth(fiscalMonth.start_date, fiscalMonth.end_date)

    // Fetch targets for this fiscal month, scoped to accessible branches
    let query = supabase
      .from('branch_targets')
      .select('branch_id, revenue_target, profit_pct_target')
      .eq('fiscal_month_id', fiscalMonth.id)

    if (access.branchIds !== null) {
      query = query.in('branch_id', access.branchIds)
    }

    const { data: targets, error: tErr } = await query
    if (tErr) throw new Error(tErr.message)

    const weeklyTargets = (targets ?? []).map((t) => ({
      branch_id: t.branch_id,
      weekly_revenue_target: t.revenue_target != null ? Math.round((t.revenue_target / weeks) * 100) / 100 : null,
      profit_pct_target: t.profit_pct_target,
    }))

    return NextResponse.json({
      success: true,
      data: {
        fiscal_month_name: fiscalMonth.name,
        fiscal_month_id: fiscalMonth.id,
        weeks_in_month: weeks,
        targets: weeklyTargets,
      },
    })
  } catch (err) {
    return apiError(err)
  }
}
