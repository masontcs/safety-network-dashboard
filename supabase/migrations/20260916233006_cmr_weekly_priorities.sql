-- CMR (SN Cash Ledger) · Phase 4 · weekly priorities
--
-- cmr_weekly_priorities — what has to be paid or handled in one week, in the Controller's order.
--
--   • A week runs Sunday → Saturday. week_start is ALWAYS that Sunday (a Pacific calendar day;
--     the app normalises any date to the Sunday on/before it). Enforced by a check below.
--   • amount_cents is optional in the app: a priority can be a task with no dollar figure, stored
--     as 0. Money is integer cents (bigint), 0 … $999,999,999.99.
--   • status: open → resolved (handled, no payment) or paid (money went out). paid stamps
--     paid_at / paid_by; leaving paid clears them (enforced below). Reopening goes back to open.
--   • 'carried' + carried_from_id are defined now for Phase 6 (carry a priority into the next
--     week). Phase 4 never writes them — the API refuses status = 'carried'.
--   • is_top_priority is the "Top" flag. sort_order is the position within the week; reorders
--     go through cmr_reorder_weekly_priorities() so a week's order is written in one statement.
--   • The Controller may hard-delete a priority (every delete is audited in audit_logs).
--     A carried copy keeps existing if its source is deleted (carried_from_id → null).
--
-- Service-role only, exactly like every other cmr_* table: RLS on with NO policies, and the
-- default anon/authenticated privileges revoked. The app reads/writes server-side only, and
-- every /api/cmr/priorities route checks the caller's cmr_access grant first.

create table public.cmr_weekly_priorities (
  id              uuid primary key default gen_random_uuid(),
  week_start      date not null,
  description     text not null,
  amount_cents    bigint not null default 0,
  due_date        date,
  notes           text,
  is_top_priority boolean not null default false,
  status          text not null default 'open',
  carried_from_id uuid references public.cmr_weekly_priorities(id) on delete set null,
  paid_at         timestamptz,
  paid_by         uuid references public.user_profiles(id) on delete set null,
  sort_order      int not null default 0,
  created_by      uuid references public.user_profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  -- Sunday (day-of-week 0) — the week runs Sunday → Saturday.
  constraint cmr_weekly_priorities_week_start_sunday
    check (extract(dow from week_start) = 0),
  constraint cmr_weekly_priorities_description_len
    check (char_length(btrim(description)) between 1 and 120),
  -- 0 = no dollar figure (a task). Never negative.
  constraint cmr_weekly_priorities_amount_chk
    check (amount_cents >= 0 and amount_cents <= 99999999999),
  constraint cmr_weekly_priorities_notes_len
    check (notes is null or char_length(btrim(notes)) between 1 and 500),
  constraint cmr_weekly_priorities_status_chk
    check (status in ('open', 'resolved', 'paid', 'carried')),
  -- A paid priority has a paid time; nothing else does. paid_by may be null after the payer's
  -- profile is removed (ON DELETE SET NULL), but never set on an unpaid priority.
  constraint cmr_weekly_priorities_paid_at_chk
    check ((status = 'paid') = (paid_at is not null)),
  constraint cmr_weekly_priorities_paid_by_chk
    check (status = 'paid' or paid_by is null),
  constraint cmr_weekly_priorities_not_self_carried
    check (carried_from_id is null or carried_from_id <> id)
);

comment on table public.cmr_weekly_priorities is
  'SN Cash Ledger (CMR) weekly priorities: what must be paid/handled in one Sunday-start week, ordered, with a top-priority flag and open/resolved/paid status (carried is reserved for Phase 6). amount_cents 0 = no dollar figure. Service-role only (RLS on, no policies).';
comment on column public.cmr_weekly_priorities.week_start is
  'The Sunday that starts the week (Pacific calendar day). Weeks run Sunday → Saturday.';
comment on column public.cmr_weekly_priorities.carried_from_id is
  'Phase 6: the priority in an earlier week this one was carried forward from.';

-- A week's list, in order.
create index cmr_weekly_priorities_week_idx on public.cmr_weekly_priorities (week_start, sort_order);
-- Cover the remaining foreign keys (performance advisor: unindexed_foreign_keys).
create index cmr_weekly_priorities_created_by_idx on public.cmr_weekly_priorities (created_by);
create index cmr_weekly_priorities_carried_from_idx on public.cmr_weekly_priorities (carried_from_id);
create index cmr_weekly_priorities_paid_by_idx on public.cmr_weekly_priorities (paid_by);

alter table public.cmr_weekly_priorities enable row level security;
revoke all on table public.cmr_weekly_priorities from anon, authenticated;

-- ── atomic reorder (service role only) ─────────────────────────────────────
-- p_ids is every priority of one week, in its new order; each row gets sort_order = its 0-based
-- position. Rows are also matched on p_week_start, so an id from another week is never touched.
-- The API checks p_ids is exactly the week's current set (409 STALE otherwise).
create function public.cmr_reorder_weekly_priorities(p_week_start date, p_ids uuid[])
returns void
language sql
security invoker
set search_path = ''
as $$
  update public.cmr_weekly_priorities as w
     set sort_order = (o.ord - 1)::int
    from unnest(p_ids) with ordinality as o(id, ord)
   where w.id = o.id
     and w.week_start = p_week_start
     and w.sort_order is distinct from (o.ord - 1)::int;
$$;

comment on function public.cmr_reorder_weekly_priorities(date, uuid[]) is
  'SN Cash Ledger: rewrite cmr_weekly_priorities.sort_order for one week from an ordered id list in one statement. Service-role only.';

revoke all on function public.cmr_reorder_weekly_priorities(date, uuid[]) from public, anon, authenticated;
grant execute on function public.cmr_reorder_weekly_priorities(date, uuid[]) to service_role;
