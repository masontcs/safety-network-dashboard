import { NextResponse } from 'next/server'
import { getAccessContext } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { isAdminOrExecutive } from '@/lib/utils/access'
import { calculateAllocations } from '@/lib/allocation'
import { apiError } from '@/lib/utils/errors'

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response

    const { access } = ctx

    if (!isAdminOrExecutive(access)) {
      return NextResponse.json(
        { success: false, error: 'Allocation data requires executive or admin access.', code: 'FORBIDDEN' },
        { status: 403 }
      )
    }

    const { searchParams } = new URL(request.url)
    const periodDate = searchParams.get('periodDate')

    if (!periodDate) {
      return NextResponse.json(
        { success: false, error: 'periodDate is required', code: 'VALIDATION_ERROR' },
        { status: 400 }
      )
    }

    const supabase = createServiceClient()

    // HQ allocation percentage is stored in the DB, never hardcoded
    const { data: snBusiness, error: bizErr } = await supabase
      .from('businesses')
      .select('id, hq_allocation_pct')
      .eq('code', 'SN')
      .single()

    if (bizErr || !snBusiness) throw new Error(`Failed to load SN business: ${bizErr?.message}`)

    // Get all revenue-generating SN branches
    const { data: branches, error: branchErr } = await supabase
      .from('branches')
      .select('id')
      .eq('business_id', snBusiness.id)
      .eq('is_revenue_generating', true)
      .eq('is_active', true)

    if (branchErr) throw new Error(`Failed to load branches: ${branchErr.message}`)

    const branchIds = (branches ?? []).map((b) => b.id)

    // Sum revenue per branch for the period
    const branchRevenues: Array<{ branchId: string; totalRevenue: number }> = []

    if (branchIds.length > 0) {
      const { data: revTxns, error: revErr } = await supabase
        .from('revenue_transactions')
        .select('branch_id, total_revenue')
        .eq('period_date', periodDate)
        .in('branch_id', branchIds)

      if (revErr) throw new Error(`Failed to load revenue: ${revErr.message}`)

      const revMap = new Map<string, number>()
      for (const t of revTxns ?? []) {
        revMap.set(t.branch_id, (revMap.get(t.branch_id) ?? 0) + t.total_revenue)
      }
      for (const branchId of branchIds) {
        branchRevenues.push({ branchId, totalRevenue: revMap.get(branchId) ?? 0 })
      }
    }

    // Corp payroll total (allocation_type = 'corp')
    const { data: corpCodes, error: corpCodesErr } = await supabase
      .from('payroll_codes')
      .select('id')
      .eq('allocation_type', 'corp')

    if (corpCodesErr) throw new Error(`Failed to load corp codes: ${corpCodesErr.message}`)

    const corpCodeIds = (corpCodes ?? []).map((c) => c.id)
    let corpPayroll = 0

    if (corpCodeIds.length > 0) {
      const { data: corpTxns, error: corpTxnErr } = await supabase
        .from('payroll_transactions')
        .select('amount')
        .in('payroll_code_id', corpCodeIds)
        .eq('period_date', periodDate)

      if (corpTxnErr) throw new Error(`Failed to load corp payroll: ${corpTxnErr.message}`)
      corpPayroll = (corpTxns ?? []).reduce((s, t) => s + t.amount, 0)
    }

    // HQ payroll total (allocation_type = 'hq')
    const { data: hqCodes, error: hqCodesErr } = await supabase
      .from('payroll_codes')
      .select('id')
      .eq('allocation_type', 'hq')

    if (hqCodesErr) throw new Error(`Failed to load HQ codes: ${hqCodesErr.message}`)

    const hqCodeIds = (hqCodes ?? []).map((c) => c.id)
    let hqPayroll = 0

    if (hqCodeIds.length > 0) {
      const { data: hqTxns, error: hqTxnErr } = await supabase
        .from('payroll_transactions')
        .select('amount')
        .in('payroll_code_id', hqCodeIds)
        .eq('period_date', periodDate)

      if (hqTxnErr) throw new Error(`Failed to load HQ payroll: ${hqTxnErr.message}`)
      hqPayroll = (hqTxns ?? []).reduce((s, t) => s + t.amount, 0)
    }

    const result = calculateAllocations(branchRevenues, corpPayroll, hqPayroll, snBusiness.hq_allocation_pct)

    return NextResponse.json({ success: true, data: result })
  } catch (err) {
    return apiError(err)
  }
}
