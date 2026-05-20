import { describe, it, expect } from 'vitest'
import { applyPayrollSumRule } from '@/lib/api/payroll-shape'
import type { PayrollLineItem } from '@/lib/api/payroll-shape'
import type { UserAccess } from '@/lib/utils/access'

const directItems: PayrollLineItem[] = [
  { employeeId: 'e1', displayName: 'Alice Smith', laborType: 'direct', amount: 1500, hours: 40, rate: 37.5 },
  { employeeId: 'e2', displayName: 'Bob Jones', laborType: 'direct', amount: 1200, hours: 40, rate: 30 },
]

const adminItems: PayrollLineItem[] = [
  { employeeId: 'e3', displayName: 'Carol White', laborType: 'admin_salary', amount: 3000, hours: null, rate: null },
  { employeeId: 'e4', displayName: 'Dan Brown', laborType: 'admin_hourly', amount: 800, hours: 20, rate: 40 },
]

const adminAccess: UserAccess = { userId: 'u', role: 'admin', displayName: '', branchIds: null }
const executiveAccess: UserAccess = { userId: 'u', role: 'executive', displayName: '', branchIds: null }
const districtAccess: UserAccess = { userId: 'u', role: 'district_manager', displayName: '', branchIds: ['b1', 'b2'] }
const branchAccess: UserAccess = { userId: 'u', role: 'branch_manager', displayName: '', branchIds: ['b1'] }

describe('payroll/summary — admin payroll sum rule (applyPayrollSumRule)', () => {
  describe('admin role', () => {
    it('adminPayroll includes detail array', () => {
      const result = applyPayrollSumRule(directItems, adminItems, 400, adminAccess)
      expect('detail' in result.adminPayroll).toBe(true)
    })

    it('adminPayroll detail contains all admin employees', () => {
      const result = applyPayrollSumRule(directItems, adminItems, 400, adminAccess)
      if (!('detail' in result.adminPayroll)) throw new Error('expected detail')
      expect(result.adminPayroll.detail).toHaveLength(2)
    })

    it('adminPayroll total is correct', () => {
      const result = applyPayrollSumRule(directItems, adminItems, 400, adminAccess)
      expect(result.adminPayroll.total).toBe(3800)
    })
  })

  describe('executive role', () => {
    it('adminPayroll includes detail array', () => {
      const result = applyPayrollSumRule(directItems, adminItems, 400, executiveAccess)
      expect('detail' in result.adminPayroll).toBe(true)
    })

    it('adminPayroll detail contains all admin employees', () => {
      const result = applyPayrollSumRule(directItems, adminItems, 400, executiveAccess)
      if (!('detail' in result.adminPayroll)) throw new Error('expected detail')
      expect(result.adminPayroll.detail).toHaveLength(2)
    })
  })

  describe('district_manager role', () => {
    it('adminPayroll does NOT have a detail key', () => {
      const result = applyPayrollSumRule(directItems, adminItems, 400, districtAccess)
      expect('detail' in result.adminPayroll).toBe(false)
    })

    it('adminPayroll has total only', () => {
      const result = applyPayrollSumRule(directItems, adminItems, 400, districtAccess)
      expect(result.adminPayroll.total).toBe(3800)
    })

    it('adminPayroll total is correct even when detail is hidden', () => {
      const result = applyPayrollSumRule(directItems, adminItems, 400, districtAccess)
      expect(result.adminPayroll.total).toBe(3000 + 800)
    })
  })

  describe('branch_manager role', () => {
    it('adminPayroll does NOT have a detail key', () => {
      const result = applyPayrollSumRule(directItems, adminItems, 400, branchAccess)
      expect('detail' in result.adminPayroll).toBe(false)
    })

    it('adminPayroll has total only', () => {
      const result = applyPayrollSumRule(directItems, adminItems, 400, branchAccess)
      expect(result.adminPayroll.total).toBe(3800)
    })

    it('taxes section has only total for branch_manager', () => {
      const result = applyPayrollSumRule(directItems, adminItems, 400, branchAccess)
      expect(result.taxes.total).toBe(400)
      expect('detail' in result.taxes).toBe(false)
    })
  })

  describe('direct labor — all roles see detail', () => {
    it('admin: directLabor has detail array', () => {
      const result = applyPayrollSumRule(directItems, adminItems, 0, adminAccess)
      expect(result.directLabor.detail).toHaveLength(2)
      expect(result.directLabor.total).toBe(2700)
    })

    it('district_manager: directLabor still has detail array', () => {
      const result = applyPayrollSumRule(directItems, adminItems, 0, districtAccess)
      expect(result.directLabor.detail).toHaveLength(2)
    })

    it('branch_manager: directLabor still has detail array', () => {
      const result = applyPayrollSumRule(directItems, adminItems, 0, branchAccess)
      expect(result.directLabor.detail).toHaveLength(2)
    })
  })

  describe('response shape is well-formed for all roles', () => {
    const roles: UserAccess[] = [adminAccess, executiveAccess, districtAccess, branchAccess]
    for (const access of roles) {
      it(`${access.role}: response has directLabor, adminPayroll, taxes`, () => {
        const result = applyPayrollSumRule(directItems, adminItems, 100, access)
        expect(result).toHaveProperty('directLabor')
        expect(result).toHaveProperty('adminPayroll')
        expect(result).toHaveProperty('taxes')
        expect(typeof result.adminPayroll.total).toBe('number')
        expect(typeof result.taxes.total).toBe('number')
      })
    }
  })
})
