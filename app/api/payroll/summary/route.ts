import { NextResponse } from 'next/server'
import { getAccessContext } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { applyPayrollSumRule } from '@/lib/api/payroll-shape'
import type { PayrollLineItem } from '@/lib/api/payroll-shape'
import type { LaborType } from '@/lib/supabase/database.types'
import { canAccessBranch } from '@/lib/utils/access'
import { apiError } from '@/lib/utils/errors'
import { resolveEmployeeAllocation, type AllocationOverride, type EmployeeAllocation } from '@/lib/allocation/employee-allocation'

function r2(v: number): number {
  return Math.round(v * 100) / 100
}

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response

    const { access } = ctx
    const { searchParams } = new URL(request.url)
    const branchId = searchParams.get('branchId')
    const periodDate = searchParams.get('periodDate')
    const entityId = searchParams.get('entityId')

    if (!periodDate) {
      return NextResponse.json(
        { success: false, error: 'periodDate is required', code: 'VALIDATION_ERROR' },
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

    // If entityId was not passed (or is empty), look it up from the branch's payroll codes.
    // This ensures admin payroll and taxes are always fetched regardless of how the client
    // constructs the URL.
    let resolvedEntityId = entityId ?? ''
    if (!resolvedEntityId && branchId) {
      const { data: codeRow } = await supabase
        .from('payroll_codes')
        .select('entity_id')
        .eq('branch_id', branchId)
        .eq('is_active', true)
        .limit(1)
        .single()
      resolvedEntityId = codeRow?.entity_id ?? ''
    }

    // Step 1: find ALL direct labor payroll_code IDs (allocation may redistribute across branches)
    let codesQuery = supabase
      .from('payroll_codes')
      .select('id')
      .eq('labor_type', 'direct' as LaborType)

    // Keep manager access scoped to assigned branches at the code level
    if (access.branchIds !== null) {
      codesQuery = codesQuery.in('branch_id', access.branchIds)
    }

    const { data: directCodes, error: codesErr } = await codesQuery
    if (codesErr) throw new Error(`Failed to load payroll codes: ${codesErr.message}`)

    const directCodeIds = (directCodes ?? []).map((c) => c.id)

    // Step 2: query all direct labor transactions, then apply allocation splits
    type PayrollTxnRow = {
      employee_id: string
      amount: number
      hours: number | null
      rate: number | null
      employees: { first_name: string; last_name: string } | null
      payroll_codes: { labor_type: LaborType; branch_id: string | null } | null
    }

    let rawTxnData: PayrollTxnRow[] = []
    if (directCodeIds.length > 0) {
      const { data: rawTxns, error: txnErr } = await supabase
        .from('payroll_transactions')
        .select('employee_id, amount, hours, rate, employees(first_name, last_name), payroll_codes(labor_type, branch_id)')
        .in('payroll_code_id', directCodeIds)
        .eq('period_date', periodDate)
        .limit(50000)

      if (txnErr) throw new Error(`Failed to query direct labor: ${txnErr.message}`)
      rawTxnData = (rawTxns ?? []) as PayrollTxnRow[]
    }

    // Fetch employee allocation data for all employees in this period
    const txnEmpIds = [...new Set(rawTxnData.map((t) => t.employee_id))]
    const empDefaults: Record<string, EmployeeAllocation[]> = {}
    const empOverrides: Record<string, AllocationOverride[]> = {}

    if (txnEmpIds.length > 0) {
      const [defaultsRes, overridesRes] = await Promise.all([
        supabase
          .from('employee_allocations')
          .select('employee_id, branch_id, percentage, effective_from, effective_to, status')
          .in('employee_id', txnEmpIds)
          .eq('status', 'approved')
          .lte('effective_from', periodDate),
        supabase
          .from('employee_allocation_overrides')
          .select('employee_id, period_date, branch_id, percentage, status')
          .in('employee_id', txnEmpIds)
          .eq('status', 'approved')
          .eq('period_date', periodDate),
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

    const directItems: PayrollLineItem[] = []
    for (const t of rawTxnData) {
      if (!t.employees || !t.payroll_codes) continue
      const homeBranchId = t.payroll_codes.branch_id
      if (!homeBranchId) continue

      const splits = resolveEmployeeAllocation(
        t.employee_id, periodDate, homeBranchId,
        empOverrides[t.employee_id] ?? [], empDefaults[t.employee_id] ?? []
      )

      if (branchId) {
        const split = splits.find((s) => s.branchId === branchId)
        if (!split) continue
        directItems.push({
          employeeId: t.employee_id,
          displayName: `${t.employees.first_name} ${t.employees.last_name}`.trim(),
          laborType: t.payroll_codes.labor_type,
          amount: r2(t.amount * (split.percentage / 100)),
          hours: t.hours !== null ? r2(t.hours * (split.percentage / 100)) : null,
          rate: t.rate,
          branchId: branchId,
        })
      } else {
        for (const split of splits) {
          directItems.push({
            employeeId: t.employee_id,
            displayName: `${t.employees.first_name} ${t.employees.last_name}`.trim(),
            laborType: t.payroll_codes.labor_type,
            amount: r2(t.amount * (split.percentage / 100)),
            hours: t.hours !== null ? r2(t.hours * (split.percentage / 100)) : null,
            rate: t.rate,
            branchId: split.branchId,
          })
        }
      }
    }

    // Step 3: query admin payroll (entity-level overhead) if entity resolved
    const adminItems: PayrollLineItem[] = []
    let taxTotal = 0

    if (resolvedEntityId) {
      const adminLaborTypes: LaborType[] = ['admin_hourly', 'admin_salary']

      const { data: adminCodes, error: adminCodesErr } = await supabase
        .from('payroll_codes')
        .select('id')
        .eq('entity_id', resolvedEntityId)
        .in('labor_type', adminLaborTypes)

      if (adminCodesErr) throw new Error(`Failed to load admin codes: ${adminCodesErr.message}`)

      const adminCodeIds = (adminCodes ?? []).map((c) => c.id)

      if (adminCodeIds.length > 0) {
        const { data: rawAdminTxns, error: adminErr } = await supabase
          .from('payroll_transactions')
          .select('employee_id, amount, hours, rate, employees(first_name, last_name), payroll_codes(labor_type)')
          .in('payroll_code_id', adminCodeIds)
          .eq('period_date', periodDate)

        if (adminErr) throw new Error(`Failed to query admin payroll: ${adminErr.message}`)

        for (const t of (rawAdminTxns ?? []) as PayrollTxnRow[]) {
          if (!t.employees || !t.payroll_codes) continue
          adminItems.push({
            employeeId: t.employee_id,
            displayName: `${t.employees.first_name} ${t.employees.last_name}`.trim(),
            laborType: t.payroll_codes.labor_type,
            amount: t.amount,
            hours: t.hours,
            rate: t.rate,
          })
        }
      }

      // Taxes — scoped to employees who had transactions this period
      // (avoids over-counting when a branchId filter is active)
      const activeEmpIds = [
        ...new Set([...directItems.map((i) => i.employeeId), ...adminItems.map((i) => i.employeeId)]),
      ]
      let taxQuery = supabase
        .from('payroll_taxes')
        .select('amount')
        .eq('entity_id', resolvedEntityId)
        .eq('period_date', periodDate)
      if (activeEmpIds.length > 0) {
        taxQuery = taxQuery.in('employee_id', activeEmpIds)
      }

      const { data: taxes, error: taxErr } = await taxQuery
      if (taxErr) throw new Error(`Failed to query payroll taxes: ${taxErr.message}`)
      taxTotal = (taxes ?? []).reduce((s, t) => s + t.amount, 0)
    }

    // Step 4: shape response — applies admin payroll sum rule based on role
    const shaped = applyPayrollSumRule(directItems, adminItems, taxTotal, access)

    return NextResponse.json({ success: true, data: shaped })
  } catch (err) {
    return apiError(err)
  }
}
