import type { LaborType, Role } from '@/lib/supabase/database.types'

export type UserAccess = {
  userId: string
  role: Role
  branchIds: string[] | null  // null = all access (admin / executive)
}

export function canAccessBranch(access: UserAccess, branchId: string): boolean {
  if (access.branchIds === null) return true
  return access.branchIds.includes(branchId)
}

export function requiresBranchFilter(access: UserAccess): boolean {
  return access.branchIds !== null
}

export function isAdminOrExecutive(access: UserAccess): boolean {
  return access.role === 'admin' || access.role === 'executive'
}

export function isAdmin(access: UserAccess): boolean {
  return access.role === 'admin'
}

export function canSeeAdminPayrollDetail(access: UserAccess): boolean {
  return access.role === 'admin' || access.role === 'executive'
}

export function canAccessEmployeeByLaborType(laborType: LaborType, access: UserAccess): boolean {
  if (laborType === 'direct') return true
  return canSeeAdminPayrollDetail(access)
}
