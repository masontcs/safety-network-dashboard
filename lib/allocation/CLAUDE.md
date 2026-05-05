# CLAUDE.md — /lib/allocation
## Overhead Allocation Rules

---

## PURPOSE

This module calculates how Corp and HQ payroll overhead is distributed
across revenue-generating Safety Network branches for a given period.

Used ONLY by executive and admin dashboards. Branch managers never see allocated overhead.

---

## THE TWO ALLOCATION TYPES

### CORP Payroll (allocation_type = 'corp')
- 100% allocated to Safety Network
- Distributed to branches by revenue share

### HQ Payroll (allocation_type = 'hq')
- First split by business (SN gets 78.13%, WH gets 18.52%, Signs gets 3.35%)
- Then the SN share is distributed to branches by revenue share
- WH and Signs shares are tracked but excluded from SN dashboards

---

## FORMULAS — IMPLEMENT EXACTLY

```typescript
function calculateAllocations(
  periodDate: string,
  branchRevenues: Array<{ branchId: string; totalRevenue: number }>,
  corpPayroll: number,
  hqPayroll: number,
  snHqPct: number,   // 0.7813
): AllocationResult {

  const totalSnRevenue = branchRevenues.reduce((sum, b) => sum + b.totalRevenue, 0)

  // GUARD: never divide by zero
  if (totalSnRevenue === 0) {
    return {
      canAllocate: false,
      reason: 'Total SN revenue is $0 for this period — allocation cannot be calculated',
      allocations: []
    }
  }

  // Corp: 100% to SN, split by revenue share
  const corpToSn = corpPayroll  // 100%

  // HQ: split by business first
  const hqToSn = hqPayroll * snHqPct

  const allocations = branchRevenues.map(branch => {
    const revenueShare = branch.totalRevenue / totalSnRevenue

    return {
      branchId: branch.branchId,
      revenueShare,                                    // e.g. 0.3000 = 30%
      corpAllocation: round2(corpToSn * revenueShare),
      hqAllocation:   round2(hqToSn * revenueShare),
      totalAllocation: round2((corpToSn + hqToSn) * revenueShare),
    }
  })

  return { canAllocate: true, allocations }
}

function round2(val: number): number {
  return Math.round(val * 100) / 100
}
```

---

## HQ ALLOCATION PERCENTAGES

These are stored in the `businesses` table (`hq_allocation_pct` column), not hardcoded.
Always read from the DB. The values are:

```
Safety Network:   78.13%
Western Highways: 18.52%
Signs:             3.35%
```

If they ever change, only the DB needs updating — no code changes needed.

---

## WHAT COUNTS AS CORP vs HQ PAYROLL

Pull from `payroll_codes` table:
- `allocation_type = 'corp'` → corp payroll
- `allocation_type = 'hq'`   → HQ payroll
- `allocation_type = 'none'` → direct branch payroll (not allocated)

Join `payroll_transactions` to `payroll_codes` via `payroll_code_id`.

---

## WHAT COUNTS AS BRANCH REVENUE

Pull from `revenue_transactions` where:
- `branch_id` matches a branch with `is_revenue_generating = true`
- `entity_id` is an SN entity (not WH or Signs — filter by business_id)
- `period_date` matches the requested period

`total_revenue = labor + rental + one_time_charges` (not including sales_tax)

---

## RETURN TYPE

```typescript
type AllocationResult = {
  canAllocate: boolean;
  reason?: string;          // populated when canAllocate = false
  allocations: BranchAllocation[];
  totalSnRevenue?: number;
  totalCorpPayroll?: number;
  totalHqPayroll?: number;
  snHqShare?: number;
}

type BranchAllocation = {
  branchId: string;
  revenueShare: number;     // 0.0 to 1.0
  corpAllocation: number;   // $ amount
  hqAllocation: number;     // $ amount
  totalAllocation: number;  // corp + hq combined
}
```

---

## VERIFICATION CHECKLIST

- [ ] `totalSnRevenue === 0` returns `canAllocate: false` — never divides by zero
- [ ] Corp allocation: `sum of all branch corpAllocations === corpPayroll` (within $0.02 rounding tolerance)
- [ ] HQ allocation: `sum of all branch hqAllocations === hqToSn` (within $0.02 rounding tolerance)
- [ ] HQ percentages are read from DB, not hardcoded in logic
- [ ] WH and Signs HQ shares are tracked in the return value but not added to SN branch allocations
- [ ] Rounding uses `round2()` — never `toFixed()` (which returns a string)
- [ ] This module has zero UI code and zero API route code — pure calculation only
