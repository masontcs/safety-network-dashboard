-- 2026-06-18
-- 1) Remove the unused payments / payment-import feature (data + tables).
--    The QuickBooks payment export data was never correct and the feature is not in use.
-- 2) Replace the lossy app-side AR customer merge with an atomic Postgres function.

-- ── 1. Drop payments feature ────────────────────────────────────────────────
drop table if exists ar_payments cascade;
drop table if exists ar_payment_imports cascade;

-- ── 2. Atomic AR customer merge ─────────────────────────────────────────────
-- Moves every related row from the source customer onto the target, then deletes
-- the source — all in one transaction. Replaces the previous route logic that ran
-- separate, non-atomic updates and silently dropped ar_customer_assignments
-- (ON DELETE CASCADE) and orphaned promises.
create or replace function merge_ar_customer(p_target uuid, p_source uuid)
returns void
language plpgsql
as $$
begin
  if p_target = p_source then
    raise exception 'cannot merge a customer with itself';
  end if;

  -- De-dupe the unique (customer_id, user_id) tables, then let the source rows
  -- cascade-delete with the source customer below.
  insert into ar_customer_assignments (customer_id, user_id)
    select p_target, user_id from ar_customer_assignments where customer_id = p_source
    on conflict (customer_id, user_id) do nothing;

  insert into ar_customer_pm_assignments (customer_id, user_id)
    select p_target, user_id from ar_customer_pm_assignments where customer_id = p_source
    on conflict (customer_id, user_id) do nothing;

  -- Re-point everything else.
  update ar_customer_entity_refs set customer_id = p_target where customer_id = p_source;
  update ar_invoices            set customer_id = p_target where customer_id = p_source;
  update ar_customer_contacts   set customer_id = p_target where customer_id = p_source;
  update ar_customer_notes      set customer_id = p_target where customer_id = p_source;
  update ar_promises            set customer_id = p_target where customer_id = p_source;

  delete from ar_customers where id = p_source;
end;
$$;
