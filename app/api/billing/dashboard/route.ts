import { NextResponse } from 'next/server'
import { getAccessContext } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { billingApiError } from '@/lib/billing/http'

/**
 * Dashboard aggregates — the numbers behind the billing home screen. Everything here is
 * derived live from the billing_* tables (no stored snapshots), so it's always current.
 * Reads are branch-scoped for non-admins via the invoice/job branch ids.
 */

const monthKey = (d: string) => d.slice(0, 7) // 'YYYY-MM'
const startOfMonth = (offset: number) => {
  const now = new Date()
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1))
  return d.toISOString().slice(0, 10)
}
const monthLabel = (ym: string) => {
  const [, m] = ym.split('-')
  return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m) - 1] ?? ym
}

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const supabase = createServiceClient()
    // null = all branches the user may see; a ?branchId narrows within that scope.
    const reqBranch = new URL(request.url).searchParams.get('branchId') || ''
    let branchIds = ctx.access.branchIds
    if (reqBranch) branchIds = branchIds === null ? [reqBranch] : branchIds.filter((b) => b === reqBranch)

    // Ledger + tickets carry no branch_id (branch lives on the job), so resolve the
    // in-scope job ids once and filter those aggregates by them. null = all jobs.
    let scopedJobIds: string[] | null = null
    if (branchIds !== null) {
      const { data: jrows } = await supabase.from('billing_jobs').select('id')
        .in('branch_id', branchIds.length ? branchIds : ['00000000-0000-0000-0000-000000000000'])
      scopedJobIds = (jrows ?? []).map((j: { id: string }) => j.id)
      if (scopedJobIds.length === 0) scopedJobIds = ['00000000-0000-0000-0000-000000000000']
    }

    // ── invoices → billed-this-month, billing-by-month, overdue ──────────────
    let invQ = supabase.from('billing_invoices').select('total_cents, status, invoice_date, branch_id')
    if (branchIds !== null) invQ = invQ.in('branch_id', branchIds.length ? branchIds : ['00000000-0000-0000-0000-000000000000'])
    const { data: invRaw } = await invQ
    const invoices = ((invRaw ?? []) as { total_cents: number; status: string; invoice_date: string; branch_id: string }[])
      .filter((i) => i.status !== 'void')

    const thisMonth = monthKey(startOfMonth(0))
    const lastMonth = monthKey(startOfMonth(-1))
    const byMonth = new Map<string, number>()
    let billedThisMonth = 0, billedLastMonth = 0
    for (const i of invoices) {
      const k = monthKey(i.invoice_date)
      byMonth.set(k, (byMonth.get(k) ?? 0) + i.total_cents)
      if (k === thisMonth) billedThisMonth += i.total_cents
      if (k === lastMonth) billedLastMonth += i.total_cents
    }
    const billingByMonth = Array.from({ length: 6 }, (_, idx) => {
      const ym = monthKey(startOfMonth(idx - 5))
      return { month: monthLabel(ym), cents: byMonth.get(ym) ?? 0 }
    })
    const delta = billedLastMonth > 0 ? Math.round(((billedThisMonth - billedLastMonth) / billedLastMonth) * 100) : null

    // Overdue: issued invoices older than 30 days (approximation of Net-30 terms).
    const cutoff = startOfMonth(0) // conservative: anything before this month that's still issued
    const overdue = invoices.filter((i) => i.status === 'issued' && i.invoice_date < cutoff)
    const overdueCents = overdue.reduce((s, i) => s + i.total_cents, 0)

    // ── ledger → on-rent per job (DTC excluded), needs-attention ─────────────
    let ledQ = supabase
      .from('billing_ticket_ledger')
      .select('item_id, job_id, event_type, qty, billing_type, billing_tickets(feature_dtc, status, is_voided)')
    if (scopedJobIds !== null) ledQ = ledQ.in('job_id', scopedJobIds)
    const { data: ledRaw } = await ledQ
    const ledger = (ledRaw ?? []) as unknown as {
      item_id: string; job_id: string; event_type: string; qty: number; billing_type: string | null
      billing_tickets: { feature_dtc: boolean; status: string; is_voided: boolean } | null
    }[]

    const onRentByJob = new Map<string, number>()
    const onRentByJobItem = new Map<string, Map<string, number>>()
    let pickupsMissingBillingType = 0
    for (const l of ledger) {
      if (l.billing_tickets?.is_voided) continue // a voided ticket counts toward nothing
      if (l.billing_tickets?.feature_dtc) continue // DTC never on rent
      const sign = l.event_type === 'pickup' ? l.qty : -l.qty
      onRentByJob.set(l.job_id, (onRentByJob.get(l.job_id) ?? 0) + sign)
      const im = onRentByJobItem.get(l.job_id) ?? new Map()
      im.set(l.item_id, (im.get(l.item_id) ?? 0) + sign)
      onRentByJobItem.set(l.job_id, im)
      if (l.event_type === 'pickup' && !l.billing_type && l.billing_tickets?.status !== 'invoiced') pickupsMissingBillingType++
    }
    const onRentUnits = [...onRentByJob.values()].reduce((s, q) => s + Math.max(0, q), 0)
    const onRentJobCount = [...onRentByJob.values()].filter((q) => q > 0).length

    // ── tickets → in-review, ready-to-invoice (jobs with final_edit tickets) ─
    let tkQ = supabase.from('billing_tickets').select('job_id, status').eq('is_voided', false)
    if (scopedJobIds !== null) tkQ = tkQ.in('job_id', scopedJobIds)
    const { data: tkRaw } = await tkQ
    const tickets = (tkRaw ?? []) as { job_id: string; status: string }[]
    const ticketsInReview = tickets.filter((t) => t.status === 'in_review').length
    const readyJobs = new Set(tickets.filter((t) => t.status === 'final_edit').map((t) => t.job_id))

    // ── names for the on-rent-by-job panel ──────────────────────────────────
    const topJobIds = [...onRentByJob.entries()].filter(([, q]) => q > 0).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([id]) => id)
    const jobName = new Map<string, string>()
    if (topJobIds.length) {
      const { data: jobs } = await supabase.from('billing_jobs').select('id, job_number, name').in('id', topJobIds)
      for (const j of (jobs ?? []) as { id: string; job_number: string; name: string | null }[]) jobName.set(j.id, `${j.job_number}${j.name ? ` — ${j.name}` : ''}`)
    }
    const itemIds = [...new Set(topJobIds.flatMap((jid) => [...(onRentByJobItem.get(jid)?.keys() ?? [])]))]
    const itemCode = new Map<string, string>()
    if (itemIds.length) {
      const { data: its } = await supabase.from('billing_items').select('id, code').in('id', itemIds)
      for (const i of (its ?? []) as { id: string; code: string }[]) itemCode.set(i.id, i.code)
    }
    const onRentDetail = topJobIds.map((jid) => {
      const items = [...(onRentByJobItem.get(jid)?.entries() ?? [])].filter(([, q]) => q > 0).sort((a, b) => b[1] - a[1]).slice(0, 3)
      return { job: jobName.get(jid) ?? jid, items: items.map(([iid, q]) => `${q} × ${itemCode.get(iid) ?? '?'}`) }
    })

    return NextResponse.json({
      success: true,
      data: {
        billedThisMonthCents: billedThisMonth,
        billedDeltaPct: delta,
        onRentUnits,
        onRentJobCount,
        readyJobCount: readyJobs.size,
        overdueCents,
        overdueCount: overdue.length,
        billingByMonth,
        needsAttention: { pickupsMissingBillingType, ticketsInReview },
        onRentByJob: onRentDetail,
      },
    })
  } catch (err) {
    return billingApiError(err)
  }
}
