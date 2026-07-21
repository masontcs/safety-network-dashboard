-- billing_023_single_rate_and_per_variation_pricing
--
-- Two shape changes to how an equipment item is priced on a list:
--   1. single_rate: price ONE rate (the 'flat' key) across tiers instead of the six
--      cadences. Tiers still cascade. Cones/barricades are single-rate; a message board
--      prices by cadence.
--   2. per-variation grids: when an item has variations, the variation is the real priced
--      unit, so rates hang off the variation, not the item.

-- 1. single-rate flag on the price-list item
ALTER TABLE billing_price_list_items
  ADD COLUMN single_rate boolean NOT NULL DEFAULT false;

-- 2. variation_id on every rate table. NULL = the item's OWN grid (used only when the
--    item has no variations); non-null = that variation's grid. ON DELETE CASCADE so
--    removing a variation takes its rates with it.
ALTER TABLE billing_price_list_item_bases
  ADD COLUMN variation_id uuid REFERENCES billing_item_variations(id) ON DELETE CASCADE;
ALTER TABLE billing_price_list_item_overrides
  ADD COLUMN variation_id uuid REFERENCES billing_item_variations(id) ON DELETE CASCADE;
ALTER TABLE billing_price_list_rates
  ADD COLUMN variation_id uuid REFERENCES billing_item_variations(id) ON DELETE CASCADE;

-- 3. Uniqueness must treat two NULL variation_ids as a collision. A plain unique index
--    does NOT (SQL NULLs are distinct), so use partial indexes: one for the item grid,
--    one for the variation grids.
ALTER TABLE billing_price_list_item_bases DROP CONSTRAINT billing_price_list_item_bases_pkey;
CREATE UNIQUE INDEX billing_pl_item_bases_item_uq
  ON billing_price_list_item_bases (price_list_item_id, billing_type) WHERE variation_id IS NULL;
CREATE UNIQUE INDEX billing_pl_item_bases_var_uq
  ON billing_price_list_item_bases (price_list_item_id, variation_id, billing_type) WHERE variation_id IS NOT NULL;

ALTER TABLE billing_price_list_item_overrides DROP CONSTRAINT billing_price_list_item_overrides_pkey;
CREATE UNIQUE INDEX billing_pl_item_overrides_item_uq
  ON billing_price_list_item_overrides (price_list_item_id, tier_id, billing_type) WHERE variation_id IS NULL;
CREATE UNIQUE INDEX billing_pl_item_overrides_var_uq
  ON billing_price_list_item_overrides (price_list_item_id, variation_id, tier_id, billing_type) WHERE variation_id IS NOT NULL;

ALTER TABLE billing_price_list_rates DROP CONSTRAINT billing_price_list_rates_pkey;
CREATE UNIQUE INDEX billing_pl_rates_item_uq
  ON billing_price_list_rates (price_list_item_id, tier_id, billing_type) WHERE variation_id IS NULL;
CREATE UNIQUE INDEX billing_pl_rates_var_uq
  ON billing_price_list_rates (price_list_item_id, variation_id, tier_id, billing_type) WHERE variation_id IS NOT NULL;

-- indexes for the cascade-delete / variation lookups
CREATE INDEX billing_pl_item_bases_variation_idx ON billing_price_list_item_bases (variation_id) WHERE variation_id IS NOT NULL;
CREATE INDEX billing_pl_item_overrides_variation_idx ON billing_price_list_item_overrides (variation_id) WHERE variation_id IS NOT NULL;
CREATE INDEX billing_pl_rates_variation_idx ON billing_price_list_rates (variation_id) WHERE variation_id IS NOT NULL;

-- 4. The variation ADJUSTMENT model is superseded by per-variation grids. It had 0 rows
--    and nothing references it.
DROP TABLE IF EXISTS billing_price_list_variation_overrides;

COMMENT ON COLUMN billing_price_list_items.single_rate IS
  'When true, this item prices a single rate (the flat key) across tiers instead of the six billing cadences. Tiers still cascade.';
COMMENT ON COLUMN billing_price_list_rates.variation_id IS
  'NULL = the item''s own grid (item has no variations). Non-null = that variation''s grid (the variation is the priced unit).';
