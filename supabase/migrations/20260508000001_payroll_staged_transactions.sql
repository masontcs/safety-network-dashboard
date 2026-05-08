-- Staging tables for pending (unconfirmed) employee payroll data.
-- When a payroll import encounters an unknown employee, their line items and taxes
-- are held here instead of being discarded. When the admin confirms or links the
-- employee in the review queue, the staged rows are moved into payroll_transactions
-- and payroll_taxes automatically.

CREATE TABLE payroll_staged_transactions (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  assignment_id   uuid NOT NULL REFERENCES employee_entity_assignments(id) ON DELETE CASCADE,
  import_id       uuid NOT NULL,
  entity_id       uuid NOT NULL,
  period_date     date NOT NULL,
  payroll_item_id uuid REFERENCES payroll_items(id),
  hours           numeric(8,3),
  rate            numeric(10,4),
  amount          numeric(12,2) NOT NULL
);

CREATE TABLE payroll_staged_taxes (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  assignment_id uuid NOT NULL REFERENCES employee_entity_assignments(id) ON DELETE CASCADE,
  import_id     uuid NOT NULL,
  entity_id     uuid NOT NULL,
  period_date   date NOT NULL,
  amount        numeric(12,2) NOT NULL
);

CREATE INDEX idx_pst_assignment   ON payroll_staged_transactions(assignment_id);
CREATE INDEX idx_psttax_assignment ON payroll_staged_taxes(assignment_id);
