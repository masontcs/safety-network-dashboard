-- CMR (SN Cash Ledger) · Phase 1 · cmr_accounts
--
-- The Controller-managed list of cash accounts that later phases (pending breakdown, recurring
-- vendors, requests) group by. These are NOT billing entities and carry no balances.
--
--   • No hard delete. Later tables will reference these rows, so an account is retired by
--     setting active = false. Inactive accounts stay listed (dimmed) and are left out of pickers.
--   • Names are unique among ACTIVE accounts, case-insensitively and ignoring outer spaces
--     ("TCS" and " tcs " clash). A deactivated account keeps its name, so a new active account
--     may reuse it — but that old one can't be reactivated until the clash is resolved.
--   • Reordering goes through cmr_reorder_accounts() so the whole order is written in one
--     statement (atomic) rather than N separate updates.
--
-- Service-role only, exactly like cmr_access / billing_*: RLS on with NO policies, and the
-- default anon/authenticated privileges revoked. The app reads/writes it server-side only, and
-- every /api/cmr/accounts route checks the caller's cmr_access grant first.

create table public.cmr_accounts (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  account_type text,
  active       boolean not null default true,
  sort_order   int not null default 0,
  created_by   uuid references public.user_profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  constraint cmr_accounts_name_len check (char_length(btrim(name)) between 1 and 60),
  constraint cmr_accounts_type_len check (account_type is null or char_length(btrim(account_type)) between 1 and 40)
);

comment on table public.cmr_accounts is
  'SN Cash Ledger (CMR) cash accounts. Controller-managed; deactivate (active=false), never delete. Service-role only (RLS on, no policies).';

-- Two live accounts can't share a name (case-insensitive); inactive ones may keep theirs.
create unique index cmr_accounts_active_name_uniq
  on public.cmr_accounts (lower(btrim(name)))
  where active;

-- List order.
create index cmr_accounts_sort_idx on public.cmr_accounts (sort_order, name);

-- Covers the created_by foreign key (performance advisor: unindexed_foreign_keys).
create index cmr_accounts_created_by_idx on public.cmr_accounts (created_by);

alter table public.cmr_accounts enable row level security;
revoke all on table public.cmr_accounts from anon, authenticated;

-- Atomic reorder: p_ids is the full list of account ids in their new order; each row gets
-- sort_order = its 0-based position. The API checks that p_ids is exactly the current set.
create function public.cmr_reorder_accounts(p_ids uuid[])
returns void
language sql
security invoker
set search_path = ''
as $$
  update public.cmr_accounts as a
     set sort_order = (o.ord - 1)::int
    from unnest(p_ids) with ordinality as o(id, ord)
   where a.id = o.id
     and a.sort_order is distinct from (o.ord - 1)::int;
$$;

comment on function public.cmr_reorder_accounts(uuid[]) is
  'SN Cash Ledger: rewrite cmr_accounts.sort_order from an ordered id list in one statement. Service-role only.';

revoke all on function public.cmr_reorder_accounts(uuid[]) from public, anon, authenticated;
grant execute on function public.cmr_reorder_accounts(uuid[]) to service_role;

-- Seed: the starting accounts Mason confirmed (names/types are refined in the Accounts screen).
insert into public.cmr_accounts (name, account_type, active, sort_order, created_by)
values
  ('TCS',      null, true, 0, '8556367e-4010-45cc-b91d-f6f5fdf3e9cf'),
  ('Signs',    null, true, 1, '8556367e-4010-45cc-b91d-f6f5fdf3e9cf'),
  ('STS',      null, true, 2, '8556367e-4010-45cc-b91d-f6f5fdf3e9cf'),
  ('INC',      null, true, 3, '8556367e-4010-45cc-b91d-f6f5fdf3e9cf'),
  ('Holdings', null, true, 4, '8556367e-4010-45cc-b91d-f6f5fdf3e9cf'),
  ('WHWY',     null, true, 5, '8556367e-4010-45cc-b91d-f6f5fdf3e9cf'),
  ('JFT',      null, true, 6, '8556367e-4010-45cc-b91d-f6f5fdf3e9cf')
on conflict do nothing;
