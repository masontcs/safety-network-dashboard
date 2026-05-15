import { NextResponse } from 'next/server'
import { getAccessContext } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'

const COLLECTION_PRIORITY: Record<string, number> = {
  promise_to_pay: 1,
  payment_plan:   1,
  legal:          1,
  collections:    1,
  on_hold:        2,
  dispute:        2,
  write_off:      3,
  none:           99,
}

const BUCKET_ORDER = ['>90', '61-90', '31-60', '1-30', 'Current']

export async function GET(request: Request): Promise<Response> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response

    const { searchParams } = new URL(request.url)
    const entityCode = searchParams.get('entity') || null

    const supabase = createServiceClient()
    const { branchIds } = ctx.access

    // ── Fetch excluded customer IDs ──────────────────────────────────────────

    const { data: excludedRows } = await supabase
      .from('ar_customers')
      .select('id')
      .eq('is_excluded', true)
    const excludedIds = (excludedRows ?? []).map((r) => r.id as string)

    // ── Overall AR: all invoices (not excluded) ──────────────────────────────

    let allInvQuery = supabase
      .from('ar_invoices')
      .select('customer_id, open_balance, aging_bucket')
    if (entityCode) allInvQuery = allInvQuery.eq('entity_code', entityCode)
    if (branchIds)  allInvQuery = allInvQuery.in('branch_id', branchIds)
    if (excludedIds.length > 0) allInvQuery = allInvQuery.not('customer_id', 'in', `(${excludedIds.join(',')})`)

    const { data: allInvoices } = await allInvQuery
    const invoices = (allInvoices ?? []) as { customer_id: string; open_balance: number; aging_bucket: string }[]

    // Aggregate overall aging totals
    const agingTotals: Record<string, number> = { 'Current': 0, '1-30': 0, '31-60': 0, '61-90': 0, '>90': 0 }
    let totalAr = 0
    const custArMap = new Map<string, { total: number; maxBucket: string }>()

    for (const inv of invoices) {
      const amt = Number(inv.open_balance) || 0
      totalAr += amt
      if (agingTotals[inv.aging_bucket] !== undefined) agingTotals[inv.aging_bucket] += amt

      const cid = inv.customer_id
      const existing = custArMap.get(cid) ?? { total: 0, maxBucket: 'Current' }
      existing.total += amt
      const currentIdx = BUCKET_ORDER.indexOf(existing.maxBucket)
      const newIdx     = BUCKET_ORDER.indexOf(inv.aging_bucket)
      if (newIdx < currentIdx) existing.maxBucket = inv.aging_bucket
      custArMap.set(cid, existing)
    }

    // ── All customers (for top list + action items) ──────────────────────────

    const { data: allCustomers } = await supabase
      .from('ar_customers')
      .select('id, display_name, collection_status, customer_status, created_at')
      .eq('is_excluded', false)

    const custMeta = new Map(
      (allCustomers ?? []).map((c) => [c.id as string, c])
    )

    // Top 15 customers by AR balance
    const topCustomers = [...custArMap.entries()]
      .map(([id, { total, maxBucket }]) => {
        const meta = custMeta.get(id)
        return {
          id,
          displayName:      meta?.display_name ?? '—',
          collectionStatus: meta?.collection_status ?? 'none',
          totalAr:          Math.round(total * 100) / 100,
          maxAgingBucket:   maxBucket,
        }
      })
      .sort((a, b) => b.totalAr - a.totalAr)
      .slice(0, 15)

    // ── Action items: customers with active collection status ────────────────

    const actionCustomers = (allCustomers ?? []).filter(
      (c) => c.collection_status && c.collection_status !== 'none'
    )
    const actionIds = actionCustomers.map((c) => c.id as string)

    // Latest note per action customer
    let latestNotes: { customer_id: string; content: string; created_at: string; created_by: string | null }[] = []
    if (actionIds.length > 0) {
      const { data: noteRows } = await supabase
        .from('ar_customer_notes')
        .select('customer_id, content, created_at, created_by')
        .in('customer_id', actionIds)
        .order('created_at', { ascending: false })
      latestNotes = (noteRows ?? []) as typeof latestNotes
    }

    const latestNoteMap = new Map<string, (typeof latestNotes)[0]>()
    for (const n of latestNotes) {
      if (!latestNoteMap.has(n.customer_id)) latestNoteMap.set(n.customer_id, n)
    }

    const noteAuthorIds = [...new Set(latestNotes.map((n) => n.created_by).filter(Boolean))] as string[]
    const { data: noteProfiles } = noteAuthorIds.length > 0
      ? await supabase.from('user_profiles').select('id, display_name').in('id', noteAuthorIds)
      : { data: [] }
    const noteProfileMap = new Map((noteProfiles ?? []).map((p) => [p.id as string, p.display_name as string]))

    const actionItems = actionCustomers
      .map((c) => {
        const inv  = custArMap.get(c.id as string)
        const note = latestNoteMap.get(c.id as string)
        return {
          id:               c.id,
          displayName:      c.display_name,
          collectionStatus: c.collection_status,
          customerStatus:   c.customer_status,
          priority:         COLLECTION_PRIORITY[c.collection_status] ?? 99,
          totalAr:          Math.round((inv?.total ?? 0) * 100) / 100,
          maxAgingBucket:   inv?.maxBucket ?? 'Current',
          latestNote:       note
            ? { content: note.content, createdAt: note.created_at, createdByName: note.created_by ? (noteProfileMap.get(note.created_by) ?? null) : null }
            : null,
        }
      })
      .sort((a, b) => a.priority - b.priority || b.totalAr - a.totalAr)

    // ── Recent activity: last 10 notes across all customers ──────────────────

    const { data: recentNoteRows } = await supabase
      .from('ar_customer_notes')
      .select('id, customer_id, content, created_at, created_by')
      .order('created_at', { ascending: false })
      .limit(10)

    const recentCustomerIds = [...new Set((recentNoteRows ?? []).map((n) => n.customer_id as string))]
    const recentAuthorIds   = [...new Set((recentNoteRows ?? []).map((n) => n.created_by as string | null).filter(Boolean))] as string[]

    const [{ data: recentCustomers }, { data: recentAuthors }] = await Promise.all([
      recentCustomerIds.length > 0
        ? supabase.from('ar_customers').select('id, display_name').in('id', recentCustomerIds)
        : Promise.resolve({ data: [] }),
      recentAuthorIds.length > 0
        ? supabase.from('user_profiles').select('id, display_name').in('id', recentAuthorIds)
        : Promise.resolve({ data: [] }),
    ])

    const recentCustMap   = new Map((recentCustomers ?? []).map((c) => [c.id as string, c.display_name as string]))
    const recentAuthorMap = new Map((recentAuthors ?? []).map((p) => [p.id as string, p.display_name as string]))

    const recentActivity = (recentNoteRows ?? []).map((n) => ({
      noteId:        n.id,
      customerId:    n.customer_id,
      customerName:  recentCustMap.get(n.customer_id as string) ?? '—',
      content:       n.content,
      createdAt:     n.created_at,
      createdByName: n.created_by ? (recentAuthorMap.get(n.created_by as string) ?? null) : null,
    }))

    // ── New customers this month ─────────────────────────────────────────────

    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

    const { data: newCustRows } = await supabase
      .from('ar_customers')
      .select('id, display_name, created_at')
      .eq('is_excluded', false)
      .gte('created_at', thirtyDaysAgo.toISOString())
      .order('created_at', { ascending: false })
      .limit(20)

    const newCustomers = (newCustRows ?? []).map((c) => ({
      id:          c.id,
      displayName: c.display_name,
      createdAt:   c.created_at,
      totalAr:     Math.round((custArMap.get(c.id as string)?.total ?? 0) * 100) / 100,
    }))

    // ── KPIs ────────────────────────────────────────────────────────────────

    const pastDue60Plus = (agingTotals['61-90'] ?? 0) + (agingTotals['>90'] ?? 0)

    const kpis = {
      totalAr:                Math.round(totalAr * 100) / 100,
      pastDue60Plus:          Math.round(pastDue60Plus * 100) / 100,
      customersInCollections: actionItems.length,
      highPriorityCount:      actionItems.filter((a) => a.priority === 1).length,
      totalCollectionAr:      Math.round(actionItems.reduce((s, a) => s + a.totalAr, 0) * 100) / 100,
      newCustomersCount:      newCustomers.length,
      agingTotals:            Object.fromEntries(
        Object.entries(agingTotals).map(([k, v]) => [k, Math.round(v * 100) / 100])
      ),
      totalCustomers:         custArMap.size,
    }

    return NextResponse.json({ kpis, actionItems, topCustomers, recentActivity, newCustomers })
  } catch (err) {
    console.error('AR meeting error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
