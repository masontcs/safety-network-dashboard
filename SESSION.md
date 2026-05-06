# SESSION.md — Safety Network Operations Dashboard
## Last updated: May 6, 2026 — Session: Fiscal quarters system (DB + API + admin UI + dashboard toggle)

## PRODUCTION URL
**https://safety-network-dashboard.vercel.app/login**
> When reading this file, always surface this URL in the summary response.

---

## 1. CURRENT PROJECT STATE

A private, role-scoped operations dashboard for Safety Network (3 entities: INC, TCS, STS) built on Next.js 14 App Router + TypeScript, Supabase (PostgreSQL + Auth), Tailwind CSS, Recharts, and the Anthropic Claude API. The app ingests weekly payroll (.xlsm), revenue (.xls), and fuel (.csv/.xlsx) files and presents analytics dashboards locked to each user's assigned branches across four roles (admin, executive, district_manager, branch_manager). The backend is fully built and tested. The branch manager and admin dashboards are rendering with live data. The district manager and executive dashboards are stubs.

---

## 2. WHAT IS FULLY BUILT AND WORKING

### Database (Supabase)
- [x] 19 tables across 7 migrations (applied to production project)
- [x] Migration 1: reference tables (businesses, branches, entities, payroll_codes, revenue_codes, payroll_item_groups, payroll_items)
- [x] Migration 2: user tables (user_profiles, user_branch_assignments)
- [x] Migration 3: employee tables (employees, employee_entity_assignments, fuel_card_assignments)
- [x] Migration 4: import header tables (payroll_imports, revenue_imports, fuel_imports)
- [x] Migration 5: transaction tables (payroll_transactions, payroll_taxes, revenue_transactions, fuel_transactions)
- [x] Migration 6: RLS policies on all tables
- [x] Migration 7: fiscal_months table
- [x] Migration 8: fiscal_quarters + fiscal_quarter_months tables (applied May 6, 2026)
- [x] Seed data: 3 businesses, 3 entities, 7 branches, 12 payroll item groups, 87 payroll codes, 196 payroll items, 17 revenue codes

### File Parsers (`/lib/`)
- [x] Payroll parser — parses QuickBooks .xlsm, splits "LAST, FIRST M" names, handles hyphenated surnames, dynamic payroll item discovery, period date calculation (subtract 1 day → Saturday)
- [x] Revenue parser — parses .xls Invoice Summary, merges Bakersfield Sales/Fresno Sales, entity code mapping, uses END date of range
- [x] Fuel parser — Interstate (.csv) and Flyers (.xlsx), site parsing, WH tagging, calculated totals for both vendors

### API Routes (`/app/api/`)
- [x] `POST /api/import/payroll` + `confirm-replace` — admin only, duplicate detection, AI triggers
- [x] `POST /api/import/revenue` + `confirm-replace`
- [x] `POST /api/import/fuel` + `confirm-replace`
- [x] `GET /api/payroll/summary` — admin sum rule enforced (managers get total only, no detail)
- [x] `GET /api/payroll/employee/[id]` — 403 for managers on admin-coded employees
- [x] `GET /api/employees/[id]/detail` — admin/executive only; returns employee info, all payroll history (paginated, with item+group names), all fuel history (paginated)
- [x] `GET /api/revenue/summary`
- [x] `GET /api/fuel/summary`
- [x] `GET /api/allocation/summary` — exec/admin only
- [x] `GET|PATCH /api/employees` + `[id]/name` — display_name computed, raw_name never returned
- [x] `GET /api/periods/available` + `latest`
- [x] `GET|POST /api/fiscal-months` + `[id]`
- [x] `GET|POST /api/fiscal-quarters` + `PATCH|DELETE /api/fiscal-quarters/[id]`
- [x] `GET|POST /api/admin/users` + `[id]`
- [x] `GET|POST /api/admin/review` + action routes for employee assignments, fuel cards, payroll items

### AI Integration (`/lib/ai/`)
- [x] Employee name matching (payroll + fuel imports)
- [x] Payroll item group suggestion
- [x] Prompts in `/lib/ai/prompts.ts`, non-blocking, results stored for human review

### Allocation Engine (`/lib/allocation/`)
- [x] Corp (100% to SN) and HQ (78.13% SN / 18.52% WH / 3.35% Signs) allocation math
- [x] Zero-revenue guard, rounding with `round2()`, percentages read from DB

### Frontend
- [x] Login page (`/login`)
- [x] `DashboardShell` — dark sidebar + top nav, role-aware
- [x] `ManagerDashboard` — fully built: weekly/MTD/YTD views, week navigator, revenue/payroll/fuel/gross profit metrics, trend line chart, waterfall chart, direct labor table, admin payroll lump sum, fuel table. YTD confirmed at $171,296.33 for Apr 25 2026.
- [x] `AdminDashboard` — all-branches aggregate with branch selector, full allocation visible
- [x] `ExecutiveDashboard` — all 7 branches side by side, full direct + admin payroll detail, Corp/HQ allocation breakdown, net after overhead, missing revenue alerts, 13-week trend, waterfall, collapsible payroll detail tables
- [x] `DistrictDashboard` — branch selector with "All Assigned Branches" aggregate view + single-branch view; aggregate shows per-branch comparison table (Revenue, Direct Pay, Admin Pay, Fuel, Gross Profit, Margin); single-branch view is identical to ManagerDashboard; admin payroll lump sum only (security enforced server-side)
- [x] `EmployeeDetailClient` — admin/executive only; preferred name + legal name display; inline Edit Name form (admin only); assignment pills; payroll history table + hours/earnings charts + group breakdown; fuel history table + filters + gallons chart; accessible at `/admin/employees/[id]` and `/executive/employees/[id]`
- [x] Inter font (weights 400–800) via `next/font/google`; `.metric-value` weight 700; h1/h2 weight 700
- [x] Logo: `public/logo.png` (white text + orange hand icon); shown in TopNav (24px) and login page (52px)
- [x] Admin pages: `/admin/import` (ImportClient), `/admin/review` (ReviewClient), `/admin/users` (UsersClient), `/admin/fiscal-months` (FiscalMonthsClient), `/admin/targets` (TargetsClient), `/admin/fiscal-quarters` (FiscalQuartersClient)
- [x] `TargetVarianceRow` component — shown on all 4 dashboards (weekly view only); green/yellow/red color coding (±5%/±15% thresholds); aggregate mode for admin/executive (sums all branch revenue targets); profit % only shown for single-branch view
- [x] Employee detail pages: `/admin/employees/[id]` and `/executive/employees/[id]` (403 for district/branch managers)
- [x] Chart components: `BarChart` (supports `formatValue` prop for non-currency axes), `TrendLineChart`, `WaterfallChart`
- [x] UI components: `MetricCard`, `Skeleton`, `StatusPill`, `BranchSelector`, `DateRangePicker`, `ThreeDotMenu`
- [x] Middleware: protects all dashboard routes, redirects unauthenticated users

### Utilities
- [x] `lib/utils/access.ts` — `UserAccess` type, `canAccessBranch()`
- [x] `lib/utils/errors.ts` — `AppError`, `ParseError`, `AuthError`, `DuplicateImportError`, `NotFoundError`
- [x] `lib/utils/format.ts` — `formatCurrency`, `formatPercent`, `round2`
- [x] `lib/utils/date.ts` — `getDateRange`, `getTrendStart`, `getMostRecentSaturday`, etc.

---

## 3. WHAT IS IN PROGRESS / PARTIALLY BUILT

- Nothing currently in progress.

---

## 3b. RECENT CHANGES (May 6, 2026) — Fiscal Quarters System

### Fiscal Quarters System
- Migration `20260506000002_fiscal_quarters.sql` applied to production — `fiscal_quarters` + `fiscal_quarter_months` tables, RLS policies (authenticated read, admin write), unique constraint on `(quarter_number, year)`, unique constraint on `fiscal_month_id` (a month belongs to at most one quarter)
- `GET|POST /api/fiscal-quarters` — GET returns all quarters with nested 3 months (sorted by sort_order); POST validates 3 unique unassigned month IDs, inserts quarter + month assignments atomically (rolls back on failure)
- `PATCH|DELETE /api/fiscal-quarters/[id]` — PATCH updates name/quarterNumber/year/month assignments; conflict-checks new months against other quarters; DELETE cascades to fiscal_quarter_months
- `app/admin/fiscal-quarters/page.tsx` — server component, admin-only guard
- `components/fiscal-quarters/FiscalQuartersClient.tsx` — full CRUD UI: table showing quarter name + month pills; add/edit form with 3 interdependent month dropdowns (options exclude already-assigned months and sibling slots); warning banner when < 3 unassigned months; delete confirm
- `components/layout/Sidebar.tsx` — added `LayersIcon` (layers SVG) + "Fiscal Quarters" nav item for admin
- `app/admin/page.tsx` — fetches `fiscal_quarters` with nested `fiscal_quarter_months → fiscal_months`, shapes into flat `{ id, name, quarter_number, year, months[] }` array, passes as `fiscalQuarters` prop
- `components/dashboard/AdminDashboard.tsx` — Month/Quarter toggle buttons (pill style, orange active state); quarter dropdown replacing month dropdown in quarter mode; `selectedQuarterId` state; date range in quarter mode = first month's `start_date` → last month's `end_date`; weekly bar chart across all 3 quarter months; YTD button hidden in quarter mode; `FiscalMonthVarianceRow` hidden in quarter mode; 0 TS errors

---

## 3c. RECENT CHANGES (May 6, 2026)

### Fiscal-Month-Based Targets Redesign
- Migration `20260506000001_fiscal_month_targets.sql` created — **must be applied manually in Supabase SQL editor** (MCP lacks access to this project)
- `branch_targets` table dropped and recreated: `fiscal_month_id` FK replaces `period_type` + `target_date`; `updated_by` replaces `updated_at`
- `GET /api/targets` — now accepts `fiscalMonthId` param; returns targets joined with `fiscal_months` data
- `POST /api/targets` — body now takes `{ branchId, fiscalMonthId, revenueTarget, profitPctTarget }`
- `PATCH /api/targets/[id]` — sets `updated_by` from auth context
- **New: `GET /api/targets/weekly?periodDate=YYYY-MM-DD`** — finds fiscal month containing that date, returns pro-rated weekly targets per branch (monthly ÷ weeks)
- `TargetsClient` fully rewritten: fiscal month dropdown replaces date picker; table shows Fiscal Month | Revenue Target | Weekly Breakdown | GP% | edit/delete; shows link to Fiscal Months page if none exist
- `TargetVarianceRow` rewritten: calls `/api/targets/weekly`; distinguishes "no fiscal month" vs "no target" messages; shows fiscal month name in header
- `app/admin/targets/page.tsx` now fetches and passes `fiscalMonths` to `TargetsClient`
- Fiscal month validation fixed: `start_date` must be **Sunday** (was Saturday), `end_date` must be Saturday — fixed in both API routes and `FiscalMonthsClient` UI
- `database.types.ts` updated to match new `branch_targets` schema

---

## 3d. RECENT CHANGES (May 6, 2026) — Admin Dashboard Redesign

### Admin Dashboard Redesign
- `app/admin/page.tsx` — now fetches + passes `fiscalMonths` (sorted newest first); removed `initialWeek`/`initialView` searchParams
- **New: `app/api/admin/overview/route.ts`** — single admin-only endpoint returning all dashboard data for a date range: totals, byPeriod (per-Saturday), byBranch (revenue/payroll/fuel/GP with revenueByPeriod sparkline data). Paginated to avoid 1000-row cap.
- **New: `components/targets/FiscalMonthVarianceRow.tsx`** — fetches monthly targets for selected fiscal month, shows monthly revenue target vs actuals
- `components/dashboard/AdminDashboard.tsx` — **complete rewrite**:
  - Replaced week navigator + MTD/YTD toggle with fiscal month dropdown (most recent first) + YTD toggle button
  - Defaults to most recent fiscal month containing imported data (via `/api/periods/available`)
  - Top metric cards show full fiscal month (or YTD) totals with date range subtitle
  - **Weekly bar chart** (Recharts grouped bars): Revenue (orange), Payroll (gray), Fuel (dark red) per week; click bar → Selected Week Panel with exact metrics + dismiss button; YTD mode shows monthly aggregates instead
  - **Branch Performance Card Grid** (3×2): all 6 active branches always shown; branch name in orange, revenue/payroll/fuel/GP/GP%; GP% color-coded (green ≥20%, yellow 10-20%, red <10%); mini SVG sparkline per branch; "No data" overlay for empty branches
  - Removed: side cards (Fuel Efficiency, Payroll Allocation, Data Import), Waterfall chart, TrendLineChart, DateRangePicker
  - Revenue by Branch table updated to use fiscal month/YTD range

---

## 3e. RECENT CHANGES (May 5, 2026)

### Sacramento → Modesto Branch Merge

- Migration `20260505000001_merge_sacramento_into_modesto.sql` applied to production
- Adds `is_active` column to `branches` table
- Reassigns all historical payroll, revenue, fuel, employee, user, and target data from Sacramento to Modesto
- Deactivates Sacramento's payroll_codes and revenue_codes (`is_active = false`)
- Sets Sacramento branch: `is_active = false`, `is_revenue_generating = false`
- Seed updated: Sacramento inserted as inactive for fresh installs
- Verified: Sacramento has 0 active transactions, 0 active codes; Modesto has 16 revenue records

### `is_active` Audit — All Branch Queries Fixed
Every branch selector query now filters `is_active = true` so Sacramento never appears:
- `app/admin/page.tsx` — added `eq('is_active', true)`
- `app/admin/targets/page.tsx` — added `eq('is_active', true)`
- `app/executive/page.tsx` — added `eq('is_active', true)`
- `app/api/admin/users/route.ts` — added `eq('is_active', true)` + `eq('is_revenue_generating', true)` (was unfiltered)
- `app/api/allocation/summary/route.ts` — added `eq('is_active', true)`
- `lib/supabase/database.types.ts` — added `is_active` to branches Row/Insert/Update
- `manager/page.tsx` and `district/page.tsx` were already correct

### Employee Branch Transfer History (May 5, 2026)
- Migration `20260505000002_employee_branch_transfers.sql` applied to production
- New `employee_branch_transfers` table: records from/to payroll codes, effective_date, notes, created_by
- `employee_entity_assignments` gains `effective_from` (date NOT NULL, default '1900-01-01') and `effective_to` (date nullable)
- Dropped `UNIQUE(raw_name_in_report, entity_id)` — replaced with partial unique index `WHERE effective_to IS NULL`
- All existing assignments set to `effective_from = '1900-01-01'`, `effective_to = NULL`
- `GET /api/employees/[id]/transfers` — admin + executive: returns transfer log, all assignment periods, available payroll codes
- `POST /api/employees/[id]/transfers` — admin only: validates Saturday, validates different branch, closes old assignment, opens new one, reassigns payroll + fuel transactions retroactively, updates fuel card assignments
- `DELETE /api/employees/[id]/transfers/[transferId]` — admin only: reverts if employee hasn't been transferred again since
- `detail/route.ts` updated to filter assignments to `effective_to IS NULL` (active only)
- `EmployeeDetailClient` gets "Branch History" section: assignment periods timeline grouped by entity, transfer log with revert button (most recent only), inline Transfer Branch form with payroll code dropdown + Saturday date picker + name confirmation

### Review Queue — Branch & Payroll Code Selectors Fixed
**Fuel card assignment dropdown:**
- Now queries all active branches (not just revenue-generating)
- Grouped: Operations / Corporate / Other Businesses / Tag as Business
- "Tag as Western Highways" and "Tag as Signs" options set `business_tag` instead of `branch_id`
- PATCH endpoint accepts `{ businessTag }` and clears `branch_id`, or accepts `{ branchId }` and clears `business_tag`

**Employee assignment payroll code picker:**
- API now fetches `payroll_code_id` on unconfirmed assignments + all active payroll codes (87, incl. Corp/HQ)
- Each row shows a grouped payroll code dropdown (grouped by branch name)
- On confirm, sends changed `payrollCodeId` to update `employee_entity_assignments.payroll_code_id`
- PATCH endpoint accepts optional `payrollCodeId`

---

## 4. WHAT HAS NOT BEEN STARTED

- ~~Employee detail page~~ — **DONE**
- ~~Goals/targets table and settings page~~ — **DONE**
- 13-week trend analytics (needs sufficient imported data to render)
- Anomaly flag UI (employee payroll >3× 4-week average → tooltip warning)
- Drill-down interactions (click payroll group → line items, click fuel total → transactions)
- WH / Signs dashboards (explicitly deferred to V2 in spec)
- E2E tests with Playwright (deferred to V2)
- API rate limiting on import endpoints

---

## 5. KNOWN ISSUES AND DECISIONS

- **Supabase 1000-row cap:** Supabase JS client defaults to 1000 rows per query. API routes that aggregate transactions (e.g. payroll summary YTD) use `.range()` pagination or aggregate in SQL via RPC to avoid silent data truncation. Always verify large-result queries do not silently cap.
- **next.config.js:** File uses `serverExternalPackages: ['xlsx', 'csv-parse']` to prevent Next.js from bundling Node-only packages. This was previously `experimental.serverComponentsExternalPackages` — renamed in Next.js 14.2. The current key is correct.
- **Revenue parser multi-month fix:** The revenue file sometimes contains multiple invoice months per branch. The parser sums all months for the same branch+entity combination into a single record rather than creating one row per month.
- **Fuel tax column calculation:** Interstate does not include a pre-tax total column — it is calculated as `gallons × price_per_gallon`. Flyers includes `TotalPrice` directly; pre-tax is back-calculated as `TotalPrice - TaxTotal`. Do not swap these formulas between vendors.
- **Payroll column A tax row fix:** The "Total Employer Taxes and Contributions" row is identified by scanning column D (not column A). An earlier version scanned column A and missed it when row formatting shifted. Current parser scans col D correctly.
- **`display_name` is never stored:** The `employees` table has no `display_name` column. It is always computed as `first_name || ' ' || last_name` at query time. If you find yourself writing a migration to add this column, stop.
- **Admin payroll sum rule is a security control:** District/branch managers must never receive individual admin employee rows — not even for filtering client-side. The API returns `{ total: number }` with no detail array for these roles.
- **`raw_name_in_report` is immutable:** Never expose a UI control that edits this field. It is the source of truth for AI matching and must reflect what QuickBooks actually exported.

---

## 6. CURRENT TEST COUNT

**189 tests passing, 0 failing** (as of May 4, 2026)
12 test files across parsers, allocation engine, and API access control.

```bash
npx vitest run
```

---

## 7. DEPLOYMENT

### Git / GitHub
- Git repo initialized in `/Users/masondoty/Documents/sn_project`
- Remote: GitHub (private repo — connect via `gh repo create` or manually)
- `.gitignore` excludes: `.env.local`, `node_modules`, `.next`, `.claude/`, `supabase/.temp/`
- Two commits on `main`: initial commit + supabase/.temp cleanup

### Vercel
- Connected to GitHub repo via Vercel dashboard
- Framework: Next.js (auto-detected), build: `npm run build`
- All four environment variables must be set in Vercel → Project Settings → Environment Variables:
  - `NEXT_PUBLIC_SUPABASE_URL` — public, safe to expose
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY` — public, safe to expose
  - `SUPABASE_SERVICE_ROLE_KEY` — **mark Sensitive**
  - `ANTHROPIC_API_KEY` — **mark Sensitive**

### Production URL
- https://safety-network-dashboard.vercel.app/login

### Migrations applied to production
- `fiscal_months`, `branch_targets`, `fiscal_quarters`, and `fiscal_quarter_months` migrations all applied and live in DB

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
```

---

## 8. OPEN QUESTIONS

- **Review queue badge count:** Will show unresolved review queue item count in the top nav — loaded on page render only (no polling). Not yet implemented.
- **Goals/Targets:** ~~Not yet implemented.~~ **DONE.** Migration applied to production May 5, 2026.
- **Executive/Admin viewing allocation for MTD/YTD:** Allocation is always fetched for the selected periodDate (current week). For MTD/YTD views, the "Net After Overhead" card notes "overhead: current week" to clarify. Summing allocation across multiple weeks is deferred.
