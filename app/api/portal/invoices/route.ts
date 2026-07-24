import { NextResponse } from 'next/server'
import { getPortalContext } from '@/lib/api/portal'
import { createServiceClient } from '@/lib/supabase/server'

/**
 * Invoices the customer may see. Only ISSUED invoices for their opted-in profiles —
 * drafts and voids never leave the office. Scope comes entirely from the portal context.
 */
export async function GET(): Promise<NextResponse> {
  const res = await getPortalContext()
  if (!res.ok) return res.response
  const { ctx } = res
  if (ctx.profileIds.length === 0) return NextResponse.json({ success: true, data: [] })

  const svc = createServiceClient()
  const { data, error } = await svc
    .from('billing_invoices')
    .select('id, invoice_number, invoice_date, through_date, status, total_cents, profile_id, billing_jobs(job_number, name)')
    .in('profile_id', ctx.profileIds)
    .eq('status', 'issued')
    .order('invoice_date', { ascending: false })
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })

  const rows = (data ?? []) as unknown as {
    id: string; invoice_number: string; invoice_date: string; through_date: string
    status: string; total_cents: number; profile_id: string
    billing_jobs: { job_number: string; name: string | null } | null
  }[]

  return NextResponse.json({
    success: true,
    data: rows.map((r) => ({
      id: r.id, invoiceNumber: r.invoice_number, invoiceDate: r.invoice_date,
      throughDate: r.through_date, totalCents: r.total_cents,
      jobNumber: r.billing_jobs?.job_number ?? '', jobName: r.billing_jobs?.name ?? null,
    })),
  })
}
