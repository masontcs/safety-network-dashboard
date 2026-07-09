-- ============================================================================
-- 20260709225140_billing_007_fix_ambiguous_fk.sql
-- TCR Billing v2 — Migration 007: Remove an ambiguous foreign key
--
-- billing_profile_entity_category_tiers had TWO foreign keys to
-- billing_profile_entities:
--   1. billing_profile_entity_category_tiers_profile_entity_id_fkey
--        (profile_entity_id) -> billing_profile_entities(id)
--   2. billing_pect_list_matches_profile_entity
--        (profile_entity_id, price_list_id) -> billing_profile_entities(id, price_list_id)
--
-- PostgREST refuses to embed a child that has more than one relationship to the
-- same parent ("Could not embed because more than one relationship was found"),
-- which would break GET /api/billing/profiles/[id]/entity-config at runtime.
--
-- (1) is redundant: profile_entity_id is NOT NULL and (2) already enforces
-- referential integrity AND ON DELETE CASCADE, while additionally guaranteeing
-- the tier's price list is the one the profile_entity actually selected.
--
-- Verified after applying: the composite FK still blocks changing a
-- profile_entity's price_list_id while category-tier children exist. That is
-- why the PUT handler deletes children before updating the parent.
-- ============================================================================

alter table public.billing_profile_entity_category_tiers
  drop constraint billing_profile_entity_category_tiers_profile_entity_id_fkey;
