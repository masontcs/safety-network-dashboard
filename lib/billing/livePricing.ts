import type { createServiceClient } from '@/lib/supabase/server'
import type { BillingItemCategory } from '@/lib/supabase/database.types'

/**
 * Live pricing for item-priced ticket lines (Labor / Lump Sum).
 *
 * Those lines store no rate — the price list supplies it. Historically the ticket showed
 * "from price list" and the number only appeared on the proof. This resolves the number
 * NOW, reading the SAME compiled `billing_price_list_rates` the invoice will read, so the
 * office can confirm pricing on the ticket instead of waiting for a proof.
 *
 * Resolution (matches the engine's precedence):
 *   profile's per-entity config -> price list + tier for the item's category
 *   -> the item's row on that list (a tierException overrides the category tier)
 *   -> compiled 'flat' rate at that tier.
 *
 * Anything unconfigured resolves to null — an honest "no rate yet", not a wrong number.
 */

type Client = ReturnType<typeof createServiceClient>

export interface LineToPrice {
  id: string
  itemId: string | null
  /** The item's category — decides which price list + tier apply. */
  category: BillingItemCategory | null
  qty: number
  units: number
}

export interface ResolvedLinePrice {
  unitRateCents: number | null
  amountCents: number | null
}

/**
 * Returns a map of lineId -> resolved rate/amount. Labor/Lump-Sum lines are variation-less
 * (only sales carry a variation), so this prices the item's own grid (variation_id NULL).
 */
export async function resolveItemLineRates(
  supabase: Client,
  params: { profileId: string; entityId: string; lines: LineToPrice[] }
): Promise<Map<string, ResolvedLinePrice>> {
  const { profileId, entityId, lines } = params
  const out = new Map<string, ResolvedLinePrice>()
  const NONE: ResolvedLinePrice = { unitRateCents: null, amountCents: null }

  const priceable = lines.filter((l) => l.itemId && l.category)
  for (const l of lines) out.set(l.id, NONE) // default everything to unresolved
  if (priceable.length === 0) return out

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

  // 3. The price-list rows for the items we need, on the lists their categories point to.
  const itemIds = [...new Set(priceable.map((l) => l.itemId as string))]
  const priceListIds = [...new Set([...byCategory.values()].map((v) => v.priceListId))]
  if (priceListIds.length === 0) return out

  const { data: plis } = await supabase
    .from('billing_price_list_items')
    .select('id, price_list_id, item_id, tier_exception_tier_id')
    .in('price_list_id', priceListIds)
    .in('item_id', itemIds)
  const pliByListItem = new Map<string, { id: string; tierExceptionTierId: string | null }>()
  for (const p of (plis ?? []) as { id: string; price_list_id: string; item_id: string; tier_exception_tier_id: string | null }[]) {
    pliByListItem.set(`${p.price_list_id}|${p.item_id}`, { id: p.id, tierExceptionTierId: p.tier_exception_tier_id })
  }

  // 4. Compiled flat rates for those items, item-grid only (variation_id NULL).
  const pliIds = [...pliByListItem.values()].map((p) => p.id)
  const rateByPliTier = new Map<string, number>()
  if (pliIds.length > 0) {
    const { data: rates } = await supabase
      .from('billing_price_list_rates')
      .select('price_list_item_id, tier_id, rate_cents, variation_id, billing_type')
      .in('price_list_item_id', pliIds)
      .eq('billing_type', 'flat')
      .is('variation_id', null)
    for (const r of (rates ?? []) as { price_list_item_id: string; tier_id: string; rate_cents: number }[]) {
      rateByPliTier.set(`${r.price_list_item_id}|${r.tier_id}`, r.rate_cents)
    }
  }

  // 5. Resolve each line.
  for (const l of priceable) {
    const cat = byCategory.get(l.category as string)
    if (!cat) continue
    const pli = pliByListItem.get(`${cat.priceListId}|${l.itemId}`)
    if (!pli) continue
    const tierId = pli.tierExceptionTierId ?? cat.tierId
    const rate = rateByPliTier.get(`${pli.id}|${tierId}`)
    if (rate == null) continue
    out.set(l.id, { unitRateCents: rate, amountCents: Math.round(l.qty * l.units * rate) })
  }

  return out
}
