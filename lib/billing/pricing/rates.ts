/**
 * Rate resolution.
 *
 * Spec precedence:  PriceItemTierException -> CategoryTierRule -> Catalog default
 *
 *   - The profile's per-entity config picks a price list AND a tier per item
 *     category (CategoryTierRule).
 *   - A price-list item may carry a tierException that ignores the category rule.
 *   - If the price list prices no cell for (item, tier, billingType), we fall
 *     back to the catalog's default rate.
 *
 * Variation adjustment is applied LAST, on top of the resolved base rate:
 *   per-price-list variation override -> item's own variation adj -> 0
 *
 * Returns the provenance too, because "why is this line $148?" is a question
 * billers ask every week and the answer must be inspectable.
 */
import { buildTierGrid } from './tier-grid';
import type { BillingType, Cents, Item, PriceList, ProfileEntityConfig } from './types';

export interface ResolvedRate {
  unitRateCents: Cents;
  tierUsed: string;
  baseRateCents: Cents;
  /** The RATE adjustment applied (cost/sale adjustments don't touch a rental). */
  adjCents: Cents;
  source: 'price_list' | 'catalog';
  /** true when the item's tierException bypassed the category tier rule */
  usedTierException: boolean;
}

export class RateNotFoundError extends Error {
  constructor(itemCode: string, bt: BillingType, tier: string) {
    super(`No rate for item "${itemCode}" at tier "${tier}" for billing type "${bt}" (and no catalog default)`);
    this.name = 'RateNotFoundError';
  }
}

/**
 * A variation's RATE adjustment, which lives only on the price list — the item carries
 * no rate adjustment, because a rate isn't a property of an item. No entry means no
 * adjustment; there is no item-level fallback to disagree with the list.
 */
export function resolveVariationAdj(
  item: Item,
  variationName: string | null | undefined,
  priceList: PriceList
): Cents {
  if (!variationName) return 0;
  return priceList.variationOverrides?.[item.code]?.[variationName] ?? 0;
}

export function resolveUnitRate(params: {
  item: Item;
  variationName?: string | null;
  priceList: PriceList;
  config: ProfileEntityConfig;
  billingType: BillingType;
}): ResolvedRate {
  const { item, variationName, priceList, config, billingType } = params;

  if (priceList.entityId !== config.entityId) {
    throw new Error(`Price list ${priceList.id} is for entity ${priceList.entityId}, config is ${config.entityId}`);
  }

  const pli = priceList.items[item.code];
  const categoryTier = config.tierByCategory[item.category];
  const usedTierException = !!pli?.tierException;
  const tierUsed = pli?.tierException ?? categoryTier;

  if (!tierUsed) throw new Error(`No tier configured for category "${item.category}"`);

  let baseRateCents: Cents | undefined;
  let source: ResolvedRate['source'] = 'price_list';

  if (pli) {
    const grid = buildTierGrid(pli, priceList.tiers);
    baseRateCents = grid[tierUsed]?.[billingType];
  }
  if (baseRateCents == null) {
    baseRateCents = item.defaultRates[billingType];
    source = 'catalog';
  }
  if (baseRateCents == null) throw new RateNotFoundError(item.code, billingType, tierUsed);

  const adjCents = resolveVariationAdj(item, variationName, priceList);
  // A variation must never drive a rate negative.
  const unitRateCents = Math.max(0, baseRateCents + adjCents);

  return { unitRateCents, tierUsed, baseRateCents, adjCents, source, usedTierException };
}
