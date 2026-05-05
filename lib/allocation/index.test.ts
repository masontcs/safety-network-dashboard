import { describe, it, expect } from 'vitest'
import { calculateAllocations } from './index'

const SN_HQ_PCT = 0.7813

describe('calculateAllocations — zero revenue guard', () => {
  it('returns canAllocate=false when total revenue is 0', () => {
    const result = calculateAllocations([], 10000, 5000, SN_HQ_PCT)
    expect(result.canAllocate).toBe(false)
  })

  it('returns canAllocate=false when all branches have zero revenue', () => {
    const result = calculateAllocations(
      [{ branchId: 'a', totalRevenue: 0 }, { branchId: 'b', totalRevenue: 0 }],
      10000, 5000, SN_HQ_PCT,
    )
    expect(result.canAllocate).toBe(false)
  })

  it('never divides by zero (returns empty allocations, not NaN)', () => {
    const result = calculateAllocations([], 10000, 5000, SN_HQ_PCT)
    expect(result.allocations).toEqual([])
    if (!result.canAllocate) {
      expect(result.reason).toBeTruthy()
    }
  })
})

describe('calculateAllocations — corp allocation', () => {
  it('branch with 30% revenue gets 30% of corp payroll', () => {
    const result = calculateAllocations(
      [{ branchId: 'a', totalRevenue: 30000 }, { branchId: 'b', totalRevenue: 70000 }],
      10000, 0, SN_HQ_PCT,
    )
    if (!result.canAllocate) throw new Error('expected canAllocate=true')
    expect(result.allocations[0].corpAllocation).toBe(3000)
    expect(result.allocations[1].corpAllocation).toBe(7000)
  })

  it('corp allocations sum back to total corp payroll (within $0.02)', () => {
    const corpPayroll = 47_321.17
    const result = calculateAllocations(
      [
        { branchId: 'a', totalRevenue: 123_456 },
        { branchId: 'b', totalRevenue: 87_654 },
        { branchId: 'c', totalRevenue: 54_321 },
        { branchId: 'd', totalRevenue: 210_000 },
      ],
      corpPayroll, 0, SN_HQ_PCT,
    )
    if (!result.canAllocate) throw new Error('expected canAllocate=true')
    const sum = result.allocations.reduce((s, b) => s + b.corpAllocation, 0)
    expect(Math.abs(sum - corpPayroll)).toBeLessThanOrEqual(0.02)
  })
})

describe('calculateAllocations — HQ allocation', () => {
  it('HQ SN allocations sum back to snHqShare (within $0.02)', () => {
    const hqPayroll = 31_500
    const result = calculateAllocations(
      [
        { branchId: 'a', totalRevenue: 100_000 },
        { branchId: 'b', totalRevenue: 200_000 },
        { branchId: 'c', totalRevenue: 150_000 },
      ],
      0, hqPayroll, SN_HQ_PCT,
    )
    if (!result.canAllocate) throw new Error('expected canAllocate=true')
    const snHqShare = result.snHqShare
    const sum = result.allocations.reduce((s, b) => s + b.hqAllocation, 0)
    expect(Math.abs(sum - snHqShare)).toBeLessThanOrEqual(0.02)
  })

  it('snHqShare = hqPayroll * snHqPct', () => {
    const result = calculateAllocations(
      [{ branchId: 'a', totalRevenue: 100_000 }],
      0, 10_000, 0.7813,
    )
    if (!result.canAllocate) throw new Error('expected canAllocate=true')
    expect(result.snHqShare).toBe(7813)
  })

  it('uses snHqPct passed in — not a hardcoded value', () => {
    const result1 = calculateAllocations(
      [{ branchId: 'a', totalRevenue: 100_000 }],
      0, 10_000, 0.5,
    )
    const result2 = calculateAllocations(
      [{ branchId: 'a', totalRevenue: 100_000 }],
      0, 10_000, 0.8,
    )
    if (!result1.canAllocate || !result2.canAllocate) throw new Error('expected canAllocate=true')
    expect(result1.snHqShare).toBe(5000)
    expect(result2.snHqShare).toBe(8000)
  })
})

describe('calculateAllocations — totalAllocation', () => {
  it('totalAllocation = corpAllocation + hqAllocation for each branch', () => {
    const result = calculateAllocations(
      [{ branchId: 'a', totalRevenue: 40_000 }, { branchId: 'b', totalRevenue: 60_000 }],
      10_000, 5_000, SN_HQ_PCT,
    )
    if (!result.canAllocate) throw new Error('expected canAllocate=true')
    for (const branch of result.allocations) {
      const expected = Math.round((branch.corpAllocation + branch.hqAllocation) * 100) / 100
      expect(Math.abs(branch.totalAllocation - expected)).toBeLessThanOrEqual(0.02)
    }
  })
})

describe('calculateAllocations — revenueShare', () => {
  it('revenueShare is a fraction 0-1 (not a percentage)', () => {
    const result = calculateAllocations(
      [{ branchId: 'a', totalRevenue: 25_000 }, { branchId: 'b', totalRevenue: 75_000 }],
      10_000, 5_000, SN_HQ_PCT,
    )
    if (!result.canAllocate) throw new Error('expected canAllocate=true')
    expect(result.allocations[0].revenueShare).toBeCloseTo(0.25, 5)
    expect(result.allocations[1].revenueShare).toBeCloseTo(0.75, 5)
  })

  it('revenue shares sum to 1.0', () => {
    const result = calculateAllocations(
      [
        { branchId: 'a', totalRevenue: 33_333 },
        { branchId: 'b', totalRevenue: 33_333 },
        { branchId: 'c', totalRevenue: 33_334 },
      ],
      10_000, 5_000, SN_HQ_PCT,
    )
    if (!result.canAllocate) throw new Error('expected canAllocate=true')
    const sum = result.allocations.reduce((s, b) => s + b.revenueShare, 0)
    expect(Math.abs(sum - 1)).toBeLessThan(0.000001)
  })
})

describe('calculateAllocations — return metadata', () => {
  it('returns totalSnRevenue, totalCorpPayroll, totalHqPayroll when canAllocate=true', () => {
    const result = calculateAllocations(
      [{ branchId: 'a', totalRevenue: 50_000 }],
      12_000, 8_000, SN_HQ_PCT,
    )
    if (!result.canAllocate) throw new Error('expected canAllocate=true')
    expect(result.totalSnRevenue).toBe(50_000)
    expect(result.totalCorpPayroll).toBe(12_000)
    expect(result.totalHqPayroll).toBe(8_000)
  })
})
