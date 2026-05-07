import { NextResponse } from 'next/server'
import { getAccessContext, guardAdminOnly } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { apiError } from '@/lib/utils/errors'
import { resolveEmployeeAllocation, type AllocationOverride, type EmployeeAllocation } from '@/lib/allocation/employee-allocation'

const PAGE_SIZE = 1000

function r2(v: number): number {
  return Math.round(v * 100) / 100
}

function toISODateLocal(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

// Snap any date to the Saturday of its Sun-Sat week
function toSaturdayOfWeek(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  const daysToSat = (6 - date.getDay() + 7) % 7
  date.setDate(date.getDate() + daysToSat)
  return toISODateLocal(date)
}

function emptyResponse() {
  return {
    totals: { revenue: 0, directPayroll: 0, employerTaxes: 0, fuel: 0, grossProfit: 0, gpPct: 0, totalGallons: 0 },
    byPeriod: [],
    byBranch: [],
  }
}

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response

    const guard = guardAdminOnly(ctx.access.role)
    if (guard) return guard

    const { searchParams } = new URL(request.url)
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')

    if (!startDate || !endDate) {
      return NextResponse.json(
        { success: false, error: 'startDate and endDate are required', code: 'VALIDATION_ERROR' },
        { status: 400 }
      )
    }

    const supabase = createServiceClient()

    // SN branch IDs — all active revenue-generating branches
    const { data: branchRows, error: branchErr } = await supabase
      .from('branches')
      .select('id')
      .eq('is_active', true)
      .eq('is_revenue_generating', true)

    if (branchErr) throw new Error(branchErr.message)
    const snBranchIds = (branchRows ?? []).map((b) => b.id)
    if (snBranchIds.length === 0) return NextResponse.json({ success: true, data: emptyResponse() })

    // ── Revenue transactions ────────────────────────────────────────────────
    type RevRow = {
      branch_id: string
      period_date: string
      labor: number
      rental: number
      one_time_charges: number
      total_revenue: number
    }

    const allRevRows: RevRow[] = []
    let from = 0
    while (true) {
      const { data, error } = await supabase
        .from('revenue_transactions')
        .select('branch_id, period_date, labor, rental, one_time_charges, total_revenue')
        .in('branch_id', snBranchIds)
        .gte('period_date', startDate)
        .lte('period_date', endDate)
        .range(from, from + PAGE_SIZE - 1)

      if (error) throw new Error(error.message)
      if (!data || data.length === 0) break
      allRevRows.push(...(data as RevRow[]))
      if (data.length < PAGE_SIZE) break
      from += PAGE_SIZE
    }

    // ── Fuel transactions ───────────────────────────────────────────────────
    type FuelRow = {
      employee_id: string | null
      branch_id: string | null
      transaction_date: string
      total_with_tax: number
      gallons: number | null
    }

    const allFuelRows: FuelRow[] = []
    from = 0
    while (true) {
      const { data, error } = await supabase
        .from('fuel_transactions')
        .select('employee_id, branch_id, transaction_date, total_with_tax, gallons')
        .is('business_tag', null)
        .in('branch_id', snBranchIds)
        .gte('transaction_date', startDate)
        .lte('transaction_date', endDate)
        .range(from, from + PAGE_SIZE - 1)

      if (error) throw new Error(error.message)
      if (!data || data.length === 0) break
      allFuelRows.push(...(data as FuelRow[]))
      if (data.length < PAGE_SIZE) break
      from += PAGE_SIZE
    }

    // ── Direct payroll transactions ─────────────────────────────────────────
    const { data: codeRows, error: codesErr } = await supabase
      .from('payroll_codes')
      .select('id, branch_id')
      .eq('labor_type', 'direct')
      .in('branch_id', snBranchIds)

    if (codesErr) throw new Error(codesErr.message)

    const codeIdToBranchId: Record<string, string> = {}
    for (const c of codeRows ?? []) {
      if (c.branch_id) codeIdToBranchId[c.id] = c.branch_id
    }
    const directCodeIds = Object.keys(codeIdToBranchId)

    type PayRow = { employee_id: string; payroll_code_id: string; period_date: string; amount: number }
    const allPayRows: PayRow[] = []

    if (directCodeIds.length > 0) {
      from = 0
      while (true) {
        const { data, error } = await supabase
          .from('payroll_transactions')
          .select('employee_id, payroll_code_id, period_date, amount')
          .in('payroll_code_id', directCodeIds)
          .gte('period_date', startDate)
          .lte('period_date', endDate)
          .range(from, from + PAGE_SIZE - 1)

        if (error) throw new Error(error.message)
        if (!data || data.length === 0) break
        allPayRows.push(...(data as PayRow[]))
        if (data.length < PAGE_SIZE) break
        from += PAGE_SIZE
      }
    }

    // ── Employer taxes ──────────────────────────────────────────────────────
    type TaxRow = { employee_id: string; entity_id: string; period_date: string; amount: number }
    const allTaxRows: TaxRow[] = []
    from = 0
    while (true) {
      const { data, error } = await supabase
        .from('payroll_taxes')
        .select('employee_id, entity_id, period_date, amount')
        .gte('period_date', startDate)
        .lte('period_date', endDate)
        .range(from, from + PAGE_SIZE - 1)
      if (error) throw new Error(error.message)
      if (!data || data.length === 0) break
      allTaxRows.push(...(data as TaxRow[]))
      if (data.length < PAGE_SIZE) break
      from += PAGE_SIZE
    }

    // Resolve branch per tax row via employee_entity_assignments → payroll_codes
    const taxEmpIds = [...new Set(allTaxRows.map((r) => r.employee_id))]
    const empEntityBranch: Record<string, string | null> = {}

    if (taxEmpIds.length > 0) {
      type EeaRow = { employee_id: string; entity_id: string; payroll_codes: { branch_id: string | null } | null }
      const { data: eeaData } = await supabase
        .from('employee_entity_assignments')
        .select('employee_id, entity_id, payroll_codes(branch_id)')
        .eq('is_confirmed', true)
        .is('effective_to', null)
        .in('employee_id', taxEmpIds)

      for (const eea of (eeaData ?? []) as unknown as EeaRow[]) {
        const branchId = eea.payroll_codes?.branch_id ?? null
        empEntityBranch[`${eea.employee_id}:${eea.entity_id}`] = branchId
      }
    }

    // ── Employee allocation splits ──────────────────────────────────────────
    const allEmpIds = [
      ...new Set([
        ...allPayRows.map((p) => p.employee_id),
        ...allFuelRows.map((f) => f.employee_id).filter((id): id is string => id !== null),
        ...allTaxRows.map((t) => t.employee_id),
      ]),
    ]

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

    // ── Aggregate ───────────────────────────────────────────────────────────
    // period-level maps
    const periodRevenue: Record<string, number> = {}
    const periodPayroll: Record<string, number> = {}
    const periodTax: Record<string, number> = {}
    const periodFuel: Record<string, number> = {}

    // branch-level maps
    const bRevenue: Record<string, number> = {}
    const bLabor: Record<string, number> = {}
    const bRental: Record<string, number> = {}
    const bOneTime: Record<string, number> = {}
    const bPayroll: Record<string, number> = {}
    const bTax: Record<string, number> = {}
    const bFuel: Record<string, number> = {}
    const bRevByPeriod: Record<string, Record<string, number>> = {}
    const bPayByPeriod: Record<string, Record<string, number>> = {}
    const bFuelByPeriod: Record<string, Record<string, number>> = {}

    for (const r of allRevRows) {
      const bid = r.branch_id
      periodRevenue[r.period_date] = (periodRevenue[r.period_date] ?? 0) + r.total_revenue
      bRevenue[bid] = (bRevenue[bid] ?? 0) + r.total_revenue
      bLabor[bid] = (bLabor[bid] ?? 0) + r.labor
      bRental[bid] = (bRental[bid] ?? 0) + r.rental
      bOneTime[bid] = (bOneTime[bid] ?? 0) + r.one_time_charges
      if (!bRevByPeriod[bid]) bRevByPeriod[bid] = {}
      bRevByPeriod[bid][r.period_date] = (bRevByPeriod[bid][r.period_date] ?? 0) + r.total_revenue
    }

    for (const p of allPayRows) {
      const homeBranchId = codeIdToBranchId[p.payroll_code_id]
      if (!homeBranchId) continue
      periodPayroll[p.period_date] = (periodPayroll[p.period_date] ?? 0) + p.amount
      const splits = resolveEmployeeAllocation(
        p.employee_id, p.period_date, homeBranchId,
        empOverrides[p.employee_id] ?? [], empDefaults[p.employee_id] ?? []
      )
      for (const split of splits) {
        const portion = r2(p.amount * (split.percentage / 100))
        bPayroll[split.branchId] = (bPayroll[split.branchId] ?? 0) + portion
        if (!bPayByPeriod[split.branchId]) bPayByPeriod[split.branchId] = {}
        bPayByPeriod[split.branchId][p.period_date] = (bPayByPeriod[split.branchId][p.period_date] ?? 0) + portion
      }
    }

    let totalGallons = 0
    for (const f of allFuelRows) {
      const sat = toSaturdayOfWeek(f.transaction_date)
      periodFuel[sat] = (periodFuel[sat] ?? 0) + f.total_with_tax
      if (f.gallons) totalGallons += f.gallons

      if (f.employee_id && f.branch_id) {
        const splits = resolveEmployeeAllocation(
          f.employee_id, sat, f.branch_id,
          empOverrides[f.employee_id] ?? [], empDefaults[f.employee_id] ?? []
        )
        for (const split of splits) {
          const portion = r2(f.total_with_tax * (split.percentage / 100))
          bFuel[split.branchId] = (bFuel[split.branchId] ?? 0) + portion
          if (!bFuelByPeriod[split.branchId]) bFuelByPeriod[split.branchId] = {}
          bFuelByPeriod[split.branchId][sat] = (bFuelByPeriod[split.branchId][sat] ?? 0) + portion
        }
      } else if (f.branch_id) {
        bFuel[f.branch_id] = (bFuel[f.branch_id] ?? 0) + f.total_with_tax
        if (!bFuelByPeriod[f.branch_id]) bFuelByPeriod[f.branch_id] = {}
        bFuelByPeriod[f.branch_id][sat] = (bFuelByPeriod[f.branch_id][sat] ?? 0) + f.total_with_tax
      }
    }

    for (const t of allTaxRows) {
      const homeBranchId = empEntityBranch[`${t.employee_id}:${t.entity_id}`]
      if (!homeBranchId || !snBranchIds.includes(homeBranchId)) continue
      periodTax[t.period_date] = (periodTax[t.period_date] ?? 0) + t.amount
      const splits = resolveEmployeeAllocation(
        t.employee_id, t.period_date, homeBranchId,
        empOverrides[t.employee_id] ?? [], empDefaults[t.employee_id] ?? []
      )
      for (const split of splits) {
        const portion = r2(t.amount * (split.percentage / 100))
        bTax[split.branchId] = (bTax[split.branchId] ?? 0) + portion
      }
    }

    // byPeriod — union of all period keys that appear in any dataset
    const allPeriods = new Set([
      ...Object.keys(periodRevenue),
      ...Object.keys(periodPayroll),
      ...Object.keys(periodTax),
      ...Object.keys(periodFuel),
    ])

    const byPeriod = Array.from(allPeriods)
      .sort()
      .map((p) => ({
        periodDate: p,
        revenue: periodRevenue[p] ?? 0,
        directPayroll: periodPayroll[p] ?? 0,
        employerTaxes: periodTax[p] ?? 0,
        fuel: periodFuel[p] ?? 0,
      }))

    // byBranch
    const allBranchIds = new Set([
      ...Object.keys(bRevenue),
      ...Object.keys(bPayroll),
      ...Object.keys(bFuel),
    ])

    const byBranch = Array.from(allBranchIds).map((bid) => {
      const rev = bRevenue[bid] ?? 0
      const pay = bPayroll[bid] ?? 0
      const tax = bTax[bid] ?? 0
      const fuel = bFuel[bid] ?? 0
      const gp = rev - pay - tax - fuel
      const gpPct = rev > 0 ? r2((gp / rev) * 100) : 0
      return {
        branchId: bid,
        revenue: rev,
        labor: bLabor[bid] ?? 0,
        rental: bRental[bid] ?? 0,
        oneTime: bOneTime[bid] ?? 0,
        directPayroll: pay,
        employerTaxes: tax,
        fuel,
        grossProfit: gp,
        gpPct,
        revenueByPeriod: Object.entries(bRevByPeriod[bid] ?? {})
          .map(([periodDate, revenue]) => ({ periodDate, revenue }))
          .sort((a, b) => (a.periodDate < b.periodDate ? -1 : 1)),
        payrollByPeriod: Object.entries(bPayByPeriod[bid] ?? {})
          .map(([periodDate, payroll]) => ({ periodDate, payroll }))
          .sort((a, b) => (a.periodDate < b.periodDate ? -1 : 1)),
        fuelByPeriod: Object.entries(bFuelByPeriod[bid] ?? {})
          .map(([periodDate, fuel]) => ({ periodDate, fuel }))
          .sort((a, b) => (a.periodDate < b.periodDate ? -1 : 1)),
      }
    })

    const totalRevenue = byBranch.reduce((s, b) => s + b.revenue, 0)
    const totalPayroll = byBranch.reduce((s, b) => s + b.directPayroll, 0)
    const totalEmployerTaxes = byBranch.reduce((s, b) => s + b.employerTaxes, 0)
    const totalFuel = byBranch.reduce((s, b) => s + b.fuel, 0)
    const totalGP = totalRevenue - totalPayroll - totalEmployerTaxes - totalFuel
    const totalGpPct = totalRevenue > 0 ? r2((totalGP / totalRevenue) * 100) : 0

    return NextResponse.json({
      success: true,
      data: {
        totals: {
          revenue: totalRevenue,
          directPayroll: totalPayroll,
          employerTaxes: totalEmployerTaxes,
          fuel: totalFuel,
          grossProfit: totalGP,
          gpPct: totalGpPct,
          totalGallons,
        },
        byPeriod,
        byBranch,
      },
    })
  } catch (err) {
    return apiError(err)
  }
}
