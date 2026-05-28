-- Allow 'tbd' as a valid outcome value on ar_customer_notes.
-- The original CHECK constraint was added inline in 20260520000001 without an
-- explicit name, so Postgres auto-named it ar_customer_notes_outcome_check.
-- Drop the old constraint and add a new one that includes 'tbd'.

ALTER TABLE ar_customer_notes
  DROP CONSTRAINT IF EXISTS ar_customer_notes_outcome_check;

ALTER TABLE ar_customer_notes
  ADD CONSTRAINT ar_customer_notes_outcome_check
  CHECK (outcome IS NULL OR outcome IN (
    'positive',
    'no_answer',
    'needs_follow_up',
    'roadblock',
    'promise_to_pay',
    'escalated',
    'unproductive',
    'tbd'
  ));
