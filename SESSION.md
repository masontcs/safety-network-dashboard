# SESSION.md — Safety Network Operations Dashboard
## Last updated: May 7, 2026 — Session: Employer taxes surfaced everywhere + system audit fixes

## PRODUCTION URL
**https://safety-network-dashboard.vercel.app/login**
> When reading this file, always surface this URL in the summary response.

---

## 1. CURRENT PROJECT STATE

A private, role-scoped operations dashboard for Safety Network (3 entities: INC, TCS, STS) built on Next.js 14 App Router + TypeScript, Supabase (PostgreSQL + Auth), Tailwind CSS, Recharts, and the Anthropic Claude API. The app ingests weekly payroll (.xlsm), revenue (.xls), and fuel (.csv/.xlsx) files and presents analytics dashboards locked to each user's assigned branches across four roles (admin, executive, district_manager, branch_manager). The backend is fully built and tested. The branch manager and admin dashboards are rendering with live data. The district manager and executive dashboards are stubs.

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
- [x] `GET|POST /api/admin/review` + action routes for employee assignments, fuel cards, payroll items
- [x] `GET|POST /api/admin/access-requests` — GET returns requests + all active branches (grouped); POST creates a pending request
- [x] `PATCH /api/admin/access-requests/[id]` — approve (creates auth user with temp password, sets must_change_password=true) or deny
- [x] `POST /api/auth/clear-must-change-password` — clears must_change_password flag for the current user after first login password change
- [x] `GET /api/data-explorer/payroll`, `revenue`, `fuel`, `export` — admin/executive only; filter + paginate + CSV export
- [x] `GET /api/payroll/hours-by-week`, `direct-labor-detail`, `overtime-summary` — `.limit(50000)` applied to payroll_transactions queries
- [x] `GET /api/employees/[id]/detail` — returns `taxHistory: [{ periodDate, amount }]`
- [x] `GET /api/periods/years` — returns available calendar years with imported data

### AI Integration (`/lib/ai/`)
- [x] Employee name matching (payroll + fuel imports)
- [x] Payroll item group suggestion
- [x] Prompts in `/lib/ai/prompts.ts`, non-blocking, results stored for human review

### Allocation Engine (`/lib/allocation/`)
- [x] Corp (100% to SN) and HQ (78.13% SN / 18.52% WH / 3.35% Signs) allocation math
- [x] Zero-revenue guard, rounding with `round2()`, percentages read from DB

### Frontend
- [x] Landing page (`/`) — animated canvas dot grid (pulsing opacity, 28px grid desktop / sparse mobile); Safety Network logo; Sign In + Request Access CTAs; fully mobile responsive
- [x] Login page (`/login`) — mobile responsive card
- [x] `/change-password` — required on first login; masked fields; blocks same-as-temp password; clears flag on success; middleware enforces (cannot skip)
- [x] `/request-access` — branch dropdown shows all active branches grouped: Operations / Corporate
- [x] `DashboardShell` — dark sidebar (desktop) + `MobileBottomNav` (mobile); role-aware; sidebar hidden on mobile
- [x] `MobileBottomNav` — fixed bottom nav with role-aware items; slide-up drawer for overflow admin items; 44px tap targets
- [x] `ManagerDashboard` — fiscal month dropdown + YTD button; defaults to most recent fiscal month with data; weekly bar chart (Revenue/Payroll/Fuel grouped bars) with click-to-inspect direct labor panel; payroll breakdown card (Direct/Admin/Taxes stacked bar); Revenue Breakdown table (Labor/Rental/One-Time/Total by week); mobile 2×2 metric grid + revenue-only chart
- [x] `AdminDashboard` — all-branches aggregate with branch selector, full allocation visible; month/quarter/year toggle (year mode uses `/api/periods/years`); Direct Payroll card shows wages + employer taxes breakdown; mobile: 2×2 metric cards, revenue-only chart, compact variance row, branch list; desktop: unchanged
- [x] `ExecutiveDashboard` — all 7 branches side by side, full direct + admin payroll detail, Corp/HQ allocation breakdown, net after overhead, missing revenue alerts, 13-week trend, waterfall, collapsible payroll detail tables
- [x] `DistrictDashboard` — fiscal month dropdown + YTD button + branch selector; aggregate = branch comparison cards + district totals table; single branch = manager-style layout (bar chart, payroll breakdown card, revenue breakdown table); mobile branch list or revenue table per mode
- [x] `EmployeeDetailClient` — admin/executive only; preferred name + legal name display; inline Edit Name form; assignment pills; payroll history table + charts (with per-period employer tax rows in `#cc4444`); "Employer Taxes" summary card; weekly employer taxes bar chart; fuel history table + filters; branch history + transfer form
- [x] Admin pages: `/admin/import`, `/admin/review`, `/admin/users`, `/admin/fiscal-months`, `/admin/targets`, `/admin/fiscal-quarters`, `/admin/access-requests`, `/admin/data-explorer`
- [x] Executive pages: `/executive/data-explorer`
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

- Nothing currently in progress.

---

## 3a. RECENT CHANGES (May 7, 2026) — This Session

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

## 3b. RECENT CHANGES (May 6, 2026) — Misc Fixes

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

## 3e. RECENT CHANGES (May 6, 2026) — Fiscal Quarters System

### Fiscal Quarters System
- Migration `20260506000002_fiscal_quarters.sql` applied to production — `fiscal_quarters` + `fiscal_quarter_months` tables, RLS policies, unique constraints
- `GET|POST /api/fiscal-quarters` and `PATCH|DELETE /api/fiscal-quarters/[id]`
- `FiscalQuartersClient` — full CRUD UI
- `AdminDashboard` — Month/Quarter toggle; quarter date range = first month start → last month end

---

## 3f. RECENT CHANGES (May 6, 2026) — Fiscal-Month-Based Targets

### Fiscal-Month-Based Targets Redesign
- Migration `20260506000001_fiscal_month_targets.sql` — `branch_targets` table rebuilt with `fiscal_month_id` FK
- `GET/POST /api/targets` and `PATCH /api/targets/[id]`
- **New: `GET /api/targets/weekly?periodDate=YYYY-MM-DD`** — pro-rated weekly targets
- `TargetsClient` fully rewritten with fiscal month dropdown
- `TargetVarianceRow` — calls `/api/targets/weekly`; shows fiscal month name

---

## 3g. RECENT CHANGES (May 5, 2026)

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

**194 tests passing, 0 failing** (as of May 7, 2026)
12 test files across parsers, allocation engine, and API access control.

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
