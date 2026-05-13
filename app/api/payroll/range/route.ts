import { NextResponse } from 'next/server'
import { getAccessContext } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { applyPayrollSumRule } from '@/lib/api/payroll-shape'
import type { PayrollLineItem } from '@/lib/api/payroll-shape'
import type { LaborType } from '@/lib/supabase/database.types'
import { canAccessBranch } from '@/lib/utils/access'
import { apiError } from '@/lib/utils/errors'
import { resolveEmployeeAllocation, type AllocationOverride, type EmployeeAllocation } from '@/lib/allocation/employee-allocation'
import { isValidDate } from '@/lib/utils/date'

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

    // ── Direct labor ────────────────────────────────────────────────────────
    const { data: directCodeRows, error: codesErr } = await supabase
      .from('payroll_codes')
      .select('id, branch_id')
      .eq('labor_type', 'direct' as LaborType)
    if (codesErr) throw new Error(`Failed to load payroll codes: ${codesErr.message}`)

    const directCodeIdToBranchId: Record<string, string | null> = {}
    for (const c of directCodeRows ?? []) directCodeIdToBranchId[c.id] = c.branch_id ?? null
    const directCodeIds = Object.keys(directCodeIdToBranchId)

    type PayRow = { employee_id: string; payroll_code_id: string; period_date: string; amount: number; hours: number | null; rate: number | null; employees: { first_name: string; last_name: string } | null; payroll_codes: { branch_id: string | null; labor_type: LaborType } | null }

    let rawDirectRows: PayRow[] = []
    if (directCodeIds.length > 0) {
      const { data, error } = await supabase
        .from('payroll_transactions')
        .select('employee_id, payroll_code_id, period_date, amount, hours, rate, employees(first_name, last_name), payroll_codes(branch_id, labor_type)')
        .in('payroll_code_id', directCodeIds)
        .gte('period_date', startDate)
        .lte('period_date', endDate)
        .limit(50000)
      if (error) throw new Error(`Failed to query direct labor: ${error.message}`)
      rawDirectRows = (data ?? []) as PayRow[]
    }

    // ── Admin payroll ────────────────────────────────────────────────────────
    const adminLaborTypes: LaborType[] = ['admin_hourly', 'admin_salary']
    let adminCodeIds: string[] = []

    if (branchId) {
      const { data: branchAdminCodes, error } = await supabase
        .from('payroll_codes')
        .select('id')
        .eq('branch_id', branchId)
        .in('labor_type', adminLaborTypes)
        .eq('is_active', true)
      if (error) throw new Error(`Failed to load admin codes: ${error.message}`)
      adminCodeIds = (branchAdminCodes ?? []).map((c) => c.id)
    } else {
      // No branch filter — load all admin codes (scoped to accessible branches for managers)
      let q = supabase.from('payroll_codes').select('id').in('labor_type', adminLaborTypes)
      if (access.branchIds !== null) q = q.in('branch_id', access.branchIds)
      const { data: allAdminCodes, error } = await q
      if (error) throw new Error(`Failed to load admin codes: ${error.message}`)
      adminCodeIds = (allAdminCodes ?? []).map((c) => c.id)
    }

    let rawAdminRows: PayRow[] = []
    if (adminCodeIds.length > 0) {
      const { data, error } = await supabase
        .from('payroll_transactions')
        .select('employee_id, payroll_code_id, period_date, amount, hours, rate, employees(first_name, last_name), payroll_codes(branch_id, labor_type)')
        .in('payroll_code_id', adminCodeIds)
        .gte('period_date', startDate)
        .lte('period_date', endDate)
        .limit(50000)
      if (error) throw new Error(`Failed to query admin payroll: ${error.message}`)
      rawAdminRows = (data ?? []) as PayRow[]
    }

    // ── Employee allocations ─────────────────────────────────────────────────
    const allEmpIds = [...new Set([...rawDirectRows, ...rawAdminRows].map((r) => r.employee_id))]
    const empDefaults: Record<string, EmployeeAllocation[]> = {}
    const empOverrides: Record<string, AllocationOverride[]> = {}

    if (allEmpIds.length > 0) {
      const [defaultsRes, overridesRes] = await Promise.all([
        supabase
          .from('employee_allocations')
          .select('employee_id, branch_id, percentage, effective_from, effective_to, status')
          .in('employee_id', allEmpIds)
          .eq('status', 'approved')
          .lte('effective_from', endDate),
        supabase
          .from('employee_allocation_overrides')
          .select('employee_id, period_date, branch_id, percentage, status')
          .in('employee_id', allEmpIds)
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

    // ── Build items per period ───────────────────────────────────────────────
    // directByPeriod and adminByPeriod hold items grouped by period_date
    const directByPeriod: Record<string, PayrollLineItem[]> = {}
    const adminByPeriod: Record<string, PayrollLineItem[]> = {}

    for (const t of rawDirectRows) {
      if (!t.employees || !t.payroll_codes) continue
      const homeBranchId = t.payroll_codes.branch_id
      if (!homeBranchId) continue

      const splits = resolveEmployeeAllocation(
        t.employee_id, t.period_date, homeBranchId,
        empOverrides[t.employee_id] ?? [], empDefaults[t.employee_id] ?? []
      )

      if (branchId) {
        const split = splits.find((s) => s.branchId === branchId)
        if (!split) continue
        if (!directByPeriod[t.period_date]) directByPeriod[t.period_date] = []
        directByPeriod[t.period_date].push({
          employeeId: t.employee_id,
          displayName: `${t.employees.first_name} ${t.employees.last_name}`.trim(),
          laborType: t.payroll_codes.labor_type,
          amount: r2(t.amount * (split.percentage / 100)),
          hours: t.hours !== null ? r2(t.hours * (split.percentage / 100)) : null,
          rate: t.rate,
          branchId,
        })
      } else {
        for (const split of splits) {
          if (access.branchIds !== null && !access.branchIds.includes(split.branchId)) continue
          if (!directByPeriod[t.period_date]) directByPeriod[t.period_date] = []
          directByPeriod[t.period_date].push({
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

    for (const t of rawAdminRows) {
      if (!t.employees || !t.payroll_codes) continue
      if (!adminByPeriod[t.period_date]) adminByPeriod[t.period_date] = []
      adminByPeriod[t.period_date].push({
        employeeId: t.employee_id,
        displayName: `${t.employees.first_name} ${t.employees.last_name}`.trim(),
        laborType: t.payroll_codes.labor_type,
        amount: t.amount,
        hours: t.hours,
        rate: t.rate,
        branchId: t.payroll_codes.branch_id,
      })
    }

    // ── Taxes ────────────────────────────────────────────────────────────────
    const taxByPeriod: Record<string, number> = {}
    const activeEmpIdsForTax = [...new Set([
      ...Object.values(directByPeriod).flat().map((i) => i.employeeId),
      ...Object.values(adminByPeriod).flat().map((i) => i.employeeId),
    ])]

    if (activeEmpIdsForTax.length > 0) {
      let taxQ = supabase
        .from('payroll_taxes')
        .select('period_date, amount')
        .in('employee_id', activeEmpIdsForTax)
        .is('business_tag', null)
        .gte('period_date', startDate)
        .lte('period_date', endDate)
      if (branchId) {
        // Fetch employee_entity_assignments to scope taxes by branch
        const { data: eeaData } = await supabase
          .from('employee_entity_assignments')
          .select('employee_id, payroll_codes(branch_id)')
          .in('employee_id', activeEmpIdsForTax)
          .eq('is_confirmed', true)
        type EeaRow = { employee_id: string; payroll_codes: { branch_id: string | null } | null }
        const branchEmpIds = (eeaData as unknown as EeaRow[] ?? [])
          .filter((e) => e.payroll_codes?.branch_id === branchId)
          .map((e) => e.employee_id)
        if (branchEmpIds.length > 0) taxQ = taxQ.in('employee_id', branchEmpIds)
        else taxQ = taxQ.in('employee_id', [])
      }
      const { data: taxes, error: taxErr } = await taxQ
      if (taxErr) throw new Error(`Failed to query taxes: ${taxErr.message}`)
      for (const t of taxes ?? []) {
        taxByPeriod[t.period_date] = (taxByPeriod[t.period_date] ?? 0) + t.amount
      }
    }

    // ── Aggregate totals and byWeek ──────────────────────────────────────────
    const allPeriods = new Set([
      ...Object.keys(directByPeriod),
      ...Object.keys(adminByPeriod),
      ...Object.keys(taxByPeriod),
    ])

    let totalDirect = 0
    let totalAdmin = 0
    let totalTaxes = 0

    const byWeek = Array.from(allPeriods).sort().map((periodDate) => {
      const dirItems = directByPeriod[periodDate] ?? []
      const admItems = adminByPeriod[periodDate] ?? []
      const taxAmt = taxByPeriod[periodDate] ?? 0

      // Apply sum rule per period
      const shaped = applyPayrollSumRule(dirItems, admItems, taxAmt, access)
      const dirTotal = shaped.directLabor.total
      const admTotal = shaped.adminPayroll.total
      const taxTotal = shaped.taxes.total

      totalDirect += dirTotal
      totalAdmin += admTotal
      totalTaxes += taxTotal

      return { periodDate, direct: r2(dirTotal), admin: r2(admTotal), taxes: r2(taxTotal) }
    })

    // Shape full-range totals through sum rule once more (for detail arrays)
    const allDirectItems = Object.values(directByPeriod).flat()
    const allAdminItems = Object.values(adminByPeriod).flat()
    const shaped = applyPayrollSumRule(allDirectItems, allAdminItems, totalTaxes, access)

    return NextResponse.json({
      success: true,
      data: {
        total: {
          direct: r2(shaped.directLabor.total),
          admin: r2(shaped.adminPayroll.total),
          taxes: r2(shaped.taxes.total),
          directDetail: shaped.directLabor.detail,
          adminDetail: 'detail' in shaped.adminPayroll ? shaped.adminPayroll.detail : undefined,
        },
        byWeek,
      },
    })
  } catch (err) {
    return apiError(err)
  }
}
