-- ============================================================================
-- 20260709223326_security_006_harden_preexisting.sql
-- Safety Network — Migration 006: Close pre-existing security advisories
--
-- These predate the billing module. Verified against the app before changing:
--   * audit_logs, payroll_staged_transactions, payroll_staged_taxes are ONLY
--     ever accessed via createServiceClient() (service_role bypasses RLS).
--     They had RLS enabled with ZERO policies -> fail-closed, which is correct,
--     but implicit. We make it EXPLICIT with deny-all policies so the intent is
--     readable and the linter is satisfied. No data is opened by this.
--   * current_user_role() is SECURITY DEFINER and was executable by `anon` over
--     /rest/v1/rpc. No client calls it as an RPC (grepped). Revoked from anon.
--     `authenticated` must retain EXECUTE because RLS policies call it.
--   * merge_ar_customer and payroll_group_breakdown had mutable search_path.
--     ALTER FUNCTION ... SET search_path avoids touching their bodies.
--
-- NOT fixable in SQL: "Leaked Password Protection Disabled" is a project Auth
-- setting (Dashboard -> Authentication -> Sign In / Providers -> Password).
-- ============================================================================

-- ---------------------------------------------- service-role-only tables
-- RLS is on and no policy grants access, so authenticated/anon already get
-- nothing. These policies state that explicitly rather than relying on absence.
create policy service_role_only on public.audit_logs
  for all to authenticated using (false) with check (false);

create policy service_role_only on public.payroll_staged_transactions
  for all to authenticated using (false) with check (false);

create policy service_role_only on public.payroll_staged_taxes
  for all to authenticated using (false) with check (false);

comment on table public.audit_logs is
  'Service-role only. Written by lib/audit/log.ts and read by /api/admin/audit, both via createServiceClient(). RLS denies authenticated/anon by policy.';
comment on table public.payroll_staged_transactions is
  'Service-role only staging table for payroll imports. RLS denies authenticated/anon by policy.';
comment on table public.payroll_staged_taxes is
  'Service-role only staging table for payroll imports. RLS denies authenticated/anon by policy.';

-- ------------------------------------------------------- SECURITY DEFINER
-- Read-only role lookup used inside RLS policies. Signed-in users need it;
-- anonymous callers must never reach it over the public REST API.
revoke execute on function public.current_user_role() from public;
revoke execute on function public.current_user_role() from anon;
grant execute on function public.current_user_role() to authenticated;
grant execute on function public.current_user_role() to service_role;

-- ---------------------------------------------------- mutable search_path
alter function public.merge_ar_customer(p_target uuid, p_source uuid) set search_path = public;
alter function public.payroll_group_breakdown(p_start date, p_end date) set search_path = public;
