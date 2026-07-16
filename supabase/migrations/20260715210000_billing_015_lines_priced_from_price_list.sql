-- billing_015_lines_priced_from_price_list
-- Labor and Lump Sum charge lines pick a CATALOG ITEM; their description and rate come
-- from the item and its price list, not from someone typing them onto a ticket. A rate
-- typed here could contradict the price list, and the price list is the source of truth.
--
-- So those lines carry no rate of their own: NULL means "priced from the price list at
-- invoice time" (live rates, not snapshotted). Previously NOT NULL, which forced a
-- fabricated 0 or a duplicated number.

ALTER TABLE billing_ticket_lines ALTER COLUMN unit_rate_cents DROP NOT NULL;
ALTER TABLE billing_ticket_lines ALTER COLUMN amount_cents DROP NOT NULL;

COMMENT ON COLUMN billing_ticket_lines.unit_rate_cents IS
  'NULL = priced from the price list at invoice time (labor / lump sum). Set only where the rate is entered by hand (misc) or taken from the item (sale).';
COMMENT ON COLUMN billing_ticket_lines.amount_cents IS
  'NULL = computed at invoice time from the price-list rate. Set only when unit_rate_cents is set.';

-- An item-priced line must actually reference an item — otherwise nothing can price it.
ALTER TABLE billing_ticket_lines
  ADD CONSTRAINT billing_ticket_lines_priced_lines_have_item_chk
  CHECK (kind NOT IN ('labor', 'lump_sum') OR item_id IS NOT NULL);

-- A hand-priced line must carry both numbers or neither.
ALTER TABLE billing_ticket_lines
  ADD CONSTRAINT billing_ticket_lines_rate_amount_together_chk
  CHECK ((unit_rate_cents IS NULL) = (amount_cents IS NULL));
