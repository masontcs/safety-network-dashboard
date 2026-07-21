import { describe, it, expect } from 'vitest'
import { compilePriceListRates, type CompileTier, type CompileItem } from './compile'

/**
 * The compiled rows in billing_price_list_rates are the source of truth pricing reads.
 * These assert the two new shapes land there correctly:
 *   - single-rate: the 'flat' key only, cascading across tiers, no cadence rows
 *   - per-variation: each variation compiles its own rows tagged with variation_id
 */

const TIERS: CompileTier[] = [
  { id: 't1', name: 'Tier 1', position: 1, pctOffPrevious: 0 },
  { id: 't2', name: 'Tier 2', position: 2, pctOffPrevious: 10 },
]

describe('compile — single rate', () => {
  it('emits only the flat key, cascaded across tiers, and no cadence rows', () => {
    const items: CompileItem[] = [
      { priceListItemId: 'pli1', variationId: null, base: { flat: 1000 }, freezeAfterPosition: null },
    ]
    const rows = compilePriceListRates(TIERS, items)
    expect(rows.every((r) => r.billing_type === 'flat')).toBe(true)
    expect(rows.every((r) => r.variation_id === null)).toBe(true)
    const byTier = Object.fromEntries(rows.map((r) => [r.tier_id, r.rate_cents]))
    expect(byTier['t1']).toBe(1000)
    expect(byTier['t2']).toBe(900) // 10% off previous
  })
})

describe('compile — per variation', () => {
  it('compiles a separate set of rows per variation, tagged with variation_id', () => {
    const items: CompileItem[] = [
      { priceListItemId: 'pli1', variationId: 'v-orange', base: { flat: 150 }, freezeAfterPosition: null },
      { priceListItemId: 'pli1', variationId: 'v-green', base: { flat: 175 }, freezeAfterPosition: null },
    ]
    const rows = compilePriceListRates(TIERS, items)
    const orange = rows.filter((r) => r.variation_id === 'v-orange')
    const green = rows.filter((r) => r.variation_id === 'v-green')
    expect(orange.find((r) => r.tier_id === 't1')?.rate_cents).toBe(150)
    expect(green.find((r) => r.tier_id === 't1')?.rate_cents).toBe(175)
    // The two never collide: same pli, different variation.
    expect(orange.length).toBe(2) // t1 + t2
    expect(green.length).toBe(2)
    expect(rows.some((r) => r.variation_id === null)).toBe(false) // no bare-item rows
  })

  it('a by-cadence variation keeps all six cadences under its variation_id', () => {
    const items: CompileItem[] = [
      { priceListItemId: 'pli1', variationId: 'v-lg', base: { daily: 200, weekly_billed_weekly: 1000 }, freezeAfterPosition: null },
    ]
    const rows = compilePriceListRates(TIERS, items)
    expect(rows.every((r) => r.variation_id === 'v-lg')).toBe(true)
    expect(rows.some((r) => r.billing_type === 'daily')).toBe(true)
    expect(rows.some((r) => r.billing_type === 'weekly_billed_weekly')).toBe(true)
  })
})
