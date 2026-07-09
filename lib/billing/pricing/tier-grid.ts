/**
 * Tier-grid compiler.
 *
 * Resolves the spec/prototype conflict: the STORAGE model is an explicit
 * (item x tier x billing type) rate grid. The prototype's ergonomic authoring
 * controls — % off the previous tier, "freeze after tier N", and sticky
 * per-cell overrides — are inputs that COMPILE into that grid here.
 *
 * Precedence within a cell (highest first):
 *   1. sticky override  (locked value; never recomputes)
 *   2. freeze           (hold the previous tier's price, no further discount)
 *   3. cascade          (pctOffPrevious applied to the previous tier's value)
 *
 * Later tiers always cascade off the PREVIOUS RESOLVED value — so a sticky
 * override re-bases everything after it, which is what "later tiers cascade
 * off it" means in the prototype.
 */
import { ALL_BILLING_TYPES, type BillingType, type Cents, type PriceListItem, type Tier, type TierGrid } from './types';

/** Money rounding happens once, per cell, on integer cents. */
const roundCents = (n: number): Cents => Math.round(n);

export function buildTierGrid(item: PriceListItem, tiers: Tier[]): TierGrid {
  if (tiers.length === 0) throw new Error('Price list has no tiers');
  const grid: TierGrid = {};
  for (const t of tiers) grid[t.name] = {};

  const freezeIdx = item.freezeAfterTierIndex ?? null;

  for (const bt of ALL_BILLING_TYPES) {
    const base = item.base[bt];
    if (base == null) continue; // this item isn't rented under this billing type

    let prev: Cents | null = null;

    tiers.forEach((tier, i) => {
      const override = item.overrides?.[tier.name]?.[bt];

      let value: Cents;
      if (override != null) {
        value = override; // sticky: wins over cascade and freeze
      } else if (i === 0) {
        value = base;
      } else if (freezeIdx != null && i > freezeIdx) {
        value = prev as Cents; // frozen: hold, no further discount
      } else {
        const pct = tier.pctOffPrevious || 0;
        value = roundCents((prev as Cents) * (1 - pct / 100));
      }

      grid[tier.name][bt] = value;
      prev = value; // later tiers cascade off the resolved (possibly overridden) value
    });
  }

  return grid;
}

/** Convenience: read one cell, or undefined if the list doesn't price it. */
export function gridCell(grid: TierGrid, tierName: string, bt: BillingType): Cents | undefined {
  return grid[tierName]?.[bt];
}
