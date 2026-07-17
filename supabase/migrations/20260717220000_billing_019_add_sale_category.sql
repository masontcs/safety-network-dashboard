-- billing_019_add_sale_category
-- Add the 'Sale' category. Must land in its own migration: Postgres won't let a new
-- enum value be USED in the same transaction that adds it (billing_020 does the fill).
--
-- Sale-ness is about how an item is USED, not what it is:
--   * A cone is Equipment. Selling one is a sale LINE — the cone stays Equipment,
--     because that's its rental nature and what picks its rental tier.
--   * A vest or marking paint is only ever sold, so 'Sale' IS its category.
--
-- This replaces the NULL-means-sale-only shape from billing_018: explicit beats
-- implicit, and nothing is null.

ALTER TYPE billing_item_category ADD VALUE IF NOT EXISTS 'Sale';
