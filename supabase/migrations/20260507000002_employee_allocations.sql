-- Employee allocation system: split an employee's payroll + fuel costs
-- across multiple branches by percentage for reporting purposes.
-- The underlying transactions are never modified.

-- ── Default recurring allocation split ────────────────────────────────────────
CREATE TABLE employee_allocations (
  id                uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  employee_id       uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  branch_id         uuid NOT NULL REFERENCES branches(id),
  percentage        numeric(5,2) NOT NULL CHECK (percentage > 0 AND percentage <= 100),
  effective_from    date NOT NULL,
  effective_to      date,  -- NULL = currently active
  status            text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','denied')),
  requested_by      uuid REFERENCES user_profiles(id),
  approved_by       uuid REFERENCES user_profiles(id),
  notes             text,
  created_at        timestamptz DEFAULT now(),
  UNIQUE (employee_id, branch_id, effective_from)
);

-- ── Weekly override for a specific period ─────────────────────────────────────
CREATE TABLE employee_allocation_overrides (
  id                uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  employee_id       uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  period_date       date NOT NULL,  -- the Saturday week-end date
  branch_id         uuid NOT NULL REFERENCES branches(id),
  percentage        numeric(5,2) NOT NULL CHECK (percentage > 0 AND percentage <= 100),
  status            text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','denied')),
  requested_by      uuid REFERENCES user_profiles(id),
  approved_by       uuid REFERENCES user_profiles(id),
  notes             text,
  created_at        timestamptz DEFAULT now(),
  UNIQUE (employee_id, period_date, branch_id)
);

CREATE INDEX ON employee_allocations(employee_id, effective_from);
CREATE INDEX ON employee_allocations(employee_id, status);
CREATE INDEX ON employee_allocation_overrides(employee_id, period_date);
CREATE INDEX ON employee_allocation_overrides(status);

-- ── RLS ───────────────────────────────────────────────────────────────────────
ALTER TABLE employee_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_allocation_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read allocations"
  ON employee_allocations FOR SELECT TO authenticated USING (true);

CREATE POLICY "Service role manages allocations"
  ON employee_allocations FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can read allocation overrides"
  ON employee_allocation_overrides FOR SELECT TO authenticated USING (true);

CREATE POLICY "Service role manages allocation overrides"
  ON employee_allocation_overrides FOR ALL TO service_role USING (true) WITH CHECK (true);
