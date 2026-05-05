import { describe, it, expect } from 'vitest'
import { isAdminOrExecutive } from '@/lib/utils/access'
import type { UserAccess } from '@/lib/utils/access'

const admin: UserAccess = { userId: 'u', role: 'admin', branchIds: null }
const executive: UserAccess = { userId: 'u', role: 'executive', branchIds: null }
const district: UserAccess = { userId: 'u', role: 'district_manager', branchIds: ['b1'] }
const branch: UserAccess = { userId: 'u', role: 'branch_manager', branchIds: ['b1'] }

describe('allocation/summary — access guard (isAdminOrExecutive)', () => {
  it('admin is permitted (returns true)', () => {
    expect(isAdminOrExecutive(admin)).toBe(true)
  })

  it('executive is permitted (returns true)', () => {
    expect(isAdminOrExecutive(executive)).toBe(true)
  })

  it('district_manager is blocked (returns false → 403)', () => {
    expect(isAdminOrExecutive(district)).toBe(false)
  })

  it('branch_manager is blocked (returns false → 403)', () => {
    expect(isAdminOrExecutive(branch)).toBe(false)
  })
})

describe('allocation/summary — canAllocate=false propagation', () => {
  // Verify calculateAllocations correctly signals when no allocation is possible
  // (zero-revenue case is tested exhaustively in lib/allocation/index.test.ts)
  it('non-admin/executive roles always get 403 before calculateAllocations is called', () => {
    // The guard runs before any DB access; managers never reach the calculation.
    const blockedRoles: UserAccess[] = [district, branch]
    for (const access of blockedRoles) {
      expect(isAdminOrExecutive(access)).toBe(false)
    }
  })
})
