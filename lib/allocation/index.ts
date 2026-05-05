export type BranchAllocation = {
  branchId: string
  revenueShare: number
  corpAllocation: number
  hqAllocation: number
  totalAllocation: number
}

export type AllocationResult =
  | {
      canAllocate: false
      reason: string
      allocations: []
    }
  | {
      canAllocate: true
      allocations: BranchAllocation[]
      totalSnRevenue: number
      totalCorpPayroll: number
      totalHqPayroll: number
      snHqShare: number
    }

function round2(val: number): number {
  return Math.round(val * 100) / 100
}

/**
 * Distributes corp and HQ payroll overhead across SN branches by revenue share.
 * snHqPct must be read from the DB (businesses.hq_allocation_pct) — not hardcoded.
 */
export function calculateAllocations(
  branchRevenues: Array<{ branchId: string; totalRevenue: number }>,
  corpPayroll: number,
  hqPayroll: number,
  snHqPct: number,
): AllocationResult {
  const totalSnRevenue = branchRevenues.reduce((sum, b) => sum + b.totalRevenue, 0)

  if (totalSnRevenue === 0) {
    return {
      canAllocate: false,
      reason: 'Total SN revenue is $0 for this period — allocation cannot be calculated',
      allocations: [],
    }
  }

  const corpToSn = corpPayroll
  const hqToSn = round2(hqPayroll * snHqPct)

  const allocations: BranchAllocation[] = branchRevenues.map((branch) => {
    const revenueShare = branch.totalRevenue / totalSnRevenue
    return {
      branchId: branch.branchId,
      revenueShare,
      corpAllocation: round2(corpToSn * revenueShare),
      hqAllocation: round2(hqToSn * revenueShare),
      totalAllocation: round2((corpToSn + hqToSn) * revenueShare),
    }
  })

  return {
    canAllocate: true,
    allocations,
    totalSnRevenue,
    totalCorpPayroll: corpPayroll,
    totalHqPayroll: hqPayroll,
    snHqShare: hqToSn,
  }
}
