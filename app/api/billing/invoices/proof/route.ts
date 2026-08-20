import { NextResponse } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import React from 'react'
import { getAccessContext } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { buildJobInvoice, InvoiceBuildError } from '@/lib/billing/invoicing'
import { InvoiceDocument, type InvoicePdfData } from '@/lib/billing/invoice-pdf'

/**
 * PROOF — a preview of what a job is *ready* to bill, rendered straight to a watermarked
 * PDF for download. It computes with the same builder an invoice uses (preview mode), but
 * writes NOTHING: no invoice row, no accrual roll-forward. Proofs are throwaway; only
 * invoices are recorded. Called as a plain download link from "+ New → Proof".
 */

const bad = (msg: string, status = 400) =>
  new Response(msg, { status, headers: { 'Content-Type': 'text/plain' } })

export async function GET(request: Request): Promise<Response> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response

    const url = new URL(request.url)
    const jobId = url.searchParams.get('jobId') || ''
    const through = url.searchParams.get('through') || ''
    if (!jobId) return bad('A job is required.')
    if (!through) return bad('A through date is required.')

    const supabase = createServiceClient()

    let draft
    try {
      draft = await buildJobInvoice(supabase, { jobId, throughDate: through })
    } catch (e) {
      if (e instanceof InvoiceBuildError) return bad(e.message)
      throw e
    }

    if (ctx.access.branchIds !== null && !ctx.access.branchIds.includes(draft.job.branchId)) {
      return bad('You do not have access to this job’s branch.', 403)
    }

    // Display fields (customer / profile / entity) aren't on the draft — fetch them.
    const { data: jobRow } = await supabase
      .from('billing_jobs')
      .select('job_number, name, entities(code), billing_profiles(name, billing_customers(name))')
      .eq('id', jobId)
      .maybeSingle()
    const jr = jobRow as unknown as { job_number: string; name: string | null; entities: { code: string } | null; billing_profiles: { name: string; billing_customers: { name: string } | null } | null } | null

    // Resolve variation names for the line sub-labels.
    const varIds = [...new Set(draft.lines.map((l) => l.variationId).filter(Boolean))] as string[]
    const varName = new Map<string, string>()
    if (varIds.length) {
      const { data: vs } = await supabase.from('billing_item_variations').select('id, name').in('id', varIds)
      for (const v of (vs ?? []) as { id: string; name: string }[]) varName.set(v.id, v.name)
    }

    const pdfData: InvoicePdfData = {
      invoiceNumber: draft.job.jobNumber, // a proof has no invoice number — show the job's
      invoiceDate: through,
      throughDate: draft.throughDate,
      status: 'draft',
      customer: jr?.billing_profiles?.billing_customers?.name ?? null,
      profile: jr?.billing_profiles?.name ?? null,
      jobNumber: jr?.job_number ?? draft.job.jobNumber,
      jobName: jr?.name ?? draft.job.name,
      entityCode: jr?.entities?.code ?? null,
      taxRatePct: Number(draft.taxRatePct),
      totals: {
        rentalSubtotalCents: draft.totals.rentalSubtotalCents,
        salesSubtotalCents: draft.totals.salesSubtotalCents,
        otherSubtotalCents: draft.totals.otherSubtotalCents,
        rentalMinimumAdjustmentCents: draft.totals.rentalMinimumAdjustmentCents,
        subtotalCents: draft.totals.subtotalCents,
        taxCents: draft.totals.taxCents,
        totalCents: draft.totals.totalCents,
      },
      lines: draft.lines.map((l, i) => ({
        id: String(i),
        kind: l.kind,
        description: l.description,
        lotDate: l.lotDate,
        variation: l.variationId ? (varName.get(l.variationId) ?? null) : null,
        qty: Number(l.qty),
        units: l.units,
        unitRateCents: l.unitRateCents,
        amountCents: l.amountCents,
        taxable: l.kind === 'sale', // matches how a real invoice derives taxability
      })),
      companyName: 'Safety Network',
      proof: true,
    }

    const pdfBuffer = await renderToBuffer(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      React.createElement(InvoiceDocument, { data: pdfData }) as any
    )

    return new Response(new Uint8Array(pdfBuffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="Proof_${draft.job.jobNumber}.pdf"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    console.error('Proof PDF generation error:', err)
    return bad('Failed to generate the proof.', 500)
  }
}
