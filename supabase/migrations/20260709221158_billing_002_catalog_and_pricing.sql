-- ============================================================================
-- 20260709000002_billing_002_catalog_and_pricing.sql
-- TCR Billing v2 — Migration 002: Catalog, price lists, and the profile x entity config
--
-- Pricing model (resolves the v1 spec/prototype conflict):
--   * STORAGE is the explicit (item x tier x billing type) rate grid:
--       billing_price_list_rates
--   * The % cascade / freeze-after-tier / sticky per-cell overrides are the
--     AUTHORING inputs that COMPILE into that grid:
--       billing_price_list_items(.freeze_after_position, .tier_exception_tier_id)
--       billing_price_list_item_bases      (tier-1 base per billing type)
--       billing_price_list_item_overrides  (sticky locked cells)
--
-- Rate resolution: PriceItemTierException -> CategoryTierRule -> catalog default
-- then the variation adjustment (per-list override -> item default -> 0).
--
-- billing_profile_entities is THE ENTITY v1 WAS MISSING: a profile's per-entity
-- price list + a tier per item category. Without it there was nowhere for the
-- price-list assignment to live.
-- ============================================================================

-- ----------------------------------------------------------------- catalog
create table public.billing_items (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  category billing_item_category not null,
  group_name text,                                   -- REG / OT / DT ... user-defined
  cost_cents integer not null default 0 check (cost_cents >= 0),  -- lost/stolen bills at COST
  salable boolean not null default false,
  sale_price_cents integer check (sale_price_cents >= 0),
  taxable boolean not null default false,            -- only ever applied to SALES lines
  tracked boolean not null default false,            -- requires an equipment ID
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billing_items_sale_price_required check (not salable or sale_price_cents is not null)
);

-- Catalog fallback rate when a price list prices no cell for the item.
create table public.billing_item_default_rates (
  item_id uuid not null references public.billing_items(id) on delete cascade,
  billing_type billing_type not null,
  rate_cents integer not null check (rate_cents >= 0),
  primary key (item_id, billing_type)
);

-- adj_cents is a per-unit adjustment FROM the item's resolved price (may be negative).
create table public.billing_item_variations (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.billing_items(id) on delete cascade,
  name text not null,
  adj_cents integer not null default 0,
  sort_order integer not null default 0,
  unique (item_id, name)
);

-- ------------------------------------------------------------- price lists
create table public.billing_price_lists (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  entity_id uuid not null references public.entities(id),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (entity_id, name)
);

create table public.billing_price_list_tiers (
  id uuid primary key default gen_random_uuid(),
  price_list_id uuid not null references public.billing_price_lists(id) on delete cascade,
  position integer not null check (position >= 1),   -- 1 = base tier
  name text not null,
  pct_off_previous numeric(6,3) not null default 0 check (pct_off_previous >= 0 and pct_off_previous < 100),
  unique (price_list_id, position),
  unique (price_list_id, name),
  -- lets child tables enforce "this tier belongs to this price list"
  unique (price_list_id, id)
);

create table public.billing_price_list_items (
  id uuid primary key default gen_random_uuid(),
  price_list_id uuid not null references public.billing_price_lists(id) on delete cascade,
  item_id uuid not null references public.billing_items(id) on delete cascade,
  freeze_after_position integer check (freeze_after_position >= 1), -- hold price from this tier onward
  tier_exception_tier_id uuid,                                      -- bypasses the category tier rule
  unique (price_list_id, item_id),
  unique (id, price_list_id),
  constraint billing_pli_tier_exception_same_list
    foreign key (price_list_id, tier_exception_tier_id)
    references public.billing_price_list_tiers(price_list_id, id) on delete set null
);
create index billing_pli_item_idx on public.billing_price_list_items(item_id);

-- Tier-1 base, entered by hand, per billing type. The cascade starts here.
create table public.billing_price_list_item_bases (
  price_list_item_id uuid not null references public.billing_price_list_items(id) on delete cascade,
  billing_type billing_type not null,
  base_cents integer not null check (base_cents >= 0),
  primary key (price_list_item_id, billing_type)
);

-- Sticky locked cells. Win over both the cascade and the freeze; later tiers re-base off them.
create table public.billing_price_list_item_overrides (
  price_list_item_id uuid not null references public.billing_price_list_items(id) on delete cascade,
  tier_id uuid not null references public.billing_price_list_tiers(id) on delete cascade,
  billing_type billing_type not null,
  rate_cents integer not null check (rate_cents >= 0),
  primary key (price_list_item_id, tier_id, billing_type)
);

-- THE COMPILED GRID. This is what pricing reads. Rebuilt whenever the
-- authoring inputs above change.
create table public.billing_price_list_rates (
  price_list_item_id uuid not null references public.billing_price_list_items(id) on delete cascade,
  tier_id uuid not null references public.billing_price_list_tiers(id) on delete cascade,
  billing_type billing_type not null,
  rate_cents integer not null check (rate_cents >= 0),
  compiled_at timestamptz not null default now(),
  primary key (price_list_item_id, tier_id, billing_type)
);

-- Per-price-list override of a variation's adjustment.
create table public.billing_price_list_variation_overrides (
  price_list_id uuid not null references public.billing_price_lists(id) on delete cascade,
  variation_id uuid not null references public.billing_item_variations(id) on delete cascade,
  adj_cents integer not null,
  primary key (price_list_id, variation_id)
);

-- ------------------------------------------- profile x entity configuration
-- The missing entity. Enabled entities pick a price list AND a tier per category.
create table public.billing_profile_entities (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.billing_profiles(id) on delete cascade,
  entity_id uuid not null references public.entities(id),
  enabled boolean not null default false,
  price_list_id uuid references public.billing_price_lists(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (profile_id, entity_id),
  unique (id, price_list_id),
  -- an enabled entity must have a price list
  constraint billing_pe_enabled_needs_price_list check (not enabled or price_list_id is not null)
);
create index billing_profile_entities_profile_idx on public.billing_profile_entities(profile_id);

-- CategoryTierRule: within the chosen price list, a tier per item category.
create table public.billing_profile_entity_category_tiers (
  profile_entity_id uuid not null references public.billing_profile_entities(id) on delete cascade,
  category billing_item_category not null,
  price_list_id uuid not null,
  tier_id uuid not null,
  primary key (profile_entity_id, category),
  -- the tier must belong to the price list...
  constraint billing_pect_tier_in_list
    foreign key (price_list_id, tier_id)
    references public.billing_price_list_tiers(price_list_id, id) on delete cascade,
  -- ...and that price list must be the one the profile_entity actually selected
  constraint billing_pect_list_matches_profile_entity
    foreign key (profile_entity_id, price_list_id)
    references public.billing_profile_entities(id, price_list_id) on delete cascade
);

create trigger billing_items_touch before update on public.billing_items
  for each row execute function public.billing_touch_updated_at();
create trigger billing_price_lists_touch before update on public.billing_price_lists
  for each row execute function public.billing_touch_updated_at();
create trigger billing_profile_entities_touch before update on public.billing_profile_entities
  for each row execute function public.billing_touch_updated_at();

-- --------------------------------------------------------------------- RLS
alter table public.billing_items                          enable row level security;
alter table public.billing_item_default_rates             enable row level security;
alter table public.billing_item_variations                enable row level security;
alter table public.billing_price_lists                    enable row level security;
alter table public.billing_price_list_tiers               enable row level security;
alter table public.billing_price_list_items               enable row level security;
alter table public.billing_price_list_item_bases          enable row level security;
alter table public.billing_price_list_item_overrides      enable row level security;
alter table public.billing_price_list_rates               enable row level security;
alter table public.billing_price_list_variation_overrides enable row level security;
alter table public.billing_profile_entities               enable row level security;
alter table public.billing_profile_entity_category_tiers  enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'billing_items','billing_item_default_rates','billing_item_variations',
    'billing_price_lists','billing_price_list_tiers','billing_price_list_items',
    'billing_price_list_item_bases','billing_price_list_item_overrides',
    'billing_price_list_rates','billing_price_list_variation_overrides'
  ] loop
    execute format('create policy authenticated_read on public.%I for select to authenticated using (true)', t);
    execute format('create policy admin_write on public.%I for all to authenticated using (current_user_role() = ''admin'') with check (current_user_role() = ''admin'')', t);
  end loop;
end $$;

create policy branch_scoped_all on public.billing_profile_entities for all to authenticated
  using (exists (select 1 from public.billing_profiles p where p.id = profile_id and public.billing_user_has_branch(p.branch_id)))
  with check (exists (select 1 from public.billing_profiles p where p.id = profile_id and public.billing_user_has_branch(p.branch_id)));

create policy branch_scoped_all on public.billing_profile_entity_category_tiers for all to authenticated
  using (exists (
    select 1 from public.billing_profile_entities pe
    join public.billing_profiles p on p.id = pe.profile_id
    where pe.id = profile_entity_id and public.billing_user_has_branch(p.branch_id)))
  with check (exists (
    select 1 from public.billing_profile_entities pe
    join public.billing_profiles p on p.id = pe.profile_id
    where pe.id = profile_entity_id and public.billing_user_has_branch(p.branch_id)));
