-- CMR (SN Cash Ledger) · Phase 6 · un-push, and the delete safety net
--
-- Phase 6's push left one way for money to go missing. A push copies a pending item onto
-- another day and marks the original 'pushed', which takes it out of its own day's roll-up
-- (Phase 3 excludes 'pushed'). The forward copy is an ordinary manual item, so the Controller
-- can delete it — and the original was then stranded at 'pushed' for good: nothing could move
-- it back, and its amount counted on NO ledger at all. A pushed item that came from a vendor
-- request was doubly stuck, because undoing the placement is refused once the placed row has
-- been pushed on.
--
-- Two things close that, and between them there is no sequence that loses an amount:
--
--   • cmr_unpush_pending_item — the deliberate reverse of a push. It deletes the forward copy
--     and puts the original back to 'pending' on its own day, atomically, refusing if that copy
--     has been paid or pushed on again (the same rule, and the same ROW_PAID / ROW_MOVED codes,
--     that cmr_unplace_request uses). Un-pushing first is also what unsticks a request-sourced
--     item: the original returns to 'pending', and the placement can then be undone normally.
--   • cmr_revive_pushed_source — an AFTER DELETE trigger that makes the safety net structural
--     rather than a rule the app has to remember. Whenever ANY pending item that was pushed
--     forward is deleted — through the API, through cmr_unpush_pending_item, or through a
--     cascade when its whole ledger goes — the item it was pushed from goes back to 'pending'
--     in the same statement. So deleting a forward copy can never strand its source off every
--     ledger, whatever route the delete took.
--
-- Balance semantics are exact either way: the revived original counts again on its original
-- day (it is 'pending' there once more), and the copy is gone from the target day. Nothing is
-- double-counted, because the copy no longer exists.
--
-- Service-role only, like every other cmr_* object.

-- ── the safety net ─────────────────────────────────────────────────────────
-- AFTER DELETE, so it sees a row that is already gone; the NOT EXISTS is belt-and-braces in
-- case a source ever had more than one copy (push requires 'pending', so it can't today).
-- The source is only revived if it is still 'pushed' — a source that was already put back, or
-- that moved on some other way, is left exactly as it is.
--
-- This function takes no grants of its own on purpose. PostgreSQL invokes a trigger function
-- from the system, without an EXECUTE check at run time, and a `returns trigger` function
-- cannot be called from SQL directly — Postgres refuses it ("can only be called as a trigger").
-- Revoking here would buy nothing and risks breaking every DELETE on the table.
create function public.cmr_revive_pushed_source()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.pushed_from_id is not null then
    update public.cmr_pending_items
       set status = 'pending'
     where id = old.pushed_from_id
       and status = 'pushed'
       and not exists (
         select 1
           from public.cmr_pending_items c
          where c.pushed_from_id = old.pushed_from_id
            and c.id <> old.id
       );
  end if;
  return old;
end;
$$;

comment on function public.cmr_revive_pushed_source() is
  'SN Cash Ledger: when a pushed-forward pending item is deleted, put the item it was pushed from back to pending, so deleting a forward copy can never leave its source counted on no ledger. AFTER DELETE trigger on cmr_pending_items.';

create trigger cmr_pending_items_revive_source
after delete on public.cmr_pending_items
for each row
execute function public.cmr_revive_pushed_source();

-- ── un-push (service role only) ────────────────────────────────────────────
-- Takes the PUSHED ORIGINAL (the history row on the day it left), not the copy. Returns the id
-- of the copy it removed, or null when that copy was already gone — in which case the original
-- is simply put back, which is the right answer either way.
create function public.cmr_unpush_pending_item(p_item_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_source  public.cmr_pending_items%rowtype;
  v_copy    public.cmr_pending_items%rowtype;
  v_removed uuid := null;
begin
  select * into v_source
    from public.cmr_pending_items
   where id = p_item_id
     for update;

  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_source.status <> 'pushed' then
    raise exception 'NOT_PUSHED' using errcode = 'P0001';
  end if;

  select * into v_copy
    from public.cmr_pending_items
   where pushed_from_id = v_source.id
   order by created_at
   limit 1
     for update;

  if found then
    -- Only an untouched copy may be taken back: paying it or pushing it on again are decisions
    -- that have moved forward, and deleting them here would erase real work.
    if v_copy.status = 'paid' then
      raise exception 'ROW_PAID' using errcode = 'P0001';
    end if;
    if v_copy.status <> 'pending'
       or exists (select 1 from public.cmr_pending_items where pushed_from_id = v_copy.id) then
      raise exception 'ROW_MOVED' using errcode = 'P0001';
    end if;

    delete from public.cmr_pending_items where id = v_copy.id;
    v_removed := v_copy.id;
  end if;

  -- The trigger above already revived the source when a copy was deleted; this covers the case
  -- where there was no copy left to delete, and is a no-op otherwise.
  update public.cmr_pending_items
     set status = 'pending'
   where id = p_item_id
     and status = 'pushed';

  return v_removed;
end;
$$;

comment on function public.cmr_unpush_pending_item(uuid) is
  'SN Cash Ledger: reverse a push — delete the forward copy and put the pushed original back to pending on its own day, atomically. Refused once that copy was paid or pushed on again. Returns the id removed, or null if it was already gone. Service-role only.';

revoke all on function public.cmr_unpush_pending_item(uuid) from public, anon, authenticated;
grant execute on function public.cmr_unpush_pending_item(uuid) to service_role;
