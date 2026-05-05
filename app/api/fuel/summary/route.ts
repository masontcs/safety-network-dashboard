import { NextResponse } from 'next/server'
import { getAccessContext } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { canAccessBranch } from '@/lib/utils/access'
import { apiError } from '@/lib/utils/errors'

const PAGE_SIZE = 1000

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

    if (branchId && !canAccessBranch(access, branchId)) {
      return NextResponse.json(
        { success: false, error: 'Access to this branch is not permitted.', code: 'FORBIDDEN' },
        { status: 403 }
      )
    }

    const supabase = createServiceClient()

    type FuelRow = {
      branch_id: string | null
      transaction_date: string
      vendor: string
      total_with_tax: number
      total_pretax: number | null
      tax: number | null
      gallons: number | null
      business_tag: string | null
    }

    const allRows: FuelRow[] = []
    let from = 0

    while (true) {
      let query = supabase
        .from('fuel_transactions')
        .select('branch_id, transaction_date, vendor, total_with_tax, total_pretax, tax, gallons, business_tag')
        .is('business_tag', null)
        .gte('transaction_date', startDate)
        .lte('transaction_date', endDate)
        .range(from, from + PAGE_SIZE - 1)

      if (branchId) {
        query = query.eq('branch_id', branchId)
      } else if (access.branchIds !== null) {
        query = query.in('branch_id', access.branchIds)
      }

      const { data, error } = await query
      if (error) throw new Error(`Failed to query fuel: ${error.message}`)

      const page = data ?? []
      allRows.push(...page)

      if (page.length < PAGE_SIZE) break
      from += PAGE_SIZE
    }

    const totals = {
      totalWithTax: allRows.reduce((s, t) => s + t.total_with_tax, 0),
      totalPretax: allRows.reduce((s, t) => s + (t.total_pretax ?? 0), 0),
      totalTax: allRows.reduce((s, t) => s + (t.tax ?? 0), 0),
      totalGallons: allRows.reduce((s, t) => s + (t.gallons ?? 0), 0),
    }

    return NextResponse.json({ success: true, data: { ...totals, transactions: allRows } })
  } catch (err) {
    return apiError(err)
  }
}
