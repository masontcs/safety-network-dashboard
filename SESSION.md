# SESSION.md — Safety Network Operations Dashboard
## Last updated: May 26, 2026 — Session: Fuel card employee linking + health check fixes + AR features

## PRODUCTION URL
**https://safety-network-dashboard.vercel.app/login**
> When reading this file, always surface this URL in the summary response.

---

## 1. CURRENT PROJECT STATE

A private, role-scoped operations dashboard for Safety Network (3 entities: INC, TCS, STS) built on Next.js 14 App Router + TypeScript, Supabase (PostgreSQL + Auth), Tailwind CSS, Recharts, and the Anthropic Claude API. The app ingests weekly payroll (.xlsm), revenue (.xls), and fuel (.csv/.xlsx) files and presents analytics dashboards locked to each user's assigned branches across ten roles. A full Accounts Receivable module is live and operational. All imports, review queue, admin tools, and AR collection workflows are fully built. A 12-bug health-check pass was completed and all fixes are committed.

---

## 2. WHAT IS FULLY BUILT AND WORKING

### User Roles — Ten Levels

```
admin            → All branches + full employee detail + imports + user management
executive        → All SN branches + full employee detail + full allocation + data explorer
district_manager → Multiple assigned branches + direct labor detail + admin payroll SUM ONLY
branch_manager   → Single assigned branch + direct labor detail + admin payroll SUM ONLY
sales            → All AR data regardless of branch; no payroll/fuel access
ar_manager       → All AR data + approve/deny AR team assignments
ar_team          → Assigned customers only (or all with showAll toggle) + AR workflows
office_team      → Same scope as ar_team; AR-only access
project_manager  → Scoped to AR customers in their assigned branches
```

### Database (Supabase)

- [x] 20 core tables across 19+ migrations (applied to production)
- [x] Core schema: businesses, branches, entities, payroll_codes, revenue_codes, payroll_item_groups, payroll_items, user_profiles, user_branch_assignments, employees, employee_entity_assignments, fuel_card_assignments, payroll_imports, revenue_imports, fuel_imports, payroll_transactions, payroll_taxes, revenue_transactions, fuel_transactions, fiscal_months, fiscal_quarters, fiscal_quarter_months, access_requests, employee_allocations, employee_allocation_overrides, employee_branch_transfers, payroll_staged_transactions, payroll_staged_taxes, payroll_item_staged_transactions
- [x] AR tables: ar_customers, ar_invoices, ar_imports, ar_customer_assignments, ar_customer_contacts, ar_customer_notes, ar_customer_payments, ar_credits
- [x] Staging tables (payroll_staged_transactions, payroll_staged_taxes, payroll_item_staged_transactions)
- [x] RLS policies on all tables
- [x] Seed data: 3 businesses, 3 entities, 7 branches (Sacramento merged into Modesto), 12 payroll item groups, 87 payroll codes, 196 payroll items, 17 revenue codes

### File Parsers (`/lib/`)

- [x] Payroll parser — parses QuickBooks .xlsm; splits "LAST, FIRST M" names; dynamic payroll item discovery; period date calculation (subtract 1 day → Saturday); auto-corrects 2-digit years with warning; rejects corrupt dates
- [x] Revenue parser — parses .xls Invoice Summary; dynamic " Sales" suffix stripping; Sacramento → Modesto merge map; entity code mapping; uses END date of range
- [x] Fuel parser — Interstate (.csv) and Flyers (.xlsx); site parsing; WH tagging; calculated totals
- [x] AR import parser — QuickBooks AR export (.xlsm); class code mapping to entity + branch; customer-centric row grouping; aging bucket assignment; exclusion list
- [x] AR payment parser — QuickBooks payment export; multi-word fuzzy matching against customer names; handles header rows above column names; QB Deposit type support

### API Routes — Payroll / Revenue / Fuel

- [x] `POST /api/import/payroll` + `confirm-replace` (streaming NDJSON) — admin only; staging system; AI triggers; rollback on failure
- [x] `POST /api/import/revenue` + `confirm-replace`
- [x] `POST /api/import/fuel` + `confirm-replace` — duplicate check scoped by vendor
- [x] `GET /api/import/history` — admin/exec; returns imports by type with entity/vendor details
- [x] `GET /api/payroll/summary` — admin sum rule enforced
- [x] `GET /api/payroll/employee/[id]` — 403 for managers on admin-coded employees
- [x] `GET /api/payroll/hours-by-week`, `direct-labor-detail`, `overtime-summary`
- [x] `GET /api/revenue/summary`
- [x] `GET /api/fuel/summary`, `by-week`, `top-consumers`
- [x] `GET /api/fuel/cards`, `fuel/cards/[id]` — branch-scoped; employee + branch names resolved
- [x] `GET /api/allocation/summary` — exec/admin only
- [x] `GET /api/admin/overview` — all-branch aggregate with employer taxes; paginated with ORDER BY
- [x] `GET /api/periods/available`, `latest`, `years`
- [x] `GET|POST /api/fiscal-months` + `[id]`
- [x] `GET|POST /api/fiscal-quarters` + `PATCH|DELETE /api/fiscal-quarters/[id]`
- [x] `GET|POST /api/targets` + `PATCH /api/targets/[id]`; `GET /api/targets/weekly`

### API Routes — Employees & Users

- [x] `GET /api/employees` — rich filtering (search, branchId, entityCode, laborType), sorting, pagination; scope by role
- [x] `GET /api/employees/[id]/detail` — full history; employer taxes; paginated payroll + fuel; branch-access guard
- [x] `PATCH /api/employees/[id]/name` — admin only; never touches raw_name_in_report
- [x] `PATCH /api/employees/[id]/labor-type` — admin only; optional retroactive backfill
- [x] `GET|POST /api/employees/[id]/allocations` + `PATCH|DELETE /api/employees/[id]/allocations/[id]`
- [x] `POST /api/employees/[id]/allocation-overrides` + `PATCH /api/employees/[id]/allocation-overrides/[id]`
- [x] `GET|POST /api/employees/[id]/transfers` + `DELETE /api/employees/[id]/transfers/[id]`
- [x] `GET|POST /api/admin/users` + `[id]`
- [x] `GET|POST /api/admin/access-requests` + `PATCH /api/admin/access-requests/[id]` — validates branch IDs against DB before approving
- [x] `POST /api/auth/clear-must-change-password`

### API Routes — AR Module

- [x] `POST /api/admin/ar/import` (streaming NDJSON) — admin only; upserts customers + invoices; clears previous invoices before inserting new batch; exclusion list applied
- [x] `GET /api/ar/summary` — aging buckets, total, last import; supports entity/branch/assignedUserId filters; excludes excluded customers; paginated
- [x] `GET /api/ar/customers` — customer list with aging, contact info, collection status; branch-scoped; supports assignedUserId filter
- [x] `GET /api/ar/customers/[id]` — full customer detail: contacts, notes, invoices, payments, credits
- [x] `GET|POST /api/ar/customers/[id]/contacts`
- [x] `GET|POST /api/ar/customers/[id]/notes` — operation notes and meeting notes; role-scoped write rules
- [x] `PATCH /api/ar/customers/[id]/notes/[noteId]` — edit (ar_team can edit own notes)
- [x] `GET|POST /api/ar/customers/[id]/payments`
- [x] `POST /api/ar/customers/[id]/merge` — merges two customer records with error checking on each step
- [x] `GET /api/ar/customers/[id]/statement` — generates PDF AR statement (clean Apple-style layout)
- [x] `PATCH /api/ar/customers/[id]/exclude` — admin/ar_manager only; toggles is_excluded
- [x] `GET|POST /api/ar/customers/[id]/credits`
- [x] `GET /api/ar/team-members` — returns users with active ar_customer_assignments (for filter dropdown)
- [x] `POST /api/ar/payments/import` (streaming NDJSON) — imports QB payment export; fuzzy name matching; shows unmatched names in summary
- [x] `PATCH /api/ar/invoices/[id]/date` — ar_team can override invoice dates (persisted)
- [x] `GET /api/ar/customers/[id]/assignments` — shows AR team members assigned to customer
- [x] `POST|DELETE /api/ar/customers/[id]/assignments`

### API Routes — Admin Tools

- [x] `GET /api/admin/review` — returns all queues + reference data; employees include branchId in entityAssignments
- [x] `PATCH /api/admin/review/employee-assignments/[id]` — new_employee / link_existing / skip / tag_business modes; deploys staged data on confirm
- [x] `PATCH /api/admin/review/fuel-cards/[id]` — branchId / businessTag / employeeId; retroactive backfill of transactions
- [x] `PATCH /api/admin/review/payroll-items/[id]` — deploys staged item transactions on confirm
- [x] `GET|POST /api/admin/payroll-items` + `PATCH /api/admin/payroll-items/[id]`
- [x] `GET /api/admin/allocations` + `GET /api/admin/allocations/pending-count`
- [x] `GET /api/branches`
- [x] `GET|POST /api/admin/settings/hq-allocation` + `PATCH`
- [x] `GET|POST|DELETE /api/admin/test-accounts`
- [x] `GET /api/admin/audit` — audit log with user, action, table, record_id; limit 5000 for filter dropdown
- [x] `GET|POST /api/data-explorer/payroll`, `revenue`, `fuel`, `export` — admin/exec only (guardAdminOrExecutive)

### AI Integration

- [x] Employee name matching (payroll + fuel imports) — module-level Anthropic client (single instance)
- [x] Payroll item group suggestion
- [x] Prompts in `/lib/ai/prompts.ts`; non-blocking; results stored for human review

### Allocation Engine

- [x] Corp (100%) + HQ (78.13% SN / 18.52% WH / 3.35% Signs) allocation math; settings editable via UI
- [x] `lib/allocation/employee-allocation.ts` — `resolveEmployeeAllocation`, `validateSplitTotal`, `isSaturday`
- [x] All 6 financial routes apply per-employee allocation splits

### Frontend — Operations Dashboards

- [x] Landing page — animated canvas dot grid; mobile responsive; Request Access CTA
- [x] `/login` — username or email login; mobile responsive
- [x] `/change-password` — required on first login; blocks same-as-temp; middleware enforced
- [x] `/request-access` — all active branches grouped Operations / Corporate; all 10 roles available
- [x] `DashboardShell` — animated expand-on-hover sidebar (48px → 220px); `MobileBottomNav`; role-aware
- [x] `AdminDashboard` — month/quarter/year toggle; direct payroll card with employer taxes; branch selector; allocation toggle; mobile responsive
- [x] `ExecutiveDashboard` — all 7 branches side by side; full payroll detail; allocation toggle; month/quarter/year toggle; employee names clickable
- [x] `DistrictDashboard` — fiscal month selector; branch selector; aggregate vs single-branch modes; employee names clickable
- [x] `ManagerDashboard` — fiscal month selector; weekly bar chart with click-to-inspect; payroll breakdown; revenue breakdown table; mobile responsive
- [x] `BranchPerformanceCard` — shared Recharts LineChart (Revenue / Payroll / Fuel); used in Admin + District
- [x] Unified dashboard at `/dashboard` — routes all roles through one entry point; month dropdown filters to months with actual data only

### Frontend — Employee Pages

- [x] `EmployeeListClient` — debounced search, filter bar, sortable table, pagination, status/entity pills
- [x] `EmployeeDetailClient` — preferred + legal name; inline Edit Name; assignment pills; labor type change; payroll + fuel history charts and tables; employer taxes card; weekly taxes chart; Rate History; Fuel per Week; branch history + transfer form; allocation section (admin only)
- [x] `/admin/employees`, `/executive/employees`, `/manager/employees/[id]`, `/district/employees/[id]`

### Frontend — AR Module

- [x] `ArDashboard` — aging summary KPI cards; aging bar chart; customer list (sortable, paginated); entity / branch / assigned AR team member filter bar with filter bubble display; clear button resets all filters
- [x] `ArCustomerDetail` — full customer detail page with filter context bubble (entity + branch inherited from list, independently adjustable or clearable); tabs: Invoices, Payments, Credits, Contacts, Notes
  - Invoices tab: sortable table; persistent date override (ar_team can edit invoice dates); invoice flags/notes; PDF statement download
  - Payments tab: payment history table
  - Credits tab: credit memos table
  - Contacts tab: contact list + add contact form
  - Notes tab: operation notes + meeting notes; role-scoped write; inline edit
- [x] AR Meeting Dashboard — real-time aggregate AR view for management meetings; aging totals unaffected by collection phase filter
- [x] AR Customer Exclusion — admin/ar_manager can hide internal/in-house customers from all AR data
- [x] Realtime updates via Supabase Realtime — live AR updates across all users
- [x] AR Statement PDF — Apple-style clean layout; download from customer detail
- [x] Customer merge UI

### Frontend — Admin Tools

- [x] `ReviewClient` — Employee Matches, Unknown Payroll Items, Unassigned Fuel Cards (with employee link mode), Pending Allocations; totalPending badge
  - Fuel card rows: "Link to existing employee" toggle; employee search autocomplete; auto-fills branch from employee's assignments; branch override select; sends `{ employeeId, branchId }` to PATCH
- [x] `/admin/import` — payroll + revenue + fuel upload sections; animated progress bar; import history panel; streaming confirm-replace
- [x] `/admin/review` — review queue
- [x] `/admin/users` — user table; deactivation toggle; test accounts panel; username + email columns
- [x] `/admin/employees` — employee list + detail
- [x] `/admin/fiscal-months` — CRUD
- [x] `/admin/fiscal-quarters` — CRUD
- [x] `/admin/targets` — fiscal month dropdown; targets per branch
- [x] `/admin/access-requests` — pending + reviewed tables; approve modal (temp password, generate/copy); deny modal; all 10 roles
- [x] `/admin/data-explorer` — filter bar, summary cards, paginated table, CSV export
- [x] `/admin/allocations` — pending + active tabs; approve/deny
- [x] `/admin/payroll-items` — group assignment; inline edit; spending by date range
- [x] `/admin/settings` — HQ allocation percentages (editable)
- [x] `/admin/audit` — audit log viewer with user/action/table filters
- [x] Sidebar — all nav items; animated badge dots; Allocations, Pay Items, Settings, Audit, AR nav items for relevant roles; `guardAdminOrExecutive` helper used across data explorer, allocations, and admin overview routes

### Frontend — Fuel Pages

- [x] `/fuel` — KPI cards; weekly cost chart; top consumers table; period/branch filter
- [x] `/fuel/cards` — card list with status tabs (All / Linked / General / Unlinked / WH/Signs)
- [x] `/fuel/cards/[id]` — card detail; admin assignment panel (Link to Employee / Mark as General); transaction history

### Utilities & Library

- [x] `lib/utils/access.ts` — `UserAccess`, `canAccessBranch()`
- [x] `lib/utils/errors.ts` — `AppError`, `ParseError`, `AuthError`, `DuplicateImportError`, `NotFoundError`; `AuthError` correctly uses 403 + `'FORBIDDEN'` code
- [x] `lib/utils/format.ts` — `formatCurrency`, `formatPercent`, `round2`
- [x] `lib/utils/date.ts` — `getDateRange`, `isValidDate()`, `getMostRecentSaturday`, etc.
- [x] `lib/utils/payroll-totals.ts` — `calcTotalPayroll`, `calcGrossProfit`, `calcGrossProfitPct`
- [x] `lib/api/auth.ts` — `getAccessContext`, `guardAdminOnly`, `guardAdminOrExecutive`, `guardPayrollAccess`, `guardArAdminOnly`, `getArTeamCustomerIds`
- [x] `components/ui/` — MetricCard, Skeleton, StatusPill, BranchSelector, DateRangePicker, ThreeDotMenu, BranchPerformanceCard

---

## 3. WHAT IS IN PROGRESS / PARTIALLY BUILT

Nothing currently in progress.

---

## 3a. RECENT CHANGES (May 26, 2026) — Fuel card employee linking + AR filter features

### Fuel Card "Link to Existing Employee" (Review Queue)

`components/review/ReviewClient.tsx`:
- Extracted `FuelCardRow` component — each fuel card now has per-card state (mirrors `EmployeeMatchRow` pattern)
- "Link to existing employee" checkbox toggles between branch/tag assignment mode (existing) and employee link mode (new)
- Employee link mode: type ≥2 chars to search employees by name; dropdown shows branch name hints; selecting an employee auto-fills the card's branch from their first confirmed assignment's `branchId`; branch override select shown after employee chosen
- Sends `{ employeeId, branchId }` to `PATCH /api/admin/review/fuel-cards/[id]`; API retroactively backfills all historical transactions
- `Employee` interface: `entityAssignments` now includes `branchId: string | null`
- `app/api/admin/review/route.ts`: `empEntityMap` updated to include `branchId` in each entity assignment entry

### AR Dashboard — Filter by Assigned AR Team Member

`app/api/ar/team-members/route.ts`:
- Returns users who have active `ar_customer_assignments`; resolves display names from `user_profiles`

`app/api/ar/customers/route.ts` + `app/api/ar/summary/route.ts`:
- Added `assignedUserId` param support; scopes data to that user's assigned customers
- Restricted to admin/executive/ar_manager roles

`components/ar/ArDashboard.tsx`:
- "All Assignees" dropdown in filter bar (visible to isArAdmin roles only)
- `assignedUserId` passed into both `fetchSummary` and `fetchCustomers`
- Clear button resets all filters including assignedUserId

### AR Filter Context Carrythrough into Customer Detail

`components/ar/ArDashboard.tsx`:
- Passes `branchId` and `branchName` to `ArCustomerDetail` when navigating to a customer

`components/ar/ArCustomerDetail.tsx`:
- Accepts `branchId` and `branchName` as props (initialized from list view filter)
- Local state (`localEntity`, `invBranchId`, `invBranchName`) initialized from props — filter carries forward but can be adjusted independently
- Filter bubble rendered below hero header when entity or branch filter is active; shows orange-tinted pills with entity/branch selects and ✕ to clear each; "Clear all" when both active

---

## 3b. RECENT CHANGES (May 26, 2026) — 12-bug Health Check Fix Plan

A cold code review identified 12 bugs. All were fixed across 5 passes:

### Pass 1 — Quick Wins
- **Double redirect on login:** `app/page.tsx` — all `DASHBOARD_ROUTES` entries changed to `'/dashboard'` directly (was redirecting to `/admin` which then redirected to `/dashboard`)
- **Wrong HTTP error code:** `lib/utils/errors.ts` — `AuthError` code changed from `'UNAUTHORIZED'` to `'FORBIDDEN'` to match the 403 status
- **Anthropic client re-instantiated per request:** `lib/ai/match.ts` — moved `new Anthropic()` to module level (single instance across all requests)

### Pass 2 — Data Safety
- **business_tag bleed on payroll_taxes:** Added `.is('business_tag', null)` to every `payroll_taxes` query in `app/api/payroll/summary/route.ts`, `app/api/payroll/range/route.ts`, `app/api/admin/overview/route.ts`, `app/api/data-explorer/payroll/route.ts` — prevents WH/Signs employer taxes from appearing in SN numbers
- **No file size limit on imports:** Added `MAX_FILE_SIZE = 10MB` check before `arrayBuffer()` in all three import routes (payroll, revenue, fuel) — returns 413 on oversized files
- **No date parameter validation:** Added `isValidDate(s: string): boolean` to `lib/utils/date.ts`; validated in all routes that accept `startDate`, `endDate`, or `periodDate` — returns 400 on malformed dates

### Pass 3 — Data Integrity
- **Non-atomic AR re-import:** `app/api/admin/ar/import/route.ts` — moved `DELETE ar_invoices` to BEFORE the new invoice insert loop (brief empty window is safer than doubled-data window); "Clearing previous import…" progress step added
- **Non-atomic payroll confirm-replace:** `app/api/import/payroll/route.ts` — wrapped `insertPayrollData` in try/catch with explicit cleanup (deletes transactions, taxes, staged data, and the import record) if insert fails
- **Merge error handling:** `app/api/ar/customers/[id]/merge/route.ts` — each update/delete step now checks for error and returns 500 with specific message if any step fails
- **SQL injection via unescaped ILIKE:** `lib/payroll/import-helpers.ts` — escapes `%`, `_`, `\` in `rawName` before interpolating into `.ilike()` pattern

### Pass 4 — Performance
- **N+1 entity assignment lookups:** `lib/payroll/import-helpers.ts` — pre-fetches ALL entity assignments once before the employee loop; builds a Map keyed by lowercased `raw_name_in_report`; eliminates one DB round-trip per employee per import
- **N+1 "Other" group fetch in payroll items:** `lib/payroll/import-helpers.ts` — fetches "Other" group ID once before the items loop; previously queried DB once per unknown payroll item
- **Employee route full table scan:** `app/api/employees/route.ts` — `payroll_transactions` query scoped to `.in('employee_id', allEmployeeIds)` (was scanning entire table)
- **Audit log unbounded user fetch:** `app/api/admin/audit/route.ts` — added `.limit(5000)` to user fetch for filter dropdown

### Pass 5 — Auth & Guards
- **`guardAdminOrExecutive` helper:** Added to `lib/api/auth.ts` — used by 7 routes: `allocations`, `allocations/pending-count`, `data-explorer/payroll`, `data-explorer/revenue`, `data-explorer/fuel`, `data-explorer/export`, (import history uses `guardAdminOnly`)
- **Branch ID validation on access request approval:** `app/api/admin/access-requests/[id]/route.ts` — validates all `branchIds` against the `branches` table before creating accounts; returns 400 with specific invalid IDs if any are bogus
- **Role validation and scoping fixes:** `office_team` role now correctly scoped to assigned customers; UTC date parsing fixes; additional role guards

---

## 3c. RECENT CHANGES (May 13–25, 2026) — AR module + payments + audit + new roles

### Accounts Receivable Module (built May 13–25)

Full AR collection workflow system. See the "AR Module" sections in Section 2 for complete API + UI inventory.

Key components:
- `components/ar/ArDashboard.tsx` — aging KPIs, customer list, filter bar
- `components/ar/ArCustomerDetail.tsx` — full customer detail with 5 tabs
- `app/api/admin/ar/import/route.ts` — streaming AR import with clear-then-insert pattern
- `app/api/ar/` — full REST surface for customers, invoices, payments, credits, contacts, notes, assignments, statements, team-members

### AR Payment Import Pipeline

- `POST /api/ar/payments/import` (streaming NDJSON) — imports QB payment export CSV; multi-word fuzzy customer name matching; unmatched names shown in summary (not silently dropped); Deposit type supported
- Payments tab in `ArCustomerDetail` with payment history table
- QB payment parser handles header rows above column names

### AR Statement PDF

- `GET /api/ar/customers/[id]/statement` — generates PDF with Apple-style clean layout: customer info, aging summary, open invoice table; downloadable from customer detail page

### Supabase Realtime

- `app/api/ar/customers/[id]` — Supabase Realtime subscription on `ar_invoices` for live updates across all users viewing the same customer

### New Roles

Ten roles now supported (was four). Added: `sales`, `ar_manager`, `ar_team`, `office_team`, `project_manager`.
- `sales` — bypasses branch filter; sees all AR regardless of branch assignments; no payroll/fuel access
- `ar_manager` — all AR + can approve AR team assignments + can toggle showAll
- `ar_team` — scoped to assigned customers by default; showAll toggle; can edit own notes; can override invoice dates
- `office_team` — same AR scope as ar_team; AR-only
- `project_manager` — scoped to AR customers in assigned branches

All new roles available in: access request form, admin user creation, middleware routing.

### Audit Log System

- `app/api/admin/audit/route.ts` — full audit log query with user/action/table/record filters; `.limit(5000)` on user fetch
- `app/admin/audit/` — audit log viewer with filter bar; uses `DashboardShell` (sidebar)
- Sidebar: Audit nav item for admin role

### Username Login

- Auth flow updated to support username or email login; username stored in `user_profiles`; middleware and auth helpers updated

### User Management Enhancements

- User deactivation toggle in admin users table
- Username + Access columns in users table
- Test accounts panel (executive, district, manager test accounts)
- All 10 roles available in admin user creation

### Goals System

- Revenue + GP% goals on Overview and Revenue tabs; Goals by Branch breakdown with actual vs target
- Four distinct goal states with color coding
- Combined revenue + GP% goal status indicator

### Fiscal Month Dropdown Fix (Unified Dashboard)

- Month dropdown filters to months with actual imported data only
- Fixed duplicate year in labels ("December 2025 2025" bug)
- Fixed wrong default month (year-first sort)

### Other Notable Fixes

- `app/api/admin/overview/route.ts` — ORDER BY added to all paginated queries (fixed weekly chart scrambling)
- `app/api/fuel/summary/route.ts` — ORDER BY transaction_date added to paginated loop
- `app/api/admin/overview/route.ts` — `allBranchIds` now includes `bAdminPayroll` keys
- `EmployeeDetailClient` — Branch Allocation section; paginated `payroll_taxes` query in employee detail route
- Removed Payments tab from AR (was removed after adding; simplified AR layout)
- `app/api/access-requests` — username column added; role constraint expanded for new roles
- Mobile polish across the entire app: meeting tab, nav feedback, loading skeletons, xlsm AR import

---

## 4. WHAT HAS NOT BEEN STARTED

- WH / Signs dashboards (explicitly deferred to V2)
- E2E tests with Playwright (deferred to V2)
- API rate limiting on import endpoints
- 13-week trend analytics (needs sufficient data to render meaningfully)
- Anomaly flag UI (employee payroll >3× 4-week average → tooltip warning)
- Drill-down interactions (click payroll group → line items, click fuel total → transactions)

---

## 5. KNOWN ISSUES AND DECISIONS

- **Supabase 1000-row cap:** All routes that aggregate transactions use `.range()` pagination loops or `.limit(50000)`. Always verify new large-result queries.
- **`display_name` is never stored:** Always computed as `first_name || ' ' || last_name`. No stored column.
- **Admin payroll sum rule is a security control:** District/branch managers never receive individual admin employee rows — API returns `{ total: number }` only.
- **`raw_name_in_report` is immutable:** Never expose a UI control that edits this field.
- **must_change_password enforcement:** Middleware gate + `user_profiles` flag. Clearing requires `POST /api/auth/clear-must-change-password`.
- **AR merge is not transactional:** `POST /api/ar/customers/[id]/merge` steps are sequential with per-step error checking, but not wrapped in a DB transaction. A failure mid-merge leaves data in a partial state.
- **next.config.js:** Uses `serverExternalPackages: ['xlsx', 'csv-parse']`.
- **TCS payroll ended March 2026:** No TCS imports after Mar 7, 2026. Intentional — employees moved to STS.

### Pending SQL (must be run manually in Supabase SQL editor)

1. **Note editing column:**
   ```sql
   ALTER TABLE ar_customer_notes ADD COLUMN IF NOT EXISTS edited_at timestamptz;
   ```

2. **Josie Sanchez customer assignments** (assigns ~337 customers):
   ```
   /Users/masondoty/Documents/sn_project/scripts/assign_josie.sql
   ```

---

## 6. CURRENT TEST COUNT

**~209 tests passing, 0 failing** (last verified May 13, 2026)
13 test files across parsers, allocation engine, and API access control.

```bash
npx vitest run
```

---

## 7. DEPLOYMENT

### Git / GitHub

- Remote: GitHub (private repo `masontcs/safety-network-dashboard`)
- `.gitignore` excludes: `.env.local`, `node_modules`, `.next`, `.claude/`, `supabase/.temp/`, `*.csv` (combined AR CSV)
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

### All migrations applied to production (19 total)

- `20260101000001` through `20260101000007` — core schema + RLS
- `20260101000008` — branch_targets
- `20260505000001` — Sacramento merge + is_active
- `20260505000002` — employee branch transfers
- `20260506000001` — fiscal_month_targets redesign
- `20260506000002` — fiscal_quarters + fiscal_quarter_months
- `20260506000003` — access_requests table + RLS
- `20260506000004` — backfill fuel_transaction branches
- `20260506000005` — fuel_imports vendor unique constraint
- `20260506000006` — user_profiles.must_change_password
- `20260507000001` — fix period_date year bug (year 26 CE → 2026)
- `20260507000002` — employee_allocations + employee_allocation_overrides
- `20260507000003` — business_tag column on employee_entity_assignments
- `20260508000001` — payroll_staged_transactions + payroll_staged_taxes
- `20260508000002` — payroll_item_staged_transactions
- `20260508000003` — business_tag on payroll_transactions/taxes; payroll_code_id nullable
- AR migrations — ar_customers, ar_invoices, ar_imports, ar_customer_assignments, ar_customer_contacts, ar_customer_notes, ar_customer_payments, ar_credits, ar_class_codes (applied to production)
- Role constraint migration — expanded CHECK on user_profiles.role for new roles
- Username migration — username column on user_profiles

---

## 8. HOW TO START THE DEV SERVER

```bash
cd /Users/masondoty/Documents/sn_project
npm run dev
# App runs at http://localhost:3000
```

TypeScript check (run before committing):
```bash
npx tsc --noEmit
```

---

## 9. OPEN QUESTIONS / DEFERRED ITEMS

- **Review queue badge count:** Total unresolved items in top nav — not yet implemented.
- **AR merge transactionality:** Merge steps are sequential, not in a DB transaction. Consider Postgres function or RPC for atomicity.
- **Pending SQL:** Two SQL statements need to be run manually (see Section 5).
- **Test count:** Rerun `npx vitest run` to get accurate count — may have changed with new features.
