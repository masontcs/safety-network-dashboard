import { describe, it, expect } from 'vitest'
import { canAccessBranch, requiresBranchFilter } from '@/lib/utils/access'
import type { UserAccess } from '@/lib/utils/access'

const BRANCH_A = 'branch-a'
const BRANCH_B = 'branch-b'
const OTHER_BRANCH = 'branch-other'

const admin: UserAccess = { userId: 'u', role: 'admin', branchIds: null }
const executive: UserAccess = { userId: 'u', role: 'executive', branchIds: null }
const district: UserAccess = { userId: 'u', role: 'district_manager', branchIds: [BRANCH_A, BRANCH_B] }
const branch: UserAccess = { userId: 'u', role: 'branch_manager', branchIds: [BRANCH_A] }

describe('revenue/summary — branch access (canAccessBranch)', () => {
  it('admin can access any branch', () => {
    expect(canAccessBranch(admin, BRANCH_A)).toBe(true)
    expect(canAccessBranch(admin, OTHER_BRANCH)).toBe(true)
  })

  it('executive can access any branch', () => {
    expect(canAccessBranch(executive, BRANCH_A)).toBe(true)
    expect(canAccessBranch(executive, OTHER_BRANCH)).toBe(true)
  })

  it('district_manager can access assigned branches', () => {
    expect(canAccessBranch(district, BRANCH_A)).toBe(true)
    expect(canAccessBranch(district, BRANCH_B)).toBe(true)
  })

  it('district_manager cannot access non-assigned branch', () => {
    expect(canAccessBranch(district, OTHER_BRANCH)).toBe(false)
  })

  it('branch_manager can access their assigned branch', () => {
    expect(canAccessBranch(branch, BRANCH_A)).toBe(true)
  })

  it('branch_manager cannot access another branch', () => {
    expect(canAccessBranch(branch, BRANCH_B)).toBe(false)
    expect(canAccessBranch(branch, OTHER_BRANCH)).toBe(false)
  })
})

describe('revenue/summary — branch filter flag (requiresBranchFilter)', () => {
  it('admin does not require branch filter (branchIds=null)', () => {
    expect(requiresBranchFilter(admin)).toBe(false)
  })

  it('executive does not require branch filter (branchIds=null)', () => {
    expect(requiresBranchFilter(executive)).toBe(false)
  })

  it('district_manager requires branch filter', () => {
    expect(requiresBranchFilter(district)).toBe(true)
  })

  it('branch_manager requires branch filter', () => {
    expect(requiresBranchFilter(branch)).toBe(true)
  })
})
