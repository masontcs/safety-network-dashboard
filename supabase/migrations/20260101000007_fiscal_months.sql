-- Fiscal months: company-defined periods keyed to week-ending Saturdays

CREATE TABLE fiscal_months (
  id          uuid    DEFAULT gen_random_uuid() PRIMARY KEY,
  name        text    NOT NULL,
  year        integer NOT NULL,
  start_date  date    NOT NULL,
  end_date    date    NOT NULL,
  sort_order  integer NOT NULL DEFAULT 0,
  is_active   boolean NOT NULL DEFAULT true,
  CONSTRAINT fiscal_months_end_after_start CHECK (end_date > start_date)
);

CREATE INDEX idx_fiscal_months_year       ON fiscal_months(year);
CREATE INDEX idx_fiscal_months_start_date ON fiscal_months(start_date);

ALTER TABLE fiscal_months ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read
CREATE POLICY "authenticated_read" ON fiscal_months
  FOR SELECT TO authenticated USING (true);

-- Only admins can write
CREATE POLICY "admin_write" ON fiscal_months
  FOR ALL TO authenticated USING (current_user_role() = 'admin')
  WITH CHECK (current_user_role() = 'admin');
