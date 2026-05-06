-- Replace date-based branch_targets with fiscal-month-based targets

DROP TABLE IF EXISTS branch_targets;

CREATE TABLE branch_targets (
  id                  uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  branch_id           uuid NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  fiscal_month_id     uuid NOT NULL REFERENCES fiscal_months(id) ON DELETE CASCADE,
  revenue_target      numeric(12,2),
  profit_pct_target   numeric(6,4),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          uuid REFERENCES user_profiles(id),
  UNIQUE (branch_id, fiscal_month_id)
);

CREATE INDEX idx_branch_targets_branch_id      ON branch_targets(branch_id);
CREATE INDEX idx_branch_targets_fiscal_month   ON branch_targets(fiscal_month_id);

ALTER TABLE branch_targets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_read" ON branch_targets
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "admin_write" ON branch_targets
  FOR ALL TO authenticated USING (current_user_role() = 'admin')
  WITH CHECK (current_user_role() = 'admin');
