/**
 * Price-list grid compiler — the bridge between the AUTHORING inputs and the
 * explicit STORAGE grid.
 *
 * Mason's decision: `billing_price_list_rates` (item x tier x billing type) is
 * the source of truth that pricing reads. The ergonomic controls the prototype
 * had — % off the previous tier, "freeze after tier N", and sticky per-cell
 * overrides — are authoring inputs that COMPILE into that grid.
 *
 * This module does the compile against database-shaped rows. It deliberately
 * delegates the actual math to `buildTierGrid` so the app and the unit-tested
 * engine can never drift apart: there is exactly one implementation of the
 * cascade/freeze/override rules.
 */
import { buildTierGrid } from './tier-grid';
import { ALL_RATE_KEYS, type Cents, type Tier, type RateKey } from './types';

/** A tier row as stored: identified by id, ordered by position. */
export interface CompileTier {
  id: string;
  name: string;
  position: number; // 1 = base tier
  pctOffPrevious: number;
}

/** A sticky locked cell, keyed by tier id (not name). */
export interface CompileOverride {
  tierId: string;
  billingType: RateKey;
  rateCents: Cents;
}

export interface CompileItem {
  priceListItemId: string;
  /** Tier-1 base per rate key. A key with no base is not priced. Equipment prices the
   *  rental cadences; charge items price the single 'flat' key. */
  base: Partial<Record<RateKey, Cents>>;
  /** Hold the price from this tier POSITION onward. */
  freezeAfterPosition?: number | null;
  overrides?: CompileOverride[];
}

/** Exactly the shape of a `billing_price_list_rates` row. */
export interface CompiledRate {
  price_list_item_id: string;
  tier_id: string;
  billing_type: RateKey;
  rate_cents: Cents;
}

export class CompileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CompileError';
  }
}

export function compilePriceListRates(tiers: CompileTier[], items: CompileItem[]): CompiledRate[] {
  if (tiers.length === 0) throw new CompileError('Price list has no tiers');

  const ordered = [...tiers].sort((a, b) => a.position - b.position);

  const seenPos = new Set<number>();
  const seenName = new Set<string>();
  for (const t of ordered) {
    if (seenPos.has(t.position)) throw new CompileError(`Duplicate tier position ${t.position}`);
    if (seenName.has(t.name)) throw new CompileError(`Duplicate tier name "${t.name}"`);
    seenPos.add(t.position);
    seenName.add(t.name);
  }

  // buildTierGrid keys tiers by NAME; the database keys them by id.
  const engineTiers: Tier[] = ordered.map((t) => ({ name: t.name, pctOffPrevious: t.pctOffPrevious }));
  const tierIdToName = new Map(ordered.map((t) => [t.id, t.name]));

  const rows: CompiledRate[] = [];

  for (const item of items) {
    // position -> index. An unknown/absent position means "no freeze".
    const freezeIdx =
      item.freezeAfterPosition == null
        ? null
        : (() => {
            const i = ordered.findIndex((t) => t.position === item.freezeAfterPosition);
            return i === -1 ? null : i;
          })();

    // Re-key sticky overrides from tier id to tier name for the engine.
    const overrides: Record<string, Partial<Record<RateKey, Cents>>> = {};
    for (const o of item.overrides ?? []) {
      const name = tierIdToName.get(o.tierId);
      if (!name) throw new CompileError(`Override references tier ${o.tierId}, which is not in this price list`);
      (overrides[name] ??= {})[o.billingType] = o.rateCents;
    }

    const grid = buildTierGrid(
      { code: item.priceListItemId, base: item.base, freezeAfterTierIndex: freezeIdx, overrides },
      engineTiers
    );

    for (const t of ordered) {
      // Every key: an item only has a base for the ones its category prices, so
      // equipment never compiles a 'flat' cell and a charge item never compiles cadences.
      for (const bt of ALL_RATE_KEYS) {
        const rate = grid[t.name]?.[bt];
        if (rate == null) continue; // this item isn't priced under this billing type
        rows.push({
          price_list_item_id: item.priceListItemId,
          tier_id: t.id,
          billing_type: bt,
          rate_cents: rate,
        });
      }
    }
  }

  return rows;
}
