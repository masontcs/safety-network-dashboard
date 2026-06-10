-- Promise to Pay tracker: weekly promises logged by the AR team.
-- week_of is always the Monday of the week (ISO week start).

CREATE TABLE ar_promises (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_id   uuid REFERENCES ar_customers(id) ON DELETE SET NULL,
  customer_name text NOT NULL,
  week_of       date NOT NULL,
  amount        numeric(12,2) NOT NULL CHECK (amount > 0),
  note          text,
  created_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by_name text,
  created_at    timestamptz DEFAULT now()
);

CREATE INDEX ar_promises_week_of_idx ON ar_promises(week_of);

ALTER TABLE ar_promises ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read promises
CREATE POLICY "ar_promises_read" ON ar_promises
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- AR-capable roles can insert
CREATE POLICY "ar_promises_insert" ON ar_promises
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid()
        AND role IN ('admin', 'executive', 'ar_manager', 'ar_team', 'office_team')
    )
  );

-- Own rows or admin can delete
CREATE POLICY "ar_promises_delete" ON ar_promises
  FOR DELETE USING (
    created_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'admin'
    )
  );
