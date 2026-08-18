import { describe, it, expect } from 'vitest'
import { buildJobInvoice, InvoiceBuildError } from './invoicing'

/**
 * End-to-end verification of the invoice builder with a mocked database. This is money
 * code — the engine math is unit-tested elsewhere; here we prove the ORCHESTRATION:
 * cadence grouping, the accrual delta (no double-billing), the DTC one-day rule, lost at
 * cost, live labor pricing, and the rental minimum.
 */

// A query stub: chainable filters that are ignored (each table's preset already holds
// exactly the rows its one query wants), awaitable to {data,error}, plus maybeSingle().
class Q {
  constructor(private rows: unknown[]) {}
  select() { return this }
  eq() { return this }
  in() { return this }
  lte() { return this }
  gte() { return this }
  neq() { return this }
  not() { return this }
  is() { return this }
  order() { return this }
  maybeSingle() { return Promise.resolve({ data: this.rows[0] ?? null, error: null }) }
  single() { return Promise.resolve({ data: this.rows[0] ?? null, error: null }) }
  then(res: (v: { data: unknown[]; error: null }) => unknown) { return Promise.resolve({ data: this.rows, error: null }).then(res) }
}
const mockClient = (data: Record<string, unknown[]>) =>
  ({ from: (table: string) => new Q(data[table] ?? []) }) as never

// ── shared world ─────────────────────────────────────────────────────────────
const JOB = [{ id: 'job1', job_number: 'J-1', name: 'Test', profile_id: 'prof1', entity_id: 'ent1', branch_id: 'br1', tax_exempt: false }]
const PROFILE = [{ rental_minimum_enabled: true, rental_minimum_cents: 2500 }]
const ITEMS = [{ id: 'cone', code: 'CONE', name: 'Cone', cost_cents: 500 }]
// price resolution: Equipment daily 200, Labor flat 7500
const PE = [{ id: 'pe1', enabled: true }]
const CAT_TIERS = [
  { category: 'Equipment', price_list_id: 'pl1', tier_id: 'tier1' },
  { category: 'Labor', price_list_id: 'pl1', tier_id: 'tier1' },
]
const PLIS = [
  { id: 'pli-cone', price_list_id: 'pl1', item_id: 'cone', tier_exception_tier_id: null },
  { id: 'pli-labor', price_list_id: 'pl1', item_id: 'labor', tier_exception_tier_id: null },
]
const RATES = [
  { price_list_item_id: 'pli-cone', variation_id: null, tier_id: 'tier1', billing_type: 'daily', rate_cents: 200 },
  { price_list_item_id: 'pli-labor', variation_id: null, tier_id: 'tier1', billing_type: 'flat', rate_cents: 7500 },
]

const base = (over: Record<string, unknown[]>) => mockClient({
  billing_jobs: JOB,
  billing_profiles: PROFILE,
  billing_items: ITEMS,
  billing_item_variations: [],
  billing_profile_entities: PE,
  billing_profile_entity_category_tiers: CAT_TIERS,
  billing_price_list_items: PLIS,
  billing_price_list_rates: RATES,
  billing_invoice_lines: [],
  billing_rental_accruals: [],
  billing_ticket_lines: [],
  ...over,
})

describe('buildJobInvoice — orchestration', () => {
  it('bills a fresh rental + labor, applies the rental minimum, and records accruals', async () => {
    const client = base({
      billing_tickets: [{ id: 't1', ticket_number: 'T-1', status: 'final_edit', feature_dtc: false }],
      billing_ticket_ledger: [
        { ticket_id: 't1', item_id: 'cone', variation_id: null, event_type: 'pickup', event_date: '2026-01-01', qty: 10, billing_type: 'daily' },
      ],
      billing_ticket_lines: [
        { id: 'l1', ticket_id: 't1', kind: 'labor', item_id: 'labor', variation_id: null, description: '1 Man Crew', qty: 1, units: 1, unit_rate_cents: null, taxable: false, billing_items: { code: 'CREW', category: 'Labor' } },
      ],
    })

    const d = await buildJobInvoice(client, { jobId: 'job1', throughDate: '2026-01-01', taxRatePct: 0 })

    const rental = d.lines.find((l) => l.kind === 'rental')!
    expect(rental.itemId).toBe('cone')
    expect(rental.qty).toBe(10)            // 10 cones × 1 day
    expect(rental.unitRateCents).toBe(200)
    expect(rental.amountCents).toBe(2000)

    const labor = d.lines.find((l) => l.kind === 'labor')!
    expect(labor.unitRateCents).toBe(7500) // priced live from the list
    expect(labor.amountCents).toBe(7500)

    expect(d.totals.rentalSubtotalCents).toBe(2000)
    expect(d.totals.rentalMinimumAdjustmentCents).toBe(500) // topped up to $25
    expect(d.totals.otherSubtotalCents).toBe(7500)
    expect(d.totals.subtotalCents).toBe(10000)             // 2000 + 500 + 7500
    expect(d.totals.taxCents).toBe(0)
    expect(d.totals.totalCents).toBe(10000)

    // the accrual it would commit: the full 10 qty-units for that lot
    expect(d.accruals).toEqual([{ ticketId: 't1', itemId: 'cone', variationId: null, lotDate: '2026-01-01', qtyUnitsBilled: 10 }])
    expect(d.warnings).toEqual([])
  })

  it('re-running bills nothing new — the accrual delta prevents double-billing', async () => {
    const client = base({
      billing_tickets: [{ id: 't1', ticket_number: 'T-1', status: 'invoiced', feature_dtc: false }],
      billing_ticket_ledger: [
        { ticket_id: 't1', item_id: 'cone', variation_id: null, event_type: 'pickup', event_date: '2026-01-01', qty: 10, billing_type: 'daily' },
      ],
      // already billed 10 qty-units for this lot
      billing_rental_accruals: [{ ticket_id: 't1', item_id: 'cone', variation_id: null, lot_date: '2026-01-01', qty_units_billed: 10 }],
      // and the labor already sits on a non-void invoice
      billing_ticket_lines: [
        { id: 'l1', ticket_id: 't1', kind: 'labor', item_id: 'labor', variation_id: null, description: '1 Man Crew', qty: 1, units: 1, unit_rate_cents: null, taxable: false, billing_items: { code: 'CREW', category: 'Labor' } },
      ],
      billing_invoice_lines: [{ ticket_id: 't1', kind: 'labor', billing_invoices: { status: 'issued' } }],
    })

    await expect(buildJobInvoice(client, { jobId: 'job1', throughDate: '2026-01-01' })).rejects.toBeInstanceOf(InvoiceBuildError)
  })

  it('a DTC bills the pickup day only, never accruing across the window', async () => {
    const client = base({
      billing_tickets: [{ id: 't1', ticket_number: 'T-1', status: 'final_edit', feature_dtc: true }],
      billing_ticket_ledger: [
        { ticket_id: 't1', item_id: 'cone', variation_id: null, event_type: 'pickup', event_date: '2026-01-01', qty: 4, billing_type: 'daily' },
      ],
    })
    // three days later: a normal rental would bill 4×3=12; a DTC bills 4 (one day).
    const d = await buildJobInvoice(client, { jobId: 'job1', throughDate: '2026-01-03', taxRatePct: 0 })
    const rental = d.lines.find((l) => l.kind === 'rental')!
    expect(rental.qty).toBe(4)
    expect(rental.amountCents).toBe(800)
  })

  it('a DTC bills daily even when the row carries no billing type', async () => {
    // DTC never asks for a cadence, so its rows can have a null billing_type. The engine
    // must still bill them at the daily rate for the one day — not warn/skip.
    const client = base({
      billing_tickets: [{ id: 't1', ticket_number: 'T-1', status: 'final_edit', feature_dtc: true }],
      billing_ticket_ledger: [
        { ticket_id: 't1', item_id: 'cone', variation_id: null, event_type: 'pickup', event_date: '2026-01-01', qty: 4, billing_type: null },
      ],
    })
    const d = await buildJobInvoice(client, { jobId: 'job1', throughDate: '2026-01-03', taxRatePct: 0 })
    const rental = d.lines.find((l) => l.kind === 'rental')!
    expect(rental.qty).toBe(4)          // one day only, forced daily
    expect(rental.amountCents).toBe(800)
    expect(d.warnings).toEqual([])      // NOT "no billing type set — not billed"
  })

  it('bills a lost unit at cost, untaxed', async () => {
    const client = base({
      billing_tickets: [{ id: 't1', ticket_number: 'T-1', status: 'final_edit', feature_dtc: false }],
      billing_ticket_ledger: [
        { ticket_id: 't1', item_id: 'cone', variation_id: null, event_type: 'pickup', event_date: '2026-01-01', qty: 5, billing_type: 'daily' },
        { ticket_id: 't1', item_id: 'cone', variation_id: null, event_type: 'lost', event_date: '2026-01-02', qty: 2, billing_type: null },
      ],
    })
    const d = await buildJobInvoice(client, { jobId: 'job1', throughDate: '2026-01-02', taxRatePct: 0 })
    const lost = d.lines.find((l) => l.kind === 'lost')!
    expect(lost.qty).toBe(2)
    expect(lost.unitRateCents).toBe(500)   // item cost
    expect(lost.amountCents).toBe(1000)
    // lost is never taxed — the persist layer sets taxable only for sale lines.
  })

  it('bills a SINGLE-RATE item from its flat rate, metered at the pickup cadence', async () => {
    // A barricade priced single-rate: the price list holds a 'flat' rate, NOT a daily one.
    const client = base({
      billing_price_list_rates: [
        { price_list_item_id: 'pli-cone', variation_id: null, tier_id: 'tier1', billing_type: 'flat', rate_cents: 300 },
      ],
      billing_tickets: [{ id: 't1', ticket_number: 'T-1', status: 'final_edit', feature_dtc: false }],
      billing_ticket_ledger: [
        // metered daily on the ticket, but the item is single-rate
        { ticket_id: 't1', item_id: 'cone', variation_id: null, event_type: 'pickup', event_date: '2026-01-01', qty: 5, billing_type: 'daily' },
      ],
    })
    const d = await buildJobInvoice(client, { jobId: 'job1', throughDate: '2026-01-03', taxRatePct: 0 })
    const rental = d.lines.find((l) => l.kind === 'rental')!
    expect(rental.unitRateCents).toBe(300)   // resolved from 'flat', not a missing 'daily'
    expect(rental.qty).toBe(15)              // 5 units × 3 days (cadence sets the period)
    expect(rental.amountCents).toBe(4500)
    expect(d.warnings).toEqual([])           // NOT "no daily rate — not billed"
  })

  it('warns instead of silently zeroing when a pickup has no billing type', async () => {
    const client = base({
      billing_tickets: [{ id: 't1', ticket_number: 'T-1', status: 'final_edit', feature_dtc: false }],
      billing_ticket_ledger: [
        { ticket_id: 't1', item_id: 'cone', variation_id: null, event_type: 'pickup', event_date: '2026-01-01', qty: 3, billing_type: null },
      ],
    })
    await expect(buildJobInvoice(client, { jobId: 'job1', throughDate: '2026-01-01' })).rejects.toThrow(/Nothing billable/)
  })
})
