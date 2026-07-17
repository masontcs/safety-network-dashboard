import { describe, it, expect } from 'vitest'
import { resolveVariationAdj } from './rates'
import type { Item, PriceList } from './types'

/**
 * A variation's RATE adjustment is price-list state, not item state — the item carries
 * none at all. The case that matters most is "no entry means 0": there is no item-level
 * default hiding behind the list to disagree with it.
 */

const item: Item = {
  code: 'CONE', name: 'Cone', category: 'Equipment', costCents: 5000,
  salable: false, taxable: false, tracked: true,
  variations: [{ name: 'Orange', costAdjCents: 500, saleAdjCents: 0 }],
  defaultRates: {},
}
const list = (overrides?: PriceList['variationOverrides']): PriceList => ({
  id: 'pl1', name: 'List', entityId: 'e1', tiers: [{ name: 'T1', pctOffPrevious: 0 }],
  items: {}, variationOverrides: overrides,
})

describe('resolveVariationAdj — the rate adj lives on the price list, not the item', () => {
  it('uses the price list adjustment', () => {
    expect(resolveVariationAdj(item, 'Orange', list({ CONE: { Orange: 250 } }))).toBe(250)
  })
  it('is 0 when this list sets nothing — no item-level fallback exists', () => {
    expect(resolveVariationAdj(item, 'Orange', list())).toBe(0)
    expect(resolveVariationAdj(item, 'Orange', list({ CONE: {} }))).toBe(0)
  })
  it('is per-list: a different list can disagree', () => {
    expect(resolveVariationAdj(item, 'Orange', list({ CONE: { Orange: 100 } }))).toBe(100)
    expect(resolveVariationAdj(item, 'Orange', list({ CONE: { Orange: 900 } }))).toBe(900)
  })
  it('carries a negative adjustment through (a cheaper variant)', () => {
    expect(resolveVariationAdj(item, 'Orange', list({ CONE: { Orange: -250 } }))).toBe(-250)
  })
  it('is 0 with no variation on the line', () => {
    expect(resolveVariationAdj(item, null, list({ CONE: { Orange: 250 } }))).toBe(0)
  })
  it("does not leak another item's adjustment", () => {
    expect(resolveVariationAdj(item, 'Orange', list({ SIGN: { Orange: 500 } }))).toBe(0)
  })
})
