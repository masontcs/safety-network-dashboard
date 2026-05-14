-- AR Tables
-- Accounts Receivable: global customers, entity refs, class code mapping, imports, invoices

-- Global customer master — persists across imports and is shared across entities
CREATE TABLE ar_customers (
  id           uuid         DEFAULT gen_random_uuid() PRIMARY KEY,
  display_name text         NOT NULL,
  notes        text,
  created_at   timestamptz  DEFAULT now()
);

-- Maps a QuickBooks source name (per entity) to a global customer.
-- Same company appearing in TCS, INC, and STS AR files links to one ar_customers row.
CREATE TABLE ar_customer_entity_refs (
  id              uuid   DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_id     uuid   NOT NULL REFERENCES ar_customers(id) ON DELETE CASCADE,
  entity_code     text   NOT NULL,
  quickbooks_name text   NOT NULL,
  UNIQUE(entity_code, quickbooks_name)
);

-- Import audit trail — one row per file upload per entity
CREATE TABLE ar_imports (
  id            uuid         DEFAULT gen_random_uuid() PRIMARY KEY,
  entity_code   text         NOT NULL,
  report_date   date         NOT NULL,
  imported_at   timestamptz  DEFAULT now(),
  imported_by   uuid         REFERENCES auth.users(id),
  total_ar      numeric(12,2),
  invoice_count int
);

-- Maps QuickBooks class codes to branches.
-- A single branch may have multiple codes (OP = Operations, SU = Southern Union, etc.)
CREATE TABLE ar_class_codes (
  code        text  PRIMARY KEY,
  branch_id   uuid  REFERENCES branches(id),
  entity_code text
);

-- Current open invoices — fully replaced per entity on each import.
-- The overwrite strategy: insert new import + invoices, then delete old invoices
-- for the entity (those not belonging to the new import_id). This ensures zero
-- downtime — new data is live before old data is removed.
CREATE TABLE ar_invoices (
  id              uuid          DEFAULT gen_random_uuid() PRIMARY KEY,
  import_id       uuid          NOT NULL REFERENCES ar_imports(id),
  customer_id     uuid          NOT NULL REFERENCES ar_customers(id),
  entity_code     text          NOT NULL,
  branch_id       uuid          REFERENCES branches(id),
  raw_class_code  text,
  invoice_number  text,
  po_number       text,
  job_name        text,
  invoice_date    date,
  due_date        date,
  terms           text,
  open_balance    numeric(12,2) NOT NULL DEFAULT 0,
  aging_bucket    text          CHECK (aging_bucket IN ('Current','1-30','31-60','61-90','>90')),
  aging_days      int,
  created_at      timestamptz   DEFAULT now()
);

-- Indexes
CREATE INDEX idx_ar_invoices_entity_code   ON ar_invoices(entity_code);
CREATE INDEX idx_ar_invoices_branch_id     ON ar_invoices(branch_id);
CREATE INDEX idx_ar_invoices_customer_id   ON ar_invoices(customer_id);
CREATE INDEX idx_ar_invoices_aging_bucket  ON ar_invoices(aging_bucket);
CREATE INDEX idx_ar_invoices_import_id     ON ar_invoices(import_id);
CREATE INDEX idx_ar_refs_entity_name       ON ar_customer_entity_refs(entity_code, quickbooks_name);

-- ─────────────────────────────────────────────
-- Seed known class codes
-- ─────────────────────────────────────────────

-- TCS — Bakersfield (TCS-BF standard, TCBOP = Operations, TCBSU = Southern Union)
INSERT INTO ar_class_codes (code, branch_id, entity_code)
  SELECT 'TCS-BF', b.id, 'TCS' FROM branches b WHERE b.name = 'Bakersfield' LIMIT 1;
INSERT INTO ar_class_codes (code, branch_id, entity_code)
  SELECT 'TCBOP', b.id, 'TCS' FROM branches b WHERE b.name = 'Bakersfield' LIMIT 1;
INSERT INTO ar_class_codes (code, branch_id, entity_code)
  SELECT 'TCBSU', b.id, 'TCS' FROM branches b WHERE b.name = 'Bakersfield' LIMIT 1;

-- TCS — Fresno
INSERT INTO ar_class_codes (code, branch_id, entity_code)
  SELECT 'TCS-FR', b.id, 'TCS' FROM branches b WHERE b.name = 'Fresno' LIMIT 1;
INSERT INTO ar_class_codes (code, branch_id, entity_code)
  SELECT 'TCFOP', b.id, 'TCS' FROM branches b WHERE b.name = 'Fresno' LIMIT 1;

-- TCS — Modesto
INSERT INTO ar_class_codes (code, branch_id, entity_code)
  SELECT 'TCS-MO', b.id, 'TCS' FROM branches b WHERE b.name = 'Modesto' LIMIT 1;
INSERT INTO ar_class_codes (code, branch_id, entity_code)
  SELECT 'TCMOP', b.id, 'TCS' FROM branches b WHERE b.name = 'Modesto' LIMIT 1;

-- TCS — Orange County
INSERT INTO ar_class_codes (code, branch_id, entity_code)
  SELECT 'TCS-OC', b.id, 'TCS' FROM branches b WHERE b.name = 'Orange County' LIMIT 1;
INSERT INTO ar_class_codes (code, branch_id, entity_code)
  SELECT 'TCOSU', b.id, 'TCS' FROM branches b WHERE b.name = 'Orange County' LIMIT 1;

-- TCS — Sacramento (merged into Modesto — no separate Sacramento branch)
INSERT INTO ar_class_codes (code, branch_id, entity_code)
  SELECT 'TCS-SAC', b.id, 'TCS' FROM branches b WHERE b.name = 'Modesto' LIMIT 1;

-- TCS — Visalia
INSERT INTO ar_class_codes (code, branch_id, entity_code)
  SELECT 'TCS-VI', b.id, 'TCS' FROM branches b WHERE b.name = 'Visalia' LIMIT 1;

-- TCS — Arroyo Grande
INSERT INTO ar_class_codes (code, branch_id, entity_code)
  SELECT 'TCASU', b.id, 'TCS' FROM branches b WHERE b.name = 'Arroyo Grande' LIMIT 1;

-- TCS — Hold (no branch, unassigned invoices)
INSERT INTO ar_class_codes (code, branch_id, entity_code) VALUES ('TCS-HLD', NULL, 'TCS');

-- STS codes present in TCS AR file
INSERT INTO ar_class_codes (code, branch_id, entity_code)
  SELECT 'STBKOP', b.id, 'STS' FROM branches b WHERE b.name = 'Bakersfield' LIMIT 1;
INSERT INTO ar_class_codes (code, branch_id, entity_code)
  SELECT 'STSOC', b.id, 'STS' FROM branches b WHERE b.name = 'Orange County' LIMIT 1;

-- ─────────────────────────────────────────────
-- Row Level Security
-- ─────────────────────────────────────────────

ALTER TABLE ar_customers             ENABLE ROW LEVEL SECURITY;
ALTER TABLE ar_customer_entity_refs  ENABLE ROW LEVEL SECURITY;
ALTER TABLE ar_imports               ENABLE ROW LEVEL SECURITY;
ALTER TABLE ar_class_codes           ENABLE ROW LEVEL SECURITY;
ALTER TABLE ar_invoices              ENABLE ROW LEVEL SECURITY;

-- Reference data: all authenticated users read; admin write
CREATE POLICY "authenticated_read" ON ar_class_codes
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin_write" ON ar_class_codes
  FOR ALL TO authenticated
  USING (current_user_role() = 'admin')
  WITH CHECK (current_user_role() = 'admin');

-- Customers: all authenticated users read; admin write
CREATE POLICY "authenticated_read" ON ar_customers
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin_write" ON ar_customers
  FOR ALL TO authenticated
  USING (current_user_role() = 'admin')
  WITH CHECK (current_user_role() = 'admin');

CREATE POLICY "authenticated_read" ON ar_customer_entity_refs
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin_write" ON ar_customer_entity_refs
  FOR ALL TO authenticated
  USING (current_user_role() = 'admin')
  WITH CHECK (current_user_role() = 'admin');

-- Imports: all authenticated users read; admin write
CREATE POLICY "authenticated_read" ON ar_imports
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin_write" ON ar_imports
  FOR ALL TO authenticated
  USING (current_user_role() = 'admin')
  WITH CHECK (current_user_role() = 'admin');

-- Invoices: branch-scoped read for managers; admin/executive see all; admin write
CREATE POLICY "admin_executive_read" ON ar_invoices
  FOR SELECT TO authenticated USING (
    current_user_role() IN ('admin', 'executive')
  );

CREATE POLICY "managers_branch_scoped" ON ar_invoices
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1
      FROM user_profiles up
      JOIN user_branch_assignments uba ON uba.user_id = up.id
      WHERE up.id = auth.uid()
        AND up.role IN ('district_manager', 'branch_manager')
        AND uba.branch_id = ar_invoices.branch_id
    )
  );

CREATE POLICY "admin_write" ON ar_invoices
  FOR ALL TO authenticated
  USING (current_user_role() = 'admin')
  WITH CHECK (current_user_role() = 'admin');
