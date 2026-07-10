-- billing_011_category_drives_item_nature
-- An item's CATEGORY is its nature. Only 'Equipment' is a physical good that
-- can be rented and/or sold (and tracked/taxed). 'Labor', 'Lump Sum' and 'Misc'
-- are charge items — never rentable, salable, tracked, or taxable; they are
-- billed as their own line kind on a ticket. Replaces the blanket
-- "rentable OR salable" rule (billing_010) which wrongly rejected labor items.

ALTER TABLE billing_items DROP CONSTRAINT IF EXISTS billing_items_rentable_or_salable_chk;

-- Normalise any non-Equipment rows before the stricter checks land.
UPDATE billing_items
SET rentable = false, salable = false, tracked = false, taxable = false, sale_price_cents = NULL
WHERE category <> 'Equipment'
  AND (rentable OR salable OR tracked OR taxable OR sale_price_cents IS NOT NULL);

-- Equipment must be usable as a good: rentable, salable, or both.
ALTER TABLE billing_items
  ADD CONSTRAINT billing_items_equipment_sellable_chk
  CHECK (category <> 'Equipment' OR rentable OR salable);

-- Charge items (non-Equipment) are never goods.
ALTER TABLE billing_items
  ADD CONSTRAINT billing_items_charge_flags_chk
  CHECK (category = 'Equipment' OR (NOT rentable AND NOT salable AND NOT tracked AND NOT taxable));
