import { NextResponse } from 'next/server'
import { getAccessContext, getArTeamCustomerIds } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'

const AGING_BUCKETS = ['Current', '1-30', '31-60', '61-90', '>90'] as const

export async function GET(request: Request): Promise<Response> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response

    const { searchParams } = new URL(request.url)
    const entityCode = searchParams.get('entity') || null
    const branchId   = searchParams.get('branchId') || null

    const supabase = createServiceClient()
    const { branchIds, role } = ctx.access

    // Build invoice query scoped to user's branch access
    let query = supabase
      .from('ar_invoices')
      .select('open_balance, aging_bucket, entity_code, branch_id')

    if (entityCode) query = query.eq('entity_code', entityCode)

    if (branchId) {
      // If user is a manager and the requested branch isn't in their assignments, deny
      if (branchIds && !branchIds.includes(branchId)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
      query = query.eq('branch_id', branchId)
    } else if (branchIds) {
      query = query.in('branch_id', branchIds)
    }

    // ar_team: scope to assigned customers only
    if (role === 'ar_team') {
      const assignedIds = await getArTeamCustomerIds(ctx.access.userId)
      const ids = assignedIds.length > 0 ? assignedIds : ['00000000-0000-0000-0000-000000000000']
      query = query.in('customer_id', ids)
    }

    // Excluded customers are removed from all totals and KPIs
    const { data: excludedRows } = await supabase
      .from('ar_customers')
      .select('id')
      .eq('is_excluded', true)
    const excludedIds = (excludedRows ?? []).map((r) => r.id as string)
    if (excludedIds.length > 0) {
      query = query.not('customer_id', 'in', `(${excludedIds.join(',')})`)
    }

    type InvRow = { open_balance: number; aging_bucket: string; entity_code: string; branch_id: string | null }
    const invoices: InvRow[] = []
    {
      const PAGE_SIZE = 1000
      let from = 0
      while (true) {
        const { data, error } = await (query as typeof query).range(from, from + PAGE_SIZE - 1)
        if (error) return NextResponse.json({ error: 'Failed to load AR data' }, { status: 500 })
        if (!data || data.length === 0) break
        invoices.push(...(data as InvRow[]))
        if (data.length < PAGE_SIZE) break
        from += PAGE_SIZE
      }
    }

    // Aggregate by aging bucket
    const aging: Record<string, number> = Object.fromEntries(
      AGING_BUCKETS.map((b) => [b, 0])
    )
    let total = 0
    for (const inv of invoices ?? []) {
      const bucket = inv.aging_bucket as string
      const amount = Number(inv.open_balance) || 0
      if (bucket in aging) aging[bucket] += amount
      total += amount
    }

    // Last import per entity (or for the requested entity)
    let importQuery = supabase
      .from('ar_imports')
      .select('entity_code, report_date, imported_at, invoice_count, total_ar')
      .order('imported_at', { ascending: false })

    if (entityCode) importQuery = importQuery.eq('entity_code', entityCode)
    else importQuery = importQuery.limit(10) // latest per-entity summary

    const { data: imports } = await importQuery

    type ImportRow = { entity_code: string; report_date: string; imported_at: string; invoice_count: number | null; total_ar: number | null }
    // Deduplicate to one row per entity (most recent)
    const latestImports: Record<string, ImportRow> = {}
    for (const imp of (imports ?? []) as ImportRow[]) {
      if (!latestImports[imp.entity_code]) latestImports[imp.entity_code] = imp
    }

    return NextResponse.json({
      aging,
      total: Math.round(total * 100) / 100,
      lastImports: Object.values(latestImports),
    })
  } catch (err) {
    console.error('AR summary error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
