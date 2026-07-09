-- ============================================================================
-- 20260709000005_billing_005_harden_functions.sql
-- TCR Billing v2 — Migration 005: Function hardening (from Supabase advisors)
--
-- 1. billing_touch_updated_at had a mutable search_path.
-- 2. billing_next_number is SECURITY DEFINER and MUTATES the invoice/job/ticket
--    counters. It was reachable by `anon` via /rest/v1/rpc. Revoked: only
--    service_role may call it (the app generates numbers server-side).
-- 3. billing_user_has_branch is SECURITY DEFINER and read-only, but is used
--    inside RLS policies, so `authenticated` must retain EXECUTE. `anon` must not.
-- ============================================================================

create or replace function public.billing_touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Number generation is a server-side concern only.
revoke execute on function public.billing_next_number(text, uuid, uuid) from public;
revoke execute on function public.billing_next_number(text, uuid, uuid) from anon;
revoke execute on function public.billing_next_number(text, uuid, uuid) from authenticated;
grant execute on function public.billing_next_number(text, uuid, uuid) to service_role;

-- Read-only branch check: needed by RLS for signed-in users, never for anon.
revoke execute on function public.billing_user_has_branch(uuid) from public;
revoke execute on function public.billing_user_has_branch(uuid) from anon;
grant execute on function public.billing_user_has_branch(uuid) to authenticated;
grant execute on function public.billing_user_has_branch(uuid) to service_role;
