-- CMR (SN Cash Ledger) · Phase 5 · vendor payment requests
--
-- cmr_vendor_requests — the inbox between the team and the Controller.
--
--   • A Requester (Jordan, Russ) submits a vendor payment here; it is the ONLY write a
--     non-Controller can make anywhere in Cash Ledger. A Viewer cannot submit at all.
--     requested_by is always the caller's own id — the API never takes it from the body.
--   • A queued request may be edited or withdrawn (hard-deleted, audited) by its submitter
--     while it is still queued, or by the Controller at any time. Everything else — placing
--     and declining — is Controller-only.
--   • The Controller PLACES a queued request into either the daily pending list
--     (cmr_pending_items, source = 'request') or a weekly priority
--     (cmr_weekly_priorities), choosing the day/period or the week at place time. The
--     request then carries where it went: placed_kind + placed_ref_id + placed_at +
--     placed_by. Placement happens inside cmr_place_request_pending /
--     cmr_place_request_priority below, so a request is never marked placed without its row.
--   • status 'paid' is defined now for Phase 6 (a placed item that is later paid). Phase 5
--     only moves a request queued → placed / declined.
--   • Money is integer cents (bigint), 0 … $999,999,999.99. due_date is a Pacific calendar
--     day and is only a suggestion — the Controller picks the real date when placing.
--   • The queue orders by created_at (oldest first); there is no sort_order and no reorder
--     function.
--
-- Service-role only, exactly like every other cmr_* table: RLS on with NO policies, and the
-- default anon/authenticated privileges revoked. The app reads/writes server-side only, and
-- every /api/cmr/requests route checks the caller's cmr_access grant first.

create table public.cmr_vendor_requests (
  id            uuid primary key default gen_random_uuid(),
  -- The submitter. ON DELETE RESTRICT: a request must always say who asked for it.
  requested_by  uuid not null references public.user_profiles(id) on delete restrict,
  account_id    uuid not null references public.cmr_accounts(id) on delete restrict,
  vendor        text not null,
  amount_cents  bigint not null default 0,
  due_date      date,
  notes         text,
  status        text not null default 'queued',
  placed_kind   text,
  placed_ref_id uuid,
  placed_at     timestamptz,
  placed_by     uuid references public.user_profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  constraint cmr_vendor_requests_vendor_len
    check (char_length(btrim(vendor)) between 1 and 80),
  constraint cmr_vendor_requests_notes_len
    check (notes is null or char_length(btrim(notes)) between 1 and 500),
  -- 0 = no dollar figure. Never negative.
  constraint cmr_vendor_requests_amount_chk
    check (amount_cents >= 0 and amount_cents <= 99999999999),
  constraint cmr_vendor_requests_status_chk
    check (status in ('queued', 'placed', 'paid', 'declined')),
  constraint cmr_vendor_requests_placed_kind_chk
    check (placed_kind is null or placed_kind in ('pending', 'priority')),
  -- A queued or declined request carries NO placement. (A placed one carries all of it —
  -- the next constraint. 'paid' is Phase 6: it keeps whatever placement it was given.)
  constraint cmr_vendor_requests_unplaced_chk
    check (
      status in ('placed', 'paid')
      or (placed_kind is null and placed_ref_id is null and placed_at is null)
    ),
  -- A placed request always says where it went, when, and by whom.
  constraint cmr_vendor_requests_placed_chk
    check (
      status <> 'placed'
      or (placed_kind is not null and placed_ref_id is not null and placed_at is not null)
    )
);

comment on table public.cmr_vendor_requests is
  'SN Cash Ledger (CMR) vendor payment requests: the queue a Requester submits into and the Controller places into a daily pending item or a weekly priority (or declines). The only non-Controller write in CMR. Service-role only (RLS on, no policies).';
comment on column public.cmr_vendor_requests.requested_by is
  'Who submitted the request — always the authenticated caller, never taken from the request body.';
comment on column public.cmr_vendor_requests.placed_kind is
  'Where a placed request went: pending (cmr_pending_items) or priority (cmr_weekly_priorities).';
comment on column public.cmr_vendor_requests.placed_ref_id is
  'The id of the row created by placing this request, in the table named by placed_kind.';

-- The queue (status first, then oldest-first within it) and the foreign keys
-- (performance advisor: unindexed_foreign_keys).
create index cmr_vendor_requests_status_idx on public.cmr_vendor_requests (status, created_at);
create index cmr_vendor_requests_requested_by_idx on public.cmr_vendor_requests (requested_by);
create index cmr_vendor_requests_account_idx on public.cmr_vendor_requests (account_id);
create index cmr_vendor_requests_placed_by_idx on public.cmr_vendor_requests (placed_by);

alter table public.cmr_vendor_requests enable row level security;
revoke all on table public.cmr_vendor_requests from anon, authenticated;

-- ── placement (service role only) ──────────────────────────────────────────
-- Placing a request must never half-happen: the new ledger/priority row and the request's
-- status change are ONE statement each, inside a single function call, so either both land or
-- neither does. Both functions re-check `queued` while holding the request row locked (FOR
-- UPDATE), so two Controllers clicking Place at once can't place the same request twice —
-- the loser gets NOT_QUEUED and nothing is written.
--
-- The caller (the API) has already validated the inputs and, for a pending placement, created
-- the (date, period) ledger row. Each function returns the id of the row it created.

create function public.cmr_place_request_pending(
  p_request_id uuid,
  p_placed_by  uuid,
  p_ledger_id  uuid,
  p_account_id uuid,
  p_payee      text,
  p_amount_cents bigint,
  p_notes      text,
  p_date       date,
  p_sort_order int
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_status text;
  v_new_id uuid;
begin
  select status into v_status
    from public.cmr_vendor_requests
   where id = p_request_id
     for update;

  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_status <> 'queued' then
    raise exception 'NOT_QUEUED' using errcode = 'P0001';
  end if;

  insert into public.cmr_pending_items
    (daily_ledger_id, account_id, payee, amount_cents, status, original_date, effective_date,
     source, source_ref_id, notes, sort_order, created_by)
  values
    (p_ledger_id, p_account_id, p_payee, p_amount_cents, 'pending', p_date, p_date,
     'request', p_request_id, p_notes, p_sort_order, p_placed_by)
  returning id into v_new_id;

  update public.cmr_vendor_requests
     set status = 'placed',
         placed_kind = 'pending',
         placed_ref_id = v_new_id,
         placed_at = now(),
         placed_by = p_placed_by
   where id = p_request_id;

  return v_new_id;
end;
$$;

comment on function public.cmr_place_request_pending(uuid, uuid, uuid, uuid, text, bigint, text, date, int) is
  'SN Cash Ledger: place a queued vendor request into a daily ledger as a pending item and mark the request placed, atomically. Returns the new cmr_pending_items id. Service-role only.';

revoke all on function public.cmr_place_request_pending(uuid, uuid, uuid, uuid, text, bigint, text, date, int) from public, anon, authenticated;
grant execute on function public.cmr_place_request_pending(uuid, uuid, uuid, uuid, text, bigint, text, date, int) to service_role;

create function public.cmr_place_request_priority(
  p_request_id uuid,
  p_placed_by  uuid,
  p_week_start date,
  p_description text,
  p_amount_cents bigint,
  p_due_date   date,
  p_notes      text,
  p_sort_order int
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_status text;
  v_new_id uuid;
begin
  select status into v_status
    from public.cmr_vendor_requests
   where id = p_request_id
     for update;

  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_status <> 'queued' then
    raise exception 'NOT_QUEUED' using errcode = 'P0001';
  end if;

  insert into public.cmr_weekly_priorities
    (week_start, description, amount_cents, due_date, notes, is_top_priority, status,
     sort_order, created_by)
  values
    (p_week_start, p_description, p_amount_cents, p_due_date, p_notes, false, 'open',
     p_sort_order, p_placed_by)
  returning id into v_new_id;

  update public.cmr_vendor_requests
     set status = 'placed',
         placed_kind = 'priority',
         placed_ref_id = v_new_id,
         placed_at = now(),
         placed_by = p_placed_by
   where id = p_request_id;

  return v_new_id;
end;
$$;

comment on function public.cmr_place_request_priority(uuid, uuid, date, text, bigint, date, text, int) is
  'SN Cash Ledger: place a queued vendor request into a week as a priority and mark the request placed, atomically. Returns the new cmr_weekly_priorities id. Service-role only.';

revoke all on function public.cmr_place_request_priority(uuid, uuid, date, text, bigint, date, text, int) from public, anon, authenticated;
grant execute on function public.cmr_place_request_priority(uuid, uuid, date, text, bigint, date, text, int) to service_role;
