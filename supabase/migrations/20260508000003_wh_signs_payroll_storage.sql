-- Allow payroll transactions and taxes to be stored for Western Highways
-- and Signs Fabrication employees. These rows carry business_tag so they
-- are naturally excluded from all SN dashboard queries (which filter by
-- payroll_code_id IN (specific SN codes)). payroll_code_id is made nullable
-- so WH/Signs transactions can be stored without an SN payroll code.

ALTER TABLE payroll_transactions
  ADD COLUMN IF NOT EXISTS business_tag text
    CHECK (business_tag IN ('western_highways', 'signs')),
  ALTER COLUMN payroll_code_id DROP NOT NULL;

ALTER TABLE payroll_taxes
  ADD COLUMN IF NOT EXISTS business_tag text
    CHECK (business_tag IN ('western_highways', 'signs'));
