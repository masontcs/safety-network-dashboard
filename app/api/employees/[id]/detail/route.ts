import { NextResponse } from 'next/server'
import { getAccessContext } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { isAdminOrExecutive } from '@/lib/utils/access'
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

    if (!isAdminOrExecutive(access)) {
      return NextResponse.json(
        { success: false, error: 'Access restricted to admin and executive roles.', code: 'FORBIDDEN' },
        { status: 403 }
      )
    }

    const supabase = createServiceClient()
    const employeeId = params.id

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

    if (assignErr) throw new Error(`Failed to load assignments: ${assignErr.message}`)

    const assignments = (rawAssignments ?? []) as AssignmentRow[]

    // Paginate payroll transactions
    const PAGE_SIZE = 1000
    const allPayrollTxns: PayrollTxnRow[] = []
    let from = 0

    while (true) {
      const { data, error } = await supabase
        .from('payroll_transactions')
        .select('period_date, payroll_item_id, hours, rate, amount, entities(code), payroll_codes(labor_type), payroll_items(name, group_id, payroll_item_groups(name))')
        .eq('employee_id', employeeId)
        .order('period_date', { ascending: false })
        .range(from, from + PAGE_SIZE - 1)

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

    return NextResponse.json({
      success: true,
      data: {
        employee: {
          id: employee.id,
          firstName: employee.first_name,
          lastName: employee.last_name,
          displayName: `${employee.first_name} ${employee.last_name}`.trim(),
          isActive: employee.is_active,
          legalNames: assignments.map((a) => ({
            entityCode: a.entities?.code ?? '',
            entityName: a.entities?.name ?? '',
            rawName: a.raw_name_in_report,
          })),
          assignments: assignments.map((a) => ({
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
