-- AR Payments: track customer payments imported from QuickBooks
-- Payments are matched to ar_customers via entity refs (qb_customer_name lookup)
-- No invoice-level linkage available from QB Transaction List by Customer export

CREATE TABLE ar_payment_imports (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  entity_code   text NOT NULL CHECK (entity_code IN ('INC','TCS','STS')),
  date_from     date NOT NULL,
  date_to       date NOT NULL,
  imported_by   uuid REFERENCES user_profiles(id),
  payment_count int NOT NULL DEFAULT 0,
  total_amount  numeric(12,2) NOT NULL DEFAULT 0,
  created_at    timestamptz DEFAULT now()
);

CREATE TABLE ar_payments (
  id                uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  import_id         uuid NOT NULL REFERENCES ar_payment_imports(id) ON DELETE CASCADE,
  customer_id       uuid REFERENCES ar_customers(id) ON DELETE SET NULL,
  entity_code       text NOT NULL CHECK (entity_code IN ('INC','TCS','STS')),
  payment_date      date NOT NULL,
  reference_number  text,                        -- check number / ACH ref
  amount            numeric(12,2) NOT NULL CHECK (amount > 0),
  memo              text,
  qb_customer_name  text NOT NULL,               -- raw QB name used for matching
  created_at        timestamptz DEFAULT now(),

  -- Deduplicate: same customer + ref + date + entity can't be imported twice
  UNIQUE (entity_code, qb_customer_name, reference_number, payment_date)
);

CREATE INDEX idx_ar_payments_customer_id   ON ar_payments(customer_id);
CREATE INDEX idx_ar_payments_payment_date  ON ar_payments(payment_date DESC);
CREATE INDEX idx_ar_payments_entity_code   ON ar_payments(entity_code);
CREATE INDEX idx_ar_payments_import_id     ON ar_payments(import_id);

ALTER TABLE ar_payment_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE ar_payments        ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read payments
CREATE POLICY "authenticated_read" ON ar_payment_imports
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "authenticated_read" ON ar_payments
  FOR SELECT TO authenticated USING (true);

-- Only AR admin (admin/executive/ar_manager) can write
CREATE POLICY "ar_admin_write" ON ar_payment_imports
  FOR ALL TO authenticated
  USING     (current_user_role() IN ('admin','executive','ar_manager'))
  WITH CHECK (current_user_role() IN ('admin','executive','ar_manager'));

CREATE POLICY "ar_admin_write" ON ar_payments
  FOR ALL TO authenticated
  USING     (current_user_role() IN ('admin','executive','ar_manager'))
  WITH CHECK (current_user_role() IN ('admin','executive','ar_manager'));
