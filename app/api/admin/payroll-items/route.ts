import { NextResponse } from 'next/server'
import { getAccessContext, guardAdminOnly } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { apiError } from '@/lib/utils/errors'

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response

    const guard = guardAdminOnly(ctx.access.role)
    if (guard) return guard

    const { searchParams } = new URL(request.url)
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')

    const supabase = createServiceClient()

    // All payroll items with group name
    const { data: items, error: itemsErr } = await supabase
      .from('payroll_items')
      .select('id, name, group_id, is_confirmed, ai_suggested_group, ai_confidence, payroll_item_groups(name)')
      .order('name')

    if (itemsErr) throw new Error(itemsErr.message)

    type ItemRow = {
      id: string
      name: string
      group_id: string
      is_confirmed: boolean
      ai_suggested_group: string | null
      ai_confidence: number | null
      payroll_item_groups: { name: string } | null
    }
    const typedItems = (items ?? []) as unknown as ItemRow[]

    // All groups for the dropdown
    const { data: groups, error: groupsErr } = await supabase
      .from('payroll_item_groups')
      .select('id, name')
      .order('name')

    if (groupsErr) throw new Error(groupsErr.message)

    type GroupRow = { id: string; name: string }
    const typedGroups = (groups ?? []) as unknown as GroupRow[]

    const itemIds = typedItems.map((i) => i.id)

    // Transaction totals per item for the date range (SN only — no business_tag)
    type TotalRow = { payroll_item_id: string; total: number; txn_count: number }
    let totals: TotalRow[] = []
    if (itemIds.length > 0) {
      let q = supabase
        .from('payroll_transactions')
        .select('payroll_item_id, amount')
        .in('payroll_item_id', itemIds)
        .is('business_tag', null)

      if (startDate) q = q.gte('period_date', startDate)
      if (endDate) q = q.lte('period_date', endDate)

      const { data: txnRows, error: txnErr } = await q
      if (txnErr) throw new Error(txnErr.message)

      const map = new Map<string, { total: number; txn_count: number }>()
      for (const row of txnRows ?? []) {
        if (!row.payroll_item_id) continue
        const cur = map.get(row.payroll_item_id) ?? { total: 0, txn_count: 0 }
        cur.total += row.amount
        cur.txn_count += 1
        map.set(row.payroll_item_id, cur)
      }
      totals = Array.from(map.entries()).map(([payroll_item_id, v]) => ({ payroll_item_id, ...v }))
    }

    // Staged transaction counts per item (unconfirmed items only)
    type StagedRow = { payroll_item_id: string; staged_count: number }
    let stagedCounts: StagedRow[] = []
    if (itemIds.length > 0) {
      const { data: stagedRows, error: stagedErr } = await supabase
        .from('payroll_item_staged_transactions')
        .select('payroll_item_id')
        .in('payroll_item_id', itemIds)

      if (stagedErr) throw new Error(stagedErr.message)

      const stagedMap = new Map<string, number>()
      for (const row of stagedRows ?? []) {
        stagedMap.set(row.payroll_item_id, (stagedMap.get(row.payroll_item_id) ?? 0) + 1)
      }
      stagedCounts = Array.from(stagedMap.entries()).map(([payroll_item_id, staged_count]) => ({ payroll_item_id, staged_count }))
    }

    const totalsMap = new Map(totals.map((t) => [t.payroll_item_id, t]))
    const stagedMap = new Map(stagedCounts.map((s) => [s.payroll_item_id, s.staged_count]))

    const result = typedItems.map((item) => {
      const t = totalsMap.get(item.id)
      return {
        id: item.id,
        name: item.name,
        groupId: item.group_id,
        groupName: item.payroll_item_groups?.name ?? '',
        isConfirmed: item.is_confirmed,
        aiSuggestedGroup: item.ai_suggested_group,
        aiConfidence: item.ai_confidence,
        totalAmount: t?.total ?? null,
        transactionCount: t?.txn_count ?? null,
        stagedCount: stagedMap.get(item.id) ?? 0,
      }
    })

    return NextResponse.json({
      success: true,
      data: {
        items: result,
        groups: typedGroups.map((g) => ({ id: g.id, name: g.name })),
        dateRange: startDate || endDate ? { startDate, endDate } : null,
      },
    })
  } catch (err) {
    return apiError(err)
  }
}
