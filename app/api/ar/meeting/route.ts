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

export async function GET(request: Request): Promise<Response> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response

    const { searchParams } = new URL(request.url)
    const entityCode = searchParams.get('entity') || null

    const supabase = createServiceClient()
    const { branchIds } = ctx.access

    // ── Action items: customers with active collection status ────────────────

    let custQuery = supabase
      .from('ar_customers')
      .select('id, display_name, collection_status, customer_status, created_at')
      .neq('collection_status', 'none')
      .eq('is_excluded', false)

    const { data: actionCustomers } = await custQuery

    // Get AR totals for those customers
    const actionIds = (actionCustomers ?? []).map((c) => c.id as string)

    let invoiceAggQuery = supabase
      .from('ar_invoices')
      .select('customer_id, open_balance, aging_bucket')

    if (actionIds.length > 0) invoiceAggQuery = invoiceAggQuery.in('customer_id', actionIds)
    if (entityCode) invoiceAggQuery = invoiceAggQuery.eq('entity_code', entityCode)
    if (branchIds) invoiceAggQuery = invoiceAggQuery.in('branch_id', branchIds)

    // This query is specifically for action customers — if no action customers, skip
    let actionInvoices: { customer_id: string; open_balance: number; aging_bucket: string }[] = []
    if (actionIds.length > 0) {
      const { data } = await invoiceAggQuery
      actionInvoices = (data ?? []) as typeof actionInvoices
    }

    // Aggregate invoice totals and max aging bucket per customer
    const BUCKET_ORDER = ['>90', '61-90', '31-60', '1-30', 'Current']
    const invByCustomer = new Map<string, { total: number; maxBucket: string }>()
    for (const inv of actionInvoices) {
      const cid = inv.customer_id
      const existing = invByCustomer.get(cid) ?? { total: 0, maxBucket: 'Current' }
      existing.total += Number(inv.open_balance) || 0
      const currentIdx = BUCKET_ORDER.indexOf(existing.maxBucket)
      const newIdx     = BUCKET_ORDER.indexOf(inv.aging_bucket)
      if (newIdx < currentIdx) existing.maxBucket = inv.aging_bucket
      invByCustomer.set(cid, existing)
    }

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

    // Deduplicate to one note per customer
    const latestNoteMap = new Map<string, (typeof latestNotes)[0]>()
    for (const n of latestNotes) {
      if (!latestNoteMap.has(n.customer_id)) latestNoteMap.set(n.customer_id, n)
    }

    // Resolve note authors
    const noteAuthorIds = [...new Set(latestNotes.map((n) => n.created_by).filter(Boolean))] as string[]
    const { data: noteProfiles } = noteAuthorIds.length > 0
      ? await supabase.from('user_profiles').select('id, display_name').in('id', noteAuthorIds)
      : { data: [] }
    const noteProfileMap = new Map((noteProfiles ?? []).map((p) => [p.id as string, p.display_name as string]))

    const actionItems = (actionCustomers ?? [])
      .map((c) => {
        const inv  = invByCustomer.get(c.id as string)
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

    // Get AR for new customers
    const newCustIds = (newCustRows ?? []).map((c) => c.id as string)
    let newCustInvoices: { customer_id: string; open_balance: number }[] = []
    if (newCustIds.length > 0) {
      let nq = supabase.from('ar_invoices').select('customer_id, open_balance').in('customer_id', newCustIds)
      if (entityCode) nq = nq.eq('entity_code', entityCode)
      if (branchIds)  nq = nq.in('branch_id', branchIds)
      const { data } = await nq
      newCustInvoices = (data ?? []) as typeof newCustInvoices
    }

    const newCustArMap = new Map<string, number>()
    for (const inv of newCustInvoices) {
      newCustArMap.set(inv.customer_id, (newCustArMap.get(inv.customer_id) ?? 0) + Number(inv.open_balance))
    }

    const newCustomers = (newCustRows ?? []).map((c) => ({
      id:          c.id,
      displayName: c.display_name,
      createdAt:   c.created_at,
      totalAr:     Math.round((newCustArMap.get(c.id as string) ?? 0) * 100) / 100,
    }))

    // ── KPIs ────────────────────────────────────────────────────────────────

    const kpis = {
      customersInCollections: actionItems.length,
      highPriorityCount:      actionItems.filter((a) => a.priority === 1).length,
      totalCollectionAr:      Math.round(actionItems.reduce((s, a) => s + a.totalAr, 0) * 100) / 100,
      newCustomersCount:      newCustomers.length,
    }

    return NextResponse.json({ kpis, actionItems, recentActivity, newCustomers })
  } catch (err) {
    console.error('AR meeting error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
