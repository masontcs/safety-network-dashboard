import { describe, it, expect } from 'vitest'
import {
  resolveEmployeeAllocation,
  validateSplitTotal,
  type AllocationOverride,
  type EmployeeAllocation,
  type BranchSplit,
} from './employee-allocation'

const EMP = 'emp-1'
const BRANCH_A = 'branch-a'
const BRANCH_B = 'branch-b'
const BRANCH_C = 'branch-c'
const PERIOD = '2026-04-25'

// ── resolveEmployeeAllocation ─────────────────────────────────────────────────

describe('resolveEmployeeAllocation', () => {
  it('returns 100% home branch when no allocations exist', () => {
    const result = resolveEmployeeAllocation(EMP, PERIOD, BRANCH_A, [], [])
    expect(result).toEqual([{ branchId: BRANCH_A, percentage: 100 }])
  })

  it('returns 100% home branch when allocations exist but none are approved', () => {
    const defaults: EmployeeAllocation[] = [
      { employee_id: EMP, branch_id: BRANCH_B, percentage: 40, effective_from: '2026-04-01', effective_to: null, status: 'pending' },
      { employee_id: EMP, branch_id: BRANCH_C, percentage: 60, effective_from: '2026-04-01', effective_to: null, status: 'pending' },
    ]
    const result = resolveEmployeeAllocation(EMP, PERIOD, BRANCH_A, [], defaults)
    expect(result).toEqual([{ branchId: BRANCH_A, percentage: 100 }])
  })

  it('returns approved default allocation split', () => {
    const defaults: EmployeeAllocation[] = [
      { employee_id: EMP, branch_id: BRANCH_A, percentage: 40, effective_from: '2026-04-01', effective_to: null, status: 'approved' },
      { employee_id: EMP, branch_id: BRANCH_B, percentage: 30, effective_from: '2026-04-01', effective_to: null, status: 'approved' },
      { employee_id: EMP, branch_id: BRANCH_C, percentage: 30, effective_from: '2026-04-01', effective_to: null, status: 'approved' },
    ]
    const result = resolveEmployeeAllocation(EMP, PERIOD, BRANCH_A, [], defaults)
    expect(result).toHaveLength(3)
    expect(result.find(s => s.branchId === BRANCH_A)?.percentage).toBe(40)
    expect(result.find(s => s.branchId === BRANCH_B)?.percentage).toBe(30)
    expect(result.find(s => s.branchId === BRANCH_C)?.percentage).toBe(30)
  })

  it('ignores default allocations outside their effective date range', () => {
    const defaults: EmployeeAllocation[] = [
      // effective_from is after the period date — should not apply
      { employee_id: EMP, branch_id: BRANCH_B, percentage: 50, effective_from: '2026-05-01', effective_to: null, status: 'approved' },
      { employee_id: EMP, branch_id: BRANCH_C, percentage: 50, effective_from: '2026-05-01', effective_to: null, status: 'approved' },
    ]
    const result = resolveEmployeeAllocation(EMP, PERIOD, BRANCH_A, [], defaults)
    expect(result).toEqual([{ branchId: BRANCH_A, percentage: 100 }])
  })

  it('ignores default allocations where effective_to is before the period', () => {
    const defaults: EmployeeAllocation[] = [
      { employee_id: EMP, branch_id: BRANCH_B, percentage: 60, effective_from: '2026-01-01', effective_to: '2026-03-31', status: 'approved' },
      { employee_id: EMP, branch_id: BRANCH_C, percentage: 40, effective_from: '2026-01-01', effective_to: '2026-03-31', status: 'approved' },
    ]
    const result = resolveEmployeeAllocation(EMP, PERIOD, BRANCH_A, [], defaults)
    expect(result).toEqual([{ branchId: BRANCH_A, percentage: 100 }])
  })

  it('approved weekly override takes priority over default allocation', () => {
    const defaults: EmployeeAllocation[] = [
      { employee_id: EMP, branch_id: BRANCH_A, percentage: 100, effective_from: '2026-01-01', effective_to: null, status: 'approved' },
    ]
    const overrides: AllocationOverride[] = [
      { employee_id: EMP, period_date: PERIOD, branch_id: BRANCH_B, percentage: 60, status: 'approved' },
      { employee_id: EMP, period_date: PERIOD, branch_id: BRANCH_C, percentage: 40, status: 'approved' },
    ]
    const result = resolveEmployeeAllocation(EMP, PERIOD, BRANCH_A, overrides, defaults)
    expect(result).toHaveLength(2)
    expect(result.find(s => s.branchId === BRANCH_B)?.percentage).toBe(60)
    expect(result.find(s => s.branchId === BRANCH_C)?.percentage).toBe(40)
  })

  it('pending override does NOT take priority — falls through to default', () => {
    const defaults: EmployeeAllocation[] = [
      { employee_id: EMP, branch_id: BRANCH_A, percentage: 100, effective_from: '2026-01-01', effective_to: null, status: 'approved' },
    ]
    const overrides: AllocationOverride[] = [
      { employee_id: EMP, period_date: PERIOD, branch_id: BRANCH_B, percentage: 100, status: 'pending' },
    ]
    const result = resolveEmployeeAllocation(EMP, PERIOD, BRANCH_A, overrides, defaults)
    expect(result).toEqual([{ branchId: BRANCH_A, percentage: 100 }])
  })

  it('override for a different period does not affect this period', () => {
    const overrides: AllocationOverride[] = [
      { employee_id: EMP, period_date: '2026-04-18', branch_id: BRANCH_B, percentage: 100, status: 'approved' },
    ]
    const result = resolveEmployeeAllocation(EMP, PERIOD, BRANCH_A, overrides, [])
    expect(result).toEqual([{ branchId: BRANCH_A, percentage: 100 }])
  })

  it('override for a different employee does not affect this employee', () => {
    const overrides: AllocationOverride[] = [
      { employee_id: 'emp-2', period_date: PERIOD, branch_id: BRANCH_B, percentage: 100, status: 'approved' },
    ]
    const result = resolveEmployeeAllocation(EMP, PERIOD, BRANCH_A, overrides, [])
    expect(result).toEqual([{ branchId: BRANCH_A, percentage: 100 }])
  })
})

// ── validateSplitTotal ────────────────────────────────────────────────────────

describe('validateSplitTotal', () => {
  it('accepts exact 100', () => {
    const splits: BranchSplit[] = [
      { branchId: BRANCH_A, percentage: 40 },
      { branchId: BRANCH_B, percentage: 30 },
      { branchId: BRANCH_C, percentage: 30 },
    ]
    expect(validateSplitTotal(splits)).toBe(true)
  })

  it('rejects 90 (too low)', () => {
    const splits: BranchSplit[] = [
      { branchId: BRANCH_A, percentage: 40 },
      { branchId: BRANCH_B, percentage: 30 },
      { branchId: BRANCH_C, percentage: 20 },
    ]
    expect(validateSplitTotal(splits)).toBe(false)
  })

  it('rejects 110 (too high)', () => {
    const splits: BranchSplit[] = [
      { branchId: BRANCH_A, percentage: 60 },
      { branchId: BRANCH_B, percentage: 50 },
    ]
    expect(validateSplitTotal(splits)).toBe(false)
  })

  it('accepts rounding tolerance: 33.33 + 33.33 + 33.34 = 100', () => {
    const splits: BranchSplit[] = [
      { branchId: BRANCH_A, percentage: 33.33 },
      { branchId: BRANCH_B, percentage: 33.33 },
      { branchId: BRANCH_C, percentage: 33.34 },
    ]
    expect(validateSplitTotal(splits)).toBe(true)
  })

  it('rejects sum of 99.97 (outside tolerance)', () => {
    const splits: BranchSplit[] = [
      { branchId: BRANCH_A, percentage: 33.33 },
      { branchId: BRANCH_B, percentage: 33.32 },
      { branchId: BRANCH_C, percentage: 33.32 },
    ]
    expect(validateSplitTotal(splits)).toBe(false)
  })

  it('accepts single 100% entry', () => {
    expect(validateSplitTotal([{ branchId: BRANCH_A, percentage: 100 }])).toBe(true)
  })
})
