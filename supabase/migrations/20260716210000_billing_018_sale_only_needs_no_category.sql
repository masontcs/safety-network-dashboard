-- billing_018_sale_only_needs_no_category
-- A category exists for ONE reason: to pick a tier in a price list.
--   * Equipment  -> rented, tier by category, cadence rates
--   * Labor / Lump Sum / Misc -> charge items, tier by category, one flat rate
--   * SALE-ONLY  -> priced by its own sale_price_cents, and deliberately EXCLUDED from
--                   price lists entirely (see the catalog filter in price-lists/[id])
--
-- So for a sale-only item the category is never read. Forcing one made us file a
-- reflective vest under "Equipment" — a lie the schema told to satisfy NOT NULL.
--
-- category IS NULL now means exactly "sale-only, uncategorised". We don't sell enough
-- to justify classifying every item; if that changes, a category can be added later
-- without touching this shape.

ALTER TABLE billing_items DROP CONSTRAINT IF EXISTS billing_items_equipment_sellable_chk;
ALTER TABLE billing_items DROP CONSTRAINT IF EXISTS billing_items_charge_flags_chk;

ALTER TABLE billing_items ALTER COLUMN category DROP NOT NULL;

-- Existing sale-only items were parked under Equipment because NOT NULL demanded it.
UPDATE billing_items
SET category = NULL
WHERE category = 'Equipment' AND NOT rentable AND salable;

COMMENT ON COLUMN billing_items.category IS
  'NULL = sale-only (priced by sale_price_cents, never on a price list). Otherwise the category picks the price-list tier: Equipment rents by cadence; Labor/Lump Sum/Misc charge one flat rate.';

-- Uncategorised means sale-only: salable, never rented, never tracked.
-- (Renting requires a tier, which requires a category — so NULL implies not rentable.)
ALTER TABLE billing_items
  ADD CONSTRAINT billing_items_uncategorised_is_sale_only_chk
  CHECK (category IS NOT NULL OR (salable AND NOT rentable AND NOT tracked));

-- Equipment must be usable as a good: rentable, salable, or both.
ALTER TABLE billing_items
  ADD CONSTRAINT billing_items_equipment_sellable_chk
  CHECK (category IS DISTINCT FROM 'Equipment' OR rentable OR salable);

-- Charge items are never goods.
ALTER TABLE billing_items
  ADD CONSTRAINT billing_items_charge_flags_chk
  CHECK (category IS NULL OR category = 'Equipment'
         OR (NOT rentable AND NOT salable AND NOT tracked AND NOT taxable));
