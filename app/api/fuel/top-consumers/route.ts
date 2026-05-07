import { NextResponse } from 'next/server'
import { getAccessContext } from '@/lib/api/auth'
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
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const limit = Math.min(parseInt(searchParams.get('limit') ?? '10', 10), 50)

    if (!startDate || !endDate) {
      return NextResponse.json(
        { success: false, error: 'startDate and endDate are required', code: 'VALIDATION_ERROR' },
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
      .select('employee_id, branch_id, total_with_tax, gallons, price_per_gallon, employees(first_name, last_name)')
      .is('business_tag', null)
      .not('employee_id', 'is', null)
      .gte('transaction_date', startDate)
      .lte('transaction_date', endDate)

    if (branchId) {
      query = query.eq('branch_id', branchId)
    } else if (access.branchIds !== null) {
      query = query.in('branch_id', access.branchIds)
    }

    const { data, error } = await query
    if (error) throw new Error(error.message)

    // Fetch branch names separately
    const { data: branchRows } = await supabase.from('branches').select('id, name')
    const branchNameMap: Record<string, string> = {}
    for (const b of branchRows ?? []) branchNameMap[b.id] = b.name

    type Row = {
      employee_id: string | null
      branch_id: string | null
      total_with_tax: number
      gallons: number | null
      price_per_gallon: number | null
      employees: { first_name: string; last_name: string } | null
    }

    type EmpAgg = {
      displayName: string
      branchId: string | null
      gallons: number
      cost: number
      txnCount: number
      ppgSum: number
      ppgCount: number
    }

    const byEmp: Record<string, EmpAgg> = {}
    for (const t of (data ?? []) as Row[]) {
      if (!t.employee_id || !t.employees) continue
      if (!byEmp[t.employee_id]) {
        byEmp[t.employee_id] = {
          displayName: `${t.employees.first_name} ${t.employees.last_name}`.trim(),
          branchId: t.branch_id,
          gallons: 0,
          cost: 0,
          txnCount: 0,
          ppgSum: 0,
          ppgCount: 0,
        }
      }
      const e = byEmp[t.employee_id]
      e.gallons += t.gallons ?? 0
      e.cost += t.total_with_tax
      e.txnCount += 1
      if (t.price_per_gallon != null) {
        e.ppgSum += t.price_per_gallon
        e.ppgCount += 1
      }
    }

    const consumers = Object.entries(byEmp)
      .map(([employeeId, a]) => ({
        employeeId,
        displayName: a.displayName,
        branchName: a.branchId ? (branchNameMap[a.branchId] ?? '—') : '—',
        totalGallons: a.gallons,
        totalCost: a.cost,
        avgPpg: a.ppgCount > 0
          ? a.ppgSum / a.ppgCount
          : a.gallons > 0 ? a.cost / a.gallons : null,
        txnCount: a.txnCount,
      }))
      .sort((a, b) => b.totalCost - a.totalCost)
      .slice(0, limit)

    return NextResponse.json({ success: true, data: consumers })
  } catch (err) {
    return apiError(err)
  }
}
