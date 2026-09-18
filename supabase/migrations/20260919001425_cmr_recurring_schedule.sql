-- CMR (SN Cash Ledger) · Phase 7 · structured recurring schedule + the due-suggestion link
--
-- Phase 2 gave every recurring vendor a free-text cadence (recurrence_detail, "Every Thursday").
-- A person can read that; the suggestion engine can't. Phase 7 replaces it with a real schedule
-- the database and the engine both understand, and records — on a weekly priority — that it came
-- from a recurring vendor, so an accepted suggestion drops off the "due" list.
--
--   • section becomes the FREQUENCY: weekly · monthly · quarterly · annually, plus the unchanged
--     urgent (Urgent Payment Plans), which has no schedule and is never suggested.
--   • schedule_weekday       0 = Sunday … 6 = Saturday   (weekly)
--     schedule_day_of_month  1 … 31, clamped to the month's length by the engine
--                                                        (monthly, quarterly, annually)
--     schedule_anchor_month  1 … 12 — the first month of the cycle
--                                                        (quarterly: +3, +6, +9; annually: that month)
--   • recurrence_detail is KEPT and deprecated. It is dropped in a later migration, once no
--     deployed code selects it: the currently-live build lists it in its SELECT, and a migration
--     lands minutes before the build that replaces it.
--
-- The table is empty (no vendor has ever been saved), so nothing is migrated or back-filled.
--
-- ── the deploy window ──────────────────────────────────────────────────────
-- This migration is applied BEFORE the Phase 7 build is deployed, so for a few minutes the LIVE
-- code is still the Phase 2 screen, which inserts a vendor with none of these three columns set.
-- The checks below are therefore written so that a row carries EITHER a complete schedule in
-- exactly the right columns for its section, OR no schedule at all — a legacy insert lands, it
-- simply has no schedule yet. Completeness for a NEW vendor is enforced by the API
-- (lib/cmr/recurring parseSchedule), which is stricter than the database on purpose, and the
-- engine skips any vendor whose schedule is incomplete rather than guessing a date.
--
-- Both new constraints are added NOT VALID and then VALIDATEd in the same migration: the table
-- is empty so nothing can fail, and it keeps the safe add-then-validate shape for a live table.
--
-- Service-role only throughout, exactly like every other cmr_* object.

-- ── 1. section = frequency ──────────────────────────────────────────────────
alter table public.cmr_recurring_vendors
  drop constraint cmr_recurring_vendors_section_chk;

alter table public.cmr_recurring_vendors
  add constraint cmr_recurring_vendors_section_chk
  check (section in ('weekly', 'monthly', 'quarterly', 'annually', 'urgent'));

-- ── 2. the schedule columns ─────────────────────────────────────────────────
alter table public.cmr_recurring_vendors
  add column schedule_weekday      smallint,
  add column schedule_day_of_month smallint,
  add column schedule_anchor_month smallint;

comment on column public.cmr_recurring_vendors.schedule_weekday is
  'Weekly vendors: the day of the week it is paid, 0 = Sunday … 6 = Saturday. Null for every other section.';
comment on column public.cmr_recurring_vendors.schedule_day_of_month is
  'Monthly / quarterly / annual vendors: the day of the month it is paid, 1 … 31. Clamped to the month''s length by the due engine (31 in February means the 28th or 29th). Null for weekly and urgent.';
comment on column public.cmr_recurring_vendors.schedule_anchor_month is
  'Quarterly / annual vendors: the first month of the cycle, 1 = January … 12 = December. Quarterly also recurs in that month + 3, + 6 and + 9. Null for weekly, monthly and urgent.';
comment on column public.cmr_recurring_vendors.recurrence_detail is
  'DEPRECATED (Phase 7): the free-text cadence replaced by schedule_weekday / schedule_day_of_month / schedule_anchor_month. Kept only so the build deployed at migration time keeps working; dropped in a later migration.';

-- Ranges. These hold for a legacy all-null row too (null passes every one), so they are plain,
-- always-enforced checks.
alter table public.cmr_recurring_vendors
  add constraint cmr_recurring_vendors_schedule_weekday_chk
    check (schedule_weekday is null or schedule_weekday between 0 and 6),
  add constraint cmr_recurring_vendors_schedule_dom_chk
    check (schedule_day_of_month is null or schedule_day_of_month between 1 and 31),
  add constraint cmr_recurring_vendors_schedule_anchor_chk
    check (schedule_anchor_month is null or schedule_anchor_month between 1 and 12);

-- ── 3. the shape of a schedule, per section ────────────────────────────────
-- Which columns a section may carry at all. A column that does not belong to the section is
-- always refused, whatever else is set — there is no "weekly vendor with an anchor month".
alter table public.cmr_recurring_vendors
  add constraint cmr_recurring_vendors_schedule_shape_chk
  check (
    case section
      when 'weekly'    then schedule_day_of_month is null and schedule_anchor_month is null
      when 'monthly'   then schedule_weekday is null and schedule_anchor_month is null
      when 'quarterly' then schedule_weekday is null
      when 'annually'  then schedule_weekday is null
      when 'urgent'    then schedule_weekday is null and schedule_day_of_month is null
                          and schedule_anchor_month is null
      else false
    end
  ) not valid;

alter table public.cmr_recurring_vendors
  validate constraint cmr_recurring_vendors_schedule_shape_chk;

-- ── 4. complete, or not there at all ───────────────────────────────────────
-- A scheduled section carries every column its frequency needs, or none of them (the legacy
-- insert described at the top — a vendor with no schedule yet, which the engine skips and the
-- screen flags). The API refuses the empty case on create and edit.
alter table public.cmr_recurring_vendors
  add constraint cmr_recurring_vendors_schedule_complete_chk
  check (
    section = 'urgent'
    or (schedule_weekday is null and schedule_day_of_month is null and schedule_anchor_month is null)
    or case section
         when 'weekly'    then schedule_weekday is not null
         when 'monthly'   then schedule_day_of_month is not null
         when 'quarterly' then schedule_day_of_month is not null and schedule_anchor_month is not null
         when 'annually'  then schedule_day_of_month is not null and schedule_anchor_month is not null
         else false
       end
  ) not valid;

alter table public.cmr_recurring_vendors
  validate constraint cmr_recurring_vendors_schedule_complete_chk;

-- ── 5. where an accepted suggestion lands ──────────────────────────────────
-- A pending item already records where it came from (source = 'recurring', source_ref_id = the
-- vendor). A weekly priority had no such column, so accepting a suggestion into a week could
-- not be told apart from a hand-typed priority — and the vendor would have stayed "due" for
-- ever. ON DELETE SET NULL because a vendor is retired (active = false), never deleted; if one
-- ever were, the priority itself is real work and must survive.
alter table public.cmr_weekly_priorities
  add column source_recurring_id uuid references public.cmr_recurring_vendors(id) on delete set null;

comment on column public.cmr_weekly_priorities.source_recurring_id is
  'SN Cash Ledger: the recurring vendor whose due suggestion created this priority. Null for a hand-entered priority or one placed from a vendor request. Used to tell the engine that occurrence has been handled.';

-- The engine's "has this occurrence been handled?" lookups, and the foreign key
-- (performance advisor: unindexed_foreign_keys).
create index cmr_weekly_priorities_source_recurring_idx
  on public.cmr_weekly_priorities (source_recurring_id, week_start);

create index cmr_pending_items_recurring_source_idx
  on public.cmr_pending_items (source_ref_id, effective_date)
  where source = 'recurring';

-- ── 6. accepting a suggestion (service role only) ──────────────────────────
-- Accepting must never half-happen and must never happen twice. Unlike a vendor request there
-- is no status to flip: a recurring vendor is "handled" for an occurrence because a row EXISTS
-- pointing back at it inside that occurrence's window. So both functions lock the vendor row
-- (FOR UPDATE) and re-check the window while holding it — two Controllers clicking Add on the
-- same due vendor at the same time means the loser gets ALREADY_HANDLED and nothing is written.
--
-- The window is the period the occurrence belongs to and is computed by the caller
-- (lib/cmr/recurring-due): the occurrence's own week, calendar month, quarter or year. A
-- priority counts as handling the occurrence when its Sunday → Saturday week OVERLAPS that
-- window, which for a weekly vendor is the same week.
--
-- p_last_amount_cents, when given, also records what went out as the vendor's last amount sent,
-- in the same statement — so the figure the Controller confirmed is the one remembered.
-- Each function returns the id of the row it created.

create function public.cmr_place_recurring_pending(
  p_vendor_id    uuid,
  p_actor        uuid,
  p_ledger_id    uuid,
  p_account_id   uuid,
  p_payee        text,
  p_amount_cents bigint,
  p_notes        text,
  p_date         date,
  p_sort_order   int,
  p_window_start date,
  p_window_end   date,
  p_last_amount_cents bigint default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_vendor public.cmr_recurring_vendors%rowtype;
  v_new_id uuid;
begin
  select * into v_vendor
    from public.cmr_recurring_vendors
   where id = p_vendor_id
     for update;

  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_vendor.section = 'urgent' then
    raise exception 'NOT_SCHEDULED' using errcode = 'P0001';
  end if;
  if not v_vendor.active then
    raise exception 'INACTIVE' using errcode = 'P0001';
  end if;
  if v_vendor.on_hold then
    raise exception 'ON_HOLD' using errcode = 'P0001';
  end if;

  if exists (
    select 1
      from public.cmr_pending_items
     where source = 'recurring'
       and source_ref_id = p_vendor_id
       and effective_date between p_window_start and p_window_end
  ) or exists (
    select 1
      from public.cmr_weekly_priorities
     where source_recurring_id = p_vendor_id
       and week_start <= p_window_end
       and week_start + 6 >= p_window_start
  ) then
    raise exception 'ALREADY_HANDLED' using errcode = 'P0001';
  end if;

  insert into public.cmr_pending_items
    (daily_ledger_id, account_id, payee, amount_cents, status, original_date, effective_date,
     source, source_ref_id, notes, sort_order, created_by)
  values
    (p_ledger_id, p_account_id, p_payee, p_amount_cents, 'pending', p_date, p_date,
     'recurring', p_vendor_id, p_notes, p_sort_order, p_actor)
  returning id into v_new_id;

  if p_last_amount_cents is not null then
    update public.cmr_recurring_vendors
       set last_amount_sent_cents = p_last_amount_cents
     where id = p_vendor_id;
  end if;

  return v_new_id;
end;
$$;

comment on function public.cmr_place_recurring_pending(uuid, uuid, uuid, uuid, text, bigint, text, date, int, date, date, bigint) is
  'SN Cash Ledger: accept a due recurring vendor into a daily ledger as a pending item sourced from that vendor, atomically, refusing (ALREADY_HANDLED) if that occurrence window already has a row. Returns the new cmr_pending_items id. Service-role only.';

revoke all on function public.cmr_place_recurring_pending(uuid, uuid, uuid, uuid, text, bigint, text, date, int, date, date, bigint) from public, anon, authenticated;
grant execute on function public.cmr_place_recurring_pending(uuid, uuid, uuid, uuid, text, bigint, text, date, int, date, date, bigint) to service_role;

create function public.cmr_place_recurring_priority(
  p_vendor_id     uuid,
  p_actor         uuid,
  p_week_start    date,
  p_description   text,
  p_amount_cents  bigint,
  p_due_date      date,
  p_notes         text,
  p_sort_order    int,
  p_window_start  date,
  p_window_end    date,
  p_last_amount_cents bigint default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_vendor public.cmr_recurring_vendors%rowtype;
  v_new_id uuid;
begin
  select * into v_vendor
    from public.cmr_recurring_vendors
   where id = p_vendor_id
     for update;

  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_vendor.section = 'urgent' then
    raise exception 'NOT_SCHEDULED' using errcode = 'P0001';
  end if;
  if not v_vendor.active then
    raise exception 'INACTIVE' using errcode = 'P0001';
  end if;
  if v_vendor.on_hold then
    raise exception 'ON_HOLD' using errcode = 'P0001';
  end if;

  if exists (
    select 1
      from public.cmr_pending_items
     where source = 'recurring'
       and source_ref_id = p_vendor_id
       and effective_date between p_window_start and p_window_end
  ) or exists (
    select 1
      from public.cmr_weekly_priorities
     where source_recurring_id = p_vendor_id
       and week_start <= p_window_end
       and week_start + 6 >= p_window_start
  ) then
    raise exception 'ALREADY_HANDLED' using errcode = 'P0001';
  end if;

  insert into public.cmr_weekly_priorities
    (week_start, description, amount_cents, due_date, notes, is_top_priority, status,
     source_recurring_id, sort_order, created_by)
  values
    (p_week_start, p_description, p_amount_cents, p_due_date, p_notes, false, 'open',
     p_vendor_id, p_sort_order, p_actor)
  returning id into v_new_id;

  if p_last_amount_cents is not null then
    update public.cmr_recurring_vendors
       set last_amount_sent_cents = p_last_amount_cents
     where id = p_vendor_id;
  end if;

  return v_new_id;
end;
$$;

comment on function public.cmr_place_recurring_priority(uuid, uuid, date, text, bigint, date, text, int, date, date, bigint) is
  'SN Cash Ledger: accept a due recurring vendor into a week as an open priority stamped with that vendor, atomically, refusing (ALREADY_HANDLED) if that occurrence window already has a row. Returns the new cmr_weekly_priorities id. Service-role only.';

revoke all on function public.cmr_place_recurring_priority(uuid, uuid, date, text, bigint, date, text, int, date, date, bigint) from public, anon, authenticated;
grant execute on function public.cmr_place_recurring_priority(uuid, uuid, date, text, bigint, date, text, int, date, date, bigint) to service_role;
