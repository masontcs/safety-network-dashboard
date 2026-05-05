import { describe, it, expect } from 'vitest'
import { canAccessBranch, requiresBranchFilter, isAdmin } from '@/lib/utils/access'
import type { UserAccess } from '@/lib/utils/access'

const admin: UserAccess = { userId: 'u', role: 'admin', branchIds: null }
const executive: UserAccess = { userId: 'u', role: 'executive', branchIds: null }
const district: UserAccess = { userId: 'u', role: 'district_manager', branchIds: ['b1', 'b2'] }
const branch: UserAccess = { userId: 'u', role: 'branch_manager', branchIds: ['b1'] }

describe('employees — branch scope (requiresBranchFilter)', () => {
  it('admin sees all employees — no branch filter', () => {
    expect(requiresBranchFilter(admin)).toBe(false)
  })

  it('executive sees all employees — no branch filter', () => {
    expect(requiresBranchFilter(executive)).toBe(false)
  })

  it('district_manager is scoped to assigned branches', () => {
    expect(requiresBranchFilter(district)).toBe(true)
  })

  it('branch_manager is scoped to assigned branch', () => {
    expect(requiresBranchFilter(branch)).toBe(true)
  })
})

describe('employees — branch access per role', () => {
  it('admin can access employees in any branch', () => {
    expect(canAccessBranch(admin, 'b1')).toBe(true)
    expect(canAccessBranch(admin, 'b-anything')).toBe(true)
  })

  it('executive can access employees in any branch', () => {
    expect(canAccessBranch(executive, 'b-anything')).toBe(true)
  })

  it('district_manager can access employees in assigned branches', () => {
    expect(canAccessBranch(district, 'b1')).toBe(true)
    expect(canAccessBranch(district, 'b2')).toBe(true)
    expect(canAccessBranch(district, 'b3')).toBe(false)
  })

  it('branch_manager can access employees only in their branch', () => {
    expect(canAccessBranch(branch, 'b1')).toBe(true)
    expect(canAccessBranch(branch, 'b2')).toBe(false)
  })
})

describe('employees — isAdmin check (for name PATCH guard)', () => {
  it('admin passes isAdmin check', () => {
    expect(isAdmin(admin)).toBe(true)
  })

  it('executive does not pass isAdmin check', () => {
    expect(isAdmin(executive)).toBe(false)
  })

  it('district_manager does not pass isAdmin check', () => {
    expect(isAdmin(district)).toBe(false)
  })

  it('branch_manager does not pass isAdmin check', () => {
    expect(isAdmin(branch)).toBe(false)
  })
})
