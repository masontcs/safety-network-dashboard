import { NextResponse } from 'next/server'
import { getAccessContext, guardBillingArea } from '@/lib/api/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { billingApiError } from '@/lib/billing/http'
import { nextNumber } from '@/lib/billing/rpc'
import { resolveCompiledRates, rateKeyOf } from '@/lib/billing/livePricing'
import type { BillingItemCategory, BillingType, BillingQuoteStatus, RateKey } from '@/lib/supabase/database.types'

/**
 * A single quote: read, save (lines priced from the list), status, and convert-to-job.
 * Prices reuse the same compiled-rate resolver the ticket and invoice use, so a quote
 * can't disagree with what the job will actually bill.
 */

function bad(error: string, code = 'VALIDATION_ERROR', status = 400) {
  return NextResponse.json({ success: false, error, code }, { status })
}
const catFor: Record<string, BillingItemCategory> = { equipment: 'Equipment', labor: 'Labor', lump_sum: 'Lump Sum', misc: 'Misc', sale: 'Sale' }

export async function GET(_request: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const supabase = createServiceClient()

    const { data: qRaw, error } = await supabase
      .from('billing_quotes')
      .select('id, quote_number, profile_id, entity_id, branch_id, status, quote_date, job_name, notes, tax_rate_pct, subtotal_cents, tax_cents, total_cents, converted_job_id, billing_profiles(name, billing_customers(name))')
      .eq('id', params.id).maybeSingle()
    if (error) throw new Error(error.message)
    const q = qRaw as unknown as {
      id: string; quote_number: string; profile_id: string; entity_id: string; branch_id: string; status: string
      quote_date: string; job_name: string | null; notes: string | null; tax_rate_pct: number
      subtotal_cents: number; tax_cents: number; total_cents: number; converted_job_id: string | null
      billing_profiles: { name: string; billing_customers: { name: string } | null } | null
    } | null
    if (!q) return bad('Quote not found', 'NOT_FOUND', 404)
    if (ctx.access.branchIds !== null && !ctx.access.branchIds.includes(q.branch_id)) return bad('No access to this branch.', 'FORBIDDEN', 403)

    const { data: lines } = await supabase
      .from('billing_quote_lines')
      .select('id, kind, item_id, variation_id, description, billing_type, qty, units, unit_rate_cents, amount_cents, sort_order')
      .eq('quote_id', params.id).order('sort_order')

    const { data: catalog } = await supabase
      .from('billing_items')
      .select('id, code, name, category, sale_price_cents, billing_item_variations(id, name)')
      .eq('is_active', true).order('code')

    return NextResponse.json({
      success: true,
      data: {
        id: q.id, quoteNumber: q.quote_number, profileId: q.profile_id, status: q.status, quoteDate: q.quote_date,
        jobName: q.job_name, notes: q.notes, taxRatePct: Number(q.tax_rate_pct),
        customer: q.billing_profiles?.billing_customers?.name ?? null, profile: q.billing_profiles?.name ?? null,
        convertedJobId: q.converted_job_id,
        totals: { subtotalCents: q.subtotal_cents, taxCents: q.tax_cents, totalCents: q.total_cents },
        lines: ((lines ?? []) as { id: string; kind: string; item_id: string | null; variation_id: string | null; description: string; billing_type: string | null; qty: number; units: number; unit_rate_cents: number; amount_cents: number }[])
          .map((l) => ({ id: l.id, kind: l.kind, itemId: l.item_id, variationId: l.variation_id, description: l.description, billingType: l.billing_type, qty: Number(l.qty), units: l.units, unitRateCents: l.unit_rate_cents, amountCents: l.amount_cents })),
        catalog: ((catalog ?? []) as unknown as { id: string; code: string; name: string; category: string; sale_price_cents: number | null; billing_item_variations: { id: string; name: string }[] | null }[])
          .map((c) => ({ id: c.id, code: c.code, name: c.name, category: c.category, salePriceCents: c.sale_price_cents, variations: (c.billing_item_variations ?? []).map((v) => ({ id: v.id, name: v.name })) })),
        isAdmin: ctx.access.role === 'admin',
      },
    })
  } catch (err) {
    return billingApiError(err)
  }
}

export async function PUT(request: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const guard = guardBillingArea(ctx.access, 'quotes')
    if (guard) return guard

    const body = (await request.json()) as {
      jobName?: string | null; notes?: string | null; taxRatePct?: number
      lines?: { kind: string; itemId?: string | null; variationId?: string | null; description?: string; billingType?: string | null; qty?: number; units?: number; unitRateCents?: number }[]
    }
    const supabase = createServiceClient()
    const { data: q } = await supabase.from('billing_quotes').select('id, profile_id, entity_id, branch_id, status').eq('id', params.id).maybeSingle()
    if (!q) return bad('Quote not found', 'NOT_FOUND', 404)
    if (ctx.access.branchIds !== null && !ctx.access.branchIds.includes(q.branch_id)) return bad('No access to this branch.', 'FORBIDDEN', 403)
    if (q.status === 'won') return bad('This quote was won and converted — it can’t be edited.', 'CONFLICT', 409)

    const linesIn = body.lines ?? []
    // Price item-backed lines from the price list (equipment: cadence or flat; charge: flat;
    // sale: the item's sale price). Misc / rate-entered lines keep their entered rate.
    const sale = new Map<string, number>()
    const itemIds = [...new Set(linesIn.filter((l) => l.itemId).map((l) => l.itemId as string))]
    if (itemIds.length) {
      const { data: its } = await supabase.from('billing_items').select('id, sale_price_cents').in('id', itemIds)
      for (const i of (its ?? []) as { id: string; sale_price_cents: number | null }[]) if (i.sale_price_cents != null) sale.set(i.id, i.sale_price_cents)
    }
    const reqs = linesIn.filter((l) => l.itemId && l.kind !== 'sale' && l.kind !== 'misc').map((l) => ({
      itemId: l.itemId as string, variationId: l.variationId ?? null,
      category: (catFor[l.kind] ?? 'Equipment') as BillingItemCategory,
      rateKey: (l.kind === 'equipment' ? (l.billingType as RateKey) || 'flat' : 'flat') as RateKey,
    }))
    // equipment: also request 'flat' as the single-rate fallback
    for (const l of linesIn) if (l.kind === 'equipment' && l.itemId) reqs.push({ itemId: l.itemId, variationId: l.variationId ?? null, category: 'Equipment', rateKey: 'flat' })
    const rates = await resolveCompiledRates(supabase, { profileId: q.profile_id, entityId: q.entity_id, requests: reqs })

    let subtotal = 0, taxable = 0
    const rows = linesIn.map((l, idx) => {
      const qty = Number(l.qty ?? 1), units = l.units ?? 1
      let rate = l.unitRateCents ?? 0
      if (l.itemId) {
        if (l.kind === 'sale') rate = sale.get(l.itemId) ?? 0
        else if (l.kind !== 'misc') {
          const key = l.kind === 'equipment' ? ((l.billingType as RateKey) || 'flat') : 'flat'
          rate = rates.get(rateKeyOf(l.itemId, l.variationId ?? null, key)) ?? rates.get(rateKeyOf(l.itemId, l.variationId ?? null, 'flat')) ?? 0
        }
      }
      const amount = Math.round(qty * units * rate)
      subtotal += amount
      if (l.kind === 'sale') taxable += amount
      return {
        quote_id: params.id, kind: l.kind, item_id: l.itemId ?? null, variation_id: l.variationId ?? null,
        description: l.description ?? '', billing_type: (l.kind === 'equipment' ? (l.billingType as BillingType | null) : null) ?? null,
        qty, units, unit_rate_cents: rate, amount_cents: amount, taxable: l.kind === 'sale', sort_order: idx,
      }
    })

    const taxRate = body.taxRatePct ?? 0
    const taxCents = Math.round(taxable * (taxRate / 100))
    await supabase.from('billing_quote_lines').delete().eq('quote_id', params.id)
    if (rows.length) { const { error } = await supabase.from('billing_quote_lines').insert(rows); if (error) throw new Error(error.message) }
    const { error: uErr } = await supabase.from('billing_quotes').update({
      job_name: body.jobName ?? null, notes: body.notes ?? null, tax_rate_pct: taxRate,
      subtotal_cents: subtotal, tax_cents: taxCents, total_cents: subtotal + taxCents, updated_at: new Date().toISOString(),
    }).eq('id', params.id)
    if (uErr) throw new Error(uErr.message)

    return NextResponse.json({ success: true, data: { subtotalCents: subtotal, taxCents, totalCents: subtotal + taxCents } })
  } catch (err) {
    return billingApiError(err)
  }
}

export async function PATCH(request: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  try {
    const ctx = await getAccessContext()
    if (!ctx.ok) return ctx.response
    const guard = guardBillingArea(ctx.access, 'quotes')
    if (guard) return guard
    const body = (await request.json()) as { action?: string; status?: string }
    const supabase = createServiceClient()

    const { data: q } = await supabase.from('billing_quotes').select('id, profile_id, entity_id, branch_id, status, job_name, converted_job_id').eq('id', params.id).maybeSingle()
    if (!q) return bad('Quote not found', 'NOT_FOUND', 404)
    if (ctx.access.branchIds !== null && !ctx.access.branchIds.includes(q.branch_id)) return bad('No access to this branch.', 'FORBIDDEN', 403)

    if (body.action === 'status') {
      if (!['draft', 'sent', 'lost'].includes(body.status ?? '')) return bad('Status must be draft, sent, or lost')
      if (q.status === 'won') return bad('A won quote can’t change status.', 'CONFLICT', 409)
      const { error } = await supabase.from('billing_quotes').update({ status: body.status as BillingQuoteStatus }).eq('id', params.id)
      if (error) throw new Error(error.message)
      return NextResponse.json({ success: true })
    }

    if (body.action === 'convert') {
      if (q.converted_job_id) return bad('This quote was already converted.', 'CONFLICT', 409)

      // Create the job under the profile, then a first active Add ticket, then seed its
      // equipment ledger with a pickup per equipment line (at its quoted cadence). Charge
      // lines aren't seeded — the office adds those on the ticket.
      const jobNumber = await nextNumber(supabase, 'job', q.entity_id, q.branch_id)
      const { data: job, error: jErr } = await supabase.from('billing_jobs').insert({
        profile_id: q.profile_id, entity_id: q.entity_id, branch_id: q.branch_id,
        job_number: jobNumber, certified: false, name: q.job_name ?? `From quote`, status: 'new',
      }).select('id').single()
      if (jErr || !job) throw new Error(jErr?.message ?? 'Failed to create the job')

      const ticketNumber = await nextNumber(supabase, 'ticket', q.entity_id, q.branch_id)
      const today = new Date().toISOString().slice(0, 10)
      const { data: ticket, error: tErr } = await supabase.from('billing_tickets').insert({
        job_id: job.id, entity_id: q.entity_id, ticket_number: ticketNumber, ticket_date: today,
        status: 'active', feature_add: true,
      }).select('id').single()
      if (tErr || !ticket) throw new Error(tErr?.message ?? 'Failed to create the first ticket')

      const { data: eqLines } = await supabase.from('billing_quote_lines')
        .select('item_id, variation_id, qty, billing_type').eq('quote_id', params.id).eq('kind', 'equipment')
      const pickups = ((eqLines ?? []) as { item_id: string | null; variation_id: string | null; qty: number; billing_type: string | null }[])
        .filter((l) => l.item_id && Number(l.qty) > 0)
        .map((l) => ({ ticket_id: ticket.id, job_id: job.id, item_id: l.item_id as string, variation_id: l.variation_id, event_type: 'pickup' as const, event_date: today, qty: Math.round(Number(l.qty)), billing_type: (l.billing_type as BillingType | null) ?? null }))
      if (pickups.length) { const { error } = await supabase.from('billing_ticket_ledger').insert(pickups); if (error) throw new Error(error.message) }

      const { error } = await supabase.from('billing_quotes').update({ status: 'won', converted_job_id: job.id }).eq('id', params.id)
      if (error) throw new Error(error.message)
      return NextResponse.json({ success: true, data: { jobId: job.id, jobNumber, ticketsSeeded: pickups.length } })
    }

    return bad('Unknown action')
  } catch (err) {
    return billingApiError(err)
  }
}
