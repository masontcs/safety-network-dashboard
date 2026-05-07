// Pure allocation resolution logic — no DB calls, fully testable.

export type BranchSplit = { branchId: string; percentage: number }

export type AllocationOverride = {
  employee_id: string
  period_date: string   // YYYY-MM-DD (Saturday)
  branch_id: string
  percentage: number
  status: string
}

export type EmployeeAllocation = {
  employee_id: string
  branch_id: string
  percentage: number
  effective_from: string  // YYYY-MM-DD
  effective_to: string | null
  status: string
}

// For a given employee + period_date, return their branch split.
// Priority: approved weekly override > approved active default > 100% home branch.
export function resolveEmployeeAllocation(
  employeeId: string,
  periodDate: string,
  homeBranchId: string,
  overrides: AllocationOverride[],
  defaults: EmployeeAllocation[]
): BranchSplit[] {
  // 1. Check for approved weekly override matching this employee + period
  const matchingOverrides = overrides.filter(
    (o) => o.employee_id === employeeId && o.period_date === periodDate && o.status === 'approved'
  )
  if (matchingOverrides.length > 0) {
    return matchingOverrides.map((o) => ({ branchId: o.branch_id, percentage: o.percentage }))
  }

  // 2. Check for approved default allocation active on this date
  const activeDefaults = defaults.filter(
    (d) =>
      d.employee_id === employeeId &&
      d.status === 'approved' &&
      d.effective_from <= periodDate &&
      (d.effective_to === null || d.effective_to >= periodDate)
  )
  if (activeDefaults.length > 0) {
    return activeDefaults.map((d) => ({ branchId: d.branch_id, percentage: d.percentage }))
  }

  // 3. Default: 100% home branch
  return [{ branchId: homeBranchId, percentage: 100 }]
}

// Splits must sum to exactly 100 within a 0.01 rounding tolerance.
export function validateSplitTotal(splits: BranchSplit[]): boolean {
  const total = splits.reduce((sum, s) => sum + s.percentage, 0)
  return Math.abs(total - 100) <= 0.01
}

// Returns true if date string is a Saturday (YYYY-MM-DD).
export function isSaturday(dateStr: string): boolean {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d).getDay() === 6
}
