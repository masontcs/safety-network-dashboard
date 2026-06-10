import { NextResponse } from 'next/server'
import { getAccessContext, getArTeamCustomerIds } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'

const AGING_BUCKETS = ['Current', '1-30', '31-60', '61-90', '>90'] as const

export async function GET(request: Request): Promise<Response> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response

    const { searchParams } = new URL(request.url)
    const entityCode      = searchParams.get('entity') || null
    const branchId        = searchParams.get('branchId') || null
    const includeExcluded = searchParams.get('includeExcluded') === 'true'

    const supabase = createServiceClient()
    const { branchIds, role: roleEarly } = ctx.access

    // sales bypasses branch filter for AR — they see all customers
    if (branchId && branchIds && roleEarly !== 'sales' && !branchIds.includes(branchId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const showAll = searchParams.get('showAll') === 'true'
    const assignedUserId = searchParams.get('assignedUserId') || null

    // sales: bypass branch filter — see all AR regardless of branch assignments
    const { role } = ctx.access
    const effectiveBranchIds = role === 'sales' ? null : branchIds

    // ar_team / office_team: resolve their own assigned customer IDs (unless showing all)
    let arTeamCustomerIds: string[] | null = null
    if ((role === 'ar_team' || role === 'office_team') && !showAll) {
      const ids = await getArTeamCustomerIds(ctx.access.userId)
      arTeamCustomerIds = ids.length > 0 ? ids : []
      if (arTeamCustomerIds.length === 0) return NextResponse.json({ customers: [] })
    }

    // Admin/manager: filter by a specific AR team member's assigned customers
    if (assignedUserId && arTeamCustomerIds === null) {
      if (role !== 'admin' && role !== 'executive' && role !== 'ar_manager') {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
      const { data: userAssignments } = await supabase
        .from('ar_customer_assignments')
        .select('customer_id')
        .eq('user_id', assignedUserId)
      const ids = (userAssignments ?? []).map((a) => a.customer_id as string)
      if (ids.length === 0) return NextResponse.json({ customers: [] })
      arTeamCustomerIds = ids
    }

    // Paginate through all invoices and aggregate by customer
    type InvRow = { customer_id: string; open_balance: number; aging_bucket: string; row_type: string; terms: string | null }
    const invoices: InvRow[] = []
    {
      const PAGE_SIZE = 1000
      let from = 0
      while (true) {
        let q = supabase
          .from('ar_invoices')
          .select('customer_id, open_balance, aging_bucket, row_type, terms')
          .eq('row_type', 'invoice')  // credits are informational only — never reduce AR totals
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .eq('is_voided' as any, false)  // manually voided invoices excluded until QB catches up
          .range(from, from + PAGE_SIZE - 1)
        if (entityCode) q = q.eq('entity_code', entityCode)
        if (arTeamCustomerIds !== null) {
          q = q.in('customer_id', arTeamCustomerIds)
        } else if (branchId) {
          q = q.eq('branch_id', branchId)
        } else if (effectiveBranchIds) {
          q = q.in('branch_id', effectiveBranchIds)
        }
        const { data, error } = await q
        if (error) return NextResponse.json({ error: 'Failed to load invoices' }, { status: 500 })
        if (!data || data.length === 0) break
        invoices.push(...(data as InvRow[]))
        if (data.length < PAGE_SIZE) break
        from += PAGE_SIZE
      }
    }

    if (invoices.length === 0) return NextResponse.json({ customers: [] })

    // Aggregate by customer_id
    type Agg = { buckets: Record<string, number>; totalAr: number; invoiceCount: number; terms: string | null }
    const custMap = new Map<string, Agg>()
    for (const inv of invoices) {
      if (!custMap.has(inv.customer_id)) {
        custMap.set(inv.customer_id, {
          buckets: Object.fromEntries(AGING_BUCKETS.map((b) => [b, 0])),
          totalAr: 0,
          invoiceCount: 0,
          terms: null,
        })
      }
      const agg = custMap.get(inv.customer_id)!
      const amount = Number(inv.open_balance) || 0
      if (inv.aging_bucket in agg.buckets) agg.buckets[inv.aging_bucket] += amount
      agg.totalAr += amount
      if (inv.row_type === 'invoice') agg.invoiceCount++
      // Pick first non-null terms seen (consistent per customer in practice)
      if (!agg.terms && inv.terms) agg.terms = inv.terms
    }

    // Fetch display names and exclusion flags for all customer ids
    const customerIds = [...custMap.keys()]
    const { data: customers } = await supabase
      .from('ar_customers')
      .select('id, display_name, is_excluded')
      .in('id', customerIds)
    const nameMap = new Map((customers ?? []).map((c) => [c.id as string, c.display_name as string]))
    const excludedSet = new Set(
      (customers ?? []).filter((c) => c.is_excluded).map((c) => c.id as string)
    )

    const result = customerIds
      .filter((id) => includeExcluded || !excludedSet.has(id))
      .map((id) => {
        const agg = custMap.get(id)!
        return {
          id,
          displayName:  nameMap.get(id) ?? '—',
          isExcluded:   excludedSet.has(id),
          terms:        agg.terms,
          current:      Math.round(agg.buckets['Current'] * 100) / 100,
          d30:          Math.round(agg.buckets['1-30'] * 100) / 100,
          d60:          Math.round(agg.buckets['31-60'] * 100) / 100,
          d90:          Math.round(agg.buckets['61-90'] * 100) / 100,
          d90plus:      Math.round(agg.buckets['>90'] * 100) / 100,
          totalAr:      Math.round(agg.totalAr * 100) / 100,
          invoiceCount: agg.invoiceCount,
        }
      })

    return NextResponse.json({ customers: result })
  } catch (err) {
    console.error('AR customers error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
