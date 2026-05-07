import { NextResponse } from 'next/server'
import { getAccessContext } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { apiError } from '@/lib/utils/errors'
import type { LaborType, Vendor } from '@/lib/supabase/database.types'

type AssignmentRow = {
  entity_id: string
  payroll_code_id: string | null
  raw_name_in_report: string
  entities: { code: string; name: string } | null
  payroll_codes: {
    code: string
    labor_type: LaborType
    branch_id: string | null
    branches: { name: string } | null
  } | null
}

type PayrollTxnRow = {
  period_date: string
  payroll_item_id: string | null
  hours: number | null
  rate: number | null
  amount: number
  entities: { code: string } | null
  payroll_codes: { labor_type: LaborType } | null
  payroll_items: {
    name: string
    group_id: string
    payroll_item_groups: { name: string } | null
  } | null
}

type FuelTxnRow = {
  id: string
  transaction_date: string
  vendor: Vendor
  site_name: string | null
  site_city: string | null
  site_state: string | null
  product: string | null
  gallons: number | null
  price_per_gallon: number | null
  total_with_tax: number
}

export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response

    const { access } = ctx
    const supabase = createServiceClient()
    const employeeId = params.id

    // ── For manager roles: verify employee is in one of their assigned branches ──
    if (access.branchIds !== null) {
      // Get payroll codes for manager's assigned branches
      const { data: allowedCodes, error: codesErr } = await supabase
        .from('payroll_codes')
        .select('id')
        .in('branch_id', access.branchIds)

      if (codesErr) throw new Error(`Failed to load payroll codes: ${codesErr.message}`)

      const allowedCodeIds = (allowedCodes ?? []).map((c) => c.id)

      if (allowedCodeIds.length === 0) {
        return NextResponse.json(
          { success: false, error: 'Access denied.', code: 'FORBIDDEN' },
          { status: 403 }
        )
      }

      // Check that this employee has payroll transactions in the allowed codes
      const { data: txnCheck, error: txnCheckErr } = await supabase
        .from('payroll_transactions')
        .select('id')
        .eq('employee_id', employeeId)
        .in('payroll_code_id', allowedCodeIds)
        .limit(1)

      if (txnCheckErr) throw new Error(`Failed to verify employee access: ${txnCheckErr.message}`)

      if (!txnCheck || txnCheck.length === 0) {
        return NextResponse.json(
          { success: false, error: 'Access denied. Employee is not in your assigned branches.', code: 'FORBIDDEN' },
          { status: 403 }
        )
      }
    }

    const { data: employee, error: empErr } = await supabase
      .from('employees')
      .select('id, first_name, last_name, is_active')
      .eq('id', employeeId)
      .single()

    if (empErr || !employee) {
      return NextResponse.json(
        { success: false, error: 'Employee not found.', code: 'NOT_FOUND' },
        { status: 404 }
      )
    }

    const { data: rawAssignments, error: assignErr } = await supabase
      .from('employee_entity_assignments')
      .select('entity_id, payroll_code_id, raw_name_in_report, entities(code, name), payroll_codes(code, labor_type, branch_id, branches(name))')
      .eq('employee_id', employeeId)
      .is('effective_to', null)

    if (assignErr) throw new Error(`Failed to load assignments: ${assignErr.message}`)

    const assignments = (rawAssignments ?? []) as AssignmentRow[]

    // Paginate payroll transactions
    const PAGE_SIZE = 1000
    const allPayrollTxns: PayrollTxnRow[] = []
    let from = 0

    // For managers: only fetch direct labor transactions in their branches
    // For admin/executive: fetch all transactions
    let allowedPayrollCodeIds: string[] | null = null
    if (access.branchIds !== null) {
      const { data: pcData } = await supabase
        .from('payroll_codes')
        .select('id')
        .in('branch_id', access.branchIds)
        .eq('labor_type', 'direct')
      allowedPayrollCodeIds = (pcData ?? []).map((c) => c.id)
    }

    while (true) {
      let query = supabase
        .from('payroll_transactions')
        .select('period_date, payroll_item_id, hours, rate, amount, entities(code), payroll_codes(labor_type), payroll_items(name, group_id, payroll_item_groups(name))')
        .eq('employee_id', employeeId)
        .order('period_date', { ascending: false })
        .range(from, from + PAGE_SIZE - 1)

      if (allowedPayrollCodeIds !== null) {
        query = query.in('payroll_code_id', allowedPayrollCodeIds)
      }

      const { data, error } = await query

      if (error) throw new Error(`Failed to load payroll transactions: ${error.message}`)

      allPayrollTxns.push(...((data ?? []) as PayrollTxnRow[]))
      if (!data || data.length < PAGE_SIZE) break
      from += PAGE_SIZE
    }

    // Paginate fuel transactions
    const allFuelTxns: FuelTxnRow[] = []
    from = 0

    while (true) {
      const { data, error } = await supabase
        .from('fuel_transactions')
        .select('id, transaction_date, vendor, site_name, site_city, site_state, product, gallons, price_per_gallon, total_with_tax')
        .eq('employee_id', employeeId)
        .is('business_tag', null)
        .order('transaction_date', { ascending: false })
        .range(from, from + PAGE_SIZE - 1)

      if (error) throw new Error(`Failed to load fuel transactions: ${error.message}`)

      allFuelTxns.push(...((data ?? []) as FuelTxnRow[]))
      if (!data || data.length < PAGE_SIZE) break
      from += PAGE_SIZE
    }

    // For manager roles: filter assignments to only show those in their branches
    const visibleAssignments = access.branchIds !== null
      ? assignments.filter((a) =>
          a.payroll_codes?.branch_id != null &&
          access.branchIds!.includes(a.payroll_codes.branch_id) &&
          a.payroll_codes.labor_type === 'direct'
        )
      : assignments

    return NextResponse.json({
      success: true,
      data: {
        employee: {
          id: employee.id,
          firstName: employee.first_name,
          lastName: employee.last_name,
          displayName: `${employee.first_name} ${employee.last_name}`.trim(),
          isActive: employee.is_active,
          legalNames: visibleAssignments.map((a) => ({
            entityCode: a.entities?.code ?? '',
            entityName: a.entities?.name ?? '',
            rawName: a.raw_name_in_report,
          })),
          assignments: visibleAssignments.map((a) => ({
            entityId: a.entity_id,
            entityCode: a.entities?.code ?? '',
            entityName: a.entities?.name ?? '',
            payrollCode: a.payroll_codes?.code ?? '',
            laborType: a.payroll_codes?.labor_type ?? ('direct' as LaborType),
            branchId: a.payroll_codes?.branch_id ?? null,
            branchName: a.payroll_codes?.branches?.name ?? null,
          })),
        },
        payrollHistory: allPayrollTxns.map((t) => ({
          periodDate: t.period_date,
          itemId: t.payroll_item_id,
          itemName: t.payroll_items?.name ?? null,
          groupName: t.payroll_items?.payroll_item_groups?.name ?? null,
          hours: t.hours,
          rate: t.rate,
          amount: t.amount,
          entityCode: t.entities?.code ?? '',
          laborType: t.payroll_codes?.labor_type ?? ('direct' as LaborType),
        })),
        fuelHistory: allFuelTxns.map((t) => ({
          id: t.id,
          transactionDate: t.transaction_date,
          vendor: t.vendor,
          siteName: t.site_name,
          siteCity: t.site_city,
          siteState: t.site_state,
          product: t.product,
          gallons: t.gallons,
          pricePerGallon: t.price_per_gallon,
          totalWithTax: t.total_with_tax,
        })),
      },
    })
  } catch (err) {
    return apiError(err)
  }
}
