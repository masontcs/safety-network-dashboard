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
      .select('id')
      .eq('labor_type', 'direct' as LaborType)

    if (branchId) {
      codesQuery = codesQuery.eq('branch_id', branchId)
    } else if (access.branchIds !== null) {
      codesQuery = codesQuery.in('branch_id', access.branchIds)
    }

    const { data: codes, error: codesErr } = await codesQuery
    if (codesErr) throw new Error(codesErr.message)
    const codeIds = (codes ?? []).map((c) => c.id)

    if (codeIds.length === 0) {
      return NextResponse.json({ success: true, data: [] })
    }

    // Fetch transactions and payroll item groups in parallel
    const [txnRes, groupsRes] = await Promise.all([
      supabase
        .from('payroll_transactions')
        .select('period_date, hours, amount, payroll_item_id')
        .in('payroll_code_id', codeIds)
        .gte('period_date', startDate)
        .lte('period_date', endDate),
      supabase
        .from('payroll_items')
        .select('id, group_id, payroll_item_groups(name)'),
    ])

    if (txnRes.error) throw new Error(txnRes.error.message)
    if (groupsRes.error) throw new Error(groupsRes.error.message)

    // Build item → group classification map
    type ItemRow = { id: string; group_id: string; payroll_item_groups: { name: string } | null }
    const itemClassMap: Record<string, 'double' | 'overtime' | 'standard'> = {}
    for (const item of (groupsRes.data ?? []) as ItemRow[]) {
      const groupName = item.payroll_item_groups?.name ?? ''
      itemClassMap[item.id] = classifyGroup(groupName)
    }

    // Aggregate by period_date
    type Week = { standardHours: number; overtimeHours: number; doubleTimeHours: number; totalDirectCost: number }
    const byWeek: Record<string, Week> = {}

    type TxnRow = { period_date: string; hours: number | null; amount: number; payroll_item_id: string | null }
    for (const t of (txnRes.data ?? []) as TxnRow[]) {
      if (!byWeek[t.period_date]) {
        byWeek[t.period_date] = { standardHours: 0, overtimeHours: 0, doubleTimeHours: 0, totalDirectCost: 0 }
      }
      const w = byWeek[t.period_date]
      w.totalDirectCost += t.amount
      if (t.hours == null) continue
      const cls = t.payroll_item_id ? (itemClassMap[t.payroll_item_id] ?? 'standard') : 'standard'
      if (cls === 'double') w.doubleTimeHours += t.hours
      else if (cls === 'overtime') w.overtimeHours += t.hours
      else w.standardHours += t.hours
    }

    const weeks = Object.entries(byWeek)
      .map(([periodDate, w]) => ({ periodDate, ...w }))
      .sort((a, b) => a.periodDate.localeCompare(b.periodDate))

    return NextResponse.json({ success: true, data: weeks })
  } catch (err) {
    return apiError(err)
  }
}
