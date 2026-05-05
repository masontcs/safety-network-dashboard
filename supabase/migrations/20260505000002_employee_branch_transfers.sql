-- Employee Branch Transfer History
-- Tracks when employees move from one branch to another.
-- employee_entity_assignments gains effective_from / effective_to to support
-- multiple assignment periods per employee+entity.

-- ─── New table ────────────────────────────────────────────────────────────────
CREATE TABLE employee_branch_transfers (
  id                    uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  employee_id           uuid        NOT NULL REFERENCES employees(id),
  from_payroll_code_id  uuid        NOT NULL REFERENCES payroll_codes(id),
  to_payroll_code_id    uuid        NOT NULL REFERENCES payroll_codes(id),
  effective_date        date        NOT NULL,
  created_at            timestamptz DEFAULT now(),
  created_by            uuid        REFERENCES user_profiles(id),
  notes                 text
);

CREATE INDEX ON employee_branch_transfers(employee_id, effective_date);

-- ─── Add period columns to employee_entity_assignments ────────────────────────

ALTER TABLE employee_entity_assignments
  ADD COLUMN effective_from date NOT NULL DEFAULT '1900-01-01',
  ADD COLUMN effective_to   date;

-- All existing records become "from the beginning of time, still active"
UPDATE employee_entity_assignments SET effective_from = '1900-01-01', effective_to = NULL;

-- Drop the old table-level unique constraint (would block historical records)
ALTER TABLE employee_entity_assignments
  DROP CONSTRAINT employee_entity_assignments_raw_name_in_report_entity_id_key;

-- Partial unique index: only one ACTIVE assignment per (raw_name, entity)
-- Historical records (effective_to IS NOT NULL) are excluded from uniqueness.
CREATE UNIQUE INDEX employee_entity_assignments_active_unique
  ON employee_entity_assignments(raw_name_in_report, entity_id)
  WHERE effective_to IS NULL;

-- Index for period-range lookups used in branch resolution queries
CREATE INDEX idx_eea_employee_entity_dates
  ON employee_entity_assignments(employee_id, entity_id, effective_from);

-- ─── RLS ─────────────────────────────────────────────────────────────────────

ALTER TABLE employee_branch_transfers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_exec_read" ON employee_branch_transfers
  FOR SELECT TO authenticated
  USING (current_user_role() IN ('admin', 'executive'));

CREATE POLICY "admin_write" ON employee_branch_transfers
  FOR ALL TO authenticated
  USING (current_user_role() = 'admin')
  WITH CHECK (current_user_role() = 'admin');
