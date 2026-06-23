import { NextResponse } from 'next/server'
import { getAccessContext, guardAdminOrExecutive } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import type { LaborType } from '@/lib/supabase/database.types'
import { apiError } from '@/lib/utils/errors'
import { resolveEmployeeAllocation, type AllocationOverride, type EmployeeAllocation } from '@/lib/allocation/employee-allocation'
import { isValidDate } from '@/lib/utils/date'

function r2(v: number): number { return Math.round(v * 100) / 100 }

// Groups that are NOT gross wages. Everything else (Std Time, OT, DT, Salary, etc.)
// rolls up into the Gross subtotal. (The "Taxes" item group has no transactions —
// employer taxes come from the payroll_taxes table.)
const NON_EARNING_GROUPS = new Set(['Fringes', 'Other'])

// GET /api/payroll/group-matrix?startDate=&endDate=
// Admin/executive only. Payroll bucketed by item GROUP × BRANCH, tied out to the
// dashboard: same direct-labor allocation splits + admin attribution the range
// route uses. Employer taxes are scoped to the same active employees (so the grand
// total equals the Total Payroll KPI) but are company-level — they have no branch
// in the source data.
export async function GET(request: Request): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const guard = guardAdminOrExecutive(ctx.access.role)
    if (guard) return guard

    const { searchParams } = new URL(request.url)
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    if (!startDate || !endDate) {
      return NextResponse.json({ success: false, error: 'startDate and endDate are required', code: 'VALIDATION_ERROR' }, { status: 400 })
    }
    if (!isValidDate(startDate) || !isValidDate(endDate)) {
      return NextResponse.json({ success: false, error: 'startDate and endDate must be valid dates (YYYY-MM-DD)', code: 'VALIDATION_ERROR' }, { status: 400 })
    }

    const supabase = createServiceClient()

    // ── Lookup maps: item → group name ───────────────────────────────────────
    const [{ data: groupRows }, { data: itemRows }] = await Promise.all([
      supabase.from('payroll_item_groups').select('id, name'),
      supabase.from('payroll_items').select('id, group_id'),
    ])
    const groupNameById: Record<string, string> = {}
    for (const g of groupRows ?? []) groupNameById[g.id as string] = g.name as string
    const groupIdByItem: Record<string, string | null> = {}
    for (const it of itemRows ?? []) groupIdByItem[it.id as string] = (it.group_id as string) ?? null
    const groupForItem = (itemId: string | null): string => {
      if (!itemId) return 'Other'
      const gid = groupIdByItem[itemId]
      return (gid && groupNameById[gid]) || 'Other'
    }

    // ── Transactions (direct + admin), paginated ─────────────────────────────
    type PayRow = {
      employee_id: string
      period_date: string
      amount: number
      payroll_item_id: string | null
      payroll_codes: { branch_id: string | null; labor_type: LaborType } | null
    }
    const PAGE = 1000
    async function fetchTxns(codeIds: string[]): Promise<PayRow[]> {
      if (codeIds.length === 0) return []
      const out: PayRow[] = []
      let from = 0
      while (true) {
        const { data, error } = await supabase
          .from('payroll_transactions')
          .select('employee_id, period_date, amount, payroll_item_id, payroll_codes(branch_id, labor_type)')
          .in('payroll_code_id', codeIds)
          .gte('period_date', startDate)
          .lte('period_date', endDate)
          .order('period_date')
          .range(from, from + PAGE - 1)
        if (error) throw new Error(`Failed to query payroll: ${error.message}`)
        if (!data || data.length === 0) break
        out.push(...(data as unknown as PayRow[]))
        if (data.length < PAGE) break
        from += PAGE
      }
      return out
    }

    const adminLaborTypes: LaborType[] = ['admin_hourly', 'admin_salary']
    const [{ data: directCodeRows, error: dcErr }, { data: adminCodeRows, error: acErr }] = await Promise.all([
      supabase.from('payroll_codes').select('id, branch_id').eq('labor_type', 'direct' as LaborType),
      supabase.from('payroll_codes').select('id, branch_id').in('labor_type', adminLaborTypes),
    ])
    if (dcErr) throw new Error(`Failed to load direct codes: ${dcErr.message}`)
    if (acErr) throw new Error(`Failed to load admin codes: ${acErr.message}`)
    const directCodeIds = (directCodeRows ?? []).map((c) => c.id as string)
    const adminCodeIds = (adminCodeRows ?? []).map((c) => c.id as string)

    const [directTxns, adminTxns] = await Promise.all([fetchTxns(directCodeIds), fetchTxns(adminCodeIds)])

    // ── Employee allocations (same logic as the range route) ─────────────────
    const allEmpIds = [...new Set([...directTxns, ...adminTxns].map((r) => r.employee_id))]
    const empDefaults: Record<string, EmployeeAllocation[]> = {}
    const empOverrides: Record<string, AllocationOverride[]> = {}
    if (allEmpIds.length > 0) {
      const [defaultsRes, overridesRes] = await Promise.all([
        supabase.from('employee_allocations')
          .select('employee_id, branch_id, percentage, effective_from, effective_to, status')
          .in('employee_id', allEmpIds).eq('status', 'approved').lte('effective_from', endDate),
        supabase.from('employee_allocation_overrides')
          .select('employee_id, period_date, branch_id, percentage, status')
          .in('employee_id', allEmpIds).eq('status', 'approved').gte('period_date', startDate).lte('period_date', endDate),
      ])
      for (const d of (defaultsRes.data ?? []) as EmployeeAllocation[]) (empDefaults[d.employee_id] ??= []).push(d)
      for (const o of (overridesRes.data ?? []) as AllocationOverride[]) (empOverrides[o.employee_id] ??= []).push(o)
    }

    // ── Accumulate matrix[branchId][groupName] ───────────────────────────────
    const matrix: Record<string, Record<string, number>> = {}
    const add = (branchId: string, group: string, amt: number) => {
      ;(matrix[branchId] ??= {})[group] = (matrix[branchId]?.[group] ?? 0) + amt
    }

    for (const t of directTxns) {
      const home = t.payroll_codes?.branch_id
      if (!home) continue
      const g = groupForItem(t.payroll_item_id)
      const splits = resolveEmployeeAllocation(
        t.employee_id, t.period_date, home,
        empOverrides[t.employee_id] ?? [], empDefaults[t.employee_id] ?? []
      )
      for (const s of splits) add(s.branchId, g, t.amount * (s.percentage / 100))
    }
    for (const t of adminTxns) {
      const b = t.payroll_codes?.branch_id
      if (!b) continue
      add(b, groupForItem(t.payroll_item_id), t.amount)
    }

    // ── Employer taxes (scoped to active employees, company-level) ───────────
    let employerTax = 0
    if (allEmpIds.length > 0) {
      let from = 0
      while (true) {
        const { data, error } = await supabase
          .from('payroll_taxes')
          .select('amount')
          .in('employee_id', allEmpIds)
          .is('business_tag', null)
          .gte('period_date', startDate)
          .lte('period_date', endDate)
          .range(from, from + PAGE - 1)
        if (error) throw new Error(`Failed to query taxes: ${error.message}`)
        if (!data || data.length === 0) break
        for (const t of data) employerTax += t.amount as number
        if (data.length < PAGE) break
        from += PAGE
      }
    }

    // ── Branch columns (only branches with data, ordered by name) ────────────
    const branchIdsPresent = Object.keys(matrix)
    const { data: branchRows } = await supabase
      .from('branches')
      .select('id, name')
      .in('id', branchIdsPresent.length ? branchIdsPresent : [''])
      .order('name')
    const branches = (branchRows ?? []).map((b) => ({ id: b.id as string, name: b.name as string }))

    // ── Group rows (earnings by size desc, then Fringes, Other) ──────────────
    const groupTotals: Record<string, number> = {}
    for (const bid of branchIdsPresent)
      for (const [g, amt] of Object.entries(matrix[bid])) groupTotals[g] = (groupTotals[g] ?? 0) + amt

    const earningsGroups = Object.keys(groupTotals).filter((g) => !NON_EARNING_GROUPS.has(g)).sort((a, b) => groupTotals[b] - groupTotals[a])
    const nonEarning = ['Fringes', 'Other'].filter((g) => g in groupTotals)
    const orderedGroups = [...earningsGroups, ...nonEarning]

    const rowFor = (g: string) => {
      const byBranch: Record<string, number> = {}
      let total = 0
      for (const b of branches) { const v = matrix[b.id]?.[g] ?? 0; byBranch[b.id] = r2(v); total += v }
      return { name: g, isEarnings: !NON_EARNING_GROUPS.has(g), byBranch, total: r2(total) }
    }
    const groups = orderedGroups.map(rowFor)

    // Gross subtotal (earnings groups only)
    const grossByBranch: Record<string, number> = {}
    let grossTotal = 0
    for (const b of branches) {
      let v = 0
      for (const g of earningsGroups) v += matrix[b.id]?.[g] ?? 0
      grossByBranch[b.id] = r2(v)
      grossTotal += v
    }

    const fringesOtherTotal = (groupTotals['Fringes'] ?? 0) + (groupTotals['Other'] ?? 0)
    const grandTotal = r2(grossTotal + fringesOtherTotal + employerTax)

    return NextResponse.json({
      success: true,
      data: {
        branches,
        groups,
        gross: { byBranch: grossByBranch, total: r2(grossTotal) },
        employerTax: r2(employerTax),
        grandTotal,
      },
    })
  } catch (err) {
    return apiError(err)
  }
}
