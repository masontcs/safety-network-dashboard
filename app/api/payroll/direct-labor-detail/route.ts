import { NextResponse } from 'next/server'
import { getAccessContext } from '@/lib/api/auth'
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

    let codesQuery = supabase
      .from('payroll_codes')
      .select('id, branch_id')
      .eq('labor_type', 'direct' as LaborType)

    // Keep manager access restriction but no branchId filter — allocation redistributes
    if (access.branchIds !== null) {
      codesQuery = codesQuery.in('branch_id', access.branchIds)
    }

    const { data: codes, error: codesErr } = await codesQuery
    if (codesErr) throw new Error(codesErr.message)

    const codeIds = (codes ?? []).map((c) => c.id)
    const codeToBranchId: Record<string, string | null> = {}
    for (const c of codes ?? []) codeToBranchId[c.id] = c.branch_id

    if (codeIds.length === 0) {
      return NextResponse.json({ success: true, data: [] })
    }

    const [itemsRes, branchRes] = await Promise.all([
      supabase.from('payroll_items').select('id, name, payroll_item_groups(name)'),
      supabase.from('branches').select('id, name'),
    ])

    if (itemsRes.error) throw new Error(itemsRes.error.message)

    const branchNameMap: Record<string, string> = {}
    for (const b of branchRes.data ?? []) branchNameMap[b.id] = b.name

    type ItemRow = { id: string; name: string; payroll_item_groups: { name: string } | null }
    const itemNameMap: Record<string, string> = {}
    const itemClassMap: Record<string, 'double' | 'overtime' | 'standard'> = {}
    const itemGroupMap: Record<string, string> = {}
    for (const item of (itemsRes.data ?? []) as ItemRow[]) {
      itemNameMap[item.id] = item.name
      const groupName = item.payroll_item_groups?.name ?? ''
      itemGroupMap[item.id] = groupName
      itemClassMap[item.id] = classifyGroup(groupName)
    }

    // Paginate transactions to avoid Supabase 1000-row hard cap
    const PAGE_SIZE = 1000
    type TxnRow = {
      employee_id: string
      payroll_code_id: string
      period_date: string
      hours: number | null
      rate: number | null
      amount: number
      payroll_item_id: string | null
      employees: { first_name: string; last_name: string } | null
    }
    const rawTxns: TxnRow[] = []
    {
      let from = 0
      while (true) {
        const { data, error } = await supabase
          .from('payroll_transactions')
          .select('employee_id, payroll_code_id, period_date, hours, rate, amount, payroll_item_id, employees(first_name, last_name)')
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

    // Fetch employee allocations
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

    // Aggregate by employee + payroll_item + target branch
    type RowKey = string
    type RowAgg = {
      employeeId: string
      displayName: string
      branchId: string | null
      itemName: string
      groupName: string
      regularHours: number
      otHours: number
      dtHours: number
      totalAmount: number
      rateSum: number
      rateCount: number
    }

    const byKey: Record<RowKey, RowAgg> = {}

    for (const t of rawTxns) {
      if (!t.employees) continue
      const homeBranchId = codeToBranchId[t.payroll_code_id] ?? null
      if (!homeBranchId) continue

      const splits = resolveEmployeeAllocation(
        t.employee_id, t.period_date, homeBranchId,
        empOverrides[t.employee_id] ?? [], empDefaults[t.employee_id] ?? []
      )

      for (const split of splits) {
        if (branchId && split.branchId !== branchId) continue
        const pct = split.percentage / 100
        const itemId = t.payroll_item_id ?? '__unclassified__'
        const key = `${t.employee_id}::${itemId}::${split.branchId}`

        if (!byKey[key]) {
          byKey[key] = {
            employeeId: t.employee_id,
            displayName: `${t.employees.first_name} ${t.employees.last_name}`.trim(),
            branchId: split.branchId,
            itemName: t.payroll_item_id ? (itemNameMap[t.payroll_item_id] ?? t.payroll_item_id) : 'Unclassified',
            groupName: t.payroll_item_id ? (itemGroupMap[t.payroll_item_id] ?? '') : '',
            regularHours: 0,
            otHours: 0,
            dtHours: 0,
            totalAmount: 0,
            rateSum: 0,
            rateCount: 0,
          }
        }

        const row = byKey[key]
        row.totalAmount += r2(t.amount * pct)
        if (t.rate != null) { row.rateSum += t.rate; row.rateCount += 1 }
        if (t.hours != null) {
          const scaledHours = r2(t.hours * pct)
          const cls = t.payroll_item_id ? (itemClassMap[t.payroll_item_id] ?? 'standard') : 'standard'
          if (cls === 'double') row.dtHours += scaledHours
          else if (cls === 'overtime') row.otHours += scaledHours
          else row.regularHours += scaledHours
        }
      }
    }

    const rows = Object.values(byKey)
      .map((r) => ({
        employeeId: r.employeeId,
        displayName: r.displayName,
        branchName: r.branchId ? (branchNameMap[r.branchId] ?? '—') : '—',
        itemName: r.itemName,
        groupName: r.groupName,
        regularHours: r.regularHours,
        otHours: r.otHours,
        dtHours: r.dtHours,
        totalHours: r.regularHours + r.otHours + r.dtHours,
        totalAmount: r.totalAmount,
        avgRate: r.rateCount > 0 ? r.rateSum / r.rateCount : null,
      }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName))

    return NextResponse.json({ success: true, data: rows })
  } catch (err) {
    return apiError(err)
  }
}
