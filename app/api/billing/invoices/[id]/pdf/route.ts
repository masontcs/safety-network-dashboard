import { NextResponse } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import React from 'react'
import { getAccessContext } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { InvoiceDocument, type InvoicePdfData } from '@/lib/billing/invoice-pdf'

/**
 * Downloadable PDF of an invoice. Same data as the invoice detail route, rendered through
 * @react-pdf/renderer (mirrors the AR statement PDF) and returned as an attachment.
 */

interface InvoiceRow {
  id: string; invoice_number: string; branch_id: string; through_date: string; invoice_date: string
  status: string; tax_rate_pct: number
  rental_subtotal_cents: number; sales_subtotal_cents: number; other_subtotal_cents: number
  rental_minimum_adjustment_cents: number; subtotal_cents: number; tax_cents: number; total_cents: number
  billing_jobs: { job_number: string; name: string | null; entities: { code: string } | null; billing_profiles: { name: string; billing_customers: { name: string } | null } | null } | null
}
interface LineRow {
  id: string; kind: string; description: string; lot_date: string | null; variation_id: string | null
  qty: number; units: number; unit_rate_cents: number; amount_cents: number; taxable: boolean
  rental_item_qty: number | null; rental_days: number | null; period_end: string | null
}

export async function GET(request: Request, { params }: { params: { id: string } }): Promise<Response> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response

    // A "proof" is the same PDF stamped with a PROOF watermark, for pre-send review.
    const isProof = new URL(request.url).searchParams.get('proof') === '1'

    const supabase = createServiceClient()
    const { data, error } = await supabase
      .from('billing_invoices')
      .select(`
        id, invoice_number, branch_id, through_date, invoice_date, status, tax_rate_pct,
        rental_subtotal_cents, sales_subtotal_cents, other_subtotal_cents,
        rental_minimum_adjustment_cents, subtotal_cents, tax_cents, total_cents,
        billing_jobs(job_number, name, entities(code), billing_profiles(name, billing_customers(name)))
      `)
      .eq('id', params.id)
      .maybeSingle()
    if (error) throw new Error(error.message)
    const inv = data as unknown as InvoiceRow | null
    if (!inv) return NextResponse.json({ success: false, error: 'Invoice not found', code: 'NOT_FOUND' }, { status: 404 })

    if (ctx.access.branchIds !== null && !ctx.access.branchIds.includes(inv.branch_id)) {
      return NextResponse.json({ success: false, error: 'You do not have access to this invoice’s branch.', code: 'FORBIDDEN' }, { status: 403 })
    }

    const { data: lineRaw } = await supabase
      .from('billing_invoice_lines')
      .select('id, kind, description, lot_date, variation_id, qty, units, unit_rate_cents, amount_cents, taxable, rental_item_qty, rental_days, period_end')
      .eq('invoice_id', params.id)
      .order('created_at')
    const lines = (lineRaw ?? []) as LineRow[]

    // Resolve variation names for the line sub-label (shown in place of the kind).
    const varIds = [...new Set(lines.map((l) => l.variation_id).filter(Boolean))] as string[]
    const varName = new Map<string, string>()
    if (varIds.length) {
      const { data: vs } = await supabase.from('billing_item_variations').select('id, name').in('id', varIds)
      for (const v of (vs ?? []) as { id: string; name: string }[]) varName.set(v.id, v.name)
    }

    const pdfData: InvoicePdfData = {
      invoiceNumber: inv.invoice_number,
      invoiceDate: inv.invoice_date,
      throughDate: inv.through_date,
      status: inv.status,
      customer: inv.billing_jobs?.billing_profiles?.billing_customers?.name ?? null,
      profile: inv.billing_jobs?.billing_profiles?.name ?? null,
      jobNumber: inv.billing_jobs?.job_number ?? null,
      jobName: inv.billing_jobs?.name ?? null,
      entityCode: inv.billing_jobs?.entities?.code ?? null,
      taxRatePct: Number(inv.tax_rate_pct),
      totals: {
        rentalSubtotalCents: inv.rental_subtotal_cents,
        salesSubtotalCents: inv.sales_subtotal_cents,
        otherSubtotalCents: inv.other_subtotal_cents,
        rentalMinimumAdjustmentCents: inv.rental_minimum_adjustment_cents,
        subtotalCents: inv.subtotal_cents,
        taxCents: inv.tax_cents,
        totalCents: inv.total_cents,
      },
      lines: lines.map((l) => ({
        id: l.id, kind: l.kind, description: l.description, lotDate: l.lot_date,
        variation: l.variation_id ? (varName.get(l.variation_id) ?? null) : null,
        qty: Number(l.qty), units: l.units, unitRateCents: l.unit_rate_cents, amountCents: l.amount_cents, taxable: l.taxable,
        rentalItemQty: l.rental_item_qty, rentalDays: l.rental_days, periodEnd: l.period_end,
      })),
      companyName: 'Safety Network',
      proof: isProof,
    }

    const pdfBuffer = await renderToBuffer(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      React.createElement(InvoiceDocument, { data: pdfData }) as any
    )

    return new Response(new Uint8Array(pdfBuffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${isProof ? 'Proof' : 'Invoice'}_${inv.invoice_number}.pdf"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    console.error('Invoice PDF generation error:', err)
    return NextResponse.json({ success: false, error: 'Failed to generate invoice PDF' }, { status: 500 })
  }
}
