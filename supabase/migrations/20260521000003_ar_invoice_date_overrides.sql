-- Persistent invoice date overrides
-- Allows admins to correct invoice dates that were altered in QB for banking purposes.
-- Overrides are keyed on (invoice_number, entity_code) so they survive fresh imports.

CREATE TABLE ar_invoice_date_overrides (
  id             uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  invoice_number text NOT NULL,
  entity_code    text NOT NULL CHECK (entity_code IN ('INC','TCS','STS')),
  override_date  date NOT NULL,
  note           text,                              -- optional reason / audit trail
  overridden_by  uuid REFERENCES user_profiles(id),
  created_at     timestamptz DEFAULT now(),
  updated_at     timestamptz DEFAULT now(),

  UNIQUE (invoice_number, entity_code)
);

CREATE INDEX idx_ar_invoice_date_overrides_entity ON ar_invoice_date_overrides(entity_code);

ALTER TABLE ar_invoice_date_overrides ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read overrides (needed to display corrected dates)
CREATE POLICY "authenticated_read" ON ar_invoice_date_overrides
  FOR SELECT TO authenticated USING (true);

-- Only AR admin can write
CREATE POLICY "ar_admin_write" ON ar_invoice_date_overrides
  FOR ALL TO authenticated
  USING     (current_user_role() IN ('admin','executive','ar_manager'))
  WITH CHECK (current_user_role() IN ('admin','executive','ar_manager'));
