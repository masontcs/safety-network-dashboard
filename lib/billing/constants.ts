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

/** `<rental cadence>_billed_<rate unit>`. No proration — each cell is an entered rate. */
export const BILLING_TYPES: BillingType[] = [
  'daily',
  'weekly_billed_weekly',
  'weekly_billed_daily',
  'monthly_billed_monthly',
  'monthly_billed_weekly',
  'monthly_billed_daily',
]

export const BILLING_TYPE_LABELS: Record<BillingType, string> = {
  daily: 'Daily',
  weekly_billed_weekly: 'Weekly · billed weekly',
  weekly_billed_daily: 'Weekly · billed daily',
  monthly_billed_monthly: 'Monthly · billed monthly',
  monthly_billed_weekly: 'Monthly · billed weekly',
  monthly_billed_daily: 'Monthly · billed daily',
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
