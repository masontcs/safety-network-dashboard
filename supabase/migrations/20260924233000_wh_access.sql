-- Western Highways (WH) · wh_access — who may open the Western Highways section
--
-- WH Phase 1 shipped gated on the admin/executive ROLE, which handed the section to everyone
-- who happened to hold either one (six accounts). WH is a separate company whose A/R and A/P
-- are the group's internal position, so who may see it is a decision about PEOPLE, not about
-- job titles. This table is that decision.
--
-- EXPLICIT GRANT ONLY, with NO role inheritance — the cmr_access model, deliberately:
-- a platform admin with no row here is denied every /wh page and every /api/wh route exactly
-- like anyone else. Holding a role grants nothing, and adding a role to the platform later can
-- never hand it Western Highways. A row grants BOTH reading and uploading (the locked decision
-- for this phase); managing the list itself is a separate, admin-only screen and is NOT implied
-- by having a row here.
--
-- Enforced in the app by lib/wh/access.ts (getWhContext / getWhPageContext / hasWhGrant) and,
-- independently, by the middleware's /wh branch. All three fail CLOSED: a read error or a
-- missing service key means "no access", never "allowed".
--
-- Service-role only, like cmr_access and every billing_* table: RLS on with NO policies, and
-- the default anon/authenticated privileges revoked, so PostgREST hands out nothing. The app
-- reads and writes it server-side with the service client.

create table public.wh_access (
  user_id    uuid primary key references public.user_profiles(id) on delete cascade,
  granted_by uuid references public.user_profiles(id) on delete set null,
  granted_at timestamptz not null default now()
);

comment on table public.wh_access is
  'Western Highways access grants — one row per person who may open /wh. Explicit grant only: no role inheritance, so a platform admin without a row is denied. A row grants view + upload; managing this list is admin-only (app/api/wh/access). Service-role only (RLS on, no policies).';
comment on column public.wh_access.granted_by is
  'The admin who granted it, kept for the Access screen; set null if that account is deleted.';

-- Covers the granted_by foreign key (performance advisor: unindexed_foreign_keys).
create index wh_access_granted_by_idx on public.wh_access (granted_by);

alter table public.wh_access enable row level security;

-- Belt and braces: RLS with no policies already denies anon/authenticated; also drop the
-- default table privileges so the table is not even selectable by those roles.
revoke all on table public.wh_access from anon, authenticated;

-- ── Seed: the four people Western Highways is for ───────────────────────────
-- Matched on display_name, which is what Mason named them by. granted_by stays null: the seed
-- is the decision itself, not a grant made by a person on the Access screen.
insert into public.wh_access (user_id)
select id from public.user_profiles
 where display_name in ('Mason Doty', 'Jordan Johnson', 'Russ Johnson', 'Paula Lofgren')
on conflict do nothing;

-- Say so LOUDLY if a name did not match a profile: the migration still applies (a missing
-- person is added from the Access screen), but the omission must not pass unnoticed.
do $$
declare
  v_missing text;
begin
  select string_agg(n, ', ' order by n) into v_missing
    from unnest(array['Mason Doty', 'Jordan Johnson', 'Russ Johnson', 'Paula Lofgren']) as n
   where not exists (
     select 1 from public.user_profiles p
      where p.display_name = n and p.id in (select user_id from public.wh_access)
   );
  if v_missing is not null then
    raise warning 'wh_access seed: NO user_profiles row matched these display_name values, so they were NOT granted Western Highways: %', v_missing;
  else
    raise notice 'wh_access seed: all four people were granted Western Highways.';
  end if;
end;
$$;
