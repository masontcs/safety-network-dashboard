# CLAUDE.md — TESTING
## Testing Standards and Strategy

---

## TESTING PHILOSOPHY

Test behavior, not implementation.
A test should answer: "Does this do what the user/system needs?"
Not: "Does this call this internal function?"

Priority order (highest to lowest):
1. Parsers (payroll, revenue, fuel) — pure functions, highest ROI
2. Allocation math — financial calculations must be exact
3. API route access control — security-critical
4. UI components — lower priority, focus on critical paths

---

## TEST FRAMEWORK

```
Unit + Integration: Vitest
Component testing:  React Testing Library + Vitest
E2E (optional V2):  Playwright
```

Test files live next to the code they test:
```
lib/payroll/parser.ts       → lib/payroll/parser.test.ts
lib/allocation/index.ts     → lib/allocation/index.test.ts
app/api/payroll/route.ts    → app/api/payroll/route.test.ts
```

---

## PARSER TESTS — REQUIRED

Every parser (payroll, revenue, fuel) must have tests covering:

### Payroll Parser
```typescript
describe('parsePayrollDate', () => {
  it('subtracts 1 day from report date',
    () => expect(parsePayrollDate('Week of Mar 29, 2026')).toBe('2026-03-28'))
  it('handles year boundary',
    () => expect(parsePayrollDate('Week of Jan 1, 2026')).toBe('2025-12-31'))
  it('result is always a Saturday',
    () => expect(getDay(parseISO(parsePayrollDate('Week of Mar 29, 2026')))).toBe(6))
  it('throws on missing date text',
    () => expect(() => parsePayrollDate('No date here')).toThrow())
})

describe('skipZeroEmployee', () => {
  it('skips when all amounts are zero', ...)
  it('skips when all amounts are null', ...)
  it('keeps employee with any non-zero amount', ...)
  it('keeps employee with zero items but non-zero tax', ...)
})

describe('parsePayrollFile', () => {
  it('returns correct employee count from sample file', ...)
  it('dynamic payroll items list matches col D content', ...)
  it('stops at TOTAL sentinel', ...)
  it('calculates correct period date', ...)
  it('returns structured error on malformed file', ...)
})
```

### Revenue Parser
```typescript
describe('parseRevenueFile', () => {
  it('uses end date not start date from range', ...)
  it('merges Bakersfield Sales into Bakersfield', ...)
  it('merges Fresno Sales into Fresno', ...)
  it('total_revenue excludes sales_tax', ...)
  it('total_revenue = labor + rental + one_time_charges', ...)
  it('skips Year Totals and Report Totals rows', ...)
  it('maps SAFETY1003 to INC', ...)
  it('maps SNTCS1503 to TCS', ...)
  it('maps SNTSIGN to STS', ...)
  it('adds unknown company code to warnings, does not throw', ...)
})
```

### Fuel Parser
```typescript
describe('detectFuelVendor', () => {
  it('returns interstate for .csv files', ...)
  it('returns flyers for .xlsx files', ...)
  it('returns error for unknown extension', ...)
})

describe('parseInterstateSite', () => {
  it('parses CA-CITY OF BAKERSFIELD → { city: BAKERSFIELD, state: CA }', ...)
  it('parses CA-CITY OF SANTA MARIA → { city: SANTA MARIA, state: CA }', ...)
  it('handles non-standard format gracefully', ...)
})

describe('parseFuelFile', () => {
  it('calculates total_pretax = gallons * price_per_gallon for Interstate', ...)
  it('calculates total_pretax = total_with_tax - tax for Flyers', ...)
  it('tags WESTERN SHOP as business_tag=western_highways', ...)
  it('tags WEST HWY reporting group as business_tag=western_highways', ...)
  it('identifies new card names not in existing assignments', ...)
})
```

---

## ALLOCATION TESTS — REQUIRED

```typescript
describe('calculateAllocations', () => {
  it('returns canAllocate=false when total revenue is 0', ...)
  it('never divides by zero', ...)

  it('corp allocations sum back to total corp payroll (within $0.02)', () => {
    const result = calculateAllocations(...)
    const sum = result.allocations.reduce((s, b) => s + b.corpAllocation, 0)
    expect(Math.abs(sum - totalCorpPayroll)).toBeLessThanOrEqual(0.02)
  })

  it('HQ SN allocations sum back to sn_hq_share (within $0.02)', ...)

  it('branch with 30% revenue gets 30% of corp payroll', () => {
    const branches = [
      { branchId: 'a', totalRevenue: 30000 },
      { branchId: 'b', totalRevenue: 70000 },
    ]
    const result = calculateAllocations('2026-03-28', branches, 10000, 5000, 0.7813)
    expect(result.allocations[0].corpAllocation).toBe(3000)
    expect(result.allocations[1].corpAllocation).toBe(7000)
  })

  it('HQ WH/Signs shares do not appear in branch allocations', ...)
  it('uses hq_allocation_pct from DB, not hardcoded', ...)
})
```

---

## API ROUTE ACCESS CONTROL TESTS

For each sensitive endpoint, test all four roles:

```typescript
describe('GET /api/payroll/summary', () => {
  it('returns 401 with no session', ...)
  it('returns full admin payroll detail for admin role', ...)
  it('returns full admin payroll detail for executive role', ...)
  it('returns only admin payroll TOTAL (no detail) for district_manager', ...)
  it('returns only admin payroll TOTAL (no detail) for branch_manager', ...)
  it('returns 403 for district_manager accessing non-assigned branch', ...)
  it('returns 403 for branch_manager accessing different branch', ...)
})

describe('GET /api/payroll/employee/:id (admin-coded employee)', () => {
  it('returns full detail for admin role', ...)
  it('returns full detail for executive role', ...)
  it('returns 403 for district_manager', ...)
  it('returns 403 for branch_manager', ...)
})

describe('GET /api/allocation/summary', () => {
  it('returns data for admin', ...)
  it('returns data for executive', ...)
  it('returns 403 for district_manager', ...)
  it('returns 403 for branch_manager', ...)
})

describe('POST /api/import/payroll', () => {
  it('succeeds for admin', ...)
  it('returns 403 for executive', ...)
  it('returns 403 for district_manager', ...)
  it('returns 403 for branch_manager', ...)
})
```

---

## WHAT NOT TO TEST

- Supabase internals (trust that the library works)
- Next.js routing (trust the framework)
- UI pixel positions or exact styling
- Tests that just verify a function was called (test the output, not the implementation)

---

## RUNNING TESTS

```bash
# All tests
npx vitest run

# Watch mode during development
npx vitest

# Coverage report
npx vitest run --coverage

# Single file
npx vitest run lib/payroll/parser.test.ts
```

Target coverage for critical modules:
- lib/payroll: >90%
- lib/allocation: 100%
- lib/revenue: >90%
- lib/fuel: >85%
- API access control tests: 100% of role/branch combinations

---

## VERIFICATION CHECKLIST

- [ ] All parser tests pass on sample files from this project
- [ ] Allocation checksum test passes (sums reconcile within $0.02)
- [ ] API access control tests cover all four roles for every sensitive endpoint
- [ ] `npx vitest run` passes with zero failures before any PR/commit
- [ ] Coverage meets targets for critical modules
