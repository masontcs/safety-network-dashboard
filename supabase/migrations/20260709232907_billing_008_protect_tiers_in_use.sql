-- ============================================================================
-- 20260709232907_billing_008_protect_tiers_in_use.sql
-- TCR Billing v2 — Migration 008: A tier in use by a profile cannot be deleted
--
-- `billing_pect_tier_in_list` was ON DELETE CASCADE. Deleting a price-list tier
-- therefore SILENTLY deleted the billing_profile_entity_category_tiers rows that
-- pointed at it -- leaving a profile with an enabled entity, a price list, and
-- NO tier for one or more item categories. Pricing would then have nothing to
-- resolve against.
--
-- Switch it to RESTRICT so the database refuses. Editing a price list must never
-- be able to quietly break a customer's pricing.
--
-- The sibling constraint (billing_pect_list_matches_profile_entity) keeps its
-- CASCADE: deleting the profile_entity itself SHOULD remove its category tiers.
--
-- Derived data (billing_price_list_item_overrides, billing_price_list_rates)
-- keeps CASCADE on tier delete -- those rows only exist for that tier.
--
-- Verified after applying:
--   * deleting a tier a profile depends on  -> foreign_key_violation (blocked)
--   * deleting an unused tier               -> succeeds
--   * deleting a price list in use          -> foreign_key_violation (blocked)
-- ============================================================================

alter table public.billing_profile_entity_category_tiers
  drop constraint billing_pect_tier_in_list;

alter table public.billing_profile_entity_category_tiers
  add constraint billing_pect_tier_in_list
  foreign key (price_list_id, tier_id)
  references public.billing_price_list_tiers(price_list_id, id)
  on delete restrict;
