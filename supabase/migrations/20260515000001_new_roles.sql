-- Add ar_manager, ar_team, and project_manager roles

ALTER TABLE user_profiles DROP CONSTRAINT IF EXISTS user_profiles_role_check;
ALTER TABLE user_profiles
  ADD CONSTRAINT user_profiles_role_check
  CHECK (role IN ('admin', 'executive', 'district_manager', 'branch_manager', 'ar_manager', 'ar_team', 'project_manager'));

-- AR team customer assignments (ar_team members can only see customers assigned to them)
CREATE TABLE IF NOT EXISTS ar_customer_assignments (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_id uuid NOT NULL REFERENCES ar_customers(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES auth.users(id)   ON DELETE CASCADE,
  assigned_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (customer_id, user_id)
);

CREATE INDEX IF NOT EXISTS ar_customer_assignments_user_idx     ON ar_customer_assignments(user_id);
CREATE INDEX IF NOT EXISTS ar_customer_assignments_customer_idx ON ar_customer_assignments(customer_id);

ALTER TABLE ar_customer_assignments ENABLE ROW LEVEL SECURITY;

-- Admins and AR managers can do anything with assignments
CREATE POLICY "ar_admin_manage_assignments" ON ar_customer_assignments
  FOR ALL USING (
    EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('admin', 'ar_manager'))
  );

-- AR team members can read their own assignments
CREATE POLICY "ar_team_read_own_assignments" ON ar_customer_assignments
  FOR SELECT USING (user_id = auth.uid());
