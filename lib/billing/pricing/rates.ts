/**
 * Rate resolution.
 *
 * Spec precedence:  PriceItemTierException -> CategoryTierRule -> Catalog default
 *
 *   - The profile's per-entity config picks a price list AND a tier per item
 *     category (CategoryTierRule).
 *   - A price-list item may carry a tierException that ignores the category rule.
 *   - If the price list prices no cell for (item, tier, rateKey), we fall
 *     back to the catalog's default rate.
 *
 * The variation is the priced unit. When an item has variations, the rate comes from
 * THAT variation's grid — the bare item isn't priced. When it has none, the item's own
 * grid is used and the variation name is irrelevant.
 *
 * Single-rate items price one rate — the 'flat' key — regardless of the requested
 * cadence; the tier cascade still applies.
 *
 * Returns the provenance too, because "why is this line $148?" is a question
 * billers ask every week and the answer must be inspectable.
 */
import { buildTierGrid } from './tier-grid';
import { FLAT_RATE } from './types';
import type { BillingType, Cents, Item, PriceList, PriceListItem, RateGrid, RateKey, ProfileEntityConfig } from './types';

export interface ResolvedRate {
  unitRateCents: Cents;
  tierUsed: string;
  /** The rate key actually looked up — 'flat' for a single-rate item, else the cadence. */
  rateKeyUsed: RateKey;
  source: 'price_list' | 'catalog';
  /** true when the item's tierException bypassed the category tier rule */
  usedTierException: boolean;
  /** The variation whose grid priced this, or null when the item has no variations. */
  variationUsed: string | null;
}

export class RateNotFoundError extends Error {
  constructor(itemCode: string, rateKey: RateKey, tier: string) {
    super(`No rate for item "${itemCode}" at tier "${tier}" for "${rateKey}" (and no catalog default)`);
    this.name = 'RateNotFoundError';
  }
}

export class VariationRequiredError extends Error {
  constructor(itemCode: string) {
    super(`Item "${itemCode}" has variations, so a variation must be given to price it`);
    this.name = 'VariationRequiredError';
  }
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

  // A single-rate item is priced under the flat key no matter which cadence was asked for.
  const rateKeyUsed: RateKey = pli?.singleRate ? FLAT_RATE : billingType;

  // The variation is the priced unit when the item has them. Pick the grid to build from.
  let variationUsed: string | null = null;
  let grid: RateGrid | undefined;
  if (pli) {
    const hasVariations = pli.variations && Object.keys(pli.variations).length > 0;
    if (hasVariations) {
      if (!variationName) throw new VariationRequiredError(item.code);
      grid = pli.variations![variationName]; // may be undefined if this variation isn't priced
      variationUsed = variationName;
    } else {
      grid = pli; // the item's own grid (PriceListItem satisfies RateGrid)
    }
  }

  let baseRateCents: Cents | undefined;
  let source: ResolvedRate['source'] = 'price_list';

  if (grid) {
    const compiled = buildTierGrid(
      { code: `${item.code}#${variationUsed ?? ''}`, base: grid.base, freezeAfterTierIndex: pli?.freezeAfterTierIndex ?? null, overrides: grid.overrides },
      priceList.tiers
    );
    baseRateCents = compiled[tierUsed]?.[rateKeyUsed];
  }
  if (baseRateCents == null && !pli?.singleRate) {
    // Catalog defaults are cadence-keyed, so only a by-cadence item can fall back to them.
    baseRateCents = item.defaultRates[billingType];
    source = 'catalog';
  }
  if (baseRateCents == null) throw new RateNotFoundError(item.code, rateKeyUsed, tierUsed);

  return { unitRateCents: baseRateCents, tierUsed, rateKeyUsed, source, usedTierException, variationUsed };
}
