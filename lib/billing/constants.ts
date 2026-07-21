import type { BillingItemCategory, BillingType, RateKey } from '@/lib/supabase/database.types'

/**
 * Shared billing constants. These live outside `route.ts` files on purpose:
 * Next.js type-checks route modules and rejects exports that aren't HTTP
 * handlers or recognised route config.
 */

/** Fixed per spec. Every catalog item has exactly one. */
export const CATEGORIES: BillingItemCategory[] = ['Equipment', 'Labor', 'Lump Sum', 'Misc', 'Sale']

/**
 * Categories that need a price-list TIER. 'Sale' is absent on purpose: a sale is priced
 * by the item's own sale_price_cents and never appears on a price list, so asking a
 * profile which tier its sales use would be a question with no answer.
 */
export const TIERED_CATEGORIES: BillingItemCategory[] = ['Equipment', 'Labor', 'Lump Sum', 'Misc']

/** True for the one category that is priced on the item rather than by a price list. */
export const isSaleCategory = (category: BillingItemCategory): boolean => category === 'Sale'

/** One rate per rental cadence. No proration — each cell is an entered rate. */
export const BILLING_TYPES: BillingType[] = ['daily', 'weekly', 'monthly']

export const BILLING_TYPE_LABELS: Record<BillingType, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
}

/**
 * The cadence-free rate key. Charge items (Labor / Lump Sum / Misc) price exactly one
 * cell per tier under this — a "1 Man Crew" has an hourly rate, not a rental cadence.
 * Equipment prices the six cadences above; the two never overlap.
 */
export const FLAT_RATE: RateKey = 'flat'

/** Which rate keys an item's category prices. Sale prices none — it isn't on a list. */
export const rateKeysFor = (category: BillingItemCategory): RateKey[] =>
  category === 'Sale' ? [] : category === 'Equipment' ? BILLING_TYPES : [FLAT_RATE]

/** True for categories that price a single flat rate rather than rental cadences. */
export const isChargeCategory = (category: BillingItemCategory): boolean =>
  category !== 'Equipment' && category !== 'Sale'
