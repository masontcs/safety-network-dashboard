-- billing_010_item_rentable_flag
-- Distinguish rental items from sale-only items (e.g. paint). A sale-only item
-- (rentable=false) can never be added to a ticket's equipment ledger or given a
-- rental price list, so it can't be accidentally billed as a rental.
-- Every existing item was implicitly rentable, so default is true.

ALTER TABLE billing_items
  ADD COLUMN rentable boolean NOT NULL DEFAULT true;

-- An item must be usable for something: rentable, salable, or both.
ALTER TABLE billing_items
  ADD CONSTRAINT billing_items_rentable_or_salable_chk
  CHECK (rentable OR salable);

COMMENT ON COLUMN billing_items.rentable IS
  'True if the item can be rented (added to a ticket equipment ledger and priced on a rental price list). False = sale-only (e.g. paint).';
