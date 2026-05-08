# SESSION.md — Safety Network Operations Dashboard
## Last updated: May 8, 2026 — Session: Staged payroll transactions for pending employees

## PRODUCTION URL
**https://safety-network-dashboard.vercel.app/login**
> When reading this file, always surface this URL in the summary response.

---

## 1. CURRENT PROJECT STATE

A private, role-scoped operations dashboard for Safety Network (3 entities: INC, TCS, STS) built on Next.js 14 App Router + TypeScript, Supabase (PostgreSQL + Auth), Tailwind CSS, Recharts, and the Anthropic Claude API. The app ingests weekly payroll (.xlsm), revenue (.xls), and fuel (.csv/.xlsx) files and presents analytics dashboards locked to each user's assigned branches across four roles (admin, executive, district_manager, branch_manager). All four role dashboards are fully built and rendering with live data. The employee list + detail views are complete for all roles. The import pipeline, review queue, and all admin tools are fully operational.

---

## 2. WHAT IS FULLY BUILT AND WORKING

### Database (Supabase)
- [x] 20 tables across 9 migrations (applied to production project)
- [x] Migration 1: reference tables (businesses, branches, entities, payroll_codes, revenue_codes, payroll_item_groups, payroll_items)
- [x] Migration 2: user tables (user_profiles, user_branch_assignments)
- [x] Migration 3: employee tables (employees, employee_entity_assignments, fuel_card_assignments)
- [x] Migration 4: import header tables (payroll_imports, revenue_imports, fuel_imports)
- [x] Migration 5: transaction tables (payroll_transactions, payroll_taxes, revenue_transactions, fuel_transactions)
- [x] Migration 6: RLS policies on all tables
- [x] Migration 7: fiscal_months table
- [x] Migration 8: fiscal_quarters + fiscal_quarter_months tables
- [x] Migration 9 (20260506000001): fiscal_month_targets redesign
- [x] Migration 10 (20260506000002): fiscal_quarters + fiscal_quarter_months
- [x] Migration 11 (20260506000003): access_requests table + RLS
- [x] Migration 12 (20260506000004): backfill fuel_transaction branches
- [x] Migration 13 (20260506000005): fuel_imports UNIQUE(vendor, date_range_start, date_range_end) constraint
- [x] Migration 14 (20260506000006): user_profiles.must_change_password boolean NOT NULL DEFAULT false
- [x] Migration 15 (20260507000001): corrects period_date year bug — updates payroll_transactions, payroll_taxes, payroll_imports where EXTRACT(year) < 100 to add 2000 years
- [x] Migration 16 (20260507000002): employee_allocations + employee_allocation_overrides tables — percentage splits, effective dates, status workflow, RLS, indexes
- [x] Seed data: 3 businesses, 3 entities, 7 branches, 12 payroll item groups, 87 payroll codes, 196 payroll items, 17 revenue codes

### File Parsers (`/lib/`)
- [x] Payroll parser — parses QuickBooks .xlsm, splits "LAST, FIRST M" names, handles hyphenated surnames, dynamic payroll item discovery, period date calculation (subtract 1 day → Saturday); rejects 2-digit years with a clear ParseError
- [x] Revenue parser — parses .xls Invoice Summary; dynamic " Sales" suffix stripping (any branch); Sacramento → Modesto merge map (MERGED_BRANCHES — easy to extend); entity code mapping; uses END date of range
- [x] Fuel parser — Interstate (.csv) and Flyers (.xlsx), site parsing, WH tagging, calculated totals for both vendors

### API Routes (`/app/api/`)
- [x] `POST /api/import/payroll` + `confirm-replace` — admin only, duplicate detection, AI triggers
- [x] `POST /api/import/revenue` + `confirm-replace`
- [x] `POST /api/import/fuel` + `confirm-replace` — duplicate check scoped by vendor (Interstate and Flyers are independent)
- [x] `GET /api/payroll/summary` — admin sum rule enforced (managers get total only, no detail)
- [x] `GET /api/payroll/employee/[id]` — 403 for managers on admin-coded employees
- [x] `GET /api/employees/[id]/detail` — admin/executive only; returns employee info, all payroll history (paginated, with item+group names), all fuel history (paginated)
- [x] `GET /api/revenue/summary` — `.limit(50000)` applied
- [x] `GET /api/fuel/summary` — paginated with PAGE_SIZE loop
- [x] `GET /api/allocation/summary` — exec/admin only
- [x] `GET|PATCH /api/employees` + `[id]/name` — display_name computed, raw_name never returned
- [x] `GET /api/periods/available` + `latest`
- [x] `GET|POST /api/fiscal-months` + `[id]`
- [x] `GET|POST /api/fiscal-quarters` + `PATCH|DELETE /api/fiscal-quarters/[id]`
- [x] `GET|POST /api/admin/users` + `[id]`
- [x] `GET|POST /api/admin/review` + action routes for employee assignments, fuel cards, payroll items; review queue returns all active employees with entity assignments for the search dropdown
- [x] `GET|POST /api/admin/access-requests` — GET returns requests + all active branches (grouped); POST creates a pending request
- [x] `PATCH /api/admin/access-requests/[id]` — approve (creates auth user with temp password, sets must_change_password=true) or deny
- [x] `POST /api/auth/clear-must-change-password` — clears must_change_password flag for the current user after first login password change
- [x] `GET /api/data-explorer/payroll`, `revenue`, `fuel`, `export` — admin/executive only; filter + paginate + CSV export
- [x] `GET /api/payroll/hours-by-week`, `direct-labor-detail`, `overtime-summary` — `.limit(50000)` applied to payroll_transactions queries
- [x] `GET /api/employees/[id]/detail` — returns `taxHistory: [{ periodDate, amount }]`
- [x] `GET /api/periods/years` — returns available calendar years with imported data
- [x] `GET /api/employees/[id]/allocations` — returns default allocations + weekly overrides (last 52) for an employee
- [x] `POST /api/employees/[id]/allocations` — admin-only; validates splits sum to 100, effectiveFrom is Saturday; closes previous open allocation, inserts new group auto-approved
- [x] `PATCH /api/employees/[id]/allocations/[allocationId]` — approve or deny entire group atomically (by employee_id + effective_from)
- [x] `DELETE /api/employees/[id]/allocations/[allocationId]` — pending-only delete; blocks deleting approved allocations
- [x] `POST /api/employees/[id]/allocation-overrides` — admin-only; weekly override, upserts by (employee_id, period_date, branch_id)
- [x] `PATCH /api/employees/[id]/allocation-overrides/[overrideId]` — approve or deny entire period group atomically
- [x] `GET /api/admin/allocations` — returns pendingAllocations, pendingOverrides, activeAllocations with displayName + branchName
- [x] `GET /api/admin/allocations/pending-count` — sum of pending allocations + overrides (used for sidebar badge)
- [x] `GET /api/branches` — all active branches (used for allocation form dropdowns)

### AI Integration (`/lib/ai/`)
- [x] Employee name matching (payroll + fuel imports)
- [x] Payroll item group suggestion
- [x] Prompts in `/lib/ai/prompts.ts`, non-blocking, results stored for human review

### Allocation Engine (`/lib/allocation/`)
- [x] Corp (100% to SN) and HQ (78.13% SN / 18.52% WH / 3.35% Signs) allocation math
- [x] Zero-revenue guard, rounding with `round2()`, percentages read from DB
- [x] `lib/allocation/employee-allocation.ts` — pure resolution logic: `resolveEmployeeAllocation` (priority: approved override > approved active default > 100% home branch), `validateSplitTotal` (±0.01 tolerance), `isSaturday`
- [x] All 6 financial routes now apply per-employee allocation splits: admin/overview, payroll/summary, fuel/summary, payroll/hours-by-week, payroll/direct-labor-detail, fuel/top-consumers

### Frontend
- [x] Landing page (`/`) — animated canvas dot grid (pulsing opacity, 28px grid desktop / sparse mobile); Safety Network logo; Sign In + Request Access CTAs; fully mobile responsive
- [x] Login page (`/login`) — mobile responsive card
- [x] `/change-password` — required on first login; masked fields; blocks same-as-temp password; clears flag on success; middleware enforces (cannot skip)
- [x] `/request-access` — branch dropdown shows all active branches grouped: Operations / Corporate
- [x] `DashboardShell` — dark sidebar (desktop) + `MobileBottomNav` (mobile); role-aware; sidebar hidden on mobile
- [x] `MobileBottomNav` — fixed bottom nav with role-aware items; slide-up drawer for overflow admin items; 44px tap targets
- [x] `ManagerDashboard` — fiscal month dropdown + YTD button; defaults to most recent fiscal month with data; weekly bar chart (Revenue/Payroll/Fuel grouped bars) with click-to-inspect direct labor panel; payroll breakdown card (Direct/Admin/Taxes stacked bar); Revenue Breakdown table (Labor/Rental/One-Time/Total by week); mobile 2×2 metric grid + revenue-only chart
- [x] `AdminDashboard` — all-branches aggregate with branch selector, full allocation visible; month/quarter/year toggle (year mode uses `/api/periods/years`); Direct Payroll card shows wages + employer taxes breakdown; mobile: 2×2 metric cards, revenue-only chart, compact variance row, branch list; desktop: unchanged
- [x] `ExecutiveDashboard` — all 7 branches side by side, full direct + admin payroll detail, Corp/HQ allocation breakdown, net after overhead, missing revenue alerts, 13-week trend, waterfall, collapsible payroll detail tables; Month/Quarter/Year toggle; employee names clickable to detail pages
- [x] `DistrictDashboard` — fiscal month dropdown + YTD button + branch selector; aggregate = branch comparison cards (using `BranchPerformanceCard`) + district totals table; single branch = manager-style layout (bar chart, payroll breakdown card, revenue breakdown table); employee names clickable; mobile branch list or revenue table per mode
- [x] `BranchPerformanceCard` (`components/ui/BranchPerformanceCard.tsx`) — shared card with 3-line Recharts LineChart (Revenue #ff6b00, Payroll #888888, Fuel #cc4444); dots, hover tooltip, right-aligned legend; used in Admin and District branch lists
- [x] `EmployeeListClient` (`components/employees/EmployeeListClient.tsx`) — debounced search, filter bar (branch, entity, labor type), sortable table, pagination, status/entity pills, skeleton loading; all roles with proper scope
- [x] `EmployeeDetailClient` — all roles with branch-access guard; preferred name + legal name display; inline Edit Name form; assignment pills; payroll history table + charts (with per-period employer tax rows in `#cc4444`); "Employer Taxes" summary card; weekly employer taxes bar chart; Rate History table (25/page); Fuel Cost per Week + Gallons charts; fuel transaction table with $/Gal column; branch history + transfer form
- [x] `EmployeeDetailClient` — Branch Allocation section (admin only): shows active default allocations table + weekly overrides (last 52 weeks); "+ Set Allocation" form with multi-branch splits, percentage inputs, effective-from date, notes; auto-closes previous open allocation on save
- [x] `AllocationsClient` (`components/allocations/AllocationsClient.tsx`) — Pending and Active tabs; Pending tab: two sub-tables (Default Allocations, Weekly Overrides) with Approve/Deny buttons; Active tab: currently open approved allocations
- [x] `/admin/allocations` page — admin-only server component wrapping `AllocationsClient`
- [x] `ReviewClient` — 4th section "Pending Allocations" added; fetches from `/api/admin/allocations` on mount; inline Approve/Deny for both allocations and overrides; `totalPending` now includes allocation counts
- [x] `Sidebar` — Allocations nav item (SplitIcon) added for admin role; orange dot badge when `allocationCount > 0`; fetches `/api/admin/allocations/pending-count` in parallel with access-requests count
- [x] Admin pages: `/admin/import`, `/admin/review`, `/admin/users`, `/admin/employees`, `/admin/fiscal-months`, `/admin/targets`, `/admin/fiscal-quarters`, `/admin/access-requests`, `/admin/data-explorer`, `/admin/allocations`
- [x] Executive pages: `/executive/data-explorer`, `/executive/employees`
- [x] Manager/District employee pages: `/manager/employees/[id]`, `/district/employees/[id]` — detail view scoped to direct labor in assigned branches
- [x] `AccessRequestsClient` — pending/reviewed tables; approve modal with temp password field (unmasked, Generate button, Copy button, confirm field, hint note); deny modal; branch dropdown grouped Operations/Corporate
- [x] `DataExplorerClient` — filter bar (dataset, branch, entity, date range, vendor); summary metric cards per dataset; sortable paginated table (50 rows/page); CSV export
- [x] `TargetVarianceRow` component — weekly and compact (mobile) variants; green/yellow/red thresholds
- [x] Chart components: `BarChart`, `TrendLineChart`, `WaterfallChart`
- [x] UI components: `MetricCard`, `Skeleton`, `StatusPill`, `BranchSelector`, `DateRangePicker`, `ThreeDotMenu`
- [x] Middleware: protects all routes; redirects unauthenticated users to /login; redirects users with must_change_password=true to /change-password regardless of path; /change-password blocked after flag cleared

### Utilities
- [x] `lib/utils/access.ts` — `UserAccess` type, `canAccessBranch()`
- [x] `lib/utils/errors.ts` — `AppError`, `ParseError`, `AuthError`, `DuplicateImportError`, `NotFoundError`
- [x] `lib/utils/format.ts` — `formatCurrency`, `formatPercent`, `round2`
- [x] `lib/utils/date.ts` — `getDateRange`, `getTrendStart`, `getMostRecentSaturday`, etc.

---

## 3. WHAT IS IN PROGRESS / PARTIALLY BUILT

- **Migrations pending manual application in Supabase SQL editor (zobgzhgwgduziszzevzp):**
  - `20260507000003` — `business_tag` on `employee_entity_assignments`:
    ```sql
    ALTER TABLE employee_entity_assignments
      ADD COLUMN IF NOT EXISTS business_tag text
        CHECK (business_tag IN ('western_highways', 'signs'));
    ```
  - `20260508000001` — staging tables for pending payroll data (run after the above):
    ```sql
    CREATE TABLE payroll_staged_transactions ( ... );
    CREATE TABLE payroll_staged_taxes ( ... );
    ```
    (copy the full SQL from `supabase/migrations/20260508000001_payroll_staged_transactions.sql`)

---

## 3a. RECENT CHANGES (May 8, 2026) — Staged payroll transactions for pending employees

### Problem Solved
When a payroll import encountered a new/unknown employee, their transaction and tax data was discarded. Admin confirmed them in the review queue (giving them a payroll code), but the data from the original import was already gone — requiring a full re-import.

### Fix: Staging System

**New tables (`supabase/migrations/20260508000001_payroll_staged_transactions.sql`):**
- `payroll_staged_transactions` — holds line items for pending employees, keyed by `assignment_id`
- `payroll_staged_taxes` — holds tax amounts for pending employees
- Both cascade-delete if the assignment is deleted
- Indexed on `assignment_id` for fast lookup at confirmation time

**`lib/payroll/import-helpers.ts`:**
- `ResolvedEmployee` gains `assignmentId: string` (the `employee_entity_assignments.id`)
- `resolveEmployees` now selects `id` from existing assignments and uses `.select('id').single()` on new inserts to return the assignment ID
- `insertPayrollData`: pending employees (`payrollCodeId === null`) now have all line items written to `payroll_staged_transactions` and taxes to `payroll_staged_taxes` instead of being discarded. The `pendingCount` still increments so the review queue badge updates correctly.

**`app/api/admin/review/employee-assignments/[id]/route.ts`:**
- New `deployStaged(employeeId, entityId, payrollCodeId)` helper: fetches all staged rows for the assignment, inserts them into `payroll_transactions` / `payroll_taxes` with the confirmed `employee_id` and `payroll_code_id`, then deletes the staged rows.
- `new_employee` mode: calls `deployStaged` after confirming the assignment
- `link_existing` mode: calls `deployStaged` with `existingEmployeeId` (the final employee_id) so data lands under the right person even if the import created a placeholder record

### Result
Import once → pending employees are staged → confirm in review queue → data deploys automatically. Re-importing to capture new employees is no longer necessary.

### Note on existing data
The Feb 2026 imports (4 weeks, imported 2026-05-08) have no staged data — they were imported before this fix. Direct employees from those imports still need one re-import to populate their transactions. After that, future imports will stage correctly.

---

## 3b. RECENT CHANGES (May 7, 2026) — WH/Signs employee business tag

### WH/Signs Employee Business Tag Feature

Employees in the import review queue can now be tagged as belonging to **Western Highways** or **Signs Fabrication** so they are permanently excluded from Safety Network reports.

**Migration (`supabase/migrations/20260507000003_employee_business_tag.sql`):**
- Adds `business_tag text CHECK ('western_highways', 'signs')` to `employee_entity_assignments`
- **Pending manual application in Supabase SQL editor**

**`lib/supabase/database.types.ts`:** `employee_entity_assignments` Row/Insert/Update updated with `business_tag: BusinessTag | null`

**`lib/payroll/import-helpers.ts`:**
- `ResolvedEmployee` type: added `businessTag: string | null` field
- `resolveEmployees`: fetches `business_tag` from existing assignments and propagates it
- `insertPayrollData`: skips business-tagged employees entirely — no transactions, no taxes, no `pendingCount` increment. These employees remain in the DB for future reference but never appear in SN reports.

**`app/api/admin/review/employee-assignments/[id]/route.ts`:**
- New `tag_business` mode: validates `businessTag ∈ {'western_highways', 'signs'}`, sets `business_tag` + `is_confirmed = true` on the assignment

**`components/review/ReviewClient.tsx`:**
- `EmployeeMatchRow` now has **"Tag: Western Hwy"** and **"Tag: Signs"** buttons (beside Skip and Confirm) that immediately tag and dismiss the item from the queue

---

## 3b. RECENT CHANGES (May 7, 2026) — Import history panel

### New API route: `GET /api/import/history`
Admin-only. Accepts `?type=payroll|revenue|fuel`. Returns all imports sorted by period date descending.
- **Payroll:** resolves `entity_id` → entity code (INC/TCS/STS) via `entities` table; returns `{ id, periodDate, entityCode, importedAt, status }`
- **Revenue:** returns `{ id, periodDate, importedAt, status }`
- **Fuel:** returns `{ id, vendor, dateRangeStart, dateRangeEnd, importedAt, status }`

### Import History panel (`components/import/ImportClient.tsx`)
New card below the three upload sections with **Payroll / Revenue / Fuel** tab switcher. Switching tabs fetches that type's history on demand. After each successful upload the panel auto-switches to the relevant tab and refreshes so the new import is immediately visible. Each tab shows a table with columns appropriate to the data type (entity pill for payroll, vendor pill for fuel).

- **Commit:** `f172700`

---

## 3b. RECENT CHANGES (May 7, 2026) — 2-digit year payroll import fix

### Problem
QuickBooks sometimes exports dates with 2-digit years ("Week of Mar 1, 26" instead of "Mar 1, 2026"). A prior session added strict validation that threw a `ParseError` and blocked the import entirely.

### Fix (`lib/payroll/parse-helpers.ts`, `lib/payroll/parser.ts`)
`extractPeriodDate` now auto-corrects 2-digit years (getFullYear < 100) by adding 2000, then pushes a warning to the optional `warnings` array instead of throwing. The parser.ts call site passes the existing `warnings` array through so the correction message surfaces in the import response. Test updated from "expect throw" to "expect corrected date + warning."

- **225 tests passing, 0 failing** (updated from prior count)
- **Commit:** `b02025c`

---

## 3b. RECENT CHANGES (May 7, 2026) — Admin payroll district/manager dashboard fix

### Root cause
Each branch has admin payroll codes under **three different entities** (INC/TCS/STS). Only one entity has actual transactions for a given import. The previous code resolved a single entity per branch from `payroll_codes` and used it to scope the admin codes query (`WHERE entity_id = resolvedEntityId`). If the resolved entity was one of the two that had no transactions, the code returned 0 results and admin payroll showed $0. No amount of "prefer admin codes" prioritization could fix this because all three entities have admin salary codes per branch — the pick was inherently arbitrary.

### Fix: branch-scoped admin code lookup in `app/api/payroll/summary/route.ts`
Step 3 now splits on whether `branchId` is present:
- **With `branchId`:** queries admin codes by `branch_id` + `is_active` (all entities). The transaction query returns only rows with actual data regardless of entity.
- **Without `branchId`** (admin/executive cross-branch view): continues using `entity_id` scoping as before.

Tax query updated to match: when `branchId` is present, filters by `employee_id` + `period_date` only (no entity filter). When entity-scoped (no branchId), entity filter is kept to prevent cross-entity double-counting.

### Supporting fixes (less critical, applied first)
- `app/district/page.tsx` — entity resolution now queries admin salary codes first, falls back to any active code. Became less relevant after the route fix but is still cleaner.
- `app/manager/page.tsx` — same admin-first entity resolution pattern.
- Route auto-resolve (when `entityId` param is empty) — also prefers admin salary codes.

### Verification
- Bakersfield: $10,951.55 admin salary + $1,221.29 taxes = **$12,172.84** ✓ matches dashboard
- Fresno: $7,728.66 admin salary + $993.06 taxes = **$8,721.72** ✓ matches dashboard
- All data is under entity `8c0aa308` (TCS), period_date `2026-03-07`

---

## 3b. RECENT CHANGES (May 7, 2026) — Payroll consistency + dashboard fixes

### Animated Expand-on-Hover Sidebar
- `components/layout/Sidebar.tsx` fully rewritten: 48px collapsed → 220px expanded on `onMouseEnter`/`onMouseLeave`; `width` + `min-width` CSS transition 200ms ease-in-out; `overflow: hidden` keeps sibling `<main>` filling the gap
- Branding: 36×36 orange "SN" badge always visible; "Safety Network" label fades in with 100ms opacity delay when expanding
- Nav labels: `opacity: expanded ? 1 : 0`, 100ms transition, 100ms delay on expand / instant on collapse
- Badges: full count pill when expanded; 8px orange dot when collapsed
- Added `LogOutIcon` + Sign Out button at bottom (calls `supabase.auth.signOut()`)
- `app/globals.css`: replaced old `.sidebar-icon` rules with `.sidebar-link` / `.sidebar-link-active` classes matching new flex-row layout
- **Commits:** `23a24b3`, `e77d3f5`

### HQ Allocation Settings Page (`/admin/settings`)
- `GET /api/admin/settings/hq-allocation` — fetches `hq_allocation_pct` from `businesses` for SN, WH, SIGNS; returns `{ safetyNetwork, westernHighways, signs }` as percentages
- `PATCH /api/admin/settings/hq-allocation` — validates sum = 1.0 ± 0.0001; updates all three rows atomically with `Promise.all`
- `components/settings/SettingsClient.tsx` — three `<input type="number">` fields; live running total; "✓ Ready to save" / "must equal exactly 100%" feedback; Save button disabled until total is valid; converts display % ↔ stored decimal
- `app/admin/settings/page.tsx` — server component, admin-only gate
- Sidebar: Settings gear icon added to admin nav items

### Test Accounts Panel (in /admin/users)
- `GET|POST|DELETE /api/admin/test-accounts` — manages three pre-defined test accounts: `test-executive@safetynetwork.com` (executive), `test-district@safetynetwork.com` (district_manager, Bakersfield+Fresno), `test-manager@safetynetwork.com` (branch_manager, Bakersfield); password `TestPass2026!`; `must_change_password: false`
- POST is idempotent (skips already-existing accounts); branch IDs resolved dynamically by name; DELETE cleans up assignments → profile → auth user in sequence
- `UsersClient` — new card with amber "Development / Testing Only" badge; per-account status dots; Create Test Accounts / Delete Test Accounts buttons; refreshes both test account list and main users list after each action
- **Commit:** `e77d3f5`

### Branch Performance Card Payroll Fixes
- `app/api/admin/overview/route.ts` — `allBranchIds` set now includes `bAdminPayroll` keys (previously missing, causing branches with only admin payroll to be excluded from branch grid)
- `components/dashboard/AdminDashboard.tsx` — desktop `BranchPerformanceCard`: `payroll` prop now sums `directPayroll + adminPayroll + employerTaxes` (was `directPayroll` only); `noData` check now requires all three payroll types to be zero
- `components/dashboard/AdminDashboard.tsx` — mobile branch list: same `noData` fix
- `components/dashboard/DistrictDashboard.tsx` — `BranchComparisonCard`: `noData` requires `admin === 0` (was missing); mobile branch list: `bNoData` requires `bAdmin === 0`
- **Commit:** `7dcd0b5`

### Removed Allocation Toggle from Manager and District Dashboards
- Per access-control design: Corp/HQ overhead allocation is for admin and executive only
- `ManagerDashboard`: removed `allocationOn` + `branchAllocAlloc` state, allocation fetch `useEffect`, `netAfterAlloc`/`netAfterAllocPct` derived values, toggle button from `selectorBar`, all conditional GP card labels; GP card now always shows "Gross Profit" (Revenue − Total Payroll − Fuel)
- `DistrictDashboard`: same removals (109 lines deleted total across both files)
- **Commit:** `160c5ed`

### Systemic Payroll Consistency Fix
Three root causes fixed, all verified with 225-test suite:

**1. Sparkline tooltip $0 payroll (`app/api/admin/overview/route.ts`)**
The API tracked `bPayByPeriod` (direct payroll per branch per period) but tracked admin payroll and taxes at the branch total level only — no per-period breakdown. Result: `payrollByPeriod` was direct-only, so the sparkline tooltip showed $0 for weeks with admin-only payroll while the card header (which summed all three) showed the correct total.
Fix: added `bAdminPayByPeriod` and `bTaxByPeriod` per-branch per-period maps; `payrollByPeriod` now returns `direct + admin + taxes` per period per branch.

**2. District/branch manager $0 admin payroll (`app/api/payroll/summary/route.ts`)**
The route gated the entire admin payroll + tax query on `if (entityId)`. The page-level entity lookup (`payroll_codes WHERE branch_id IN (branchIds)`) can return empty string if no matching code exists. Empty string is falsy → `if (entityId)` silently skips the admin payroll query entirely.
Fix: after reading `entityId` from the request, auto-resolve it from `payroll_codes WHERE branch_id = branchId AND is_active = true LIMIT 1` when not provided or empty. Both manager and district pages still pass `entityId` as before — this is a defensive fallback for robustness.

**3. `SelectedWeekPanel` wrong gross profit (`AdminDashboard.tsx`)**
`const pay = data?.directPayroll ?? 0` → `gp = rev - pay - fuel` — ignored admin payroll and employer taxes.
Fix: uses `calcTotalPayroll(data)` + `calcGrossProfit(...)` from the new shared utility. Label changed from "Direct Payroll" to "Total Payroll".

**New shared utility (`lib/utils/payroll-totals.ts`)**
- `calcTotalPayroll({ directPayroll, adminPayroll?, employerTaxes? }): number` — canonical formula
- `calcGrossProfit({ revenue, directPayroll, adminPayroll?, employerTaxes?, fuel }): number`
- `calcGrossProfitPct(grossProfit, revenue): number` — zero-guarded

**Tests (`lib/utils/payroll-totals.test.ts`)**
16 tests covering: correct sum of all three payroll components, missing optional fields default to 0, card header === sparkline formula consistency, GP = revenue − total payroll − fuel, profit % = GP / revenue × 100, zero-revenue guard.

- **Commit:** `c9ec283`

---

## 3b. RECENT CHANGES (May 7, 2026) — Employee allocation system

### Employee Allocation System
Full end-to-end split of an employee's payroll and fuel costs across multiple branches by percentage for reporting purposes. Underlying transactions are never modified — allocation is a pure reporting layer.

**Resolution priority:** approved weekly override > approved active default > 100% home branch (payroll code's branch_id for payroll; fuel_transaction.branch_id for fuel)

**Database (Migration 16):**
- `employee_allocations`: default recurring split (employee_id, branch_id, percentage, effective_from/to, status)
- `employee_allocation_overrides`: one-off weekly split (employee_id, period_date, branch_id, percentage, status)
- Status workflow: pending → approved | denied
- Approval is atomic per group (all rows sharing the same employee_id + effective_from / period_date)
- UNIQUE constraints: (employee_id, branch_id, effective_from) and (employee_id, period_date, branch_id)

**Pure logic library (`lib/allocation/employee-allocation.ts`):**
- `resolveEmployeeAllocation(employeeId, periodDate, homeBranchId, overrides, defaults) → BranchSplit[]`
- `validateSplitTotal(splits) → boolean` — ±0.01 tolerance
- `isSaturday(dateStr) → boolean`
- 13 tests covering all edge cases: pending ignored, date range filtering, override priority, wrong period, wrong employee

**Financial route changes (6 routes):**
- All 6 routes now fetch `employee_allocations` and `employee_allocation_overrides` after collecting employee IDs
- Per-transaction: `resolveEmployeeAllocation` returns splits → amount multiplied by percentage and attributed to each target branch
- For branchId-filtered requests: only the portion allocated to that branch is included
- Payroll routes: removed branchId filter from payroll_codes query (allocation handles redistribution); kept manager access scoped by access.branchIds
- Fuel routes: employee-linked transactions use allocation; card-linked (no employee_id) use branch_id as-is

**Commit:** `1df30e7`

---

## 3b. RECENT CHANGES (May 7, 2026) — Audit fixes + employer taxes

### Employer Taxes Surfaced Everywhere
- `app/api/admin/overview/route.ts` — fetches `payroll_taxes` with full pagination; attributes taxes to branches via `employee_entity_assignments → payroll_codes → branch_id`; `gp = rev - pay - tax - fuel`; `totals.employerTaxes` added
- `app/api/payroll/summary/route.ts` — taxes scoped to employees with transactions in the period; returns `taxes.total` via `applyPayrollSumRule`
- `app/api/employees/[id]/detail/route.ts` — fetches `payroll_taxes` for the employee; response includes `taxHistory: [{ periodDate, amount }]`
- `AdminDashboard` — Direct Payroll card shows combined wages + employer taxes with breakdown sub-line; year view mode added (uses `/api/periods/years`); `grossProfit` includes employer taxes
- `ExecutiveDashboard` — `totalPayroll = directTotal + adminTotal + employerTaxes`; `grossProfit = rev - totalPayroll - fuel`
- `DistrictDashboard` — per-branch GP includes `tax` prop; district totals table correct
- `ManagerDashboard` — already correct: `totalPayroll = totalDirect + totalAdmin + totalTax`; confirmed by audit
- `EmployeeDetailClient` — "Employer Taxes" 5th summary card; weekly employer taxes bar chart (`#cc4444`); per-period tax rows injected inline after last transaction row for that period

### System Audit Fixes
- **Date parser 2-digit year (critical):** `lib/payroll/parse-helpers.ts` — after parsing, validates `parsed.getFullYear() >= 2000`; throws `ParseError` with clear message including the bad year. Test added: `"Week of Mar 8, 26"` throws with `/4-digit year/i` in `.detail`.
- **Migration `20260507000001`:** corrects existing `period_date` values stored as year 26 CE in `payroll_transactions`, `payroll_taxes`, and `payroll_imports` (adds 2000 years where EXTRACT(year) < 100). Applied to production.
- **1000-row cap fixes:** `.limit(50000)` added to `revenue/summary`, `payroll/direct-labor-detail`, `payroll/hours-by-week`, `payroll/overtime-summary`
- **Manager dashboard GP verified correct** — taxes already included via `taxTotal` accumulation

---

## 3c. RECENT CHANGES (May 6–7, 2026) — Employee list, clickable names, Executive toggle, BranchPerformanceCard, review queue

### Employee List Pages + Clickable Names in Dashboards
- `GET /api/employees` rewritten — rich filtering (search, branchId, entityCode, laborType), sorting, pagination; admin/executive get full list, managers scoped to assigned branches
- `EmployeeListClient` — debounced search, filter bar, sortable table, pagination, status/entity pills, skeleton loading
- `/admin/employees` and `/executive/employees` — server-component list pages
- `/manager/employees/[id]` and `/district/employees/[id]` — detail pages; `GET /api/employees/[id]/detail` updated to allow manager roles with branch-access guard (direct labor only)
- Employee `displayName`s in ExecutiveDashboard, ManagerDashboard, DistrictDashboard (payroll tables, direct labor panel, top consumers, OT table) are now clickable links to the detail page
- `Sidebar` — People icon added for admin and executive roles
- `EmployeeDetailClient` enhancements: Total Weeks replaces Fuel Cost summary card; paginated Rate History table (25/page); Payroll Items & Rate History summary table; Fuel Cost per Week bar chart alongside Gallons chart; $/Gal column in fuel table

### Executive Dashboard — Month/Quarter/Year Toggle
- Removed old weekly view navigator and `DateRangePicker`; replaced with same `[Month][Quarter][Year]` 3-button toggle used on Manager/District/Admin
- Allocation card sub-labels now derive from `periodDate`

### BranchPerformanceCard
- New `components/ui/BranchPerformanceCard.tsx` — shared Recharts `LineChart` with 3 lines: Revenue (#ff6b00), Payroll (#888888), Fuel (#cc4444); dots, hover tooltip, right-aligned legend, 80px chart area, x-axis date labels
- `AdminDashboard` — SVG sparkline + old BranchCard replaced with `BranchPerformanceCard`; `/api/admin/overview` extended to return `payrollByPeriod` and `fuelByPeriod` per branch
- `DistrictDashboard` — `BranchComparisonCard` delegates to `BranchPerformanceCard`

### Employee Match Review Queue Redesign
- New assignment UI replaces raw payroll code dropdown:
  - New employee mode: select Branch + Labor Type → server resolves payroll code
  - Link existing mode: searchable employee dropdown with entity assignment pills; shows override Branch/Labor Type when linked employee has no assignment for the import entity
  - Orange Confirm button (disabled until valid) + Skip on every row; inline error if no matching code exists
- `GET /api/admin/review` — now returns all active employees with entity assignments for the search dropdown
- `PATCH /api/admin/review/employee-assignments/[id]` — updated to accept branch + laborType and resolve payroll code server-side

---

## 3d. RECENT CHANGES (May 6, 2026) — Manager/District Fiscal Month Selector

### Manager and District Dashboard — Fiscal Month Selector

Both `ManagerDashboard` and `DistrictDashboard` were fully rewritten to match the AdminDashboard's fiscal month selector pattern. The old week navigator (‹ ›) and Weekly/MTD/YTD toggle are gone.

**ManagerDashboard (`components/dashboard/ManagerDashboard.tsx`)**
- Props simplified: `{ branchId, entityId }` — `initialWeek` and `initialView` removed
- On mount: fetches `/api/fiscal-months` and `/api/periods/available` in parallel; selects the fiscal month containing the most recently imported period date; falls back to first fiscal month
- Fiscal month dropdown + YTD button in header; selecting a fiscal month clears YTD; clicking YTD clears the dropdown highlight
- Date range = `selectedFiscal.start_date → selectedFiscal.end_date`; YTD = `year-01-01 → latest fiscal month end`
- Data fetch strategy: revenue and fuel fetched as date range (single call each); payroll fetched per-Saturday (N calls for N weeks in range, all in parallel via `Promise.all`)
- Weekly bar chart (Recharts): Revenue / Direct Payroll / Fuel grouped bars; clicking a Revenue bar opens the direct labor detail panel for that week; selected bar highlighted `#ffaa44`; `SelectedWeekPanel` dismissed via ×
- Payroll breakdown card: horizontal stacked bar (orange = Direct, gray = Admin, dark gray = Taxes); line-item breakdown with percentages
- Revenue Breakdown table: rows = Saturdays in fiscal month, columns = Labor / Rental / One-Time / Total
- Period Summary card: Revenue → (Payroll) → (Fuel) → Gross Profit
- Right column: Gross Profit, Margin, Total Cost metric cards
- Mobile: 2×2 metric cards + revenue-only bar chart + selected-week panel + revenue table
- Removed: TrendLineChart, WaterfallChart, TargetVarianceRow, DateRangePicker, week navigator, URL sync

**DistrictDashboard (`components/dashboard/DistrictDashboard.tsx`)**
- Props simplified: `{ branches, initialBranch }` — `initialWeek` and `initialView` removed
- Same mount logic and fiscal month selector as Manager
- Branch selector retained (orange text); selecting a branch or fiscal month triggers a fresh data fetch
- Aggregate mode ("All Assigned Branches"):
  - Revenue and fuel fetched without branchId filter (API scopes to assigned branches automatically)
  - Payroll: N branches × M weeks calls, all parallel
  - Branch comparison cards: revenue (large), payroll + fuel (small), gross profit + GP% pill; sorted by revenue descending; "No data" overlay for empty branches
  - District Totals table: Branch / Revenue / Direct Pay / Admin Pay / Fuel / Gross Profit / Margin; totals row
  - Weekly bar chart shows district-wide aggregates per week (no click-to-detail in aggregate)
- Single branch mode: identical layout to ManagerDashboard (bar chart with click detail, payroll breakdown card, revenue breakdown table, period summary, right column)
- Mobile: 2×2 metrics + revenue chart; aggregate shows branch list with GP%, single shows revenue table

**Pages updated**
- `app/manager/page.tsx` — removed `searchParams: { week, view }` and `initialWeek`/`initialView` prop passing
- `app/district/page.tsx` — removed `week` and `view` from searchParams; kept `branch` for initialBranch

---

## 3e. RECENT CHANGES (May 6, 2026) — Misc fixes (temp password, branch dropdowns, fuel dupe, revenue parser, mobile)

### Temporary Password Flow for Access Request Approval
- `PATCH /api/admin/access-requests/[id]` — switched from `inviteUserByEmail` to `createUser` with `password`, `email_confirm: true`, `user_metadata: { must_change_password: true }`; validates `temporaryPassword` (required, min 8 chars); inserts `user_profiles` with `must_change_password: true`
- `POST /api/auth/clear-must-change-password` — any authenticated user clears their own flag via service client
- Migration `20260506000006_must_change_password.sql` — adds `must_change_password boolean NOT NULL DEFAULT false` to `user_profiles`; applied to production
- `database.types.ts` — updated `user_profiles` Row/Insert/Update to include `must_change_password`
- `AccessRequestsClient` approval modal — added unmasked Temporary Password field + Confirm Password field; Generate button (12-char, letters+digits+special, shuffled); Copy button (flashes "Copied"); note "Share this temporary password…"; client-side validation (min 8 chars, must match); sends `temporaryPassword` in request body; branch dropdown now grouped Operations/Corporate
- `/change-password` page — centered dark card (same design as login); masked New Password + Confirm fields; rejects same-as-current (tries signInWithPassword before updateUser); calls clear-flag API on success; redirects to `/` (middleware routes to role dashboard); no way to skip
- Middleware updated — selects `must_change_password` alongside `role`; any `must_change_password=true` session redirected to `/change-password` for all paths; `/change-password` itself redirected to role dashboard when flag is false; `/change-password` added to matcher

### Branch Dropdowns — All Active Branches with Grouping
- `/request-access` page — removed `is_revenue_generating=true` filter; now fetches all active branches with `is_revenue_generating` field; branch dropdown uses `<optgroup>` labels "— Operations —" and "— Corporate —"
- `GET /api/admin/access-requests` — same filter removal; passes `is_revenue_generating` to client
- `AccessRequestsClient` and `RequestAccessClient` — `Branch` interface updated; selects split into two optgroups

### Fuel Import Duplicate Check Fix
- `POST /api/import/fuel` — duplicate check now includes `.eq('vendor', vendor)` before the date overlap filters; error message and conflict payload include vendor
- Migration `20260506000005_fuel_imports_vendor_unique_constraint.sql` — adds `UNIQUE(vendor, date_range_start, date_range_end)` to `fuel_imports`; applied to production

### Revenue Branch Normalization Fix
- `lib/revenue/parser.ts` — replaced hardcoded `BRANCH_MERGE` lookup with `normalizeBranchName()`:
  - Strips `/ Sales$/i` suffix dynamically (any branch, not just Bakersfield/Fresno)
  - `MERGED_BRANCHES` map handles consolidated branches: `'Sacramento' → 'Modesto'`
  - `"Sacramento Sales"` → strip → `"Sacramento"` → merge → `"Modesto"`
  - Add future merges by updating `MERGED_BRANCHES` — no other changes needed
- `lib/revenue/parser.test.ts` — 4 new tests: Orange County Sales, Visalia Sales (dynamic rule), Sacramento → Modesto, Sacramento Sales → Modesto (193 total)
- `lib/revenue/CLAUDE.md` — updated to reflect new normalization function and checklist

### Fuel Card Assignment Retroactive Backfill Bug Fix
- `PATCH /api/admin/review/fuel-cards/[id]` — now retroactively updates all historical `fuel_transactions` for the confirmed card (`fuel_card_assignment_id = id`) with branch_id, employee_id, and business_tag
- Migration `20260506000004_backfill_fuel_transaction_branches.sql` — one-time backfill for cards confirmed before this fix; applied to production

### Mobile Responsive Views
- Landing page — stacked layout; 160px logo (240px desktop); full-width buttons (auto-width desktop); sparse dot grid (~40 dots mobile via 112px spacing)
- Login page — full-width card with 16px horizontal padding on mobile; 120px logo on mobile
- Admin Dashboard — mobile: 2×2 metric cards (no sparklines), revenue-only bar chart, compact variance row, branch list; desktop layout unchanged; `useIsMobile()` hook (SSR-safe, starts false)
- `MobileBottomNav` — role-aware fixed bottom nav; slide-up overlay drawer for overflow items; 60px height; 44px tap targets; orange active / gray inactive
- `DashboardShell` — sidebar hidden on mobile (`hidden md:flex`); bottom nav shown on mobile (`md:hidden`)
- `globals.css` — `overflow-x: hidden` on html; `.table-scroll` helper; `.dashboard-main` bottom padding for nav

### Data Explorer (built in prior session, included here for completeness)
- `/admin/data-explorer` and `/executive/data-explorer` pages
- `DataExplorerClient` — filter bar, summary cards, sortable paginated table (50 rows/page), CSV export
- API routes: `GET /api/data-explorer/payroll`, `revenue`, `fuel`, `export`
- Sidebar nav: Database icon added for both admin and executive roles

---

## 3f. RECENT CHANGES (May 6, 2026) — Fiscal quarters

### Fiscal Quarters System
- Migration `20260506000002_fiscal_quarters.sql` applied to production — `fiscal_quarters` + `fiscal_quarter_months` tables, RLS policies, unique constraints
- `GET|POST /api/fiscal-quarters` and `PATCH|DELETE /api/fiscal-quarters/[id]`
- `FiscalQuartersClient` — full CRUD UI
- `AdminDashboard` — Month/Quarter toggle; quarter date range = first month start → last month end

---

## 3g. RECENT CHANGES (May 6, 2026) — Fiscal month targets

### Fiscal-Month-Based Targets Redesign
- Migration `20260506000001_fiscal_month_targets.sql` — `branch_targets` table rebuilt with `fiscal_month_id` FK
- `GET/POST /api/targets` and `PATCH /api/targets/[id]`
- **New: `GET /api/targets/weekly?periodDate=YYYY-MM-DD`** — pro-rated weekly targets
- `TargetsClient` fully rewritten with fiscal month dropdown
- `TargetVarianceRow` — calls `/api/targets/weekly`; shows fiscal month name

---

## 3h. RECENT CHANGES (May 5, 2026) — Sacramento merge + employee transfers

### Sacramento → Modesto Branch Merge
- Migration `20260505000001_merge_sacramento_into_modesto.sql` applied to production
- Adds `is_active` to `branches`; reassigns all Sacramento data to Modesto; deactivates Sacramento codes
- Revenue parser: `normalizeBranchName()` maps Sacramento → Modesto (covers historical imports too)

### Employee Branch Transfer History
- Migration `20260505000002_employee_branch_transfers.sql` applied to production
- `employee_branch_transfers` table; `employee_entity_assignments` gets `effective_from` / `effective_to`
- `GET/POST /api/employees/[id]/transfers`, `DELETE /api/employees/[id]/transfers/[transferId]`
- `EmployeeDetailClient` — Branch History section with transfer log and inline transfer form

### Review Queue Fixes
- Fuel card assignment dropdown grouped: Operations / Corporate / Other Businesses / Tag as Business
- Employee assignment payroll code picker grouped by branch

---

## 4. WHAT HAS NOT BEEN STARTED

- 13-week trend analytics (needs sufficient imported data to render)
- Anomaly flag UI (employee payroll >3× 4-week average → tooltip warning)
- Drill-down interactions (click payroll group → line items, click fuel total → transactions)
- WH / Signs dashboards (explicitly deferred to V2 in spec)
- E2E tests with Playwright (deferred to V2)
- API rate limiting on import endpoints

---

## 5. KNOWN ISSUES AND DECISIONS

- **Supabase 1000-row cap:** Supabase JS client defaults to 1000 rows per query. Routes that aggregate transactions use either `.range()` pagination loops (admin/overview, fuel/summary) or `.limit(50000)` (revenue/summary, payroll/hours-by-week, payroll/direct-labor-detail, payroll/overtime-summary). Always verify large-result queries don't silently cap when adding new routes.
- **next.config.js:** Uses `serverExternalPackages: ['xlsx', 'csv-parse']` to prevent Next.js from bundling Node-only packages.
- **Revenue parser multi-month fix:** Sums all months for the same branch+entity into one record.
- **Fuel tax column calculation:** Interstate: `gallons × price_per_gallon`. Flyers: `TotalPrice` direct; pre-tax back-calculated as `TotalPrice - TaxTotal`. Do not swap.
- **Payroll column A tax row fix:** "Total Employer Taxes and Contributions" identified by scanning column D (not A).
- **`display_name` is never stored:** Always computed as `first_name || ' ' || last_name`. No stored column.
- **Admin payroll sum rule is a security control:** District/branch managers never receive individual admin employee rows — API returns `{ total: number }` only.
- **`raw_name_in_report` is immutable:** Never expose a UI control that edits this field.
- **must_change_password enforcement:** Middleware gate is the primary control. The flag lives in `user_profiles`, not just auth metadata. Clearing it requires the `/api/auth/clear-must-change-password` API route (uses service client).

---

## 6. CURRENT TEST COUNT

**209 tests passing, 0 failing** (as of May 7, 2026)
13 test files across parsers, allocation engine, and API access control.

```bash
npx vitest run
```

---

## 7. DEPLOYMENT

### Git / GitHub
- Remote: GitHub (private repo `masontcs/safety-network-dashboard`)
- `.gitignore` excludes: `.env.local`, `node_modules`, `.next`, `.claude/`, `supabase/.temp/`
- Current branch: `main`

### Vercel
- Connected to GitHub repo; auto-deploys on push to `main`
- Framework: Next.js (auto-detected), build: `npm run build`
- Environment variables in Vercel Project Settings:
  - `NEXT_PUBLIC_SUPABASE_URL` — public
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY` — public
  - `SUPABASE_SERVICE_ROLE_KEY` — **Sensitive**
  - `ANTHROPIC_API_KEY` — **Sensitive**

### Production URL
- https://safety-network-dashboard.vercel.app/login

### All migrations applied to production (17 total)
- `20260101000001` through `20260101000007` — core schema
- `20260101000008` — branch_targets
- `20260505000001` — Sacramento merge + is_active
- `20260505000002` — employee branch transfers
- `20260506000001` — fiscal_month_targets redesign
- `20260506000002` — fiscal_quarters + fiscal_quarter_months
- `20260506000003` — access_requests table
- `20260506000004` — backfill fuel_transaction branches
- `20260506000005` — fuel_imports vendor unique constraint
- `20260506000006` — user_profiles.must_change_password
- `20260507000001` — fix period_date year bug (year 26 CE → 2026)

---

## 8. HOW TO START THE DEV SERVER

```bash
cd /Users/masondoty/Documents/sn_project
npm run dev
# App runs at http://localhost:3000
```

TypeScript check (run before committing):
```bash
npm run typecheck
# or
npx tsc --noEmit
```

---

## 9. OPEN QUESTIONS

- **Review queue badge count:** Unresolved review queue item count in top nav — not yet implemented.
- **Executive/Admin allocation for MTD/YTD:** Allocation fetched for selected periodDate only. Summing allocation across multiple weeks is deferred.
