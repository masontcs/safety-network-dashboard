-- billing_021_variation_cost_and_sale_adj
-- A variation is a real physical difference (an orange cone, a large vest), so it can
-- differ on ALL THREE numbers an item carries — not just the rental rate:
--   * cost      -> what a LOST unit bills at
--   * rate      -> the price-list rental rate
--   * sale price-> what it sells for
--
-- Previously a variation only adjusted the rate, and the column was called `adj_cents`.
-- With one adjustment that name was merely vague; with three it would be a trap, so it
-- is renamed to say which number it moves. All three now read alike:
--   rate_adj_cents / cost_adj_cents / sale_adj_cents
--
-- Existing rows keep their value: adj_cents WAS the rate adjustment.

ALTER TABLE billing_item_variations RENAME COLUMN adj_cents TO rate_adj_cents;

ALTER TABLE billing_item_variations
  ADD COLUMN cost_adj_cents integer NOT NULL DEFAULT 0,
  ADD COLUMN sale_adj_cents integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN billing_item_variations.rate_adj_cents IS
  'Per-unit +/- on the price-list RENTAL RATE, applied after the tier cascade. May be negative; the resolved rate is floored at 0.';
COMMENT ON COLUMN billing_item_variations.cost_adj_cents IS
  'Per-unit +/- on the item COST — i.e. what a LOST unit of this variation bills at.';
COMMENT ON COLUMN billing_item_variations.sale_adj_cents IS
  'Per-unit +/- on the item SALE PRICE. Only meaningful when the item is salable.';

-- This table overrides the RATE adjustment for one price list; renamed to match.
-- (Cost and sale price are properties of the item, not of a customer's price list.)
ALTER TABLE billing_price_list_variation_overrides RENAME COLUMN adj_cents TO rate_adj_cents;

COMMENT ON COLUMN billing_price_list_variation_overrides.rate_adj_cents IS
  'Overrides billing_item_variations.rate_adj_cents for this price list only.';
