import { createServiceClient } from '@/lib/supabase/server'

/**
 * On-rent balances — THE definition of "what's still out".
 *
 * On-rent is a property of the **JOB, not the ticket**. Equipment goes out on an Add
 * ticket and comes back on a *separate* Return ticket, so anything scoped to one ticket
 * can never see the other half and gets the answer wrong. (This is exactly the bug that
 * made returns impossible: a Return ticket has no pickups of its own, so a ticket-scoped
 * balance was always 0 and every return was rejected with "Only 0 on rent".)
 *
 * **DTC rows are excluded.** On a DTC the equipment is billed for that day only — it
 * never goes on rent, and nothing ever returns it, so counting it would inflate the
 * pool forever.
 *
 * That exclusion is also the DTC → Add conversion: when the office flips a ticket from
 * DTC to Add, its rows stop being excluded and enter the on-rent pool automatically.
 * No rows are rewritten. The conversion and the exclusion are the same mechanism.
 */

export interface LedgerRow {
  id: string
  item_id: string
  variation_id: string | null
  event_type: string
  qty: number
  /** True when the row's ticket is a DTC — a day charge, never on rent. */
  ticketIsDtc: boolean
  /** True when the row's ticket is voided — it counts toward nothing at all. */
  ticketVoided: boolean
}

/** Balances are per (item, variation) — a variation is a distinct thing to hand back. */
export const onRentKey = (itemId: string, variationId: string | null): string =>
  `${itemId}|${variationId ?? ''}`

/**
 * On-rent balance per (item, variation) for a job.
 *
 * `override` substitutes a hypothetical qty for one row — used when EDITING a ledger
 * entry, to ask "would this change drive the balance negative?" without writing first.
 */
export function balanceFrom(
  rows: LedgerRow[],
  override?: { id: string; qty: number }
): Map<string, number> {
  const bal = new Map<string, number>()
  for (const r of rows) {
    if (r.ticketVoided) continue // a voided ticket counts toward nothing
    if (r.ticketIsDtc) continue // DTC equipment is never on rent
    const qty = override && override.id === r.id ? override.qty : r.qty
    const key = onRentKey(r.item_id, r.variation_id)
    bal.set(key, (bal.get(key) ?? 0) + (r.event_type === 'pickup' ? qty : -qty))
  }
  return bal
}

type SB = ReturnType<typeof createServiceClient>

interface RawRow {
  id: string
  item_id: string
  variation_id: string | null
  event_type: string
  qty: number
  billing_tickets: { feature_dtc: boolean; is_voided: boolean } | null
}

/** Every ledger row on a job, each tagged with whether its ticket is a DTC or voided. */
export async function fetchJobLedger(supabase: SB, jobId: string): Promise<LedgerRow[]> {
  const { data, error } = await supabase
    .from('billing_ticket_ledger')
    .select('id, item_id, variation_id, event_type, qty, billing_tickets(feature_dtc, is_voided)')
    .eq('job_id', jobId)
  if (error) throw new Error(error.message)
  const rows = (data ?? []) as unknown as RawRow[]
  return rows.map((r) => ({
    id: r.id,
    item_id: r.item_id,
    variation_id: r.variation_id,
    event_type: r.event_type,
    qty: r.qty,
    ticketIsDtc: r.billing_tickets?.feature_dtc ?? false,
    ticketVoided: r.billing_tickets?.is_voided ?? false,
  }))
}

/** Convenience: the on-rent qty for one (item, variation) on a job. */
export async function onRentFor(
  supabase: SB,
  jobId: string,
  itemId: string,
  variationId: string | null
): Promise<number> {
  const bal = balanceFrom(await fetchJobLedger(supabase, jobId))
  return bal.get(onRentKey(itemId, variationId)) ?? 0
}
