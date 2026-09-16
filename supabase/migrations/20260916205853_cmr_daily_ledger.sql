-- CMR (SN Cash Ledger) · Phase 3 · daily ledger
--
-- Three tables behind the Daily ledger screen (/cmr):
--
--   cmr_daily_ledger        one row per (ledger_date, period). AM and PM are INDEPENDENT
--                           snapshots, each with its own beginning cash, adjustments and pending
--                           items. Nothing carries between AM/PM or across days (that is Phase 6).
--                           Rows are created on demand by the first write for that date/period.
--   cmr_ledger_adjustments  signed lines that move the balance (+ money in, − money out), with an
--                           optional note and an optional "warn note" (the amber pill, e.g.
--                           "Needs to be covered by 2:00 PM").
--   cmr_pending_items       money written but not yet cleared the bank, per account. Amounts are
--                           stored POSITIVE and always REDUCE the balance.
--
--   Current balance = beginning_cash_cents
--                   + Σ cmr_ledger_adjustments.amount_cents (kind = 'manual', signed)
--                   − Σ cmr_pending_items.amount_cents
--   The pending roll-up line is DERIVED on read and never stored. `kind` exists on adjustments
--   for the data model; Phase 3 only ever writes kind = 'manual'.
--
--   • Money is integer cents (bigint), bounded to ±$999,999,999.99 like the other CMR tables.
--   • ledger_date is a Pacific calendar day (the app computes it with pacificToday()).
--   • Adjustments and pending items belong to one ledger and are removed with it
--     (ON DELETE CASCADE); the Controller may hard-delete them (every delete is audited).
--   • Pending items reference cmr_accounts ON DELETE RESTRICT (accounts are never deleted).
--   • original_date is the day an item was first dated; effective_date is the day it currently
--     sits on (it advances when the item is pushed forward, Phase 6).
--   • status / paid_at / paid_by / original_date / effective_date / source / source_ref_id are
--     for later phases (paid + push-to-next-day, recurring suggestions, vendor requests).
--     Phase 3 writes status = 'pending', source = 'manual', and original = effective = ledger_date.
--
-- Service-role only, exactly like every other cmr_* table: RLS on with NO policies, and the
-- default anon/authenticated privileges revoked. The app reads/writes server-side only, and
-- every /api/cmr/ledger route checks the caller's cmr_access grant first.

-- ── the day/period ledger ──────────────────────────────────────────────────
create table public.cmr_daily_ledger (
  id                   uuid primary key default gen_random_uuid(),
  ledger_date          date not null,
  period               text not null,
  beginning_cash_cents bigint not null default 0,
  created_by           uuid references public.user_profiles(id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint cmr_daily_ledger_period_chk
    check (period in ('am', 'pm')),
  -- −$999,999,999.99 … $999,999,999.99 (an overdrawn opening balance is allowed)
  constraint cmr_daily_ledger_beginning_chk
    check (beginning_cash_cents between -99999999999 and 99999999999),
  constraint cmr_daily_ledger_date_period_key
    unique (ledger_date, period)
);

comment on table public.cmr_daily_ledger is
  'SN Cash Ledger (CMR) daily ledger: one independent snapshot per (ledger_date, period am|pm) with its beginning cash. Created on demand. Service-role only (RLS on, no policies).';

-- The unique constraint above already provides the (ledger_date, period) index lookups use.
create index cmr_daily_ledger_created_by_idx on public.cmr_daily_ledger (created_by);

alter table public.cmr_daily_ledger enable row level security;
revoke all on table public.cmr_daily_ledger from anon, authenticated;

-- ── adjustment lines ───────────────────────────────────────────────────────
create table public.cmr_ledger_adjustments (
  id              uuid primary key default gen_random_uuid(),
  daily_ledger_id uuid not null references public.cmr_daily_ledger(id) on delete cascade,
  description     text not null,
  amount_cents    bigint not null,
  note            text,
  warn_note       text,
  kind            text not null default 'manual',
  sort_order      int not null default 0,
  created_by      uuid references public.user_profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  constraint cmr_ledger_adjustments_kind_chk
    check (kind in ('manual', 'pending_rollup')),
  constraint cmr_ledger_adjustments_description_len
    check (char_length(btrim(description)) between 1 and 120),
  -- SIGNED: + adds to the balance, − takes away.
  constraint cmr_ledger_adjustments_amount_chk
    check (amount_cents between -99999999999 and 99999999999),
  constraint cmr_ledger_adjustments_note_len
    check (note is null or char_length(btrim(note)) between 1 and 500),
  constraint cmr_ledger_adjustments_warn_note_len
    check (warn_note is null or char_length(btrim(warn_note)) between 1 and 80)
);

comment on table public.cmr_ledger_adjustments is
  'SN Cash Ledger (CMR) signed adjustment lines for one daily ledger (+ in / − out), with optional note and warn note. Phase 3 writes kind=manual only; the pending roll-up is derived, not stored. Service-role only (RLS on, no policies).';

create index cmr_ledger_adjustments_ledger_idx on public.cmr_ledger_adjustments (daily_ledger_id, sort_order);
create index cmr_ledger_adjustments_created_by_idx on public.cmr_ledger_adjustments (created_by);

alter table public.cmr_ledger_adjustments enable row level security;
revoke all on table public.cmr_ledger_adjustments from anon, authenticated;

-- ── pending-in-bank items ──────────────────────────────────────────────────
create table public.cmr_pending_items (
  id              uuid primary key default gen_random_uuid(),
  daily_ledger_id uuid not null references public.cmr_daily_ledger(id) on delete cascade,
  account_id      uuid not null references public.cmr_accounts(id) on delete restrict,
  payee           text not null,
  amount_cents    bigint not null,
  status          text not null default 'pending',
  original_date   date,
  effective_date  date,
  paid_at         timestamptz,
  paid_by         uuid references public.user_profiles(id) on delete set null,
  source          text not null default 'manual',
  source_ref_id   uuid,
  notes           text,
  sort_order      int not null default 0,
  created_by      uuid references public.user_profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  -- POSITIVE: a pending item is money leaving the bank; it always reduces the balance.
  constraint cmr_pending_items_amount_chk
    check (amount_cents >= 0 and amount_cents <= 99999999999),
  constraint cmr_pending_items_status_chk
    check (status in ('pending', 'paid', 'pushed')),
  constraint cmr_pending_items_source_chk
    check (source in ('manual', 'recurring', 'request')),
  -- A hand-entered item points at nothing; recurring/request items may point at their origin.
  constraint cmr_pending_items_manual_no_ref
    check (source <> 'manual' or source_ref_id is null),
  constraint cmr_pending_items_payee_len
    check (char_length(btrim(payee)) between 1 and 80),
  constraint cmr_pending_items_notes_len
    check (notes is null or char_length(btrim(notes)) between 1 and 500)
);

comment on table public.cmr_pending_items is
  'SN Cash Ledger (CMR) pending-in-bank items for one daily ledger, per account. amount_cents is positive and always subtracted from the balance. Service-role only (RLS on, no policies).';
comment on column public.cmr_pending_items.original_date is
  'The day this item was first dated.';
comment on column public.cmr_pending_items.effective_date is
  'The ledger day this item currently sits on (advances when pushed forward, Phase 6).';

-- Breakdown order: ledger, then account group, then position within the group.
create index cmr_pending_items_ledger_idx on public.cmr_pending_items (daily_ledger_id, account_id, sort_order);
-- Cover the remaining foreign keys (performance advisor: unindexed_foreign_keys).
create index cmr_pending_items_account_idx on public.cmr_pending_items (account_id);
create index cmr_pending_items_paid_by_idx on public.cmr_pending_items (paid_by);
create index cmr_pending_items_created_by_idx on public.cmr_pending_items (created_by);

alter table public.cmr_pending_items enable row level security;
revoke all on table public.cmr_pending_items from anon, authenticated;

-- ── atomic reorders (service role only) ────────────────────────────────────
-- p_ids is the full set being reordered, in its new order; each row gets sort_order = its
-- 0-based position. Rows are also matched on p_ledger_id, so an id from another ledger is never
-- touched. The API checks p_ids is exactly the current set (409 STALE otherwise).

-- Every manual adjustment of one ledger.
create function public.cmr_reorder_ledger_adjustments(p_ledger_id uuid, p_ids uuid[])
returns void
language sql
security invoker
set search_path = ''
as $$
  update public.cmr_ledger_adjustments as a
     set sort_order = (o.ord - 1)::int
    from unnest(p_ids) with ordinality as o(id, ord)
   where a.id = o.id
     and a.daily_ledger_id = p_ledger_id
     and a.sort_order is distinct from (o.ord - 1)::int;
$$;

comment on function public.cmr_reorder_ledger_adjustments(uuid, uuid[]) is
  'SN Cash Ledger: rewrite cmr_ledger_adjustments.sort_order for one ledger from an ordered id list in one statement. Service-role only.';

revoke all on function public.cmr_reorder_ledger_adjustments(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.cmr_reorder_ledger_adjustments(uuid, uuid[]) to service_role;

-- Every pending item of one account group within one ledger.
create function public.cmr_reorder_pending_items(p_ledger_id uuid, p_ids uuid[])
returns void
language sql
security invoker
set search_path = ''
as $$
  update public.cmr_pending_items as p
     set sort_order = (o.ord - 1)::int
    from unnest(p_ids) with ordinality as o(id, ord)
   where p.id = o.id
     and p.daily_ledger_id = p_ledger_id
     and p.sort_order is distinct from (o.ord - 1)::int;
$$;

comment on function public.cmr_reorder_pending_items(uuid, uuid[]) is
  'SN Cash Ledger: rewrite cmr_pending_items.sort_order for one account group of one ledger from an ordered id list in one statement. Service-role only.';

revoke all on function public.cmr_reorder_pending_items(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.cmr_reorder_pending_items(uuid, uuid[]) to service_role;
