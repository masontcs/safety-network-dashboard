import { NextResponse } from 'next/server'
import { getAccessContext } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { applyPayrollSumRule } from '@/lib/api/payroll-shape'
import type { PayrollLineItem } from '@/lib/api/payroll-shape'
import type { LaborType } from '@/lib/supabase/database.types'
import { canAccessBranch } from '@/lib/utils/access'
import { apiError } from '@/lib/utils/errors'

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

    // Step 1: find direct labor payroll_code IDs for the requested branch(es)
    let codesQuery = supabase
      .from('payroll_codes')
      .select('id')
      .eq('labor_type', 'direct' as LaborType)

    if (branchId) {
      codesQuery = codesQuery.eq('branch_id', branchId)
    } else if (access.branchIds !== null) {
      codesQuery = codesQuery.in('branch_id', access.branchIds)
    }

    const { data: directCodes, error: codesErr } = await codesQuery
    if (codesErr) throw new Error(`Failed to load payroll codes: ${codesErr.message}`)

    const directCodeIds = (directCodes ?? []).map((c) => c.id)

    // Step 2: query direct labor transactions for those codes
    type PayrollTxnRow = {
      employee_id: string
      amount: number
      hours: number | null
      rate: number | null
      employees: { first_name: string; last_name: string } | null
      payroll_codes: { labor_type: LaborType; branch_id: string | null } | null
    }

    const directItems: PayrollLineItem[] = []
    if (directCodeIds.length > 0) {
      const { data: rawTxns, error: txnErr } = await supabase
        .from('payroll_transactions')
        .select('employee_id, amount, hours, rate, employees(first_name, last_name), payroll_codes(labor_type, branch_id)')
        .in('payroll_code_id', directCodeIds)
        .eq('period_date', periodDate)

      if (txnErr) throw new Error(`Failed to query direct labor: ${txnErr.message}`)

      for (const t of (rawTxns ?? []) as PayrollTxnRow[]) {
        if (!t.employees || !t.payroll_codes) continue
        directItems.push({
          employeeId: t.employee_id,
          displayName: `${t.employees.first_name} ${t.employees.last_name}`.trim(),
          laborType: t.payroll_codes.labor_type,
          amount: t.amount,
          hours: t.hours,
          rate: t.rate,
          branchId: t.payroll_codes.branch_id,
        })
      }
    }

    // Step 3: query admin payroll (entity-level overhead) if entityId provided
    const adminItems: PayrollLineItem[] = []
    let taxTotal = 0

    if (entityId) {
      const adminLaborTypes: LaborType[] = ['admin_hourly', 'admin_salary']

      const { data: adminCodes, error: adminCodesErr } = await supabase
        .from('payroll_codes')
        .select('id')
        .eq('entity_id', entityId)
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

      // Taxes
      const { data: taxes, error: taxErr } = await supabase
        .from('payroll_taxes')
        .select('amount')
        .eq('entity_id', entityId)
        .eq('period_date', periodDate)

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
