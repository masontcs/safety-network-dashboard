import { NextResponse } from 'next/server'
import { getAccessContext, guardFuelAccess } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { canAccessBranch } from '@/lib/utils/access'
import { apiError } from '@/lib/utils/errors'
import { resolveEmployeeAllocation, type AllocationOverride, type EmployeeAllocation } from '@/lib/allocation/employee-allocation'
import { isValidDate } from '@/lib/utils/date'

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
    const fuelGuard = guardFuelAccess(ctx.access.role)
    if (fuelGuard) return fuelGuard

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

    // Fetch all SN fuel transactions — employee-linked and general branch cards
    const PAGE_SIZE = 1000
    type Row = {
      employee_id: string | null
      branch_id: string | null
      transaction_date: string
      total_with_tax: number
      gallons: number | null
      price_per_gallon: number | null
      employees: { first_name: string; last_name: string } | null
    }
    const rawRows: Row[] = []
    {
      let from = 0
      while (true) {
        let q = supabase
          .from('fuel_transactions')
          .select('employee_id, branch_id, transaction_date, total_with_tax, gallons, price_per_gallon, employees(first_name, last_name)')
          .is('business_tag', null)
          .gte('transaction_date', startDate)
          .lte('transaction_date', endDate)
          .order('transaction_date')
          .range(from, from + PAGE_SIZE - 1)
        if (access.branchIds !== null) q = q.in('branch_id', access.branchIds)
        const { data: page, error } = await q
        if (error) throw new Error(error.message)
        if (!page || page.length === 0) break
        rawRows.push(...(page as Row[]))
        if (page.length < PAGE_SIZE) break
        from += PAGE_SIZE
      }
    }

    // Fetch employee allocations
    const fuelEmpIds = [...new Set(rawRows.map((r) => r.employee_id).filter((id): id is string => id !== null))]
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

    // Fetch branch names separately
    const { data: branchRows } = await supabase.from('branches').select('id, name')
    const branchNameMap: Record<string, string> = {}
    for (const b of branchRows ?? []) branchNameMap[b.id] = b.name

    // Aggregate by (employee+branch) for linked rows, by branch for general card rows
    type AggKey = string
    type Agg = {
      employeeId: string | null
      displayName: string
      branchId: string | null
      isGeneral: boolean
      gallons: number
      cost: number
      txnCount: number
      ppgSum: number
      ppgCount: number
    }

    const byKey: Record<AggKey, Agg> = {}

    function accumulate(key: AggKey, init: Omit<Agg, 'gallons' | 'cost' | 'txnCount' | 'ppgSum' | 'ppgCount'>, t: Row, pct = 1) {
      if (!byKey[key]) byKey[key] = { ...init, gallons: 0, cost: 0, txnCount: 0, ppgSum: 0, ppgCount: 0 }
      const e = byKey[key]
      e.gallons += (t.gallons ?? 0) * pct
      e.cost += t.total_with_tax * pct
      e.txnCount += 1
      if (t.price_per_gallon != null) { e.ppgSum += t.price_per_gallon; e.ppgCount += 1 }
    }

    for (const t of rawRows) {
      if (t.employee_id && t.employees && t.branch_id) {
        // Employee-linked: apply allocation splits
        const sat = toSaturdayOfWeek(t.transaction_date)
        const splits = resolveEmployeeAllocation(
          t.employee_id, sat, t.branch_id,
          empOverrides[t.employee_id] ?? [], empDefaults[t.employee_id] ?? []
        )
        for (const split of splits) {
          if (branchId && split.branchId !== branchId) continue
          accumulate(`emp::${t.employee_id}::${split.branchId}`, {
            employeeId: t.employee_id,
            displayName: `${t.employees.first_name} ${t.employees.last_name}`.trim(),
            branchId: split.branchId,
            isGeneral: false,
          }, t, split.percentage / 100)
        }
      } else if (!t.employee_id && t.branch_id) {
        // General branch card: group by branch
        if (branchId && t.branch_id !== branchId) continue
        accumulate(`general::${t.branch_id}`, {
          employeeId: null,
          displayName: 'General Card',
          branchId: t.branch_id,
          isGeneral: true,
        }, t)
      }
    }

    const consumers = Object.values(byKey)
      .map((a) => ({
        employeeId: a.employeeId,
        displayName: a.displayName,
        branchName: a.branchId ? (branchNameMap[a.branchId] ?? '—') : '—',
        isGeneral: a.isGeneral,
        totalGallons: Math.round(a.gallons * 100) / 100,
        totalCost: Math.round(a.cost * 100) / 100,
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
