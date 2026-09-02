import { NextResponse } from 'next/server'
import { getAccessContext, guardBillingArea } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { billingApiError } from '@/lib/billing/http'
import { broadcastBillingChanged } from '@/lib/realtime/broadcast'

/**
 * A single invoice: its header, its lines, and the two transitions it can make.
 *
 *   draft ──issue──▶ issued        marks the tickets it billed 'invoiced'
 *   draft / issued ──void──▶ void  reverses the rental accruals it added, so those
 *                                   qty-units become billable again, and un-hides its
 *                                   one-time charges (the charge guard skips void invoices)
 *
 * A DRAFT is a proposal — nothing downstream depends on it until it's issued. Voiding is
 * the escape hatch for an issued invoice that was wrong; it never deletes history.
 */

function bad(error: string, code = 'VALIDATION_ERROR', status = 400) {
  return NextResponse.json({ success: false, error, code }, { status })
}

interface InvoiceRow {
  id: string; invoice_number: string; job_id: string; profile_id: string; entity_id: string; branch_id: string
  through_date: string; invoice_date: string; status: 'draft' | 'issued' | 'void'; tax_rate_pct: number
  rental_subtotal_cents: number; sales_subtotal_cents: number; other_subtotal_cents: number
  rental_minimum_adjustment_cents: number; subtotal_cents: number; taxable_base_cents: number
  tax_cents: number; total_cents: number
  billing_jobs: { job_number: string; name: string | null; billing_profiles: { name: string; billing_customers: { name: string } | null } | null; entities: { code: string } | null } | null
}
interface LineRow {
  id: string; kind: string; description: string; item_id: string | null; variation_id: string | null
  lot_date: string | null; qty: number; units: number; unit_rate_cents: number; amount_cents: number; taxable: boolean
}

export async function GET(_request: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response

    const supabase = createServiceClient()
    const { data, error } = await supabase
      .from('billing_invoices')
      .select(`
        id, invoice_number, job_id, profile_id, entity_id, branch_id, through_date, invoice_date, status,
        tax_rate_pct, rental_subtotal_cents, sales_subtotal_cents, other_subtotal_cents,
        rental_minimum_adjustment_cents, subtotal_cents, taxable_base_cents, tax_cents, total_cents,
        billing_jobs(job_number, name, entities(code), billing_profiles(name, billing_customers(name)))
      `)
      .eq('id', params.id)
      .maybeSingle()
    if (error) throw new Error(error.message)
    const inv = data as unknown as InvoiceRow | null
    if (!inv) return bad('Invoice not found', 'NOT_FOUND', 404)

    if (ctx.access.branchIds !== null && !ctx.access.branchIds.includes(inv.branch_id)) {
      return bad('You do not have access to this invoice’s branch.', 'FORBIDDEN', 403)
    }

    const { data: lineRaw } = await supabase
      .from('billing_invoice_lines')
      .select('id, kind, description, item_id, variation_id, lot_date, qty, units, unit_rate_cents, amount_cents, taxable')
      .eq('invoice_id', params.id)
      .order('created_at')
    const lines = (lineRaw ?? []) as LineRow[]

    const varIds = [...new Set(lines.map((l) => l.variation_id).filter(Boolean))] as string[]
    const varName = new Map<string, string>()
    if (varIds.length) {
      const { data: vs } = await supabase.from('billing_item_variations').select('id, name').in('id', varIds)
      for (const v of (vs ?? []) as { id: string; name: string }[]) varName.set(v.id, v.name)
    }

    return NextResponse.json({
      success: true,
      data: {
        id: inv.id,
        invoiceNumber: inv.invoice_number,
        jobId: inv.job_id,
        jobNumber: inv.billing_jobs?.job_number ?? null,
        jobName: inv.billing_jobs?.name ?? null,
        customer: inv.billing_jobs?.billing_profiles?.billing_customers?.name ?? null,
        profile: inv.billing_jobs?.billing_profiles?.name ?? null,
        entityCode: inv.billing_jobs?.entities?.code ?? null,
        throughDate: inv.through_date,
        invoiceDate: inv.invoice_date,
        status: inv.status,
        taxRatePct: Number(inv.tax_rate_pct),
        totals: {
          rentalSubtotalCents: inv.rental_subtotal_cents,
          salesSubtotalCents: inv.sales_subtotal_cents,
          otherSubtotalCents: inv.other_subtotal_cents,
          rentalMinimumAdjustmentCents: inv.rental_minimum_adjustment_cents,
          subtotalCents: inv.subtotal_cents,
          taxableBaseCents: inv.taxable_base_cents,
          taxCents: inv.tax_cents,
          totalCents: inv.total_cents,
        },
        lines: lines.map((l) => ({
          id: l.id, kind: l.kind, description: l.description, lotDate: l.lot_date,
          variation: l.variation_id ? (varName.get(l.variation_id) ?? null) : null,
          qty: Number(l.qty), units: l.units, unitRateCents: l.unit_rate_cents, amountCents: l.amount_cents, taxable: l.taxable,
        })),
        isAdmin: ctx.access.role === 'admin',
      },
    })
  } catch (err) {
    return billingApiError(err)
  }
}

export async function PATCH(request: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const guard = guardBillingArea(ctx.access, 'invoices')
    if (guard) return guard

    const body = (await request.json()) as { action?: string; invoiceDate?: string }
    const supabase = createServiceClient()

    const { data: inv, error: iErr } = await supabase
      .from('billing_invoices')
      .select('id, status, branch_id')
      .eq('id', params.id)
      .maybeSingle()
    if (iErr) throw new Error(iErr.message)
    if (!inv) return bad('Invoice not found', 'NOT_FOUND', 404)
    if (ctx.access.branchIds !== null && !ctx.access.branchIds.includes(inv.branch_id)) {
      return bad('You do not have access to this invoice’s branch.', 'FORBIDDEN', 403)
    }

    // A plain date change (draft only).
    if (body.invoiceDate !== undefined && !body.action) {
      if (inv.status !== 'draft') return bad('Only a draft invoice can be edited.', 'CONFLICT', 409)
      const { error } = await supabase.from('billing_invoices').update({ invoice_date: body.invoiceDate }).eq('id', params.id)
      if (error) throw new Error(error.message)
      await broadcastBillingChanged()
      return NextResponse.json({ success: true })
    }

    if (body.action === 'issue') {
      if (inv.status !== 'draft') return bad('Only a draft can be issued.', 'CONFLICT', 409)
      const { error } = await supabase.from('billing_invoices').update({ status: 'issued' }).eq('id', params.id)
      if (error) throw new Error(error.message)

      // Mark the tickets this invoice billed as 'invoiced'. They keep billing recurring
      // rentals next cycle — the accrual delta, not the ticket status, is the double-bill
      // guard — but the status reflects that money has gone out against them.
      const { data: ticketLines } = await supabase
        .from('billing_invoice_lines')
        .select('ticket_id')
        .eq('invoice_id', params.id)
        .not('ticket_id', 'is', null)
      const ticketIds = [...new Set(((ticketLines ?? []) as { ticket_id: string | null }[]).map((l) => l.ticket_id).filter(Boolean))] as string[]
      if (ticketIds.length > 0) {
        const { error: tErr } = await supabase.from('billing_tickets').update({ status: 'invoiced' }).in('id', ticketIds)
        if (tErr) throw new Error(tErr.message)
      }
      await broadcastBillingChanged()
      return NextResponse.json({ success: true })
    }

    if (body.action === 'void') {
      if (inv.status === 'void') return bad('This invoice is already void.', 'CONFLICT', 409)

      // Reverse the rental accruals this invoice added: subtract each rental line's
      // qty-units back off the lot's cumulative total, so it becomes billable again. Its
      // one-time charges free up automatically — the charge guard ignores void invoices.
      const { data: rentalLines } = await supabase
        .from('billing_invoice_lines')
        .select('ticket_id, item_id, variation_id, lot_date, qty')
        .eq('invoice_id', params.id)
        .eq('kind', 'rental')
      for (const l of (rentalLines ?? []) as { ticket_id: string | null; item_id: string | null; variation_id: string | null; lot_date: string | null; qty: number }[]) {
        if (!l.ticket_id || !l.item_id || !l.lot_date) continue
        let q = supabase.from('billing_rental_accruals')
          .select('id, qty_units_billed')
          .eq('ticket_id', l.ticket_id).eq('item_id', l.item_id).eq('lot_date', l.lot_date)
        q = l.variation_id ? q.eq('variation_id', l.variation_id) : q.is('variation_id', null)
        const { data: acc } = await q.maybeSingle()
        if (acc) {
          const next = Math.max(0, acc.qty_units_billed - Number(l.qty))
          const { error } = await supabase.from('billing_rental_accruals').update({ qty_units_billed: next }).eq('id', acc.id)
          if (error) throw new Error(error.message)
        }
      }

      const { error } = await supabase.from('billing_invoices').update({ status: 'void' }).eq('id', params.id)
      if (error) throw new Error(error.message)

      // Unlock the tickets this invoice billed: revert 'invoiced' → 'final_edit' so they can
      // be re-billed (or reopened to edit). A ticket that still sits on ANOTHER non-void
      // invoice — e.g. a recurring rental billed across cycles — stays 'invoiced'.
      const { data: myLines } = await supabase
        .from('billing_invoice_lines')
        .select('ticket_id')
        .eq('invoice_id', params.id)
        .not('ticket_id', 'is', null)
      const myTicketIds = [...new Set(((myLines ?? []) as { ticket_id: string | null }[]).map((l) => l.ticket_id).filter(Boolean))] as string[]
      for (const tid of myTicketIds) {
        const { data: otherLines } = await supabase
          .from('billing_invoice_lines')
          .select('billing_invoices!inner(status)')
          .eq('ticket_id', tid)
          .neq('invoice_id', params.id)
        const stillBilled = ((otherLines ?? []) as unknown as { billing_invoices: { status: string } | null }[])
          .some((l) => l.billing_invoices && l.billing_invoices.status !== 'void')
        if (!stillBilled) {
          await supabase.from('billing_tickets').update({ status: 'final_edit' }).eq('id', tid).eq('status', 'invoiced')
        }
      }
      // Live: the invoice flips to void on the list, and its unlocked tickets revert to
      // 'final_edit' on the tickets list.
      await broadcastBillingChanged()
      return NextResponse.json({ success: true })
    }

    return bad('Unknown action')
  } catch (err) {
    return billingApiError(err)
  }
}
