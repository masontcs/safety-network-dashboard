-- CMR (SN Cash Ledger) · Phase 6 · push-to-next-day, carry-forward, undo placement
--
-- Moving work forward without losing what happened:
--
--   • PUSH — a still-pending item on one day's ledger is copied onto another day's ledger and
--     the original is marked 'pushed'. The original stays where it was as a greyed history row
--     and, because the pending roll-up already ignores 'pushed', it stops counting against that
--     day's balance (Phase 3). The forward copy is the live one and points back at what it came
--     from through the new pushed_from_id column — the ONLY schema change in this migration.
--   • CARRY — the same idea a week at a time: an OPEN weekly priority is copied into another
--     week (carried_from_id, already on the table since Phase 4) and the original becomes
--     'carried', which takes it out of "needed this week" without deleting it.
--   • UNPLACE — the undo the Controller had no way to do in Phase 5: the row a placed vendor
--     request created is deleted and the request goes back to 'queued'. It is refused once that
--     row has been paid, or pushed / carried onward, because undoing then would erase work that
--     has moved on.
--
-- All three are transactional functions in the same shape as the Phase 5 placement functions:
-- they lock the source row FOR UPDATE, re-check its state while holding it, and do the insert
-- (or delete) and the status change in ONE call — so two Controllers clicking at the same time
-- can't push, carry or undo the same thing twice, and a row is never half-moved. Each returns
-- the id it created (or, for unplace, the id it removed).
--
-- Service-role only, exactly like every other cmr_* object: the functions are revoked from
-- public/anon/authenticated and granted to service_role, and every /api/cmr/* route checks the
-- caller's cmr_access grant (Controller for all of these) before calling them.

-- ── the back-link a pushed copy carries ────────────────────────────────────
-- The forward copy points at the item it was pushed from; the original carries status 'pushed'.
-- ON DELETE SET NULL: deleting a history row must never cascade away the live copy.
alter table public.cmr_pending_items
  add column pushed_from_id uuid references public.cmr_pending_items(id) on delete set null;

comment on column public.cmr_pending_items.pushed_from_id is
  'The pending item this one was pushed forward from (that item carries status = pushed). Null for an item that was entered, placed or recurred on its own day.';

-- Finding a pushed item's forward copy, and covering the new foreign key
-- (performance advisor: unindexed_foreign_keys).
create index cmr_pending_items_pushed_from_idx on public.cmr_pending_items (pushed_from_id);

-- ── push a pending item to another day (service role only) ─────────────────
-- The caller (the API) has already validated the target and created the (date, period) ledger
-- row, and computes the copy's sort_order the same way placing a request does.
create function public.cmr_push_pending_item(
  p_item_id    uuid,
  p_actor      uuid,
  p_ledger_id  uuid,
  p_date       date,
  p_sort_order int
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_item   public.cmr_pending_items%rowtype;
  v_new_id uuid;
begin
  select * into v_item
    from public.cmr_pending_items
   where id = p_item_id
     for update;

  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  -- Only a still-pending item moves: a paid one left the bank on its own day, and an already
  -- pushed one has a forward copy somewhere else that is the live row.
  if v_item.status <> 'pending' then
    raise exception 'NOT_PENDING' using errcode = 'P0001';
  end if;
  if v_item.daily_ledger_id = p_ledger_id then
    raise exception 'SAME_LEDGER' using errcode = 'P0001';
  end if;

  -- The copy keeps the payee, account, amount and notes, and remembers the day the item was
  -- FIRST dated (original_date) however many times it has been pushed. It is a plain manual
  -- item on its new day: source 'manual' with no source_ref_id (the table's
  -- cmr_pending_items_manual_no_ref check), so a placed request still points at exactly one
  -- row — the original, which is now history.
  insert into public.cmr_pending_items
    (daily_ledger_id, account_id, payee, amount_cents, status, original_date, effective_date,
     source, source_ref_id, notes, sort_order, created_by, pushed_from_id)
  values
    (p_ledger_id, v_item.account_id, v_item.payee, v_item.amount_cents, 'pending',
     coalesce(v_item.original_date, v_item.effective_date), p_date,
     'manual', null, v_item.notes, p_sort_order, p_actor, v_item.id)
  returning id into v_new_id;

  update public.cmr_pending_items
     set status = 'pushed'
   where id = p_item_id;

  return v_new_id;
end;
$$;

comment on function public.cmr_push_pending_item(uuid, uuid, uuid, date, int) is
  'SN Cash Ledger: copy a still-pending item onto another day''s ledger and mark the original pushed, atomically. Returns the new cmr_pending_items id. Service-role only.';

revoke all on function public.cmr_push_pending_item(uuid, uuid, uuid, date, int) from public, anon, authenticated;
grant execute on function public.cmr_push_pending_item(uuid, uuid, uuid, date, int) to service_role;

-- ── carry a weekly priority to another week (service role only) ────────────
create function public.cmr_carry_priority(
  p_priority_id uuid,
  p_actor       uuid,
  p_week_start  date,
  p_sort_order  int
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_priority public.cmr_weekly_priorities%rowtype;
  v_new_id   uuid;
begin
  select * into v_priority
    from public.cmr_weekly_priorities
   where id = p_priority_id
     for update;

  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  -- Only an OPEN priority carries: resolved and paid ones are finished, and a carried one
  -- already has its copy in a later week.
  if v_priority.status <> 'open' then
    raise exception 'NOT_OPEN' using errcode = 'P0001';
  end if;
  if v_priority.week_start = p_week_start then
    raise exception 'SAME_WEEK' using errcode = 'P0001';
  end if;

  -- The copy keeps everything the Controller wrote, including the Top flag, and starts open in
  -- its new week. p_week_start is a Sunday (the API normalises any date to its Sunday); the
  -- table's cmr_weekly_priorities_week_start_sunday check is the backstop.
  insert into public.cmr_weekly_priorities
    (week_start, description, amount_cents, due_date, notes, is_top_priority, status,
     carried_from_id, sort_order, created_by)
  values
    (p_week_start, v_priority.description, v_priority.amount_cents, v_priority.due_date,
     v_priority.notes, v_priority.is_top_priority, 'open',
     v_priority.id, p_sort_order, p_actor)
  returning id into v_new_id;

  update public.cmr_weekly_priorities
     set status = 'carried'
   where id = p_priority_id;

  return v_new_id;
end;
$$;

comment on function public.cmr_carry_priority(uuid, uuid, date, int) is
  'SN Cash Ledger: copy an open weekly priority into another week and mark the original carried, atomically. Returns the new cmr_weekly_priorities id. Service-role only.';

revoke all on function public.cmr_carry_priority(uuid, uuid, date, int) from public, anon, authenticated;
grant execute on function public.cmr_carry_priority(uuid, uuid, date, int) to service_role;

-- ── undo a placement (service role only) ───────────────────────────────────
-- The mirror of cmr_place_request_pending / cmr_place_request_priority: delete the row the
-- placement created and put the request back in the queue, in one call. Refused once that row
-- has been paid, or pushed / carried onward — undoing then would delete a decision that has
-- already moved forward. If the placed row is simply gone (someone deleted it directly), the
-- request still returns to the queue and the function returns null.
create function public.cmr_unplace_request(p_request_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_request  public.cmr_vendor_requests%rowtype;
  v_pending  public.cmr_pending_items%rowtype;
  v_priority public.cmr_weekly_priorities%rowtype;
  v_removed  uuid := null;
begin
  select * into v_request
    from public.cmr_vendor_requests
   where id = p_request_id
     for update;

  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_request.status <> 'placed' then
    raise exception 'NOT_PLACED' using errcode = 'P0001';
  end if;

  if v_request.placed_kind = 'pending' then
    select * into v_pending
      from public.cmr_pending_items
     where id = v_request.placed_ref_id
       for update;
    if found then
      if v_pending.status = 'paid' then
        raise exception 'ROW_PAID' using errcode = 'P0001';
      end if;
      if v_pending.status <> 'pending'
         or exists (select 1 from public.cmr_pending_items where pushed_from_id = v_pending.id) then
        raise exception 'ROW_MOVED' using errcode = 'P0001';
      end if;
      delete from public.cmr_pending_items where id = v_pending.id;
      v_removed := v_pending.id;
    end if;

  elsif v_request.placed_kind = 'priority' then
    select * into v_priority
      from public.cmr_weekly_priorities
     where id = v_request.placed_ref_id
       for update;
    if found then
      if v_priority.status = 'paid' then
        raise exception 'ROW_PAID' using errcode = 'P0001';
      end if;
      if v_priority.status = 'carried'
         or exists (select 1 from public.cmr_weekly_priorities where carried_from_id = v_priority.id) then
        raise exception 'ROW_MOVED' using errcode = 'P0001';
      end if;
      if v_priority.status <> 'open' then
        raise exception 'ROW_SETTLED' using errcode = 'P0001';
      end if;
      delete from public.cmr_weekly_priorities where id = v_priority.id;
      v_removed := v_priority.id;
    end if;
  end if;

  update public.cmr_vendor_requests
     set status = 'queued',
         placed_kind = null,
         placed_ref_id = null,
         placed_at = null,
         placed_by = null
   where id = p_request_id;

  return v_removed;
end;
$$;

comment on function public.cmr_unplace_request(uuid) is
  'SN Cash Ledger: undo a placed vendor request — delete the pending item or weekly priority it created and return the request to the queue, atomically. Refused once that row was paid or pushed/carried on. Returns the id removed, or null if it was already gone. Service-role only.';

revoke all on function public.cmr_unplace_request(uuid) from public, anon, authenticated;
grant execute on function public.cmr_unplace_request(uuid) to service_role;
