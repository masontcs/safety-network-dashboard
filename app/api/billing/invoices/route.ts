import { NextResponse } from 'next/server'
import { getAccessContext } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { billingApiError } from '@/lib/billing/http'

/**
 * Invoices — read list. Invoice GENERATION is part of the invoicing build and
 * isn't wired yet, so this returns whatever exists (none, for now). Optional
 * ?profileId= scopes to a billing profile (used by the profile's Invoices tab).
 */

interface InvoiceRow {
  id: string
  invoice_number: string
  invoice_date: string
  status: string
  total_cents: number
  branch_id: string
  billing_jobs: { job_number: string } | null
}

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response

    const url = new URL(request.url)
    const profileId = url.searchParams.get('profileId')

    const supabase = createServiceClient()
    let query = supabase
      .from('billing_invoices')
      .select('id, invoice_number, invoice_date, status, total_cents, branch_id, billing_jobs(job_number)')
      .order('invoice_date', { ascending: false })

    if (profileId) query = query.eq('profile_id', profileId)
    if (ctx.access.branchIds !== null) {
      if (ctx.access.branchIds.length === 0) return NextResponse.json({ success: true, data: [] })
      query = query.in('branch_id', ctx.access.branchIds)
    }

    const { data, error } = await query
    if (error) throw new Error(error.message)
    const rows = (data ?? []) as unknown as InvoiceRow[]

    return NextResponse.json({
      success: true,
      data: rows.map((i) => ({
        id: i.id,
        invoiceNumber: i.invoice_number,
        invoiceDate: i.invoice_date,
        status: i.status,
        totalCents: i.total_cents,
        jobNumber: i.billing_jobs?.job_number ?? null,
      })),
    })
  } catch (err) {
    return billingApiError(err)
  }
}
