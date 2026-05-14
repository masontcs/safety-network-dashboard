import { NextResponse } from 'next/server'
import { getAccessContext } from '@/lib/api/auth'
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
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')

    if (!startDate || !endDate) {
      return NextResponse.json(
        { success: false, error: 'startDate and endDate are required', code: 'VALIDATION_ERROR' },
        { status: 400 }
      )
    }
    if (!isValidDate(startDate) || !isValidDate(endDate)) {
      return NextResponse.json(
        { success: false, error: 'startDate and endDate must be valid dates (YYYY-MM-DD)', code: 'VALIDATION_ERROR' },
        { status: 400 }
      )
    }

    if (branchId && !canAccessBranch(access, branchId)) {
      return NextResponse.json(
        { success: false, error: 'Access to this branch is not permitted.', code: 'FORBIDDEN' },
        { status: 403 }
      )
    }

    const supabase = createServiceClient()

    let query = supabase
      .from('revenue_transactions')
      .select('branch_id, period_date, labor, rental, one_time_charges, sales_tax, total_revenue')
      .gte('period_date', startDate)
      .lte('period_date', endDate)

    if (branchId) {
      query = query.eq('branch_id', branchId)
    } else if (access.branchIds !== null) {
      query = query.in('branch_id', access.branchIds)
    }

    const PAGE_SIZE = 1000
    type RevRow = { branch_id: string; period_date: string; labor: number; rental: number; one_time_charges: number; sales_tax: number; total_revenue: number }
    const rows: RevRow[] = []
    {
      let from = 0
      while (true) {
        const { data, error } = await query.range(from, from + PAGE_SIZE - 1)
        if (error) throw new Error(`Failed to query revenue: ${error.message}`)
        if (!data || data.length === 0) break
        rows.push(...(data as RevRow[]))
        if (data.length < PAGE_SIZE) break
        from += PAGE_SIZE
      }
    }
    const totals = {
      labor: rows.reduce((s, t) => s + t.labor, 0),
      rental: rows.reduce((s, t) => s + t.rental, 0),
      oneTimeCharges: rows.reduce((s, t) => s + t.one_time_charges, 0),
      salesTax: rows.reduce((s, t) => s + t.sales_tax, 0),
      totalRevenue: rows.reduce((s, t) => s + t.total_revenue, 0),
    }

    return NextResponse.json({ success: true, data: { ...totals, transactions: rows } })
  } catch (err) {
    return apiError(err)
  }
}
