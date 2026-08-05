-- billing_016_profile_scoped_items
-- Custom items that belong to ONE billing profile — a negotiated Lump Sum or Labor line
-- created just for that contract. Global catalog items keep owner_profile_id NULL and are
-- unchanged. A scoped item carries its OWN price (per variation, or a single rate when it
-- has no variations) instead of resolving from a price list.

ALTER TABLE billing_items
  ADD COLUMN owner_profile_id uuid REFERENCES billing_profiles(id) ON DELETE CASCADE,
  ADD COLUMN own_rate_cents integer CHECK (own_rate_cents IS NULL OR own_rate_cents >= 0);

-- Each variation of a scoped item sets its own full price (design decision "B").
ALTER TABLE billing_item_variations
  ADD COLUMN own_rate_cents integer CHECK (own_rate_cents IS NULL OR own_rate_cents >= 0);

-- Scoped items are only ever negotiated charge lines — Labor or Lump Sum.
ALTER TABLE billing_items
  ADD CONSTRAINT billing_items_owner_category_chk
  CHECK (owner_profile_id IS NULL OR category IN ('Labor', 'Lump Sum'));

-- Code uniqueness: global codes stay globally unique; scoped codes are unique WITHIN their
-- profile, so two profiles can each have a "SPECIAL-1". Replaces the old global-only unique.
ALTER TABLE billing_items DROP CONSTRAINT IF EXISTS billing_items_code_key;
CREATE UNIQUE INDEX billing_items_code_global_uk ON billing_items(code) WHERE owner_profile_id IS NULL;
CREATE UNIQUE INDEX billing_items_code_scoped_uk ON billing_items(owner_profile_id, code) WHERE owner_profile_id IS NOT NULL;

-- Fast lookup of a profile's custom items.
CREATE INDEX billing_items_owner_profile_idx ON billing_items(owner_profile_id) WHERE owner_profile_id IS NOT NULL;
