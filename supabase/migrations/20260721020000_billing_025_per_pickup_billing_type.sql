-- billing_025_per_pickup_billing_type
--
-- The rental cadence (daily/weekly/monthly) was one value for the WHOLE ticket. It belongs
-- on the equipment instead: each item you pick up chooses how it bills. The accrual engine
-- already keys billing by pickup lot, so the cadence rides on the pickup event.
--
-- billing_type is meaningful only on 'pickup' rows; return/lost leave it null. 'flat' is a
-- charge-item key, never an equipment cadence, so the check excludes it.

ALTER TABLE billing_ticket_ledger ADD COLUMN billing_type billing_type;

ALTER TABLE billing_ticket_ledger ADD CONSTRAINT billing_ledger_billing_type_ck
  CHECK (billing_type IS NULL OR billing_type IN ('daily', 'weekly', 'monthly'));

-- Backfill: existing pickups inherit the ticket's current cadence, so nothing already
-- entered is lost when the ticket-level field goes away.
UPDATE billing_ticket_ledger l
   SET billing_type = t.billing_type
  FROM billing_tickets t
 WHERE t.id = l.ticket_id
   AND l.event_type = 'pickup'
   AND t.billing_type IS NOT NULL;

COMMENT ON COLUMN billing_ticket_ledger.billing_type IS
  'Rental cadence for this pickup (daily/weekly/monthly). Null on return/lost rows. Replaces the ticket-level billing_type.';
