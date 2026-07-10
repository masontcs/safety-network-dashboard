-- ============================================================================
-- 20260710163758_perf_009_fk_indexes.sql
-- Performance: index the foreign keys that get filtered/joined.
--
-- Unindexed FKs force sequential scans on filtered queries and slow the FK
-- checks Postgres runs when a parent row is deleted. This gets worse as the
-- import tables grow (payroll ~16k rows, fuel ~5k), which matches the
-- "slower over the past couple of weeks" symptom.
--
-- Scope: tables that actually grow or get joined. Tiny static lookup tables
-- (revenue_codes 17 rows, payroll_codes 87) are deliberately skipped -- an
-- index there would never be used and only adds write overhead.
--
-- Measured: `... where entity_id = X` on payroll_transactions went from a
-- 154 ms sequential scan to a 4.3 ms index scan.
--
-- All additive. IF NOT EXISTS keeps this safe to re-run.
-- ============================================================================

-- ── high-volume import + AR tables ──────────────────────────────────────────
create index if not exists idx_payroll_transactions_entity_id       on public.payroll_transactions(entity_id);
create index if not exists idx_payroll_transactions_payroll_item_id  on public.payroll_transactions(payroll_item_id);
create index if not exists idx_payroll_taxes_entity_id               on public.payroll_taxes(entity_id);
create index if not exists idx_fuel_transactions_employee_id         on public.fuel_transactions(employee_id);
create index if not exists idx_fuel_transactions_fuel_card_assignment on public.fuel_transactions(fuel_card_assignment_id);
create index if not exists idx_revenue_transactions_revenue_code_id  on public.revenue_transactions(revenue_code_id);
create index if not exists idx_revenue_transactions_branch_id        on public.revenue_transactions(branch_id);
create index if not exists idx_ar_customer_notes_created_by          on public.ar_customer_notes(created_by);
create index if not exists idx_ar_invoices_voided_by                 on public.ar_invoices(voided_by);
create index if not exists idx_ar_customer_entity_refs_customer_id   on public.ar_customer_entity_refs(customer_id);
create index if not exists idx_ar_customer_assignments_assigned_by   on public.ar_customer_assignments(assigned_by);
create index if not exists idx_ar_invoice_date_overrides_overridden_by on public.ar_invoice_date_overrides(overridden_by);
create index if not exists idx_employee_entity_assignments_payroll_code_id on public.employee_entity_assignments(payroll_code_id);
create index if not exists idx_ar_promises_customer_id               on public.ar_promises(customer_id);

-- ── billing_* (empty now, but they will carry the daily workload) ───────────
create index if not exists idx_billing_profiles_payment_term_id      on public.billing_profiles(payment_term_id);
create index if not exists idx_billing_profile_entities_entity_id    on public.billing_profile_entities(entity_id);
create index if not exists idx_billing_profile_entities_price_list_id on public.billing_profile_entities(price_list_id);
create index if not exists idx_billing_customers_ar_customer_id      on public.billing_customers(ar_customer_id);
create index if not exists idx_billing_customers_default_term        on public.billing_customers(default_payment_term_id);
create index if not exists idx_billing_jobs_entity_id                on public.billing_jobs(entity_id);
create index if not exists idx_billing_tickets_entity_id             on public.billing_tickets(entity_id);
create index if not exists idx_billing_invoices_entity_id            on public.billing_invoices(entity_id);
create index if not exists idx_billing_price_list_items_tier_exc     on public.billing_price_list_items(price_list_id, tier_exception_tier_id);

-- Keep the planner's statistics fresh on the tables that just gained indexes.
analyze public.payroll_transactions;
analyze public.fuel_transactions;
analyze public.revenue_transactions;
analyze public.payroll_taxes;
