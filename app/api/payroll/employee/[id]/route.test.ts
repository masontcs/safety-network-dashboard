import { describe, it, expect } from 'vitest'
import { canAccessEmployeeByLaborType } from '@/lib/utils/access'
import type { UserAccess } from '@/lib/utils/access'
import type { LaborType } from '@/lib/supabase/database.types'

const admin: UserAccess = { userId: 'u', role: 'admin', branchIds: null }
const executive: UserAccess = { userId: 'u', role: 'executive', branchIds: null }
const district: UserAccess = { userId: 'u', role: 'district_manager', branchIds: ['b1'] }
const branch: UserAccess = { userId: 'u', role: 'branch_manager', branchIds: ['b1'] }

const directTypes: LaborType[] = ['direct']
const adminTypes: LaborType[] = ['admin_hourly', 'admin_salary']
const corpTypes: LaborType[] = ['corp_hourly', 'corp_salary']
const hqTypes: LaborType[] = ['hq_hourly', 'hq_salary']
const nonDirectTypes: LaborType[] = [...adminTypes, ...corpTypes, ...hqTypes]

describe('payroll/employee — labor type access guard (canAccessEmployeeByLaborType)', () => {
  describe('direct labor employees — all roles can access', () => {
    for (const role of [admin, executive, district, branch]) {
      it(`${role.role} can access direct labor employees`, () => {
        for (const lt of directTypes) {
          expect(canAccessEmployeeByLaborType(lt, role)).toBe(true)
        }
      })
    }
  })

  describe('admin / executive can access all employee types', () => {
    for (const lt of nonDirectTypes) {
      it(`admin can access ${lt} employees`, () => {
        expect(canAccessEmployeeByLaborType(lt, admin)).toBe(true)
      })

      it(`executive can access ${lt} employees`, () => {
        expect(canAccessEmployeeByLaborType(lt, executive)).toBe(true)
      })
    }
  })

  describe('district_manager cannot access admin-coded employees', () => {
    for (const lt of nonDirectTypes) {
      it(`district_manager is blocked for ${lt}`, () => {
        expect(canAccessEmployeeByLaborType(lt, district)).toBe(false)
      })
    }
  })

  describe('branch_manager cannot access admin-coded employees', () => {
    for (const lt of nonDirectTypes) {
      it(`branch_manager is blocked for ${lt}`, () => {
        expect(canAccessEmployeeByLaborType(lt, branch)).toBe(false)
      })
    }
  })
})
