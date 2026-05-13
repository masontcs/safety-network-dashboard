import { NextResponse } from 'next/server'
import { getAccessContext } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { canAccessBranch } from '@/lib/utils/access'
import { apiError } from '@/lib/utils/errors'
import { resolveEmployeeAllocation, type AllocationOverride, type EmployeeAllocation } from '@/lib/allocation/employee-allocation'
import { isValidDate } from '@/lib/utils/date'

const PAGE_SIZE = 1000

function toSaturdayOfWeek(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  const daysToSat = (6 - date.getDay() + 7) % 7
  date.setDate(date.getDate() + daysToSat)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
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

    type FuelRow = {
      employee_id: string | null
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
        .select('employee_id, branch_id, transaction_date, vendor, total_with_tax, total_pretax, tax, gallons, business_tag')
        .is('business_tag', null)
        .gte('transaction_date', startDate)
        .lte('transaction_date', endDate)
        .order('transaction_date')
        .range(from, from + PAGE_SIZE - 1)

      // Fetch all accessible rows; allocation handles branch distribution
      if (access.branchIds !== null) {
        query = query.in('branch_id', access.branchIds)
      }

      const { data, error } = await query
      if (error) throw new Error(`Failed to query fuel: ${error.message}`)

      const page = data ?? []
      allRows.push(...page)

      if (page.length < PAGE_SIZE) break
      from += PAGE_SIZE
    }

    // Fetch employee allocations for rows with employee_id
    const fuelEmpIds = [...new Set(allRows.map((r) => r.employee_id).filter((id): id is string => id !== null))]
    const empDefaults: Record<string, EmployeeAllocation[]> = {}
    const empOverrides: Record<string, AllocationOverride[]> = {}

    if (fuelEmpIds.length > 0) {
      const [defaultsRes, overridesRes] = await Promise.all([
        supabase
          .from('employee_allocations')
          .select('employee_id, branch_id, percentage, effective_from, effective_to, status')
          .in('employee_id', fuelEmpIds)
          .eq('status', 'approved')
          .lte('effective_from', endDate),
        supabase
          .from('employee_allocation_overrides')
          .select('employee_id, period_date, branch_id, percentage, status')
          .in('employee_id', fuelEmpIds)
          .eq('status', 'approved')
          .gte('period_date', startDate)
          .lte('period_date', endDate),
      ])
      for (const d of (defaultsRes.data ?? []) as EmployeeAllocation[]) {
        if (!empDefaults[d.employee_id]) empDefaults[d.employee_id] = []
        empDefaults[d.employee_id].push(d)
      }
      for (const o of (overridesRes.data ?? []) as AllocationOverride[]) {
        if (!empOverrides[o.employee_id]) empOverrides[o.employee_id] = []
        empOverrides[o.employee_id].push(o)
      }
    }

    // Compute totals with allocation applied
    let totalWithTax = 0
    let totalPretax = 0
    let totalTax = 0
    let totalGallons = 0

    for (const t of allRows) {
      if (t.employee_id && t.branch_id) {
        const sat = toSaturdayOfWeek(t.transaction_date)
        const splits = resolveEmployeeAllocation(
          t.employee_id, sat, t.branch_id,
          empOverrides[t.employee_id] ?? [], empDefaults[t.employee_id] ?? []
        )
        for (const split of splits) {
          if (branchId && split.branchId !== branchId) continue
          const pct = split.percentage / 100
          totalWithTax += t.total_with_tax * pct
          totalPretax += (t.total_pretax ?? 0) * pct
          totalTax += (t.tax ?? 0) * pct
          totalGallons += (t.gallons ?? 0) * pct
        }
      } else if (!branchId || t.branch_id === branchId) {
        totalWithTax += t.total_with_tax
        totalPretax += t.total_pretax ?? 0
        totalTax += t.tax ?? 0
        totalGallons += t.gallons ?? 0
      }
    }

    // transactions list: filter by branchId if specified (raw view, not allocation-split)
    const transactions = branchId
      ? allRows.filter((t) => t.branch_id === branchId)
      : allRows

    return NextResponse.json({
      success: true,
      data: { totalWithTax, totalPretax, totalTax, totalGallons, transactions },
    })
  } catch (err) {
    return apiError(err)
  }
}
