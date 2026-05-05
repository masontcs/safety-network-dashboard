-- Branch performance targets (revenue and gross profit % per period)

CREATE TABLE branch_targets (
  id                uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  branch_id         uuid        NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  period_type       text        NOT NULL CHECK (period_type IN ('weekly', 'monthly')),
  target_date       date        NOT NULL,  -- Saturday for weekly, 1st of month for monthly
  revenue_target    numeric(12,2),
  profit_pct_target numeric(6,4),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT branch_targets_unique_period UNIQUE (branch_id, period_type, target_date)
);

CREATE INDEX idx_branch_targets_branch_id   ON branch_targets(branch_id);
CREATE INDEX idx_branch_targets_target_date ON branch_targets(target_date);

ALTER TABLE branch_targets ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read targets for their accessible branches
CREATE POLICY "authenticated_read" ON branch_targets
  FOR SELECT TO authenticated USING (true);

-- Only admins can write
CREATE POLICY "admin_write" ON branch_targets
  FOR ALL TO authenticated USING (current_user_role() = 'admin')
  WITH CHECK (current_user_role() = 'admin');
