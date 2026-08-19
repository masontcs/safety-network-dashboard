import type { createServiceClient } from '@/lib/supabase/server'
import type { BillingType, RateKey } from '@/lib/supabase/database.types'
import { buildBatches, type LedgerEvent } from '@/lib/billing/pricing/rental'
import { accrualPlan, type AccrualLedger } from '@/lib/billing/pricing/cycles'
import { buildInvoice, rentalLine, lostLine, DEFAULT_INVOICE_OPTIONS, type InvoiceLine, type InvoiceTotals } from '@/lib/billing/pricing/invoice'
import { resolveCompiledRates, rateKeyOf } from '@/lib/billing/livePricing'

/**
 * Invoice generation — the bridge from a job's tickets to a billable invoice.
 *
 * An invoice is scoped to a JOB and a THROUGH DATE (see billing_invoices: job_id +
 * through_date). It sweeps up everything unbilled as of that date:
 *
 *   RENTALS   accrued per pickup LOT via the accrual engine, at that pickup's own
 *             cadence, priced from the compiled price list. The accrual ledger holds
 *             qty-units already billed, so re-running bills only the delta — a monthly
 *             rental accrues quietly across weekly runs and never double-bills.
 *   LOST      at item cost, untaxed, once.
 *   CHARGES   sale / labor / lump sum / misc lines off each ticket, once. Labor and
 *             lump sum are priced live from the price list (they store no rate).
 *
 * One-time charges are billed once by construction: a ticket's non-rental lines are
 * skipped if they already appear on a non-void invoice. Rentals need no such guard —
 * the accrual delta IS the guard.
 *
 * Nothing here writes. `buildJobInvoice` computes; the caller decides whether to persist,
 * which is what makes a preview and the real thing provably identical.
 */

type Client = ReturnType<typeof createServiceClient>

/** A computed line plus the identity the database row needs. */
export interface DraftLine extends InvoiceLine {
  ticketId: string | null
  itemId: string | null
  variationId: string | null
  /** The pickup lot a rental line came from — its billing anchor. */
  lotDate: string | null
}

/** What to add to billing_rental_accruals once the invoice is actually issued. */
export interface AccrualCommit {
  ticketId: string
  itemId: string
  variationId: string | null
  lotDate: string
  qtyUnitsBilled: number
}

export interface JobInvoiceDraft {
  job: { id: string; jobNumber: string; name: string | null; profileId: string; entityId: string; branchId: string; taxExempt: boolean }
  throughDate: string
  taxRatePct: number
  lines: DraftLine[]
  totals: InvoiceTotals
  accruals: AccrualCommit[]
  /** Anything the biller should look at before issuing — never silently swallowed. */
  warnings: string[]
}

export class InvoiceBuildError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvoiceBuildError'
  }
}

const keyOf = (itemId: string, variationId: string | null) => `${itemId}|${variationId ?? ''}`

interface LedgerRow {
  ticket_id: string
  item_id: string
  variation_id: string | null
  event_type: 'pickup' | 'return' | 'lost'
  event_date: string
  qty: number
  billing_type: BillingType | null
}

export async function buildJobInvoice(
  supabase: Client,
  params: { jobId: string; throughDate: string; taxRatePct?: number }
): Promise<JobInvoiceDraft> {
  const { jobId, throughDate } = params
  const warnings: string[] = []

  // ── job + profile settings ────────────────────────────────────────────────
  const { data: jobRow, error: jErr } = await supabase
    .from('billing_jobs')
    .select('id, job_number, name, profile_id, entity_id, branch_id, tax_exempt')
    .eq('id', jobId)
    .maybeSingle()
  if (jErr) throw new Error(jErr.message)
  if (!jobRow) throw new InvoiceBuildError('Job not found')
  const job = {
    id: jobRow.id, jobNumber: jobRow.job_number, name: jobRow.name,
    profileId: jobRow.profile_id, entityId: jobRow.entity_id, branchId: jobRow.branch_id,
    taxExempt: jobRow.tax_exempt,
  }

  const { data: profile } = await supabase
    .from('billing_profiles')
    .select('rental_minimum_enabled, rental_minimum_cents')
    .eq('id', job.profileId)
    .maybeSingle()

  // A tax-exempt job is 0% no matter what was requested.
  const taxRatePct = job.taxExempt ? 0 : params.taxRatePct ?? 0

  // ── the job's tickets and their ledgers ───────────────────────────────────
  const { data: ticketRows } = await supabase
    .from('billing_tickets')
    .select('id, ticket_number, status, feature_dtc, is_voided')
    .eq('job_id', jobId)
  const tickets = (ticketRows ?? []) as { id: string; ticket_number: string; status: string; feature_dtc: boolean; is_voided: boolean }[]
  if (tickets.length === 0) throw new InvoiceBuildError('This job has no tickets to bill.')

  // Only settled tickets bill. An active/in-review ticket is still being edited by the
  // crew — billing it would invoice numbers nobody has signed off on.
  // A voided ticket is billed by nothing, ever — it drops out before the status check.
  const billable = tickets.filter((t) => !t.is_voided && (t.status === 'final_edit' || t.status === 'invoiced'))
  if (billable.length === 0) throw new InvoiceBuildError('No tickets on this job are final-edited yet, so there is nothing to bill.')
  const billableIds = billable.map((t) => t.id)
  const ticketNumber = new Map(billable.map((t) => [t.id, t.ticket_number]))
  const isDtc = new Map(billable.map((t) => [t.id, t.feature_dtc]))

  const { data: ledgerRaw } = await supabase
    .from('billing_ticket_ledger')
    .select('ticket_id, item_id, variation_id, event_type, event_date, qty, billing_type')
    .in('ticket_id', billableIds)
    .lte('event_date', throughDate)
  const ledger = (ledgerRaw ?? []) as LedgerRow[]

  // ── names, costs, and per-variation cost adjustments ──────────────────────
  const itemIds = [...new Set(ledger.map((l) => l.item_id))]
  const itemById = new Map<string, { code: string; name: string; costCents: number }>()
  if (itemIds.length > 0) {
    const { data: its } = await supabase.from('billing_items').select('id, code, name, cost_cents').in('id', itemIds)
    for (const i of (its ?? []) as { id: string; code: string; name: string; cost_cents: number }[]) {
      itemById.set(i.id, { code: i.code, name: i.name, costCents: i.cost_cents })
    }
  }
  const variationIds = [...new Set(ledger.map((l) => l.variation_id).filter(Boolean))] as string[]
  const variationById = new Map<string, { name: string; costAdjCents: number }>()
  if (variationIds.length > 0) {
    const { data: vs } = await supabase.from('billing_item_variations').select('id, name, cost_adj_cents').in('id', variationIds)
    for (const v of (vs ?? []) as { id: string; name: string; cost_adj_cents: number }[]) {
      variationById.set(v.id, { name: v.name, costAdjCents: v.cost_adj_cents })
    }
  }

  // ── accruals already billed, per (ticket, item, variation, lot) ───────────
  const { data: accrualRows } = await supabase
    .from('billing_rental_accruals')
    .select('ticket_id, item_id, variation_id, lot_date, qty_units_billed')
    .in('ticket_id', billableIds)
  const billedSoFar = new Map<string, number>()
  for (const a of (accrualRows ?? []) as { ticket_id: string; item_id: string; variation_id: string | null; lot_date: string; qty_units_billed: number }[]) {
    billedSoFar.set(`${a.ticket_id}|${keyOf(a.item_id, a.variation_id)}|${a.lot_date}`, a.qty_units_billed)
  }

  // ── which cadence each (ticket, item, variation) bills at ─────────────────
  // The cadence lives on the pickup. In practice every pickup of one item on one ticket
  // shares a cadence; if they ever disagree we bill the first and say so rather than
  // silently picking one.
  const cadenceFor = new Map<string, BillingType>()
  for (const row of ledger) {
    if (row.event_type !== 'pickup') continue
    // A DTC ticket is always a daily day-charge: the cadence is forced to 'daily' no matter
    // what (if anything) is stored on the row. That's why DTC never asks for a billing type,
    // and why legacy DTC rows with a null cadence still bill.
    const bt: BillingType | null = isDtc.get(row.ticket_id) ? 'daily' : row.billing_type
    if (!bt) continue
    const k = `${row.ticket_id}|${keyOf(row.item_id, row.variation_id)}`
    const existing = cadenceFor.get(k)
    if (!existing) cadenceFor.set(k, bt)
    else if (existing !== bt) {
      const code = itemById.get(row.item_id)?.code ?? 'item'
      warnings.push(`Ticket ${ticketNumber.get(row.ticket_id)}: ${code} has pickups with different billing types — billed as ${existing}.`)
    }
  }

  // ── price everything we need, in one batch ────────────────────────────────
  // For each equipment pickup we ask for BOTH the cadence rate and the 'flat' rate: a
  // by-cadence item is priced under its cadence (daily/weekly/monthly), a single-rate item
  // under 'flat'. An item only has one of the two, so requesting both is harmless and lets
  // resolution pick whichever exists.
  const rateRequests = [...new Set(
    ledger.filter((l) => l.event_type === 'pickup').flatMap((l) => {
      const k = `${l.ticket_id}|${keyOf(l.item_id, l.variation_id)}`
      const cadence = cadenceFor.get(k)
      if (!cadence) return []
      return [`${l.item_id}|${l.variation_id ?? ''}|${cadence}`, `${l.item_id}|${l.variation_id ?? ''}|flat`]
    })
  )].map((s) => {
    const [itemId, variationId, rateKey] = s.split('|')
    return { itemId, variationId: variationId || null, category: 'Equipment' as const, rateKey: rateKey as RateKey }
  })

  const rates = await resolveCompiledRates(supabase, { profileId: job.profileId, entityId: job.entityId, requests: rateRequests })

  // ── RENTAL lines, per (ticket, item, variation) ───────────────────────────
  const lines: DraftLine[] = []
  const accruals: AccrualCommit[] = []

  const groups = new Map<string, LedgerRow[]>()
  for (const row of ledger) {
    const k = `${row.ticket_id}|${keyOf(row.item_id, row.variation_id)}`
    ;(groups.get(k) ?? groups.set(k, []).get(k)!).push(row)
  }

  for (const [k, rows] of groups) {
    const [ticketId] = k.split('|')
    const { item_id: itemId, variation_id: variationId } = rows[0]
    const item = itemById.get(itemId)
    const variation = variationId ? variationById.get(variationId) : null
    const label = `${item?.name ?? 'Item'}${variation ? ` (${variation.name})` : ''}`

    // LOST — charged once at cost, never a rental accrual.
    const lostQty = rows.filter((r) => r.event_type === 'lost').reduce((s, r) => s + r.qty, 0)
    if (lostQty > 0) {
      const costCents = (item?.costCents ?? 0) + (variation?.costAdjCents ?? 0)
      lines.push({
        ...lostLine({ description: `${label} — lost/stolen`, itemCode: item?.code ?? '', variation: variation?.name ?? null, qty: lostQty, costCents }),
        ticketId, itemId, variationId, lotDate: null,
      })
    }

    const cadence = cadenceFor.get(k)
    if (!cadence) {
      if (rows.some((r) => r.event_type === 'pickup')) {
        warnings.push(`Ticket ${ticketNumber.get(ticketId)}: ${item?.code ?? 'an item'} has no billing type set, so its rental wasn't billed.`)
      }
      continue
    }

    // A by-cadence item is priced under its cadence; a single-rate item under 'flat'. The
    // cadence still sets the accrual PERIOD in both cases — a single-rate cone metered
    // daily bills its one flat rate per day.
    const unitRateCents = rates.get(rateKeyOf(itemId, variationId, cadence)) ?? rates.get(rateKeyOf(itemId, variationId, 'flat'))
    if (unitRateCents == null) {
      warnings.push(`Ticket ${ticketNumber.get(ticketId)}: no price-list rate for ${item?.code ?? 'an item'} (looked for ${cadence} and flat) — not billed.`)
      continue
    }

    const events: LedgerEvent[] = rows.map((r) => ({ date: r.event_date, type: r.event_type, qty: r.qty }))
    let batches
    try {
      batches = buildBatches(events)
    } catch (e) {
      warnings.push(`Ticket ${ticketNumber.get(ticketId)}: ${item?.code ?? 'an item'} ledger doesn't balance (${(e as Error).message}) — not billed.`)
      continue
    }

    // A DTC is a one-day charge: the equipment never goes on rent, so bill the pickup day
    // and nothing more. Everything else accrues per lot until it comes back.
    const alreadyBilled: AccrualLedger = {}
    for (const b of batches) {
      const prior = billedSoFar.get(`${ticketId}|${keyOf(itemId, variationId)}|${b.start}`)
      if (prior != null) alreadyBilled[b.start] = prior
    }

    const plan = accrualPlan({ batches, asOf: throughDate, billingType: cadence, alreadyBilled })

    for (const row of plan.chargeable) {
      const qtyUnits = isDtc.get(ticketId)
        ? rows.filter((r) => r.event_type === 'pickup' && r.event_date === row.start).reduce((s, r) => s + r.qty, 0)
        : row.qtyUnitsToBill
      if (qtyUnits <= 0) continue

      lines.push({
        ...rentalLine({
          description: `${label} — ${cadence} rental from ${row.start}`,
          itemCode: item?.code ?? '',
          variation: variation?.name ?? null,
          qty: qtyUnits,
          units: 1, // qty-units are already qty x periods
          unitRateCents,
        }),
        ticketId, itemId, variationId, lotDate: row.start,
      })
      accruals.push({
        ticketId, itemId, variationId, lotDate: row.start,
        qtyUnitsBilled: (billedSoFar.get(`${ticketId}|${keyOf(itemId, variationId)}|${row.start}`) ?? 0) + qtyUnits,
      })
    }

    for (const over of plan.rows.filter((r) => r.qtyUnitsToBill < 0)) {
      warnings.push(`Ticket ${ticketNumber.get(ticketId)}: ${item?.code ?? 'an item'} was over-billed by ${-over.qtyUnitsToBill} unit(s) on the ${over.start} lot — a date or quantity was changed after invoicing. Needs a credit.`)
    }
  }

  // ── one-time CHARGE lines off the tickets ─────────────────────────────────
  const { data: chargeRows } = await supabase
    .from('billing_ticket_lines')
    .select('id, ticket_id, kind, item_id, variation_id, description, qty, units, unit_rate_cents, taxable, billing_items(code, category)')
    .in('ticket_id', billableIds)
  const charges = (chargeRows ?? []) as unknown as {
    id: string; ticket_id: string; kind: string; item_id: string | null; variation_id: string | null
    description: string; qty: number; units: number; unit_rate_cents: number | null; taxable: boolean
    billing_items: { code: string; category: string } | null
  }[]

  // Already invoiced? A ticket's non-rental lines bill exactly once.
  const { data: priorLines } = await supabase
    .from('billing_invoice_lines')
    .select('ticket_id, kind, billing_invoices!inner(status)')
    .in('ticket_id', billableIds)
    .neq('kind', 'rental')
  const alreadyCharged = new Set(
    ((priorLines ?? []) as unknown as { ticket_id: string | null; kind: string; billing_invoices: { status: string } | null }[])
      .filter((l) => l.billing_invoices?.status !== 'void')
      .map((l) => `${l.ticket_id}|${l.kind}`)
  )

  // Labor / lump sum carry no stored rate — price them from the list, same as the ticket.
  const needsRate = charges.filter((c) => c.unit_rate_cents == null && c.item_id && c.billing_items?.category)
  const chargeRates = await resolveCompiledRates(supabase, {
    profileId: job.profileId,
    entityId: job.entityId,
    requests: needsRate.map((c) => ({
      itemId: c.item_id as string, variationId: c.variation_id,
      category: c.billing_items!.category as 'Labor' | 'Lump Sum' | 'Misc' | 'Equipment' | 'Sale',
      rateKey: 'flat' as RateKey,
    })),
  })

  for (const c of charges) {
    if (alreadyCharged.has(`${c.ticket_id}|${c.kind}`)) continue
    const unitRateCents = c.unit_rate_cents ?? (c.item_id ? chargeRates.get(rateKeyOf(c.item_id, c.variation_id, 'flat')) ?? null : null)
    if (unitRateCents == null) {
      warnings.push(`Ticket ${ticketNumber.get(c.ticket_id)}: "${c.description}" has no price-list rate — not billed.`)
      continue
    }
    const qty = Number(c.qty)
    lines.push({
      kind: c.kind as DraftLine['kind'],
      description: c.description,
      itemCode: c.billing_items?.code,
      variation: null,
      qty,
      units: c.units,
      unitRateCents,
      amountCents: Math.round(qty * c.units * unitRateCents),
      ticketId: c.ticket_id, itemId: c.item_id, variationId: c.variation_id, lotDate: null,
    })
  }

  if (lines.length === 0) {
    throw new InvoiceBuildError(
      warnings.length > 0
        ? `Nothing billable as of ${throughDate}. ${warnings[0]}`
        : `Nothing new to bill on this job as of ${throughDate}.`
    )
  }

  const built = buildInvoice(lines, {
    taxRatePct,
    rentalMinimumCents: profile?.rental_minimum_cents ?? DEFAULT_INVOICE_OPTIONS.rentalMinimumCents,
    applyRentalMinimum: profile?.rental_minimum_enabled ?? DEFAULT_INVOICE_OPTIONS.applyRentalMinimum,
  })

  // buildInvoice may append the rental-minimum adjustment; carry the identity columns.
  const draftLines: DraftLine[] = built.lines.map((l) => {
    const src = lines.find((d) => d === l) as DraftLine | undefined
    return src ?? { ...l, ticketId: null, itemId: null, variationId: null, lotDate: null }
  })

  return { job, throughDate, taxRatePct, lines: draftLines, totals: built.totals, accruals, warnings }
}
