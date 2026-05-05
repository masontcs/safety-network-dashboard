# CLAUDE.md — /supabase
## Database Layer Rules

---

## ALL TABLES

### Reference / Config
```
businesses            id, name, code, is_active, hq_allocation_pct
branches              id, name, business_id, is_revenue_generating, is_corporate
entities              id, name, code (INC/TCS/STS)
payroll_codes         id, code, branch_id, entity_id, labor_type, allocation_type, is_active
revenue_codes         id, code, branch_id, entity_id, is_active
payroll_item_groups   id, name
payroll_items         id, name, group_id, is_confirmed, ai_suggested_group, ai_confidence
```

### User / Access
```
user_profiles           id (= auth.users.id), role, display_name
user_branch_assignments id, user_id, branch_id
```
Role values: `'admin' | 'executive' | 'district_manager' | 'branch_manager'`

### Employee — NAME FIELDS ARE CRITICAL
```
employees   id, first_name, last_name, is_active
```

**`first_name`** — preferred first name. Editable by admin. Defaults to auto-split from legal name on first import.
**`last_name`** — preferred last name. Editable by admin. Defaults to auto-split from legal name on first import.
**`display_name`** — DO NOT store this column. Always compute as `first_name || ' ' || last_name` at query time or in application code. Never add a `display_name` column to this table.

```
employee_entity_assignments
  id, employee_id, entity_id, payroll_code_id,
  raw_name_in_report,   ← legal name from QuickBooks, NEVER editable, used for AI matching only
  is_confirmed, ai_match_score, ai_match_candidate
```

**`raw_name_in_report`** is the source of truth for who this person is in QuickBooks.
It must never be modified after initial import. It is the field used for all AI name matching.

```
fuel_card_assignments
  id, card_name, vendor, employee_id (nullable), branch_id (nullable),
  business_tag (nullable), is_confirmed
```

### Import Headers
```
payroll_imports   id, entity_id, period_date, imported_at, imported_by, status
revenue_imports   id, period_date, imported_at, imported_by, status
fuel_imports      id, vendor, date_range_start, date_range_end, imported_at, imported_by, status
```

### Transactions
```
payroll_transactions
  id, import_id, employee_id, entity_id, payroll_code_id,
  period_date, payroll_item_id, hours, rate, amount

payroll_taxes
  id, import_id, employee_id, entity_id, period_date, amount

revenue_transactions
  id, import_id, revenue_code_id, branch_id, entity_id,
  period_date, labor, rental, one_time_charges, sales_tax, total_revenue

fuel_transactions
  id, import_id, fuel_card_assignment_id, branch_id (nullable),
  employee_id (nullable), business_tag (nullable), vendor,
  transaction_date, transaction_time, site_name, site_city, site_state,
  product, gallons, price_per_gallon, total_pretax, tax, total_with_tax
```

---

## DATA TYPES — STRICT

```sql
id                  uuid DEFAULT gen_random_uuid() PRIMARY KEY
monetary amounts    numeric(12,2)   — NEVER float or real
hours               numeric(8,3)
rate                numeric(10,4)
percentage          numeric(6,4)
dates               date
timestamps          timestamptz
first_name          text NOT NULL DEFAULT ''
last_name           text NOT NULL DEFAULT ''
raw_name_in_report  text NOT NULL
role CHECK          ('admin','executive','district_manager','branch_manager')
labor_type CHECK    ('direct','admin_hourly','admin_salary','corp_hourly','corp_salary','hq_hourly','hq_salary')
allocation_type CHECK ('none','corp','hq')
vendor CHECK        ('interstate','flyers')
status CHECK        ('pending','confirmed','replaced')
business_tag CHECK  ('western_highways','signs') OR NULL
```

---

## EMPLOYEES TABLE — MIGRATION NOTE

```sql
CREATE TABLE employees (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  first_name  text NOT NULL DEFAULT '',
  last_name   text NOT NULL DEFAULT '',
  is_active   boolean NOT NULL DEFAULT true
);

-- display_name is NEVER a column — always computed:
-- SELECT first_name || ' ' || last_name AS display_name FROM employees
```

There is no `display_name` column. If you find yourself adding one, stop — it belongs in
application code or as a generated column, not a stored column that can go stale.

If a `display_name` generated column is useful for indexing/search, use:
```sql
ALTER TABLE employees
  ADD COLUMN display_name text GENERATED ALWAYS AS (first_name || ' ' || last_name) STORED;
```
But only add this if search performance requires it. Default: compute in application code.

---

## NAME EDITING API

Admin needs an endpoint to update first_name and last_name on employees.

```sql
-- The only fields editable on employees:
UPDATE employees SET first_name = $1, last_name = $2 WHERE id = $3;

-- raw_name_in_report on employee_entity_assignments is NEVER updated via the UI
```

---

## RLS POLICIES

Enable RLS on ALL tables. Three-policy pattern for transaction tables:

```sql
-- Branch/District managers: assigned branches, direct labor only
CREATE POLICY "managers_direct_only" ON payroll_transactions
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM user_profiles up
      JOIN user_branch_assignments uba ON uba.user_id = up.id
      JOIN payroll_codes pc ON pc.id = payroll_transactions.payroll_code_id
      WHERE up.id = auth.uid()
        AND up.role IN ('district_manager','branch_manager')
        AND uba.branch_id = pc.branch_id
        AND pc.labor_type = 'direct'
    )
  );

-- Admin + Executive: full access
CREATE POLICY "admin_exec_full" ON payroll_transactions
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('admin','executive'))
  );

-- Admin: write
CREATE POLICY "admin_write" ON payroll_transactions
  FOR ALL USING (
    EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'admin')
  );
```

Apply same pattern to: `payroll_taxes`, `revenue_transactions`, `fuel_transactions`.

---

## SEED DATA

**businesses (3):** Safety Network (SN, 78.13%), Western Highways (WH, 18.52%), Signs (SIGNS, 3.35%)
**entities (3):** INC, TCS, STS
**branches (7):** Arroyo Grande, Bakersfield, Fresno, Modesto, Orange County, Sacramento, Visalia — all `is_revenue_generating = true`
**payroll_item_groups (12):** Standard Time, Overtime, Double-time, Lunch Comp, SAUs, Per Diem, Reimbursement, Fringes, Salary, Paid Leave, Other, Taxes
**All 29 payroll codes** from Payroll_Codes_-_Sheet2.csv
**All revenue codes** per branch/entity mapping
**All 195 payroll items** from payroll-item-mappings.csv

Seed script must be idempotent.

---

## VERIFICATION CHECKLIST

- [ ] `employees` table has `first_name` and `last_name` — NO `display_name` column
- [ ] `raw_name_in_report` on `employee_entity_assignments` is NOT NULL and NOT editable via UI
- [ ] All monetary columns are `numeric(12,2)` (verify via information_schema)
- [ ] RLS enabled on every table
- [ ] `user_profiles` cascades delete from `auth.users`
- [ ] Seed script runs without error on a fresh project
