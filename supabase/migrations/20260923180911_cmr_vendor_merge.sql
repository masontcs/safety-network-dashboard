-- CMR (SN Cash Ledger) · AP Phase 3b · manual vendor merge / split / rename (the cleanup layer)
--
-- AP Phase 3a gave every A/P line a canonical vendor (cmr_vendors), reached through the vendor's
-- QuickBooks spellings (cmr_vendor_aliases, one row per normalized spelling). Only identical
-- spellings unify on their own. This adds the Controller's tools for everything else:
--
--   • cmr_merge_vendors(target, source, actor)   — the source's spellings and lines move to the
--     target; the source is deleted. Because the SPELLINGS move, every later re-import resolves
--     them to the target again: a merge survives re-imports.
--   • cmr_split_vendor(source, alias_ids, name, actor) → new vendor id — the reverse: the chosen
--     spellings (and the source's lines spelled that way) move to a NEW vendor. Raw QuickBooks
--     names and every per-spelling alias are kept by a merge, so any merge can be split back.
--   • cmr_rename_vendor(vendor, name, actor)     — the display name only. Matching (the vendor's
--     normalized_name and its aliases) is untouched.
--   • cmr_vendor_merge_dismissals                 — a suggested pair the Controller rejected, so it
--     stops being suggested. Stored ordered (vendor_id_a < vendor_id_b); goes away with either
--     vendor (on delete cascade), e.g. when one is merged away.
--
-- MATCHING STAYS FULLY MANUAL. Nothing here runs on its own and nothing merges automatically:
-- the app's suggestion engine only PROPOSES pairs (it never writes), and each of these functions
-- runs only when a Controller confirms it in the app (guardCmrController).
--
-- Normalization fix (the auto-link key): cmr_vendor_normalize is redefined so a trailing "."
-- that follows a space no longer leaves a trailing space — "ACME INC ." → "ACME INC" (was
-- "ACME INC "). The dot is stripped first and trimming is now the LAST step. Nothing else about
-- the rule changes; lib/cmr/vendors.ts normalizeVendorName changes identically. Stored keys that
-- the old rule produced are recomputed only where the new key collides with nothing; if any
-- would collide, the migration stops (see §2) rather than let a re-import merge them silently.
--
-- Race safety: merge and split lock every cmr_accounts row (id order, FOR NO KEY UPDATE) and then
-- the vendor rows (id order). An A/P import locks its account FOR UPDATE first and then touches
-- vendor rows, and a request compose locks its account FOR SHARE, so they queue behind one another
-- in the same order — no deadlock, and an import can never link lines to a vendor that a merge is
-- deleting. Ordinary writes that merely reference an account (FOR KEY SHARE) are not blocked.
--
-- Payments stay per-account: cmr_vendor_requests / cmr_vendor_request_invoices and
-- cmr_compose_vendor_request are NOT touched, and neither is the A/P import path.
--
-- Service-role only, like every other cmr_* object: RLS on with NO policies, anon/authenticated
-- privileges revoked, functions security invoker with an empty search_path, executable by
-- service_role alone. Nothing is seeded.

-- ── 1. the normalization fix ───────────────────────────────────────────────
create or replace function public.cmr_vendor_normalize(p_name text)
returns text
language sql
immutable
strict
parallel safe
security invoker
set search_path = ''
as $$
  select btrim(
           case
             when char_length(t) > 1 and right(t, 1) = '.' then left(t, -1)
             else t
           end,
           ' ')
    from (
      select btrim(
               regexp_replace(
                 translate(p_name, 'abcdefghijklmnopqrstuvwxyz', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'),
                 '[ \t\n\r\f\v\u00a0]+', ' ', 'g'),
               ' ') as t
    ) s;
$$;

comment on function public.cmr_vendor_normalize(text) is
  'SN Cash Ledger canonical-vendor match key (AP Phase 3a; AP Phase 3b trims last). ASCII a-z uppercased, whitespace runs (incl. no-break space) collapsed to one space, trimmed, one trailing "." stripped (unless the name is just "."), then trimmed again — so "ACME INC ." gives "ACME INC". Nothing else. Mirrors normalizeVendorName in lib/cmr/vendors.ts.';

revoke all on function public.cmr_vendor_normalize(text) from public, anon, authenticated;
grant execute on function public.cmr_vendor_normalize(text) to service_role;

-- ── 2. recompute stored keys — only where nothing collides ─────────────────
-- Only a key that ends in a space can change (the old rule's "X ." case: "ACME INC ." was stored
-- as "ACME INC "). Each such key is recomputed when its new form is used by no other row (and by
-- no other changing row) — aliases and vendors are separate unique key spaces.
--
-- A key whose new form IS already taken is a collision: two vendors the new rule calls
-- identical. Leaving it stored as-is would NOT keep them apart — the next A/P re-import resolves
-- that spelling by the new rule and would silently move its lines onto the other vendor, which
-- is an automatic merge in all but name. So a collision stops this migration instead (nothing is
-- applied; the message names the spellings) and the Controller-merge decision is made first.
-- On the real STS / TCS / HLD / INC data there are none (no vendor name ends in " .").
do $$
declare
  v_collisions text;
  v_alias_fixed  int;
  v_vendor_fixed int;
begin
  with c as (
    select a.id, a.raw_name, public.cmr_vendor_normalize(a.raw_name) as k
      from public.cmr_vendor_aliases a
     where public.cmr_vendor_normalize(a.raw_name) <> ''
       and a.normalized_name = public.cmr_vendor_normalize(a.raw_name) || ' '
  ), v as (
    select v.id, v.canonical_name, public.cmr_vendor_normalize(v.canonical_name) as k
      from public.cmr_vendors v
     where public.cmr_vendor_normalize(v.canonical_name) <> ''
       and v.normalized_name = public.cmr_vendor_normalize(v.canonical_name) || ' '
  )
  select string_agg(n, ', ' order by n) into v_collisions
    from (
      select '"' || c.raw_name || '"' as n
        from c
       where exists (select 1 from public.cmr_vendor_aliases x where x.normalized_name = c.k)
          or (select count(*) from c c2 where c2.k = c.k) > 1
      union
      select '"' || v.canonical_name || '"'
        from v
       where exists (select 1 from public.cmr_vendors x where x.normalized_name = v.k)
          or (select count(*) from v v2 where v2.k = v.k) > 1
    ) z;

  if v_collisions is not null then
    raise exception 'NORMALIZE_COLLISION'
      using errcode = 'P0001',
            detail = 'These vendor spellings end in " ." and would become identical to another vendor under the fixed normalization: '
                     || v_collisions || '. Nothing was changed.';
  end if;

  update public.cmr_vendor_aliases a
     set normalized_name = public.cmr_vendor_normalize(a.raw_name)
   where public.cmr_vendor_normalize(a.raw_name) <> ''
     and a.normalized_name = public.cmr_vendor_normalize(a.raw_name) || ' ';
  get diagnostics v_alias_fixed = row_count;

  update public.cmr_vendors v
     set normalized_name = public.cmr_vendor_normalize(v.canonical_name)
   where public.cmr_vendor_normalize(v.canonical_name) <> ''
     and v.normalized_name = public.cmr_vendor_normalize(v.canonical_name) || ' ';
  get diagnostics v_vendor_fixed = row_count;

  raise notice 'cmr_vendor_merge: normalization recompute — % alias key(s) and % vendor key(s) updated, 0 collisions',
    v_alias_fixed, v_vendor_fixed;
end;
$$;

-- ── 3. dismissed suggestions ───────────────────────────────────────────────
create table public.cmr_vendor_merge_dismissals (
  id           uuid primary key default gen_random_uuid(),
  vendor_id_a  uuid not null references public.cmr_vendors(id) on delete cascade,
  vendor_id_b  uuid not null references public.cmr_vendors(id) on delete cascade,
  dismissed_by uuid references public.user_profiles(id) on delete set null,
  dismissed_at timestamptz not null default now(),
  constraint cmr_vendor_merge_dismissals_ordered check (vendor_id_a < vendor_id_b),
  constraint cmr_vendor_merge_dismissals_pair_uniq unique (vendor_id_a, vendor_id_b)
);

comment on table public.cmr_vendor_merge_dismissals is
  'SN Cash Ledger (CMR) AP Phase 3b: a suggested duplicate-vendor pair a Controller dismissed, so it is not suggested again. Stored ordered (vendor_id_a < vendor_id_b); removed with either vendor (on delete cascade). Service-role only (RLS on, no policies).';

-- foreign keys (performance advisor: unindexed_foreign_keys); vendor_id_a is the unique key's lead
create index cmr_vendor_merge_dismissals_b_idx on public.cmr_vendor_merge_dismissals (vendor_id_b);
create index cmr_vendor_merge_dismissals_by_idx on public.cmr_vendor_merge_dismissals (dismissed_by);

alter table public.cmr_vendor_merge_dismissals enable row level security;
revoke all on table public.cmr_vendor_merge_dismissals from anon, authenticated;

-- ── 4. merge ────────────────────────────────────────────────────────────────
-- Refusals: NOT_FOUND — either vendor missing; SAME_VENDOR — target = source.
create function public.cmr_merge_vendors(p_target uuid, p_source uuid, p_actor uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_n int;
begin
  if p_target is null or p_source is null then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if p_target = p_source then
    raise exception 'SAME_VENDOR' using errcode = 'P0001';
  end if;

  -- Queue behind (and block) A/P imports and request composes: accounts first, in id order.
  -- FOR NO KEY UPDATE conflicts with an import's FOR UPDATE and a compose's FOR SHARE, but not
  -- with the FOR KEY SHARE that ordinary foreign-key writes take (ledger, priorities, …), so
  -- those carry on untouched while a merge runs.
  perform 1
     from public.cmr_accounts
    order by id
      for no key update;

  -- Then both vendors, in id order.
  select count(*) into v_n
    from (
      select id
        from public.cmr_vendors
       where id in (p_target, p_source)
       order by id
         for update
    ) x;
  if v_n <> 2 then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  -- The spellings move (so re-imports keep resolving to the target), then the lines.
  update public.cmr_vendor_aliases
     set vendor_id = p_target
   where vendor_id = p_source;

  update public.cmr_ap_lines
     set vendor_id = p_target
   where vendor_id = p_source;

  -- Its dismissals go with it (on delete cascade).
  delete from public.cmr_vendors
   where id = p_source;
end;
$$;

comment on function public.cmr_merge_vendors(uuid, uuid, uuid) is
  'SN Cash Ledger AP Phase 3b: merge canonical vendor p_source INTO p_target — every alias (QuickBooks spelling) and every A/P line of the source moves to the target, then the source is deleted. One transaction; locks all accounts then both vendors (id order). Refuses NOT_FOUND / SAME_VENDOR. Controller-confirmed only; never automatic. Reversible with cmr_split_vendor. Service-role only.';

revoke all on function public.cmr_merge_vendors(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.cmr_merge_vendors(uuid, uuid, uuid) to service_role;

-- ── 5. split ────────────────────────────────────────────────────────────────
-- The new vendor's match key (normalized_name) comes from the name typed for it, as when an
-- import registers a vendor: a later import bringing a brand-new spelling identical to that name
-- links to it, exactly like any other identical spelling.
--
-- Refusals: NOT_FOUND — no such source; BAD_NAME — the new name is blank, longer than 200, or
-- normalizes to nothing; NAME_TAKEN — another vendor already has that name's key (it may have
-- been renamed since, so the key can differ from what it shows); BAD_ALIAS — no aliases given, or
-- one is not the source's; WOULD_EMPTY — the source would keep no alias.
create function public.cmr_split_vendor(p_source uuid, p_alias_ids uuid[], p_new_canonical text, p_actor uuid)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_name   text := btrim(p_new_canonical);
  v_key    text;
  v_wanted int;
  v_owned  int;
  v_new    uuid;
begin
  if v_name is null or char_length(v_name) not between 1 and 200 then
    raise exception 'BAD_NAME' using errcode = 'P0001';
  end if;
  v_key := public.cmr_vendor_normalize(v_name);
  if v_key = '' then
    raise exception 'BAD_NAME' using errcode = 'P0001';
  end if;
  if p_source is null then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if p_alias_ids is null or cardinality(p_alias_ids) = 0 or array_position(p_alias_ids, null) is not null then
    raise exception 'BAD_ALIAS' using errcode = 'P0001';
  end if;

  -- Same lock order as a merge: accounts (id order), then the vendor.
  perform 1
     from public.cmr_accounts
    order by id
      for no key update;

  perform 1
     from public.cmr_vendors
    where id = p_source
      for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  select count(distinct u) into v_wanted from unnest(p_alias_ids) u;
  select count(*) into v_owned
    from public.cmr_vendor_aliases
   where id = any (p_alias_ids)
     and vendor_id = p_source;
  if v_owned <> v_wanted then
    raise exception 'BAD_ALIAS' using errcode = 'P0001';
  end if;
  if not exists (
    select 1
      from public.cmr_vendor_aliases
     where vendor_id = p_source
       and id <> all (p_alias_ids)
  ) then
    raise exception 'WOULD_EMPTY' using errcode = 'P0001';
  end if;

  begin
    insert into public.cmr_vendors (canonical_name, normalized_name, created_by)
    values (v_name, v_key, p_actor)
    returning id into v_new;
  exception when unique_violation then
    raise exception 'NAME_TAKEN' using errcode = 'P0001';
  end;

  update public.cmr_vendor_aliases
     set vendor_id = v_new
   where id = any (p_alias_ids);

  -- The source's lines spelled like a moved alias follow it.
  update public.cmr_ap_lines l
     set vendor_id = v_new
   where l.vendor_id = p_source
     and public.cmr_vendor_normalize(l.vendor_name) in (
           select a.normalized_name
             from public.cmr_vendor_aliases a
            where a.id = any (p_alias_ids)
         );

  return v_new;
end;
$$;

comment on function public.cmr_split_vendor(uuid, uuid[], text, uuid) is
  'SN Cash Ledger AP Phase 3b: split the given aliases (QuickBooks spellings) of p_source off into a NEW canonical vendor named p_new_canonical, with the source''s A/P lines spelled that way — the reverse of a merge. Locks all accounts then the source. Refuses NOT_FOUND / BAD_NAME / NAME_TAKEN / BAD_ALIAS / WOULD_EMPTY. Returns the new vendor id. Service-role only.';

revoke all on function public.cmr_split_vendor(uuid, uuid[], text, uuid) from public, anon, authenticated;
grant execute on function public.cmr_split_vendor(uuid, uuid[], text, uuid) to service_role;

-- ── 6. rename (display only) ────────────────────────────────────────────────
-- Refusals: BAD_NAME — blank or longer than 200 after trimming; NOT_FOUND — no such vendor.
create function public.cmr_rename_vendor(p_vendor uuid, p_canonical text, p_actor uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_name text := btrim(p_canonical);
begin
  if v_name is null or char_length(v_name) not between 1 and 200 then
    raise exception 'BAD_NAME' using errcode = 'P0001';
  end if;

  update public.cmr_vendors
     set canonical_name = v_name
   where id = p_vendor;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
end;
$$;

comment on function public.cmr_rename_vendor(uuid, text, uuid) is
  'SN Cash Ledger AP Phase 3b: change a canonical vendor''s display name (canonical_name, 1..200 after trimming). normalized_name and the aliases are NOT touched, so matching and re-imports are unaffected. Refuses BAD_NAME / NOT_FOUND. Service-role only.';

revoke all on function public.cmr_rename_vendor(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.cmr_rename_vendor(uuid, text, uuid) to service_role;
