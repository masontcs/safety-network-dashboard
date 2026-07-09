-- ============================================================================
-- 20260709000003_billing_003_jobs_tickets_ledger.sql
-- TCR Billing v2 — Migration 003: Jobs, tickets, the quantity ledger, accruals
--
-- Hierarchy: Customer -> Billing Profile -> [Entity] -> Job -> Ticket.
-- Jobs attach to a BILLING PROFILE (customer is derived).
--
-- billing_ticket_ledger is the per-job quantity ledger: pickup (+), return (-),
-- lost (-). Rental charges are DERIVED from it, never stored on the ticket.
--
-- billing_rental_accruals is the ongoing-rental ledger. It is keyed by
-- PICKUP LOT (lot_date), not by batch, because a batch's identity contains its
-- end date and therefore changes the moment the batch closes -- a batch-keyed
-- ledger would forget what it had billed and re-charge the whole rental.
-- It stores cumulative qty-units ever billed, which makes billing runs
-- idempotent and makes retroactive edits detectable (cumulative < billed).
-- ============================================================================

create type billing_job_status    as enum ('new','in_progress','on_hold','completed','closed');
create type billing_ticket_status as enum ('active','in_review','final_edit','invoiced');
create type billing_ledger_event  as enum ('pickup','return','lost');
create type billing_line_kind     as enum ('sale','lost','labor','lump_sum','misc');

-- Per-entity (and, for invoices, per-branch) sequence generators.
create table public.billing_counters (
  kind text not null,                       -- 'job' | 'ticket' | 'invoice' | 'bid'
  entity_id uuid not null references public.entities(id),
  branch_id uuid references public.branches(id),
  next_seq bigint not null default 1 check (next_seq >= 1)
);
create unique index billing_counters_key
  on public.billing_counters (kind, entity_id, coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- -------------------------------------------------------------------- jobs
create table public.billing_jobs (
  id uuid primary key default gen_random_uuid(),
  job_number text not null unique,
  profile_id uuid not null references public.billing_profiles(id),
  entity_id uuid not null references public.entities(id),
  branch_id uuid not null references public.branches(id),
  name text,
  status billing_job_status not null default 'new',

  -- Certified? must be answered before a job can be created.
  certified boolean not null,
  dir_number text,
  cert_payroll_contact text,
  contract_number text,
  pay_classification text,
  constraint billing_jobs_certified_fields check (
    not certified or (dir_number is not null and contract_number is not null and pay_classification is not null)
  ),

  -- location + tax
  address text, cross_streets text, city text, county text, state text, zip text,
  tax_exempt boolean not null default false,

  -- completion rules
  require_signature boolean not null default false,
  enable_second_signature boolean not null default false,
  ticket_labor_minimum_minutes integer check (ticket_labor_minimum_minutes >= 0),

  po_number text,
  notes text,
  date_opened date not null default current_date,
  date_completed date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index billing_jobs_profile_idx on public.billing_jobs(profile_id);
create index billing_jobs_branch_idx on public.billing_jobs(branch_id);
create index billing_jobs_status_idx on public.billing_jobs(status);

-- ----------------------------------------------------------------- tickets
-- Feature-based, not type-based. DTC is exclusive: a one-day charge that does
-- NOT start an ongoing rental. Flipping DTC -> Add starts the rental from the
-- ORIGINAL DTC date (that day is day 1).
create table public.billing_tickets (
  id uuid primary key default gen_random_uuid(),
  ticket_number text not null unique,
  job_id uuid not null references public.billing_jobs(id) on delete cascade,
  entity_id uuid not null references public.entities(id),   -- regenerates on cross-entity transfer
  ticket_date date not null,
  status billing_ticket_status not null default 'active',

  feature_add boolean not null default false,
  feature_return boolean not null default false,
  feature_dtc boolean not null default false,
  constraint billing_tickets_dtc_exclusive check (not feature_dtc or (not feature_add and not feature_return)),

  -- chosen by the biller BEFORE final edit; selects the rate cell
  billing_type billing_type,
  recurring boolean not null default false,   -- equipment still out; drives at-a-glance reporting

  final_edited_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index billing_tickets_job_idx on public.billing_tickets(job_id);
create index billing_tickets_status_idx on public.billing_tickets(status);
create index billing_tickets_recurring_idx on public.billing_tickets(recurring) where recurring;

-- ------------------------------------------------------- quantity ledger
create table public.billing_ticket_ledger (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.billing_tickets(id) on delete cascade,
  job_id uuid not null references public.billing_jobs(id) on delete cascade,
  item_id uuid not null references public.billing_items(id),
  variation_id uuid references public.billing_item_variations(id),
  event_type billing_ledger_event not null,
  event_date date not null,
  qty integer not null check (qty > 0),   -- sign lives in event_type
  equipment_id text,                      -- required for tracked items
  created_at timestamptz not null default now()
);
create index billing_ticket_ledger_ticket_idx on public.billing_ticket_ledger(ticket_id);
create index billing_ticket_ledger_job_item_idx on public.billing_ticket_ledger(job_id, item_id, event_date);

-- ------------------------------------------------- ongoing-rental accruals
-- lot_date IS the pickup date = the stable LotKey. qty_units_billed is
-- cumulative qty x periods ever invoiced for that lot.
create table public.billing_rental_accruals (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.billing_tickets(id) on delete cascade,
  item_id uuid not null references public.billing_items(id),
  variation_id uuid references public.billing_item_variations(id),
  lot_date date not null,
  qty_units_billed integer not null default 0 check (qty_units_billed >= 0),
  updated_at timestamptz not null default now(),
  constraint billing_rental_accruals_lot unique nulls not distinct (ticket_id, item_id, variation_id, lot_date)
);
create index billing_rental_accruals_ticket_idx on public.billing_rental_accruals(ticket_id);

-- --------------------------------------------- non-rental ticket lines
-- Rentals are derived from the ledger; sales/lost/labor/lump-sum/misc are entered.
create table public.billing_ticket_lines (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.billing_tickets(id) on delete cascade,
  kind billing_line_kind not null,
  item_id uuid references public.billing_items(id),
  variation_id uuid references public.billing_item_variations(id),
  description text not null,
  qty numeric(12,2) not null default 1 check (qty > 0),
  units integer not null default 1 check (units >= 0),
  unit_rate_cents integer not null check (unit_rate_cents >= 0),
  amount_cents integer not null check (amount_cents >= 0),
  -- Tax applies ONLY to sales lines. Never rentals, labor, or lost/stolen.
  taxable boolean not null default false,
  constraint billing_ticket_lines_only_sales_taxable check (taxable = (kind = 'sale')),
  created_at timestamptz not null default now()
);
create index billing_ticket_lines_ticket_idx on public.billing_ticket_lines(ticket_id);

create trigger billing_jobs_touch before update on public.billing_jobs
  for each row execute function public.billing_touch_updated_at();
create trigger billing_tickets_touch before update on public.billing_tickets
  for each row execute function public.billing_touch_updated_at();
create trigger billing_rental_accruals_touch before update on public.billing_rental_accruals
  for each row execute function public.billing_touch_updated_at();

-- --------------------------------------------------------------------- RLS
alter table public.billing_counters          enable row level security;
alter table public.billing_jobs              enable row level security;
alter table public.billing_tickets           enable row level security;
alter table public.billing_ticket_ledger     enable row level security;
alter table public.billing_rental_accruals   enable row level security;
alter table public.billing_ticket_lines      enable row level security;

create policy authenticated_read on public.billing_counters for select to authenticated using (true);
create policy admin_write on public.billing_counters for all to authenticated using (current_user_role() = 'admin') with check (current_user_role() = 'admin');

create policy branch_scoped_all on public.billing_jobs for all to authenticated
  using (public.billing_user_has_branch(branch_id))
  with check (public.billing_user_has_branch(branch_id));

create policy branch_scoped_all on public.billing_tickets for all to authenticated
  using (exists (select 1 from public.billing_jobs j where j.id = job_id and public.billing_user_has_branch(j.branch_id)))
  with check (exists (select 1 from public.billing_jobs j where j.id = job_id and public.billing_user_has_branch(j.branch_id)));

create policy branch_scoped_all on public.billing_ticket_ledger for all to authenticated
  using (exists (select 1 from public.billing_jobs j where j.id = job_id and public.billing_user_has_branch(j.branch_id)))
  with check (exists (select 1 from public.billing_jobs j where j.id = job_id and public.billing_user_has_branch(j.branch_id)));

create policy branch_scoped_all on public.billing_rental_accruals for all to authenticated
  using (exists (select 1 from public.billing_tickets t join public.billing_jobs j on j.id = t.job_id
                 where t.id = ticket_id and public.billing_user_has_branch(j.branch_id)))
  with check (exists (select 1 from public.billing_tickets t join public.billing_jobs j on j.id = t.job_id
                 where t.id = ticket_id and public.billing_user_has_branch(j.branch_id)));

create policy branch_scoped_all on public.billing_ticket_lines for all to authenticated
  using (exists (select 1 from public.billing_tickets t join public.billing_jobs j on j.id = t.job_id
                 where t.id = ticket_id and public.billing_user_has_branch(j.branch_id)))
  with check (exists (select 1 from public.billing_tickets t join public.billing_jobs j on j.id = t.job_id
                 where t.id = ticket_id and public.billing_user_has_branch(j.branch_id)));
