/**
 * TCR Billing v2 — core domain types.
 *
 * Money is ALWAYS integer cents. Never floats: `0.1 + 0.2 !== 0.3`, and a billing
 * system that drifts a penny per line is a billing system nobody trusts.
 * Dates are plain 'YYYY-MM-DD' strings, compared as UTC epoch-days (see dates.ts)
 * so a Pacific-time browser can never shift a rental day across a boundary.
 */

/** Integer cents. 2500 === $25.00 */
export type Cents = number;

/** Calendar date, 'YYYY-MM-DD'. No time, no zone. */
export type ISODate = string;

/** Fixed set — every catalog item has exactly one. */
export type ItemCategory = 'Equipment' | 'Labor' | 'Lump Sum' | 'Misc' | 'Sale';

/**
 * The 6 billing types. Per spec there is NO proration/division: each
 * (item x tier x billing type) cell holds an explicitly entered rate.
 *
 * Naming reads as `<rental cadence>_billed_<billing unit>`:
 *  - `rateUnit` = the unit the entered rate is expressed in (what we multiply by)
 *  - `cycle`    = the recurring rental cadence (how often it re-bills)
 */
export type BillingType =
  | 'daily'
  | 'weekly_billed_weekly'
  | 'weekly_billed_daily'
  | 'monthly_billed_monthly'
  | 'monthly_billed_weekly'
  | 'monthly_billed_daily';

export type RateUnit = 'day' | 'week' | 'month';

export const BILLING_TYPES: Record<
  BillingType,
  { rateUnit: RateUnit; cycle: RateUnit; label: string }
> = {
  daily: { rateUnit: 'day', cycle: 'day', label: 'Daily' },
  weekly_billed_weekly: { rateUnit: 'week', cycle: 'week', label: 'Weekly · billed weekly' },
  weekly_billed_daily: { rateUnit: 'day', cycle: 'week', label: 'Weekly · billed daily' },
  monthly_billed_monthly: { rateUnit: 'month', cycle: 'month', label: 'Monthly · billed monthly' },
  monthly_billed_weekly: { rateUnit: 'week', cycle: 'month', label: 'Monthly · billed weekly' },
  monthly_billed_daily: { rateUnit: 'day', cycle: 'month', label: 'Monthly · billed daily' },
};

export const ALL_BILLING_TYPES = Object.keys(BILLING_TYPES) as BillingType[];

/**
 * A rate with NO cadence — what CHARGE items (Labor / Lump Sum / Misc) price.
 *
 * The six billing types are rental cadences. A "1 Man Crew" has an hourly rate; asking
 * which cadence it bills under is a meaningless question. So charge items price exactly
 * one cell per tier under this key, and equipment prices the cadence cells.
 *
 * Deliberately NOT a member of BillingType: the rental engine must never see it, and
 * BILLING_TYPES (rateUnit / cycle) has nothing sensible to say about it.
 */
export const FLAT_RATE = 'flat' as const;
export type FlatRate = typeof FLAT_RATE;

/** How a price-list cell is keyed: a rental cadence, or the cadence-free flat rate. */
export type RateKey = BillingType | FlatRate;
export const ALL_RATE_KEYS: RateKey[] = [...ALL_BILLING_TYPES, FLAT_RATE];

/** Charge items price 'flat'; equipment prices cadences; Sale isn't on a list at all. */
export const rateKeysFor = (category: ItemCategory): RateKey[] =>
  category === 'Sale' ? [] : category === 'Equipment' ? ALL_BILLING_TYPES : [FLAT_RATE];

/** A tier on a price list. tiers[0] is the base; its pctOffPrevious is ignored. */
export interface Tier {
  name: string;
  /** Percent off the PREVIOUS tier's price. 10 === 10% off. */
  pctOffPrevious: number;
}

/**
 * A variation is a real physical difference (an orange cone, a large vest), so it moves
 * the item's numbers. Each may be negative.
 *
 * Note what ISN'T here: the rental RATE adjustment. An adjustment belongs where the
 * number it moves lives — cost and sale price live on the item, but a rate lives on the
 * PRICE LIST, so a variation's rate adjustment is set per list (PriceList.variationOverrides).
 */
export interface ItemVariation {
  name: string;
  /** +/- the item COST — what a LOST unit of this variation bills at. */
  costAdjCents: Cents;
  /** +/- the item SALE PRICE. Only meaningful when the item is salable. */
  saleAdjCents: Cents;
}

export interface Item {
  code: string;
  name: string;
  category: ItemCategory;
  /** Lost/stolen bills at COST (decided) — and is NOT taxed. */
  costCents: Cents;
  salable: boolean;
  salePriceCents?: Cents;
  /** Only meaningful for sales lines; rentals/labor/lost are never taxed. */
  taxable: boolean;
  tracked: boolean;
  variations: ItemVariation[];
  /** Catalog fallback rates, used when a price list has no cell for the item. */
  defaultRates: Partial<Record<BillingType, Cents>>;
}

/** tierName -> billingType -> explicit rate. This is the STORAGE model. */
export type TierGrid = Record<string, Partial<Record<RateKey, Cents>>>;

/**
 * How a price list authors an item's grid. The % cascade / freeze / sticky
 * overrides are the AUTHORING UI; `buildTierGrid` compiles them into the
 * explicit TierGrid above, which is what pricing actually reads.
 */
export interface PriceListItem {
  code: string;
  /** Tier-1 base rate per billing type, entered by hand. */
  base: Partial<Record<RateKey, Cents>>;
  /** Hold price from this tier index onward (no further discount). */
  freezeAfterTierIndex?: number | null;
  /** Sticky per-cell locks: [tierName][billingType] = cents. Wins over cascade AND freeze. */
  overrides?: Record<string, Partial<Record<RateKey, Cents>>>;
  /** PriceItemTierException — this item ignores the category tier rule and uses this tier. */
  tierException?: string | null;
}

export interface PriceList {
  id: string;
  name: string;
  entityId: string;
  tiers: Tier[];
  items: Record<string, PriceListItem>;
  /**
   * [itemCode][variationName] = the variation's RATE adjustment on this list. This is
   * the only place a rate adjustment exists — the item carries none. Absent = 0.
   */
  variationOverrides?: Record<string, Record<string, Cents>>;
}

/**
 * The entity that v1 was missing: a billing profile's config PER ENTITY.
 * Enabled entities pick a price list AND a tier per item category.
 */
export interface ProfileEntityConfig {
  entityId: string;
  enabled: boolean;
  priceListId: string;
  tierByCategory: Record<ItemCategory, string>;
}
