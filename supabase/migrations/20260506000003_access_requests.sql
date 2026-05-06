CREATE TABLE access_requests (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  first_name      text NOT NULL,
  last_name       text NOT NULL,
  email           text NOT NULL,
  branch_id       uuid REFERENCES branches(id),
  requested_role  text NOT NULL CHECK (requested_role IN ('branch_manager','district_manager','executive')),
  notes           text,
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','denied')),
  reviewed_by     uuid REFERENCES user_profiles(id),
  reviewed_at     timestamptz,
  created_at      timestamptz DEFAULT now()
);

CREATE INDEX idx_access_requests_status ON access_requests(status);

ALTER TABLE access_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_all" ON access_requests
  FOR ALL TO authenticated
  USING (current_user_role() = 'admin')
  WITH CHECK (current_user_role() = 'admin');
