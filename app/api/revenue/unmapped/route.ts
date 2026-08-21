import { NextResponse } from 'next/server'
import { getAccessContext, guardRevenueAccess } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { apiError } from '@/lib/utils/errors'

/**
 * Unmapped revenue — every (branch, entity) that has revenue transactions but no revenue
 * code. Revenue still imports so nothing is lost, but without a code it can drop off
 * code-grouped reports. This endpoint is the safety net: if this list is non-empty, a code
 * is missing and revenue is at risk of being under-reported.
 */
export async function GET(): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const guard = guardRevenueAccess(ctx.access.role)
    if (guard) return guard

    const supabase = createServiceClient()

    let q = supabase
      .from('revenue_transactions')
      .select('branch_id, entity_id, total_revenue')
      .is('revenue_code_id', null)
    if (ctx.access.branchIds !== null) q = q.in('branch_id', ctx.access.branchIds)

    const { data, error } = await q
    if (error) throw new Error(error.message)
    const rows = (data ?? []) as { branch_id: string; entity_id: string; total_revenue: number }[]

    // Names for display.
    const [{ data: branches }, { data: entities }] = await Promise.all([
      supabase.from('branches').select('id, name'),
      supabase.from('entities').select('id, code'),
    ])
    const branchName = new Map((branches ?? []).map((b) => [b.id as string, b.name as string]))
    const entityCode = new Map((entities ?? []).map((e) => [e.id as string, e.code as string]))

    const agg = new Map<string, { branch: string; entity: string; rows: number; totalRevenue: number }>()
    for (const r of rows) {
      const key = `${r.branch_id}|${r.entity_id}`
      const cur = agg.get(key) ?? { branch: branchName.get(r.branch_id) ?? '—', entity: entityCode.get(r.entity_id) ?? '—', rows: 0, totalRevenue: 0 }
      cur.rows++
      cur.totalRevenue += Number(r.total_revenue)
      agg.set(key, cur)
    }

    const unmapped = [...agg.values()].sort((a, b) => b.totalRevenue - a.totalRevenue)
    const totalUnmapped = unmapped.reduce((s, u) => s + u.totalRevenue, 0)

    return NextResponse.json({ success: true, data: { unmapped, totalUnmapped, combos: unmapped.length } })
  } catch (err) {
    return apiError(err)
  }
}
