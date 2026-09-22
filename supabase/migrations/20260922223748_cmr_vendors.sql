-- CMR (SN Cash Ledger) · AP Phase 3a · canonical vendors across accounts (read layer)
--
-- Until now a vendor was only the raw QuickBooks name on an A/P line, scoped to one account.
-- This adds a CANONICAL VENDOR layer on top, so the same real-world vendor under several
-- accounts (STS, TCS, …) rolls up into one identity:
--
--   • cmr_vendors        — one row per real-world vendor: its display name (canonical_name) and
--                          its match key (normalized_name, unique).
--   • cmr_vendor_aliases — every raw QuickBooks spelling that belongs to a vendor. normalized_name
--                          is unique across the WHOLE table: one spelling maps to exactly one
--                          vendor. Identical spellings from different accounts share one alias,
--                          which is why they unify.
--   • cmr_ap_lines.vendor_id — the mapping from a line to its canonical vendor. The line's raw
--                          vendor_name is NEVER changed; vendor_id sits on top of it.
--
-- Matching is FULLY MANUAL. The only automatic link is a normalized-IDENTICAL spelling, and the
-- normalization is deliberately conservative (cmr_vendor_normalize):
--     ASCII a–z → A–Z · runs of whitespace (space, tab, CR, LF, FF, VT, no-break space) → one
--     space · trim spaces · strip ONE trailing "." (unless that would leave nothing)
-- and NOTHING else — no INC/LLC/CORP folding, no punctuation removal, no fuzzy matching. So
-- "ACME INC" and "ACME LLC" stay two vendors; a Controller merges them in AP Phase 3b (with AI
-- only suggesting). An unseen spelling registers its own new vendor — that is registration, not
-- a match decision. lib/cmr/vendors.ts normalizeVendorName is the same rule in the app; its
-- tests pin the two together.
--
--   • cmr_resolve_ap_vendors(account, actor) — links the account's CURRENT import lines to
--     vendors: per distinct normalized spelling, reuse its alias's vendor (hit) or create the
--     vendor + its alias (miss), then set every line's vendor_id. Idempotent; safe to re-run.
--   • cmr_ap_replace_import is redefined (same signature, same steps, same grants) to call the
--     resolver as its LAST step, inside the same transaction as the replace — a snapshot is never
--     left half-linked, and every daily re-import re-links identical names to the same (later
--     possibly merged) vendor.
--   • Backfill: every account's current import is resolved once, below, and the migration
--     refuses to commit if any current line with a name is still unlinked.
--
-- Payments stay per-account: cmr_vendor_requests / cmr_vendor_request_invoices and
-- cmr_compose_vendor_request are NOT touched (a request still matches lines by the exact raw
-- QuickBooks name in one account).
--
-- Service-role only, exactly like every other cmr_* object: RLS on with NO policies, the
-- default anon/authenticated privileges revoked, and the functions executable by service_role
-- alone (security invoker, search_path ''). Nothing is seeded.

-- ── 1. the normalization (the auto-link key) ───────────────────────────────
-- translate() rather than upper(): upper() follows the database locale; this is ASCII-only and
-- locale-independent, so the SQL and the app can never disagree.
create function public.cmr_vendor_normalize(p_name text)
returns text
language sql
immutable
strict
parallel safe
security invoker
set search_path = ''
as $$
  select case
           when char_length(t) > 1 and right(t, 1) = '.' then left(t, -1)
           else t
         end
    from (
      select btrim(
               regexp_replace(
                 translate(p_name, 'abcdefghijklmnopqrstuvwxyz', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'),
                 '[ \t\n\r\f\v\u00a0]+', ' ', 'g'),
               ' ') as t
    ) s;
$$;

comment on function public.cmr_vendor_normalize(text) is
  'SN Cash Ledger AP Phase 3a: the canonical-vendor match key. ASCII a-z uppercased, whitespace runs (incl. no-break space) collapsed to one space, trimmed, one trailing "." stripped (unless the name is just "."). Nothing else. Mirrors normalizeVendorName in lib/cmr/vendors.ts.';

revoke all on function public.cmr_vendor_normalize(text) from public, anon, authenticated;
grant execute on function public.cmr_vendor_normalize(text) to service_role;

-- ── 2. vendors ──────────────────────────────────────────────────────────────
create table public.cmr_vendors (
  id              uuid primary key default gen_random_uuid(),
  canonical_name  text not null,
  normalized_name text not null unique,
  created_at      timestamptz not null default now(),
  created_by      uuid references public.user_profiles(id) on delete set null,
  constraint cmr_vendors_canonical_len
    check (char_length(canonical_name) between 1 and 200),
  constraint cmr_vendors_normalized_len
    check (char_length(normalized_name) between 1 and 200)
);

comment on table public.cmr_vendors is
  'SN Cash Ledger (CMR) AP Phase 3a: one row per real-world vendor across accounts. canonical_name is what the Vendors rollup and the request picker show; normalized_name (unique) is its match key. Registered by cmr_resolve_ap_vendors when an A/P import brings an unseen spelling. Service-role only (RLS on, no policies).';

-- foreign key (performance advisor: unindexed_foreign_keys)
create index cmr_vendors_created_by_idx on public.cmr_vendors (created_by);

alter table public.cmr_vendors enable row level security;
revoke all on table public.cmr_vendors from anon, authenticated;

-- ── 3. aliases (every raw QuickBooks spelling of a vendor) ─────────────────
create table public.cmr_vendor_aliases (
  id              uuid primary key default gen_random_uuid(),
  vendor_id       uuid not null references public.cmr_vendors(id) on delete cascade,
  raw_name        text not null,
  normalized_name text not null unique,
  created_at      timestamptz not null default now(),
  constraint cmr_vendor_aliases_raw_len
    check (char_length(raw_name) between 1 and 200),
  constraint cmr_vendor_aliases_normalized_len
    check (char_length(normalized_name) between 1 and 200)
);

comment on table public.cmr_vendor_aliases is
  'SN Cash Ledger (CMR) AP Phase 3a: every raw QuickBooks vendor spelling and the canonical vendor it belongs to. normalized_name is unique across the table — one spelling maps to exactly one vendor, in every account. Service-role only (RLS on, no policies).';

create index cmr_vendor_aliases_vendor_idx on public.cmr_vendor_aliases (vendor_id);

alter table public.cmr_vendor_aliases enable row level security;
revoke all on table public.cmr_vendor_aliases from anon, authenticated;

-- ── 4. the mapping on each A/P line ────────────────────────────────────────
alter table public.cmr_ap_lines
  add column vendor_id uuid references public.cmr_vendors(id) on delete set null;

comment on column public.cmr_ap_lines.vendor_id is
  'AP Phase 3a: the canonical vendor this line''s raw vendor_name resolves to (via cmr_vendor_aliases). Set by cmr_resolve_ap_vendors on every import. vendor_name itself is never changed.';

create index cmr_ap_lines_vendor_id_idx on public.cmr_ap_lines (vendor_id);

-- ── 5. resolving an account's current lines (service role only) ────────────
-- For the account's CURRENT import: every distinct normalized spelling either hits an alias
-- (its vendor is reused) or registers a new vendor (canonical_name = the raw spelling) + its
-- alias; then every line's vendor_id is set from the alias table. A line whose name normalizes
-- to nothing (whitespace only) is left unlinked.
--
-- Race safety: the account row is locked FOR UPDATE (the same lock cmr_ap_replace_import takes,
-- so it serialises with imports of this account and with a compose's FOR SHARE). Imports of two
-- DIFFERENT accounts bringing the same new spelling at once are settled by the unique
-- normalized_name keys: both inserts use ON CONFLICT DO NOTHING (the second waits for the first
-- to commit and then does nothing), each later statement re-reads the committed rows, and new
-- keys are inserted in sorted order so two such imports cannot deadlock.
--
-- Refusals: NOT_FOUND — no such account; UNRESOLVED — a named line is still unlinked (should
-- never happen; it rolls the whole transaction back rather than leave a half-linked snapshot).
--
-- Returns how many canonical vendors it registered.
create function public.cmr_resolve_ap_vendors(p_account_id uuid, p_actor uuid)
returns int
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_import  uuid;
  v_created int;
begin
  perform 1
     from public.cmr_accounts
    where id = p_account_id
      for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  select id into v_import
    from public.cmr_ap_imports
   where account_id = p_account_id
     and is_current;
  if v_import is null then
    return 0;
  end if;

  -- a. register a vendor for every spelling no alias knows yet
  with names as (
    select distinct on (k) k, raw
      from (
        select public.cmr_vendor_normalize(l.vendor_name) as k, l.vendor_name as raw
          from public.cmr_ap_lines l
         where l.import_id = v_import
      ) x
     where k <> ''
     order by k, raw
  ), ins as (
    insert into public.cmr_vendors (canonical_name, normalized_name, created_by)
    select n.raw, n.k, p_actor
      from names n
     where not exists (select 1 from public.cmr_vendor_aliases a where a.normalized_name = n.k)
     order by n.k
    on conflict (normalized_name) do nothing
    returning 1
  )
  select count(*) into v_created from ins;

  -- b. give each of those spellings its alias (to the vendor with that key)
  insert into public.cmr_vendor_aliases (vendor_id, raw_name, normalized_name)
  select v.id, n.raw, n.k
    from (
      select distinct on (k) k, raw
        from (
          select public.cmr_vendor_normalize(l.vendor_name) as k, l.vendor_name as raw
            from public.cmr_ap_lines l
           where l.import_id = v_import
        ) x
       where k <> ''
       order by k, raw
    ) n
    join public.cmr_vendors v on v.normalized_name = n.k
   where not exists (select 1 from public.cmr_vendor_aliases a where a.normalized_name = n.k)
   order by n.k
  on conflict (normalized_name) do nothing;

  -- c. link every line through its spelling's alias
  update public.cmr_ap_lines l
     set vendor_id = a.vendor_id
    from public.cmr_vendor_aliases a
   where l.import_id = v_import
     and a.normalized_name = public.cmr_vendor_normalize(l.vendor_name)
     and l.vendor_id is distinct from a.vendor_id;

  if exists (
    select 1
      from public.cmr_ap_lines l
     where l.import_id = v_import
       and l.vendor_id is null
       and public.cmr_vendor_normalize(l.vendor_name) <> ''
  ) then
    raise exception 'UNRESOLVED' using errcode = 'P0001';
  end if;

  return v_created;
end;
$$;

comment on function public.cmr_resolve_ap_vendors(uuid, uuid) is
  'SN Cash Ledger AP Phase 3a: link an account''s CURRENT A/P lines to canonical vendors — reuse the vendor of an identical normalized spelling (cmr_vendor_aliases), register a new vendor + alias for an unseen one, set cmr_ap_lines.vendor_id. Locks the account FOR UPDATE; idempotent; refuses NOT_FOUND / UNRESOLVED. Returns the number of vendors registered. Service-role only.';

revoke all on function public.cmr_resolve_ap_vendors(uuid, uuid) from public, anon, authenticated;
grant execute on function public.cmr_resolve_ap_vendors(uuid, uuid) to service_role;

-- ── 6. every import resolves, in the same transaction ──────────────────────
-- Identical to AP Phase 1's function (same signature, same refusals, same steps, same order)
-- with ONE added last step: cmr_resolve_ap_vendors for the account. The account is already
-- locked FOR UPDATE by this transaction, so the resolver's lock is a no-op re-lock.
create or replace function public.cmr_ap_replace_import(
  p_account_id         uuid,
  p_actor              uuid,
  p_source_filename    text,
  p_report_total_cents bigint,
  p_lines              jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_active    boolean;
  v_import_id uuid;
  v_count     int;
begin
  -- Lock the account: concurrent uploads for the same account run one after the other, and
  -- the account cannot be deactivated half-way through.
  select active into v_active
    from public.cmr_accounts
   where id = p_account_id
     for update;

  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if not v_active then
    raise exception 'INACTIVE' using errcode = 'P0001';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'BAD_LINES' using errcode = 'P0001';
  end if;

  v_count := jsonb_array_length(p_lines);

  -- The previous snapshot goes first (its lines cascade), so the partial unique index never
  -- sees two current imports for the account.
  delete from public.cmr_ap_imports
   where account_id = p_account_id
     and is_current;

  insert into public.cmr_ap_imports
    (account_id, source_filename, report_total_cents, payable_total_cents, line_count,
     imported_by, is_current)
  values
    (p_account_id, nullif(btrim(p_source_filename), ''), p_report_total_cents, 0, v_count,
     p_actor, true)
  returning id into v_import_id;

  insert into public.cmr_ap_lines
    (import_id, account_id, vendor_name, invoice_num, doc_type, bill_date, due_date,
     aging_days, aging_bucket, open_balance_cents, payable)
  select v_import_id, p_account_id, l.vendor_name, l.invoice_num, l.doc_type, l.bill_date,
         l.due_date, l.aging_days, l.aging_bucket, l.open_balance_cents,
         l.doc_type in ('Bill', 'Credit')
    from jsonb_to_recordset(p_lines) as l(
           vendor_name        text,
           invoice_num        text,
           doc_type           text,
           bill_date          date,
           due_date           date,
           aging_days         int,
           aging_bucket       text,
           open_balance_cents bigint
         );

  update public.cmr_ap_imports
     set payable_total_cents = coalesce((
           select sum(open_balance_cents)
             from public.cmr_ap_lines
            where import_id = v_import_id
              and payable
         ), 0)
   where id = v_import_id;

  -- AP Phase 3a: link the new lines to canonical vendors before this transaction commits.
  perform public.cmr_resolve_ap_vendors(p_account_id, p_actor);

  return v_import_id;
end;
$$;

comment on function public.cmr_ap_replace_import(uuid, uuid, text, bigint, jsonb) is
  'SN Cash Ledger AP: replace an account''s A/P snapshot in one transaction — lock the account, refuse an unknown (NOT_FOUND) or inactive (INACTIVE) one, delete its current import (lines cascade), insert the new current import and its lines, derive payable from doc_type, sum the payable total, and (AP Phase 3a) link every line to its canonical vendor via cmr_resolve_ap_vendors. Returns the new cmr_ap_imports id. Service-role only.';

revoke all on function public.cmr_ap_replace_import(uuid, uuid, text, bigint, jsonb) from public, anon, authenticated;
grant execute on function public.cmr_ap_replace_import(uuid, uuid, text, bigint, jsonb) to service_role;

-- ── 7. backfill today's imports ────────────────────────────────────────────
-- Resolve every account's current import once (in account-id order), credited to whoever
-- imported it. Then refuse to commit this migration if any current line with a name is still
-- unlinked — the whole migration rolls back rather than leave live data half-linked.
do $$
declare
  r record;
begin
  for r in
    select account_id, imported_by
      from public.cmr_ap_imports
     where is_current
     order by account_id
  loop
    perform public.cmr_resolve_ap_vendors(r.account_id, r.imported_by);
  end loop;

  if exists (
    select 1
      from public.cmr_ap_lines l
      join public.cmr_ap_imports i on i.id = l.import_id and i.is_current
     where l.vendor_id is null
       and public.cmr_vendor_normalize(l.vendor_name) <> ''
  ) then
    raise exception 'BACKFILL_INCOMPLETE';
  end if;
end;
$$;
