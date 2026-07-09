-- ============================================================================
-- 20260709000001_billing_001_foundation.sql
-- TCR Billing v2 — Migration 001: Foundation
--
-- Reuses SN's existing `entities`, `branches`, `user_profiles`,
-- `user_branch_assignments`. Adds billing-owned settings (entity letters and
-- 2-letter branch codes needed for invoice numbering, per-branch tax rates),
-- payment terms, customers, billing profiles and profile contacts.
--
-- Additive only. Nothing outside the billing_* namespace is modified.
-- Money is ALWAYS integer cents.
-- ============================================================================

-- Item categories are a fixed set per spec.
create type billing_item_category as enum ('Equipment','Labor','Lump Sum','Misc');

-- The 6 billing types: <rental cadence>_billed_<rate unit>. No proration:
-- each (item x tier x billing type) cell holds an explicitly entered rate.
create type billing_type as enum (
  'daily',
  'weekly_billed_weekly',
  'weekly_billed_daily',
  'monthly_billed_monthly',
  'monthly_billed_weekly',
  'monthly_billed_daily'
);

create or replace function public.billing_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- SECURITY DEFINER so the policy can read user_branch_assignments without
-- re-entering RLS (avoids the recursive-policy trap). Admins see everything.
create or replace function public.billing_user_has_branch(p_branch uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(public.current_user_role() = 'admin', false)
      or exists (
        select 1 from public.user_branch_assignments
        where user_id = auth.uid() and branch_id = p_branch
      );
$$;

-- ---------------------------------------------------------------- settings
create table public.billing_entity_settings (
  entity_id uuid primary key references public.entities(id) on delete cascade,
  letter char(1) not null unique,       -- I / S / T -> invoice number prefix
  billing_enabled boolean not null default true
);

create table public.billing_branch_settings (
  branch_id uuid primary key references public.branches(id) on delete cascade,
  code char(2) not null unique,         -- BK / FR / ... -> invoice number suffix
  tax_rate_pct numeric(6,4),            -- manual jurisdiction rate; tax API later
  billing_enabled boolean not null default true
);

-- ----------------------------------------------------------- payment terms
-- Managed list; accounting + branch management only.
create table public.billing_payment_terms (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  net_days integer not null default 0 check (net_days >= 0),
  sort_order integer not null default 0,
  is_active boolean not null default true
);

-- --------------------------------------------------------------- customers
-- A customer is entity-agnostic. `code` is INTERNAL only (never sent to QB).
-- ar_customer_id links to the existing AR module; nullable and unenforced
-- because that relationship is still an open question.
create table public.billing_customers (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  ar_customer_id uuid references public.ar_customers(id) on delete set null,
  default_payment_term_id uuid references public.billing_payment_terms(id),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------- billing profiles
-- Branch-owned. Jobs attach HERE, not to the customer.
-- QuickBooks reads by NAME: "{customer.name} - {profile.name}".
create table public.billing_profiles (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.billing_customers(id) on delete cascade,
  branch_id uuid not null references public.branches(id),
  code text not null,
  name text not null,
  payment_term_id uuid references public.billing_payment_terms(id), -- overrides customer default
  rental_minimum_enabled boolean not null default true,
  rental_minimum_cents integer not null default 2500 check (rental_minimum_cents >= 0),
  field_rules jsonb not null default '{}'::jsonb,  -- per-profile label renames + required-on-create
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (customer_id, code)
);
create index billing_profiles_customer_idx on public.billing_profiles(customer_id);
create index billing_profiles_branch_idx on public.billing_profiles(branch_id);

create table public.billing_profile_contacts (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.billing_profiles(id) on delete cascade,
  name text not null,
  email text,
  phone text,
  is_invoice_recipient boolean not null default false,
  created_at timestamptz not null default now()
);
create index billing_profile_contacts_profile_idx on public.billing_profile_contacts(profile_id);

-- The QuickBooks customer name, derived. security_invoker so RLS still applies.
create view public.billing_profile_qb_names
with (security_invoker = true) as
  select p.id as profile_id,
         c.name || ' - ' || p.name as qb_name
  from public.billing_profiles p
  join public.billing_customers c on c.id = p.customer_id;

create trigger billing_customers_touch before update on public.billing_customers
  for each row execute function public.billing_touch_updated_at();
create trigger billing_profiles_touch before update on public.billing_profiles
  for each row execute function public.billing_touch_updated_at();

-- --------------------------------------------------------------------- RLS
alter table public.billing_entity_settings enable row level security;
alter table public.billing_branch_settings enable row level security;
alter table public.billing_payment_terms  enable row level security;
alter table public.billing_customers      enable row level security;
alter table public.billing_profiles       enable row level security;
alter table public.billing_profile_contacts enable row level security;

create policy authenticated_read on public.billing_entity_settings for select to authenticated using (true);
create policy admin_write on public.billing_entity_settings for all to authenticated using (current_user_role() = 'admin') with check (current_user_role() = 'admin');

create policy authenticated_read on public.billing_branch_settings for select to authenticated using (true);
create policy admin_write on public.billing_branch_settings for all to authenticated using (current_user_role() = 'admin') with check (current_user_role() = 'admin');

create policy authenticated_read on public.billing_payment_terms for select to authenticated using (true);
create policy admin_write on public.billing_payment_terms for all to authenticated using (current_user_role() = 'admin') with check (current_user_role() = 'admin');

create policy authenticated_read on public.billing_customers for select to authenticated using (true);
create policy admin_write on public.billing_customers for all to authenticated using (current_user_role() = 'admin') with check (current_user_role() = 'admin');

-- Branch-scoped: users only see profiles for branches they're assigned to.
create policy branch_scoped_all on public.billing_profiles for all to authenticated
  using (public.billing_user_has_branch(branch_id))
  with check (public.billing_user_has_branch(branch_id));

create policy branch_scoped_all on public.billing_profile_contacts for all to authenticated
  using (exists (select 1 from public.billing_profiles p where p.id = profile_id and public.billing_user_has_branch(p.branch_id)))
  with check (exists (select 1 from public.billing_profiles p where p.id = profile_id and public.billing_user_has_branch(p.branch_id)));

-- ------------------------------------------------------------------- seeds
insert into public.billing_entity_settings (entity_id, letter, billing_enabled)
select id, left(code, 1), true from public.entities
on conflict (entity_id) do nothing;

insert into public.billing_branch_settings (branch_id, code, billing_enabled)
select b.id, v.code, true
from public.branches b
join (values ('Arroyo Grande','AG'),('Bakersfield','BK'),('Fresno','FR'),
             ('Modesto','MO'),('Orange County','OC'),('Visalia','VI')) as v(name, code)
  on v.name = b.name
on conflict (branch_id) do nothing;

insert into public.billing_payment_terms (name, net_days, sort_order) values
  ('Due Upon Receipt', 0, 10),
  ('Credit Card', 0, 20),
  ('Cash', 0, 30),
  ('Net 15', 15, 40),
  ('Net 30', 30, 50),
  ('Net 45', 45, 60),
  ('Net 60', 60, 70)
on conflict (name) do nothing;
