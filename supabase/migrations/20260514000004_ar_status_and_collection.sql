-- Rename status → customer_status, replace values, add collection_status

ALTER TABLE ar_customers RENAME COLUMN status TO customer_status;

-- Drop the old check constraint (Postgres auto-named it)
ALTER TABLE ar_customers DROP CONSTRAINT IF EXISTS ar_customers_status_check;

-- Remap any legacy values that don't belong in the new schema
UPDATE ar_customers
SET customer_status = 'active'
WHERE customer_status NOT IN ('active', 'inactive', 'one_time', 'key_account');

ALTER TABLE ar_customers
  ADD CONSTRAINT ar_customers_customer_status_check
  CHECK (customer_status IN ('active', 'inactive', 'one_time', 'key_account'));

-- Collection status — separate from general customer status
-- Priority: 1 = critical, 2 = high, 3 = low, 0 = none
ALTER TABLE ar_customers
  ADD COLUMN IF NOT EXISTS collection_status text NOT NULL DEFAULT 'none'
  CHECK (collection_status IN (
    'none',           -- no collection issue (priority 0)
    'promise_to_pay', -- customer promised a date (priority 1)
    'payment_plan',   -- on a structured payment plan (priority 1)
    'legal',          -- legal action initiated (priority 1)
    'collections',    -- sent to collections agency (priority 1)
    'on_hold',        -- account on hold (priority 2)
    'dispute',        -- invoice disputed (priority 2)
    'write_off'       -- written off (priority 3)
  ));
