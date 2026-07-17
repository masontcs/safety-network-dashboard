-- billing_020_sale_category_not_null
-- Fill in 'Sale' for the sale-only items billing_018 left uncategorised, then put
-- NOT NULL back. Every item now states what it is; nothing is null.
--
-- A category still exists to pick a price-list tier — 'Sale' is the one category that
-- needs none, because a sale is priced by the item's own sale_price_cents and never
-- appears on a price list. Keeping it a real value (rather than NULL) means the catalog
-- reads plainly and nothing has to explain what "no category" meant.
--
-- ORDER MATTERS: the 018 constraints must be dropped BEFORE the UPDATE. Their rule was
-- "category IS NULL OR category = 'Equipment' OR (not a good)", so the moment marking
-- paint became 'Sale' it stopped being NULL and the UPDATE itself would be rejected.

ALTER TABLE billing_items DROP CONSTRAINT IF EXISTS billing_items_uncategorised_is_sale_only_chk;
ALTER TABLE billing_items DROP CONSTRAINT IF EXISTS billing_items_charge_flags_chk;

UPDATE billing_items SET category = 'Sale' WHERE category IS NULL;

ALTER TABLE billing_items ALTER COLUMN category SET NOT NULL;

COMMENT ON COLUMN billing_items.category IS
  'What the item IS. Equipment rents (tier by category, cadence rates); Labor/Lump Sum/Misc charge a flat rate from the price list; Sale is only ever sold, priced by sale_price_cents and never on a price list. Selling a rentable item does NOT make it Sale — that is a sale LINE on a ticket.';

-- A Sale item is sold, never rented, never tracked. (Renting needs a tier, and Sale has
-- none — a rentable item must carry its rental category instead.)
ALTER TABLE billing_items
  ADD CONSTRAINT billing_items_sale_is_sale_only_chk
  CHECK (category <> 'Sale' OR (salable AND NOT rentable AND NOT tracked));

-- Charge items (Labor / Lump Sum / Misc) are never goods.
ALTER TABLE billing_items
  ADD CONSTRAINT billing_items_charge_flags_chk
  CHECK (category IN ('Equipment', 'Sale')
         OR (NOT rentable AND NOT salable AND NOT tracked AND NOT taxable));
