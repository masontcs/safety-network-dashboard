-- Add payment_type column to ar_payments
-- 'payment' = normal customer payment
-- 'deposit'  = cash deposited into wrong QB company (still real cash received)

ALTER TABLE ar_payments
  ADD COLUMN IF NOT EXISTS payment_type text
    NOT NULL
    DEFAULT 'payment'
    CHECK (payment_type IN ('payment', 'deposit'));
