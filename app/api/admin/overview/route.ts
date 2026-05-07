import { NextResponse } from 'next/server'
import { getAccessContext, guardAdminOnly } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { apiError } from '@/lib/utils/errors'

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
    totals: { revenue: 0, directPayroll: 0, fuel: 0, grossProfit: 0, gpPct: 0, totalGallons: 0 },
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
        .select('branch_id, transaction_date, total_with_tax, gallons')
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

    type PayRow = { payroll_code_id: string; period_date: string; amount: number }
    const allPayRows: PayRow[] = []

    if (directCodeIds.length > 0) {
      from = 0
      while (true) {
        const { data, error } = await supabase
          .from('payroll_transactions')
          .select('payroll_code_id, period_date, amount')
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

    // ── Aggregate ───────────────────────────────────────────────────────────
    // period-level maps
    const periodRevenue: Record<string, number> = {}
    const periodPayroll: Record<string, number> = {}
    const periodFuel: Record<string, number> = {}

    // branch-level maps
    const bRevenue: Record<string, number> = {}
    const bLabor: Record<string, number> = {}
    const bRental: Record<string, number> = {}
    const bOneTime: Record<string, number> = {}
    const bPayroll: Record<string, number> = {}
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
      const bid = codeIdToBranchId[p.payroll_code_id]
      if (!bid) continue
      periodPayroll[p.period_date] = (periodPayroll[p.period_date] ?? 0) + p.amount
      bPayroll[bid] = (bPayroll[bid] ?? 0) + p.amount
      if (!bPayByPeriod[bid]) bPayByPeriod[bid] = {}
      bPayByPeriod[bid][p.period_date] = (bPayByPeriod[bid][p.period_date] ?? 0) + p.amount
    }

    let totalGallons = 0
    for (const f of allFuelRows) {
      if (!f.branch_id) continue
      const sat = toSaturdayOfWeek(f.transaction_date)
      periodFuel[sat] = (periodFuel[sat] ?? 0) + f.total_with_tax
      bFuel[f.branch_id] = (bFuel[f.branch_id] ?? 0) + f.total_with_tax
      if (!bFuelByPeriod[f.branch_id]) bFuelByPeriod[f.branch_id] = {}
      bFuelByPeriod[f.branch_id][sat] = (bFuelByPeriod[f.branch_id][sat] ?? 0) + f.total_with_tax
      if (f.gallons) totalGallons += f.gallons
    }

    // byPeriod — union of all period keys that appear in any dataset
    const allPeriods = new Set([
      ...Object.keys(periodRevenue),
      ...Object.keys(periodPayroll),
      ...Object.keys(periodFuel),
    ])

    const byPeriod = Array.from(allPeriods)
      .sort()
      .map((p) => ({
        periodDate: p,
        revenue: periodRevenue[p] ?? 0,
        directPayroll: periodPayroll[p] ?? 0,
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
      const fuel = bFuel[bid] ?? 0
      const gp = rev - pay - fuel
      const gpPct = rev > 0 ? r2((gp / rev) * 100) : 0
      return {
        branchId: bid,
        revenue: rev,
        labor: bLabor[bid] ?? 0,
        rental: bRental[bid] ?? 0,
        oneTime: bOneTime[bid] ?? 0,
        directPayroll: pay,
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
    const totalFuel = byBranch.reduce((s, b) => s + b.fuel, 0)
    const totalGP = totalRevenue - totalPayroll - totalFuel
    const totalGpPct = totalRevenue > 0 ? r2((totalGP / totalRevenue) * 100) : 0

    return NextResponse.json({
      success: true,
      data: {
        totals: {
          revenue: totalRevenue,
          directPayroll: totalPayroll,
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
