-- Fiscal quarters composed of exactly 3 custom fiscal months

CREATE TABLE fiscal_quarters (
  id              uuid    DEFAULT gen_random_uuid() PRIMARY KEY,
  name            text    NOT NULL,
  quarter_number  integer NOT NULL CHECK (quarter_number BETWEEN 1 AND 4),
  year            integer NOT NULL,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz DEFAULT now(),
  UNIQUE (quarter_number, year)
);

CREATE TABLE fiscal_quarter_months (
  id                  uuid    DEFAULT gen_random_uuid() PRIMARY KEY,
  fiscal_quarter_id   uuid    NOT NULL REFERENCES fiscal_quarters(id) ON DELETE CASCADE,
  fiscal_month_id     uuid    NOT NULL REFERENCES fiscal_months(id),
  sort_order          integer NOT NULL CHECK (sort_order BETWEEN 1 AND 3),
  UNIQUE (fiscal_quarter_id, fiscal_month_id),
  UNIQUE (fiscal_month_id)   -- a month belongs to at most one quarter
);

CREATE INDEX idx_fqm_quarter ON fiscal_quarter_months(fiscal_quarter_id);
CREATE INDEX idx_fqm_month   ON fiscal_quarter_months(fiscal_month_id);

ALTER TABLE fiscal_quarters        ENABLE ROW LEVEL SECURITY;
ALTER TABLE fiscal_quarter_months  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_read" ON fiscal_quarters
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin_write" ON fiscal_quarters
  FOR ALL TO authenticated
  USING (current_user_role() = 'admin')
  WITH CHECK (current_user_role() = 'admin');

CREATE POLICY "authenticated_read" ON fiscal_quarter_months
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin_write" ON fiscal_quarter_months
  FOR ALL TO authenticated
  USING (current_user_role() = 'admin')
  WITH CHECK (current_user_role() = 'admin');
