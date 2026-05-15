import { NextResponse } from 'next/server'
import { getAccessContext, guardPayrollAccess } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { canAccessBranch } from '@/lib/utils/access'
import { apiError } from '@/lib/utils/errors'
import type { LaborType } from '@/lib/supabase/database.types'
import { resolveEmployeeAllocation, type AllocationOverride, type EmployeeAllocation } from '@/lib/allocation/employee-allocation'
import { isValidDate } from '@/lib/utils/date'

function r2(v: number): number {
  return Math.round(v * 100) / 100
}

function classifyGroup(name: string): 'double' | 'overtime' | 'standard' {
  const n = name.toLowerCase()
  if (n.includes('double')) return 'double'
  if (n.includes('overtime') || n.includes('over time')) return 'overtime'
  return 'standard'
}

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const payrollGuard = guardPayrollAccess(ctx.access.role)
    if (payrollGuard) return payrollGuard

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

    // Get ALL direct labor payroll_code IDs (allocation redistributes across branches)
    let codesQuery = supabase
      .from('payroll_codes')
      .select('id, branch_id')
      .eq('labor_type', 'direct' as LaborType)

    if (access.branchIds !== null) {
      codesQuery = codesQuery.in('branch_id', access.branchIds)
    }

    const { data: codes, error: codesErr } = await codesQuery
    if (codesErr) throw new Error(codesErr.message)
    const codeIds = (codes ?? []).map((c) => c.id)
    const codeToHomeBranch: Record<string, string> = {}
    for (const c of codes ?? []) {
      if (c.branch_id) codeToHomeBranch[c.id] = c.branch_id
    }

    if (codeIds.length === 0) {
      return NextResponse.json({ success: true, data: [] })
    }

    const groupsRes = await supabase
      .from('payroll_items')
      .select('id, group_id, payroll_item_groups(name)')
    if (groupsRes.error) throw new Error(groupsRes.error.message)

    // Paginate transactions to avoid Supabase 1000-row hard cap
    const PAGE_SIZE = 1000
    type TxnRow = { employee_id: string; payroll_code_id: string; period_date: string; hours: number | null; amount: number; payroll_item_id: string | null }
    const rawTxns: TxnRow[] = []
    {
      let from = 0
      while (true) {
        const { data, error } = await supabase
          .from('payroll_transactions')
          .select('employee_id, payroll_code_id, period_date, hours, amount, payroll_item_id')
          .in('payroll_code_id', codeIds)
          .gte('period_date', startDate)
          .lte('period_date', endDate)
          .order('period_date')
          .range(from, from + PAGE_SIZE - 1)
        if (error) throw new Error(error.message)
        if (!data || data.length === 0) break
        rawTxns.push(...(data as TxnRow[]))
        if (data.length < PAGE_SIZE) break
        from += PAGE_SIZE
      }
    }
    const txnEmpIds = [...new Set(rawTxns.map((t) => t.employee_id))]
    const empDefaults: Record<string, EmployeeAllocation[]> = {}
    const empOverrides: Record<string, AllocationOverride[]> = {}

    if (txnEmpIds.length > 0) {
      const [defaultsRes, overridesRes] = await Promise.all([
        supabase
          .from('employee_allocations')
          .select('employee_id, branch_id, percentage, effective_from, effective_to, status')
          .in('employee_id', txnEmpIds)
          .eq('status', 'approved')
          .lte('effective_from', endDate),
        supabase
          .from('employee_allocation_overrides')
          .select('employee_id, period_date, branch_id, percentage, status')
          .in('employee_id', txnEmpIds)
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

    // Build item → group classification map
    type ItemRow = { id: string; group_id: string; payroll_item_groups: { name: string } | null }
    const itemClassMap: Record<string, 'double' | 'overtime' | 'standard'> = {}
    for (const item of (groupsRes.data ?? []) as ItemRow[]) {
      const groupName = item.payroll_item_groups?.name ?? ''
      itemClassMap[item.id] = classifyGroup(groupName)
    }

    // Aggregate by period_date, applying allocation splits
    type Week = { standardHours: number; overtimeHours: number; doubleTimeHours: number; totalDirectCost: number }
    const byWeek: Record<string, Week> = {}

    for (const t of rawTxns) {
      const homeBranchId = codeToHomeBranch[t.payroll_code_id]
      if (!homeBranchId) continue

      const splits = resolveEmployeeAllocation(
        t.employee_id, t.period_date, homeBranchId,
        empOverrides[t.employee_id] ?? [], empDefaults[t.employee_id] ?? []
      )

      for (const split of splits) {
        if (branchId && split.branchId !== branchId) continue
        const pct = split.percentage / 100
        if (!byWeek[t.period_date]) {
          byWeek[t.period_date] = { standardHours: 0, overtimeHours: 0, doubleTimeHours: 0, totalDirectCost: 0 }
        }
        const w = byWeek[t.period_date]
        w.totalDirectCost += r2(t.amount * pct)
        if (t.hours == null) continue
        const scaledHours = r2(t.hours * pct)
        const cls = t.payroll_item_id ? (itemClassMap[t.payroll_item_id] ?? 'standard') : 'standard'
        if (cls === 'double') w.doubleTimeHours += scaledHours
        else if (cls === 'overtime') w.overtimeHours += scaledHours
        else w.standardHours += scaledHours
      }
    }

    const weeks = Object.entries(byWeek)
      .map(([periodDate, w]) => ({ periodDate, ...w }))
      .sort((a, b) => a.periodDate.localeCompare(b.periodDate))

    return NextResponse.json({ success: true, data: weeks })
  } catch (err) {
    return apiError(err)
  }
}
