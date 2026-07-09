import type { BillingItemCategory, BillingType } from '@/lib/supabase/database.types'

/**
 * Shared billing constants. These live outside `route.ts` files on purpose:
 * Next.js type-checks route modules and rejects exports that aren't HTTP
 * handlers or recognised route config.
 */

/** Fixed per spec. Every catalog item has exactly one. */
export const CATEGORIES: BillingItemCategory[] = ['Equipment', 'Labor', 'Lump Sum', 'Misc']

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
