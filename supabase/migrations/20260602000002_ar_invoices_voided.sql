-- Manual void flag on ar_invoices.
-- Allows AR team to mark an invoice voided in the app before QB reflects it.
-- Voided invoices are excluded from totals, aging, and statements.

ALTER TABLE ar_invoices
  ADD COLUMN IF NOT EXISTS is_voided   boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS voided_at   timestamptz,
  ADD COLUMN IF NOT EXISTS voided_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS ar_invoices_is_voided_idx ON ar_invoices(is_voided) WHERE is_voided = true;
