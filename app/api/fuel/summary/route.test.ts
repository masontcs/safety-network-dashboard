import { describe, it, expect } from 'vitest'
import { isSnFuelTransaction } from '@/lib/fuel/rules'
import { canAccessBranch, requiresBranchFilter } from '@/lib/utils/access'
import type { UserAccess } from '@/lib/utils/access'

const admin: UserAccess = { userId: 'u', role: 'admin', branchIds: null }
const executive: UserAccess = { userId: 'u', role: 'executive', branchIds: null }
const district: UserAccess = { userId: 'u', role: 'district_manager', branchIds: ['b1', 'b2'] }
const branch: UserAccess = { userId: 'u', role: 'branch_manager', branchIds: ['b1'] }

describe('fuel/summary — WH/Signs exclusion (isSnFuelTransaction)', () => {
  it('includes transactions with null business_tag (SN)', () => {
    expect(isSnFuelTransaction(null)).toBe(true)
  })

  it('excludes western_highways transactions for all roles', () => {
    expect(isSnFuelTransaction('western_highways')).toBe(false)
  })

  it('excludes signs transactions for all roles', () => {
    expect(isSnFuelTransaction('signs')).toBe(false)
  })

  it('null business_tag is the only value that passes (no WH/Signs ever included)', () => {
    const businessTags = [null, 'western_highways', 'signs', 'unknown'] as const
    const results = businessTags.map((t) => isSnFuelTransaction(t as string | null))
    // Only null passes
    expect(results).toEqual([true, false, false, false])
  })
})

describe('fuel/summary — branch access (all four roles)', () => {
  it('admin can access any branch', () => {
    expect(canAccessBranch(admin, 'any-branch')).toBe(true)
  })

  it('executive can access any branch', () => {
    expect(canAccessBranch(executive, 'any-branch')).toBe(true)
  })

  it('district_manager can access assigned branches', () => {
    expect(canAccessBranch(district, 'b1')).toBe(true)
    expect(canAccessBranch(district, 'b2')).toBe(true)
  })

  it('district_manager cannot access non-assigned branch', () => {
    expect(canAccessBranch(district, 'b3')).toBe(false)
  })

  it('branch_manager can access their branch', () => {
    expect(canAccessBranch(branch, 'b1')).toBe(true)
  })

  it('branch_manager cannot access another branch', () => {
    expect(canAccessBranch(branch, 'b2')).toBe(false)
  })
})

describe('fuel/summary — branch filter flag (all four roles)', () => {
  it('admin: no branch filter needed', () => {
    expect(requiresBranchFilter(admin)).toBe(false)
  })

  it('executive: no branch filter needed', () => {
    expect(requiresBranchFilter(executive)).toBe(false)
  })

  it('district_manager: branch filter required', () => {
    expect(requiresBranchFilter(district)).toBe(true)
  })

  it('branch_manager: branch filter required', () => {
    expect(requiresBranchFilter(branch)).toBe(true)
  })
})
