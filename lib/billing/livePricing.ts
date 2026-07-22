import type { createServiceClient } from '@/lib/supabase/server'
import type { BillingItemCategory, RateKey } from '@/lib/supabase/database.types'

/**
 * Resolving a price-list rate for a real (item, variation) at billing time.
 *
 * This reads the COMPILED `billing_price_list_rates` — the same explicit grid the
 * price-list editor writes on save — rather than recomputing the tier cascade. One
 * source of truth, so a ticket, a proof and an invoice can never disagree.
 *
 * Precedence (matches the engine's documented order):
 *   profile's per-entity config -> price list + tier for the item's CATEGORY
 *   -> that item's row on the list (a tierException overrides the category tier)
 *   -> compiled rate at (item, variation, tier, rateKey).
 *
 * The variation is the priced unit: when an item has variations its rates are stored
 * per variation, so a request naming one resolves against that variation's grid and a
 * request without one resolves against the item's own. Anything unconfigured comes back
 * null — an honest "no rate", never a guessed number.
 */

type Client = ReturnType<typeof createServiceClient>

export interface RateRequest {
  itemId: string
  variationId: string | null
  /** Decides which price list + tier apply. */
  category: BillingItemCategory
  /** 'flat' for charge/single-rate items, else the rental cadence. */
  rateKey: RateKey
}

/** Key a resolved rate by exactly what identified it. */
export const rateKeyOf = (itemId: string, variationId: string | null, rateKey: RateKey) =>
  `${itemId}|${variationId ?? ''}|${rateKey}`

/**
 * Batch-resolve rates. One set of queries for the whole request list — never per line.
 * Returns cents keyed by `rateKeyOf(...)`; a missing entry means unpriced.
 */
export async function resolveCompiledRates(
  supabase: Client,
  params: { profileId: string; entityId: string; requests: RateRequest[] }
): Promise<Map<string, number>> {
  const { profileId, entityId, requests } = params
  const out = new Map<string, number>()
  if (requests.length === 0) return out

  // 1. The profile's config for this entity.
  const { data: pe } = await supabase
    .from('billing_profile_entities')
    .select('id, enabled')
    .eq('profile_id', profileId)
    .eq('entity_id', entityId)
    .maybeSingle()
  if (!pe || !pe.enabled) return out

  // 2. Price list + tier per category.
  const { data: catTiers } = await supabase
    .from('billing_profile_entity_category_tiers')
    .select('category, price_list_id, tier_id')
    .eq('profile_entity_id', pe.id)
  const byCategory = new Map<string, { priceListId: string; tierId: string }>()
  for (const c of (catTiers ?? []) as { category: string; price_list_id: string; tier_id: string }[]) {
    byCategory.set(c.category, { priceListId: c.price_list_id, tierId: c.tier_id })
  }
  if (byCategory.size === 0) return out

  // 3. The price-list rows for every item we were asked about.
  const itemIds = [...new Set(requests.map((r) => r.itemId))]
  const priceListIds = [...new Set([...byCategory.values()].map((v) => v.priceListId))]
  const { data: plis } = await supabase
    .from('billing_price_list_items')
    .select('id, price_list_id, item_id, tier_exception_tier_id')
    .in('price_list_id', priceListIds)
    .in('item_id', itemIds)
  const pliByListItem = new Map<string, { id: string; tierExceptionTierId: string | null }>()
  for (const p of (plis ?? []) as { id: string; price_list_id: string; item_id: string; tier_exception_tier_id: string | null }[]) {
    pliByListItem.set(`${p.price_list_id}|${p.item_id}`, { id: p.id, tierExceptionTierId: p.tier_exception_tier_id })
  }
  if (pliByListItem.size === 0) return out

  // 4. Every compiled rate for those price-list items, in one read.
  const pliIds = [...pliByListItem.values()].map((p) => p.id)
  const { data: rates } = await supabase
    .from('billing_price_list_rates')
    .select('price_list_item_id, variation_id, tier_id, billing_type, rate_cents')
    .in('price_list_item_id', pliIds)
  const compiled = new Map<string, number>()
  for (const r of (rates ?? []) as { price_list_item_id: string; variation_id: string | null; tier_id: string; billing_type: RateKey; rate_cents: number }[]) {
    compiled.set(`${r.price_list_item_id}|${r.variation_id ?? ''}|${r.tier_id}|${r.billing_type}`, r.rate_cents)
  }

  // 5. Resolve each request.
  for (const req of requests) {
    const cat = byCategory.get(req.category)
    if (!cat) continue
    const pli = pliByListItem.get(`${cat.priceListId}|${req.itemId}`)
    if (!pli) continue
    const tierId = pli.tierExceptionTierId ?? cat.tierId
    const cents = compiled.get(`${pli.id}|${req.variationId ?? ''}|${tierId}|${req.rateKey}`)
    if (cents == null) continue
    out.set(rateKeyOf(req.itemId, req.variationId, req.rateKey), cents)
  }

  return out
}

// ── Ticket live pricing (Labor / Lump Sum lines) ─────────────────────────────

export interface LineToPrice {
  id: string
  itemId: string | null
  category: BillingItemCategory | null
  qty: number
  units: number
}

export interface ResolvedLinePrice {
  unitRateCents: number | null
  amountCents: number | null
}

/**
 * Rates for item-priced ticket lines, so the ticket shows the real number instead of
 * "from price list". Labor/Lump-Sum lines are variation-less (only sales carry one) and
 * price the flat key.
 */
export async function resolveItemLineRates(
  supabase: Client,
  params: { profileId: string; entityId: string; lines: LineToPrice[] }
): Promise<Map<string, ResolvedLinePrice>> {
  const { profileId, entityId, lines } = params
  const out = new Map<string, ResolvedLinePrice>()
  const NONE: ResolvedLinePrice = { unitRateCents: null, amountCents: null }
  for (const l of lines) out.set(l.id, NONE)

  const priceable = lines.filter((l) => l.itemId && l.category)
  if (priceable.length === 0) return out

  const rates = await resolveCompiledRates(supabase, {
    profileId,
    entityId,
    requests: priceable.map((l) => ({
      itemId: l.itemId as string,
      variationId: null,
      category: l.category as BillingItemCategory,
      rateKey: 'flat' as RateKey,
    })),
  })

  for (const l of priceable) {
    const cents = rates.get(rateKeyOf(l.itemId as string, null, 'flat'))
    if (cents == null) continue
    out.set(l.id, { unitRateCents: cents, amountCents: Math.round(l.qty * l.units * cents) })
  }
  return out
}
