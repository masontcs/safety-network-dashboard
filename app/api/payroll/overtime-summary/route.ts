import { NextResponse } from 'next/server'
import { getAccessContext } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { canAccessBranch } from '@/lib/utils/access'
import { apiError } from '@/lib/utils/errors'
import type { LaborType } from '@/lib/supabase/database.types'

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

    if (branchId && !canAccessBranch(access, branchId)) {
      return NextResponse.json(
        { success: false, error: 'Access to this branch is not permitted.', code: 'FORBIDDEN' },
        { status: 403 },
      )
    }

    const supabase = createServiceClient()

    // Get direct labor payroll_code IDs
    let codesQuery = supabase
      .from('payroll_codes')
      .select('id, branch_id')
      .eq('labor_type', 'direct' as LaborType)

    if (branchId) {
      codesQuery = codesQuery.eq('branch_id', branchId)
    } else if (access.branchIds !== null) {
      codesQuery = codesQuery.in('branch_id', access.branchIds)
    }

    const { data: codes, error: codesErr } = await codesQuery
    if (codesErr) throw new Error(codesErr.message)

    const codeIds = (codes ?? []).map((c) => c.id)
    const codeTobranchId: Record<string, string | null> = {}
    for (const c of codes ?? []) codeTobranchId[c.id] = c.branch_id

    if (codeIds.length === 0) {
      return NextResponse.json({ success: true, data: [] })
    }

    const [txnRes, groupsRes, branchRes] = await Promise.all([
      supabase
        .from('payroll_transactions')
        .select('employee_id, payroll_code_id, hours, amount, payroll_item_id, employees(first_name, last_name)')
        .in('payroll_code_id', codeIds)
        .gte('period_date', startDate)
        .lte('period_date', endDate),
      supabase
        .from('payroll_items')
        .select('id, payroll_item_groups(name)'),
      supabase.from('branches').select('id, name'),
    ])

    if (txnRes.error) throw new Error(txnRes.error.message)
    if (groupsRes.error) throw new Error(groupsRes.error.message)

    const branchNameMap: Record<string, string> = {}
    for (const b of branchRes.data ?? []) branchNameMap[b.id] = b.name

    type ItemRow = { id: string; payroll_item_groups: { name: string } | null }
    const itemClassMap: Record<string, 'double' | 'overtime' | 'standard'> = {}
    for (const item of (groupsRes.data ?? []) as ItemRow[]) {
      itemClassMap[item.id] = classifyGroup(item.payroll_item_groups?.name ?? '')
    }

    type TxnRow = {
      employee_id: string
      payroll_code_id: string
      hours: number | null
      amount: number
      payroll_item_id: string | null
      employees: { first_name: string; last_name: string } | null
    }

    type EmpAgg = {
      displayName: string
      branchId: string | null
      regularHours: number
      otHours: number
      dtHours: number
      totalOtDtCost: number
      totalCost: number
    }

    const byEmp: Record<string, EmpAgg> = {}
    for (const t of (txnRes.data ?? []) as TxnRow[]) {
      if (!t.employees) continue
      if (!byEmp[t.employee_id]) {
        byEmp[t.employee_id] = {
          displayName: `${t.employees.first_name} ${t.employees.last_name}`.trim(),
          branchId: codeTobranchId[t.payroll_code_id] ?? null,
          regularHours: 0,
          otHours: 0,
          dtHours: 0,
          totalOtDtCost: 0,
          totalCost: 0,
        }
      }
      const e = byEmp[t.employee_id]
      e.totalCost += t.amount
      if (t.hours == null) continue
      const cls = t.payroll_item_id ? (itemClassMap[t.payroll_item_id] ?? 'standard') : 'standard'
      if (cls === 'double') {
        e.dtHours += t.hours
        e.totalOtDtCost += t.amount
      } else if (cls === 'overtime') {
        e.otHours += t.hours
        e.totalOtDtCost += t.amount
      } else {
        e.regularHours += t.hours
      }
    }

    const results = Object.entries(byEmp)
      .filter(([, e]) => e.otHours > 0 || e.dtHours > 0)
      .map(([employeeId, e]) => {
        const totalHours = e.regularHours + e.otHours + e.dtHours
        return {
          employeeId,
          displayName: e.displayName,
          branchName: e.branchId ? (branchNameMap[e.branchId] ?? '—') : '—',
          regularHours: e.regularHours,
          otHours: e.otHours,
          dtHours: e.dtHours,
          otPct: totalHours > 0 ? ((e.otHours + e.dtHours) / totalHours) * 100 : 0,
          totalOtDtCost: e.totalOtDtCost,
        }
      })
      .sort((a, b) => b.totalOtDtCost - a.totalOtDtCost)
      .slice(0, 10)

    return NextResponse.json({ success: true, data: results })
  } catch (err) {
    return apiError(err)
  }
}
