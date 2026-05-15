-- Customer status
ALTER TABLE ar_customers ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active'
  CHECK (status IN ('active', 'collections', 'on_hold', 'closed'));

-- Contacts
CREATE TABLE IF NOT EXISTS ar_customer_contacts (
  id          uuid         DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_id uuid         NOT NULL REFERENCES ar_customers(id) ON DELETE CASCADE,
  name        text         NOT NULL,
  title       text,
  email       text,
  phone       text,
  is_primary  boolean      NOT NULL DEFAULT false,
  created_at  timestamptz  DEFAULT now()
);

-- Notes
CREATE TABLE IF NOT EXISTS ar_customer_notes (
  id          uuid         DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_id uuid         NOT NULL REFERENCES ar_customers(id) ON DELETE CASCADE,
  content     text         NOT NULL,
  created_by  uuid         REFERENCES auth.users(id),
  created_at  timestamptz  DEFAULT now()
);

-- PM assignments — links AR customers to system users
CREATE TABLE IF NOT EXISTS ar_customer_pm_assignments (
  id          uuid         DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_id uuid         NOT NULL REFERENCES ar_customers(id) ON DELETE CASCADE,
  user_id     uuid         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at  timestamptz  DEFAULT now(),
  UNIQUE(customer_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_ar_contacts_customer ON ar_customer_contacts(customer_id);
CREATE INDEX IF NOT EXISTS idx_ar_notes_customer    ON ar_customer_notes(customer_id);
CREATE INDEX IF NOT EXISTS idx_ar_pm_customer       ON ar_customer_pm_assignments(customer_id);

-- RLS
ALTER TABLE ar_customer_contacts      ENABLE ROW LEVEL SECURITY;
ALTER TABLE ar_customer_notes         ENABLE ROW LEVEL SECURITY;
ALTER TABLE ar_customer_pm_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_read" ON ar_customer_contacts
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin_write" ON ar_customer_contacts
  FOR ALL TO authenticated
  USING (current_user_role() = 'admin') WITH CHECK (current_user_role() = 'admin');

CREATE POLICY "authenticated_read" ON ar_customer_notes
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin_write" ON ar_customer_notes
  FOR ALL TO authenticated
  USING (current_user_role() = 'admin') WITH CHECK (current_user_role() = 'admin');

CREATE POLICY "authenticated_read" ON ar_customer_pm_assignments
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin_write" ON ar_customer_pm_assignments
  FOR ALL TO authenticated
  USING (current_user_role() = 'admin') WITH CHECK (current_user_role() = 'admin');
