-- Employee Tables
-- employees, employee_entity_assignments, fuel_card_assignments

-- IMPORTANT: display_name is NEVER stored here.
-- Always compute as: first_name || ' ' || last_name
CREATE TABLE employees (
  id          uuid    DEFAULT gen_random_uuid() PRIMARY KEY,
  first_name  text    NOT NULL DEFAULT '',
  last_name   text    NOT NULL DEFAULT '',
  is_active   boolean NOT NULL DEFAULT true
);

-- One row per (employee, entity) combination.
-- raw_name_in_report: legal name exactly as imported from QuickBooks.
--   - Set on first import, NEVER modified thereafter.
--   - Used only for AI name matching — never shown as a primary label in the UI.
CREATE TABLE employee_entity_assignments (
  id                   uuid         DEFAULT gen_random_uuid() PRIMARY KEY,
  employee_id          uuid         NOT NULL REFERENCES employees(id),
  entity_id            uuid         NOT NULL REFERENCES entities(id),
  payroll_code_id      uuid         REFERENCES payroll_codes(id),
  raw_name_in_report   text         NOT NULL,
  is_confirmed         boolean      NOT NULL DEFAULT false,
  ai_match_score       numeric(6,4),
  ai_match_candidate   text,
  UNIQUE (raw_name_in_report, entity_id)
);

-- Tracks fuel card names from import files to employee or branch
-- card_name + vendor must be unique (same card can't belong to two assignments)
CREATE TABLE fuel_card_assignments (
  id            uuid    DEFAULT gen_random_uuid() PRIMARY KEY,
  card_name     text    NOT NULL,
  vendor        text    NOT NULL CHECK (vendor IN ('interstate','flyers')),
  employee_id   uuid    REFERENCES employees(id),
  branch_id     uuid    REFERENCES branches(id),
  business_tag  text    CHECK (business_tag IN ('western_highways','signs')),
  is_confirmed  boolean NOT NULL DEFAULT false,
  UNIQUE (card_name, vendor)
);

-- Indexes
CREATE INDEX idx_employee_entity_assignments_employee_id ON employee_entity_assignments(employee_id);
CREATE INDEX idx_employee_entity_assignments_entity_id ON employee_entity_assignments(entity_id);
CREATE INDEX idx_employee_entity_assignments_raw_name ON employee_entity_assignments(raw_name_in_report);
CREATE INDEX idx_fuel_card_assignments_employee_id ON fuel_card_assignments(employee_id);
CREATE INDEX idx_fuel_card_assignments_branch_id ON fuel_card_assignments(branch_id);
