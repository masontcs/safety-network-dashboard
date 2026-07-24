-- billing_024_simplify_billing_types_to_daily_weekly_monthly
--
-- Collapse the six rate-unit/cycle cadences down to three plain ones. The old split
-- (weekly_billed_weekly vs weekly_billed_daily, etc.) distinguished the unit a rate was
-- expressed in from the cadence it billed at; TCR only needs one rate per cadence.
--
--   daily                  -> daily
--   weekly_billed_weekly   -> weekly
--   weekly_billed_daily    -> weekly
--   monthly_billed_monthly -> monthly
--   monthly_billed_weekly  -> monthly
--   monthly_billed_daily   -> monthly
--   flat                   -> flat   (single-rate / charge items, unchanged)
--
-- Data-safe: only 'daily' and 'flat' rows exist; the removed variants carry no data.
-- Enum values can't be dropped in place, so recreate the type and convert every column.

CREATE TYPE billing_type_new AS ENUM ('daily', 'weekly', 'monthly', 'flat');

-- One mapping, applied to every column that stores a billing_type. ALTER COLUMN TYPE
-- rebuilds the dependent (partial, unique) indexes automatically.
ALTER TABLE billing_item_default_rates
  ALTER COLUMN billing_type TYPE billing_type_new USING (
    CASE billing_type::text
      WHEN 'weekly_billed_weekly' THEN 'weekly'
      WHEN 'weekly_billed_daily' THEN 'weekly'
      WHEN 'monthly_billed_monthly' THEN 'monthly'
      WHEN 'monthly_billed_weekly' THEN 'monthly'
      WHEN 'monthly_billed_daily' THEN 'monthly'
      ELSE billing_type::text
    END::billing_type_new);

ALTER TABLE billing_price_list_item_bases
  ALTER COLUMN billing_type TYPE billing_type_new USING (
    CASE billing_type::text
      WHEN 'weekly_billed_weekly' THEN 'weekly'
      WHEN 'weekly_billed_daily' THEN 'weekly'
      WHEN 'monthly_billed_monthly' THEN 'monthly'
      WHEN 'monthly_billed_weekly' THEN 'monthly'
      WHEN 'monthly_billed_daily' THEN 'monthly'
      ELSE billing_type::text
    END::billing_type_new);

ALTER TABLE billing_price_list_item_overrides
  ALTER COLUMN billing_type TYPE billing_type_new USING (
    CASE billing_type::text
      WHEN 'weekly_billed_weekly' THEN 'weekly'
      WHEN 'weekly_billed_daily' THEN 'weekly'
      WHEN 'monthly_billed_monthly' THEN 'monthly'
      WHEN 'monthly_billed_weekly' THEN 'monthly'
      WHEN 'monthly_billed_daily' THEN 'monthly'
      ELSE billing_type::text
    END::billing_type_new);

ALTER TABLE billing_price_list_rates
  ALTER COLUMN billing_type TYPE billing_type_new USING (
    CASE billing_type::text
      WHEN 'weekly_billed_weekly' THEN 'weekly'
      WHEN 'weekly_billed_daily' THEN 'weekly'
      WHEN 'monthly_billed_monthly' THEN 'monthly'
      WHEN 'monthly_billed_weekly' THEN 'monthly'
      WHEN 'monthly_billed_daily' THEN 'monthly'
      ELSE billing_type::text
    END::billing_type_new);

ALTER TABLE billing_tickets
  ALTER COLUMN billing_type TYPE billing_type_new USING (
    CASE billing_type::text
      WHEN 'weekly_billed_weekly' THEN 'weekly'
      WHEN 'weekly_billed_daily' THEN 'weekly'
      WHEN 'monthly_billed_monthly' THEN 'monthly'
      WHEN 'monthly_billed_weekly' THEN 'monthly'
      WHEN 'monthly_billed_daily' THEN 'monthly'
      ELSE billing_type::text
    END::billing_type_new);

DROP TYPE billing_type;
ALTER TYPE billing_type_new RENAME TO billing_type;
