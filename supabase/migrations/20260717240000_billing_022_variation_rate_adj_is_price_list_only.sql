-- billing_022_variation_rate_adj_is_price_list_only
-- An adjustment belongs where the number it moves lives:
--   cost       lives on the ITEM        -> cost_adj_cents stays on the variation
--   sale price lives on the ITEM        -> sale_adj_cents stays on the variation
--   rate       lives on the PRICE LIST  -> the rate adj belongs to the price list
--
-- So the item no longer carries a rate adjustment at all. A variation's rate adjustment
-- is set per price list, in billing_price_list_variation_overrides — which until now was
-- read by the engine but written by nothing.
--
-- Safe: 0 of 37 variations had a non-zero rate adj, so nothing is lost.

ALTER TABLE billing_item_variations DROP COLUMN rate_adj_cents;

-- No longer an "override" of an item-level default — there is no default. This IS where
-- a variation's rental rate adjustment is set, per price list. (Table name kept: renaming
-- it would churn every reference for a word.)
COMMENT ON TABLE billing_price_list_variation_overrides IS
  'THE place a variation''s rental rate adjustment is set, per price list. The item carries no rate adjustment: a rate lives on the price list, so its adjustment does too. Absent row = no adjustment (0).';
COMMENT ON COLUMN billing_price_list_variation_overrides.rate_adj_cents IS
  'Per-unit +/- on the resolved rental rate for this variation, on this price list. May be negative; the resolved rate is floored at 0.';
