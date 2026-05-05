import type { LaborType } from '@/lib/supabase/database.types'
import type { UserAccess } from '@/lib/utils/access'
import { canSeeAdminPayrollDetail } from '@/lib/utils/access'

export type PayrollLineItem = {
  employeeId: string
  displayName: string
  laborType: LaborType
  amount: number
  hours: number | null
  rate: number | null
  branchId?: string | null
}

export type AdminPayrollDetail = { detail: PayrollLineItem[]; total: number }
export type AdminPayrollSum = { total: number }

export type PayrollSummaryShape = {
  directLabor: { detail: PayrollLineItem[]; total: number }
  adminPayroll: AdminPayrollDetail | AdminPayrollSum
  taxes: { total: number }
}

// Security control: admin/executive get full detail; managers get total only — never a detail array.
export function applyPayrollSumRule(
  directItems: PayrollLineItem[],
  adminItems: PayrollLineItem[],
  taxTotal: number,
  access: UserAccess
): PayrollSummaryShape {
  const canSeeDetail = canSeeAdminPayrollDetail(access)
  const directTotal = directItems.reduce((s, i) => s + i.amount, 0)
  const adminTotal = adminItems.reduce((s, i) => s + i.amount, 0)

  return {
    directLabor: { detail: directItems, total: directTotal },
    adminPayroll: canSeeDetail
      ? { detail: adminItems, total: adminTotal }
      : { total: adminTotal },
    taxes: { total: taxTotal },
  }
}
