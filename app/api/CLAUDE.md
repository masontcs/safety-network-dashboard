# CLAUDE.md — /app/api
## API Route Rules

---

## EVERY ROUTE — REQUIRED STEPS IN ORDER

```
1. Get session from Supabase Auth → 401 if missing
2. Get user_profiles row (role)
3. Get user_branch_assignments (branchIds array, or null for admin/executive)
4. Validate role has permission
5. Validate branch access
6. Validate request body/params
7. Execute logic
8. Return { success: boolean, data?: T, error?: string }
```

---

## EMPLOYEE NAME FIELDS IN API RESPONSES

**Never return `raw_name_in_report` to the client** except on the admin review queue
where it is needed for matching context.

**Always compute display_name server-side:**
```typescript
// In every query that returns employee data:
const displayName = `${employee.first_name} ${employee.last_name}`.trim()

// Or in SQL:
SELECT first_name || ' ' || last_name AS display_name FROM employees
```

**Never store or cache display_name** — always recompute from first_name + last_name.

---

## BRANCH ACCESS HELPER

Build once in `/lib/utils/access.ts`:

```typescript
type UserAccess = {
  role: 'admin' | 'executive' | 'district_manager' | 'branch_manager'
  branchIds: string[] | null   // null = all access
}

function canAccessBranch(access: UserAccess, branchId: string): boolean {
  if (access.branchIds === null) return true
  return access.branchIds.includes(branchId)
}
```

---

## PAYROLL ROUTES — THE ADMIN SUM RULE

```typescript
// admin / executive:
return {
  directLabor:  { detail: PayrollLineItem[], total: number },
  adminPayroll: { detail: PayrollLineItem[], total: number },
  taxes:        { detail: PayrollLineItem[], total: number },
}

// district_manager / branch_manager:
return {
  directLabor:  { detail: PayrollLineItem[], total: number },
  adminPayroll: { total: number },   // NO detail array — ever
  taxes:        { total: number },   // NO detail array — ever
}
```

PayrollLineItem includes `displayName` (computed) — never `rawName`.

### GET /api/payroll/employee/:employeeId
```typescript
// If employee's labor_type !== 'direct' AND role is manager → return 403
// Also verify branch access
```

---

## EMPLOYEE NAME MANAGEMENT ROUTES

### GET /api/employees
- All authenticated roles (scoped by branch access)
- Returns: `{ id, firstName, lastName, displayName, isActive }`
- Never returns `raw_name_in_report`

### PATCH /api/employees/:id/name — admin only
```typescript
// Body: { firstName: string, lastName: string }
// Validates: both fields present, non-empty strings, max 100 chars each
// Updates: employees.first_name, employees.last_name
// Does NOT touch raw_name_in_report — ever
// Returns: { id, firstName, lastName, displayName }

// Validation:
if (!firstName?.trim()) return error('First name is required', 400)
if (!lastName?.trim()) return error('Last name is required', 400)
if (firstName.length > 100 || lastName.length > 100) return error('Name too long', 400)
```

### GET /api/employees/:id
- Role-scoped: managers only access employees in their branches
- Returns full employee profile including:
  - `firstName`, `lastName`, `displayName`
  - `legalName` (raw_name_in_report) — shown on detail page only, in muted text
  - payroll history, fuel history

---

## IMPORT ROUTES — admin only

### POST /api/import/payroll
1. role === 'admin' check → 403
2. Parse via lib/payroll
3. Duplicate check (entity + period_date) → 409 if found
4. For each new employee name: auto-split into first_name/last_name, trigger AI matching
5. Create import, resolve employees, insert transactions
6. Return import summary

### POST /api/import/payroll/confirm-replace — admin only
Atomic delete of previous import + taxes, then re-import.

### POST /api/import/revenue — admin only
### POST /api/import/fuel — admin only

---

## DATA ROUTES

### GET /api/payroll/summary
Params: branchId (or branchIds[] for district), startDate, endDate, view
Apply admin payroll sum rule. All employee names returned as displayName only.

### GET /api/revenue/summary
### GET /api/fuel/summary
Same branch access pattern. Never return WH/Signs to manager roles.

### GET /api/allocation/summary — executive and admin only (403 for managers)

---

## ADMIN ROUTES — admin only

```
GET/POST  /api/admin/users
GET/POST  /api/admin/review-queue
POST      /api/admin/review-queue/confirm
GET/POST  /api/admin/payroll-codes
GET/POST  /api/admin/revenue-codes
GET/POST  /api/admin/branches
```

---

## RESPONSE FORMAT

```typescript
{ success: true, data: T }
{ success: false, error: string, code?: string }
```

Status: 200 | 400 bad request | 401 unauthenticated | 403 unauthorized | 409 conflict | 500 server error

---

## SUPABASE CLIENT IN API ROUTES

```typescript
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!  // SERVER ONLY
)
```

---

## VERIFICATION CHECKLIST

- [ ] PATCH /api/employees/:id/name exists and is admin-only
- [ ] raw_name_in_report never returned to client except in review queue
- [ ] display_name always computed from first_name + last_name — never from a stored column
- [ ] Employee name update does NOT touch raw_name_in_report
- [ ] Admin payroll detail never returned to district/branch managers
- [ ] Duplicate imports return 409 with conflict payload
- [ ] All API routes validate session before any data access
