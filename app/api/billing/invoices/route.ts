import { NextResponse } from 'next/server'
import { getAccessContext, guardAdminOnly } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { billingApiError } from '@/lib/billing/http'
import { nextNumber } from '@/lib/billing/rpc'
import { buildJobInvoice, InvoiceBuildError } from '@/lib/billing/invoicing'

/**
 * Invoices — list, and GENERATE from a job.
 *
 * Generation is a billing run: pick a job and a through date, and everything unbilled as
 * of that date becomes one invoice. `preview: true` computes and returns without writing
 * anything, so what you approve is what gets saved — same code path, one flag.
 *
 * Optional ?profileId= scopes the list to a billing profile.
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

/**
 * Generate an invoice for a job as of a through date.
 *
 * `preview: true` returns the computed lines and totals WITHOUT writing — the biller
 * confirms the numbers, then posts again to commit. Both paths call the same builder, so
 * a preview can't drift from what actually saves.
 *
 * Committing writes the invoice as a DRAFT and rolls the rental accruals forward, which
 * is what stops a recurring rental from billing the same qty-units twice.
 */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const guard = guardAdminOnly(ctx.access.role)
    if (guard) return guard

    const body = (await request.json()) as {
      jobId?: string
      throughDate?: string
      invoiceDate?: string
      taxRatePct?: number
      preview?: boolean
    }
    if (!body.jobId) return NextResponse.json({ success: false, error: 'A job is required', code: 'VALIDATION_ERROR' }, { status: 400 })
    if (!body.throughDate) return NextResponse.json({ success: false, error: 'A through date is required', code: 'VALIDATION_ERROR' }, { status: 400 })
    if (body.taxRatePct != null && !(body.taxRatePct >= 0 && body.taxRatePct < 100)) {
      return NextResponse.json({ success: false, error: 'Tax rate must be between 0 and 100', code: 'VALIDATION_ERROR' }, { status: 400 })
    }

    const supabase = createServiceClient()

    let draft
    try {
      draft = await buildJobInvoice(supabase, {
        jobId: body.jobId,
        throughDate: body.throughDate,
        taxRatePct: body.taxRatePct,
      })
    } catch (e) {
      if (e instanceof InvoiceBuildError) {
        return NextResponse.json({ success: false, error: e.message, code: 'NOTHING_TO_BILL' }, { status: 400 })
      }
      throw e
    }

    if (ctx.access.branchIds !== null && !ctx.access.branchIds.includes(draft.job.branchId)) {
      return NextResponse.json({ success: false, error: 'You do not have access to this job’s branch.', code: 'FORBIDDEN' }, { status: 403 })
    }

    // Preview: hand back exactly what would be written, having written nothing.
    if (body.preview) {
      return NextResponse.json({ success: true, data: { preview: true, ...draft } })
    }

    const invoiceDate = body.invoiceDate ?? draft.throughDate
    const invoiceNumber = await nextNumber(supabase, 'invoice', draft.job.entityId, draft.job.branchId)

    const { data: created, error: cErr } = await supabase
      .from('billing_invoices')
      .insert({
        invoice_number: invoiceNumber,
        job_id: draft.job.id,
        profile_id: draft.job.profileId,
        entity_id: draft.job.entityId,
        branch_id: draft.job.branchId,
        through_date: draft.throughDate,
        invoice_date: invoiceDate,
        status: 'draft',
        tax_rate_pct: draft.taxRatePct,
        rental_subtotal_cents: draft.totals.rentalSubtotalCents,
        sales_subtotal_cents: draft.totals.salesSubtotalCents,
        other_subtotal_cents: draft.totals.otherSubtotalCents,
        rental_minimum_adjustment_cents: draft.totals.rentalMinimumAdjustmentCents,
        subtotal_cents: draft.totals.subtotalCents,
        taxable_base_cents: draft.totals.taxableBaseCents,
        tax_cents: draft.totals.taxCents,
        total_cents: draft.totals.totalCents,
        created_by: ctx.access.userId ?? null,
      })
      .select('id, invoice_number')
      .single()
    if (cErr || !created) throw new Error(cErr?.message ?? 'Failed to create the invoice')

    const { error: lErr } = await supabase.from('billing_invoice_lines').insert(
      draft.lines.map((l) => ({
        invoice_id: created.id,
        ticket_id: l.ticketId,
        kind: l.kind,
        item_id: l.itemId,
        variation_id: l.variationId,
        description: l.description,
        lot_date: l.lotDate,
        qty: l.qty,
        units: l.units,
        unit_rate_cents: l.unitRateCents,
        amount_cents: l.amountCents,
        taxable: l.kind === 'sale',
      }))
    )
    if (lErr) throw new Error(lErr.message)

    // Roll accruals forward: these qty-units are now billed and must never bill again.
    for (const a of draft.accruals) {
      const { error } = await supabase
        .from('billing_rental_accruals')
        .upsert(
          {
            ticket_id: a.ticketId,
            item_id: a.itemId,
            variation_id: a.variationId,
            lot_date: a.lotDate,
            qty_units_billed: a.qtyUnitsBilled,
          },
          { onConflict: 'ticket_id,item_id,variation_id,lot_date' }
        )
      if (error) throw new Error(error.message)
    }

    return NextResponse.json({
      success: true,
      data: { id: created.id, invoiceNumber: created.invoice_number, warnings: draft.warnings, totals: draft.totals },
    })
  } catch (err) {
    return billingApiError(err)
  }
}
