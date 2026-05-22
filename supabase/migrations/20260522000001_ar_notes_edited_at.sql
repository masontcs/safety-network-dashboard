-- Add edited_at to track whether a note has been edited after creation
ALTER TABLE ar_customer_notes
  ADD COLUMN IF NOT EXISTS edited_at timestamptz;
