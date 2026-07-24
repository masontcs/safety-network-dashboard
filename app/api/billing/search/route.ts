import { NextResponse } from 'next/server'
import { getAccessContext } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { billingApiError } from '@/lib/billing/http'

/**
 * Global billing search — powers the topbar box. Matches customers, jobs, tickets and
 * invoices by their number/name/code, branch-scoped like the list views. Returns a small
 * grouped set (each item carries the href to open it) — this is quick navigation, not a
 * report, so results are capped.
 */

interface Hit { type: string; label: string; sub: string | null; href: string }

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response

    const q = (new URL(request.url).searchParams.get('q') || '').trim()
    if (q.length < 2) return NextResponse.json({ success: true, data: [] })

    const supabase = createServiceClient()
    const like = `%${q}%`
    const branchIds = ctx.access.branchIds // null = all
    const inBranch = <T>(rows: T[], getBranch: (r: T) => string | null | undefined) =>
      branchIds === null ? rows : rows.filter((r) => { const b = getBranch(r); return !!b && branchIds.includes(b) })

    const [custR, jobR, tkR, invR] = await Promise.all([
      supabase.from('billing_customers').select('id, code, name').or(`name.ilike.${like},code.ilike.${like}`).limit(6),
      supabase.from('billing_jobs').select('id, job_number, name, branch_id, billing_profiles(billing_customers(name))').or(`job_number.ilike.${like},name.ilike.${like}`).limit(6),
      supabase.from('billing_tickets').select('id, ticket_number, billing_jobs(job_number, branch_id)').ilike('ticket_number', like).limit(6),
      supabase.from('billing_invoices').select('id, invoice_number, branch_id, billing_jobs(job_number)').ilike('invoice_number', like).limit(6),
    ])

    const hits: Hit[] = []

    for (const c of (custR.data ?? []) as { id: string; code: string; name: string }[]) {
      hits.push({ type: 'Customer', label: c.name, sub: c.code, href: `/billing/customers/${c.id}` })
    }
    const jobs = inBranch((jobR.data ?? []) as unknown as { id: string; job_number: string; name: string | null; branch_id: string; billing_profiles: { billing_customers: { name: string } | null } | null }[], (j) => j.branch_id)
    for (const j of jobs) {
      hits.push({ type: 'Job', label: `${j.job_number}${j.name ? ` — ${j.name}` : ''}`, sub: j.billing_profiles?.billing_customers?.name ?? null, href: `/billing/jobs/${j.id}` })
    }
    const tks = inBranch((tkR.data ?? []) as unknown as { id: string; ticket_number: string; billing_jobs: { job_number: string; branch_id: string } | null }[], (t) => t.billing_jobs?.branch_id)
    for (const t of tks) {
      hits.push({ type: 'Ticket', label: t.ticket_number, sub: t.billing_jobs?.job_number ?? null, href: `/billing/tickets/${t.id}` })
    }
    const invs = inBranch((invR.data ?? []) as unknown as { id: string; invoice_number: string; branch_id: string; billing_jobs: { job_number: string } | null }[], (i) => i.branch_id)
    for (const i of invs) {
      hits.push({ type: 'Invoice', label: i.invoice_number, sub: i.billing_jobs?.job_number ?? null, href: `/billing/invoices/${i.id}` })
    }

    return NextResponse.json({ success: true, data: hits })
  } catch (err) {
    return billingApiError(err)
  }
}
