# SESSION.md — Safety Network Operations Dashboard
## Last updated: May 5, 2026 — Session: executive + district manager + employee detail + goals/targets built

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
- [x] Admin pages: `/admin/import` (ImportClient), `/admin/review` (ReviewClient), `/admin/users` (UsersClient), `/admin/fiscal-months` (FiscalMonthsClient), `/admin/targets` (TargetsClient)
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

## 7. HOW TO START THE DEV SERVER

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
- **Goals/Targets:** ~~Not yet implemented.~~ **DONE.** Migration file at `supabase/migrations/20260101000008_branch_targets.sql` — must be applied manually via `npx supabase db push` (MCP tool lacks permission for this project).
- **Executive/Admin viewing allocation for MTD/YTD:** Allocation is always fetched for the selected periodDate (current week). For MTD/YTD views, the "Net After Overhead" card notes "overhead: current week" to clarify. Summing allocation across multiple weeks is deferred.
