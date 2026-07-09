-- ============================================================================
-- 20260709000004_billing_004_invoices_and_accounting.sql
-- TCR Billing v2 — Migration 004: Invoices, invoice lines, accounting queue
--
-- An invoice is scoped to a SINGLE job (never spans jobs).
-- Invoice number = [entity letter][7-digit zero-padded seq][branch code],
-- sequence continuous and independent per (entity, branch): I0000001BK.
--
-- Tax applies ONLY to sales lines. Lost/stolen bills at item COST and is NOT
-- taxed. The rental minimum ($25 default) applies per invoice, and only when
-- the invoice actually has rentals.
--
-- Invoices are NOT hard-frozen: adjustments are GOVERNED. Any change opens a
-- tracked item in billing_accounting_queue so accounting can update QuickBooks.
-- ============================================================================

create type billing_invoice_status as enum ('draft','issued','void');
create type billing_invoice_line_kind as enum ('rental','sale','lost','labor','lump_sum','misc','adjustment');
create type billing_queue_status as enum ('needs_update','updated');

-- Generic per-entity (optionally per-branch) number generator.
-- Concurrency-safe: the UPDATE takes a row lock before returning the sequence.
create or replace function public.billing_next_number(
  p_kind text,
  p_entity uuid,
  p_branch uuid default null
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_letter char(1);
  v_code   char(2) := '';
  v_seq    bigint;
begin
  select letter into v_letter from public.billing_entity_settings where entity_id = p_entity;
  if v_letter is null then
    raise exception 'No billing_entity_settings row (letter) for entity %', p_entity;
  end if;

  if p_branch is not null then
    select code into v_code from public.billing_branch_settings where branch_id = p_branch;
    if v_code is null then
      raise exception 'No billing_branch_settings row (code) for branch %', p_branch;
    end if;
  end if;

  update public.billing_counters
     set next_seq = next_seq + 1
   where kind = p_kind
     and entity_id = p_entity
     and branch_id is not distinct from p_branch
  returning next_seq - 1 into v_seq;

  if v_seq is null then
    insert into public.billing_counters (kind, entity_id, branch_id, next_seq)
    values (p_kind, p_entity, p_branch, 2);
    v_seq := 1;
  end if;

  return v_letter || lpad(v_seq::text, 7, '0') || v_code;
end;
$$;

-- ---------------------------------------------------------------- invoices
create table public.billing_invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_number text not null unique,
  job_id uuid not null references public.billing_jobs(id),      -- one job, always
  profile_id uuid not null references public.billing_profiles(id),
  entity_id uuid not null references public.entities(id),
  branch_id uuid not null references public.branches(id),

  through_date date not null,
  invoice_date date not null default current_date,
  status billing_invoice_status not null default 'draft',

  -- The jurisdiction rate actually applied, stored for audit (never recomputed).
  tax_rate_pct numeric(6,4) not null default 0,

  rental_subtotal_cents integer not null default 0,
  sales_subtotal_cents integer not null default 0,
  other_subtotal_cents integer not null default 0,
  rental_minimum_adjustment_cents integer not null default 0 check (rental_minimum_adjustment_cents >= 0),
  subtotal_cents integer not null default 0,
  taxable_base_cents integer not null default 0,   -- sales only
  tax_cents integer not null default 0,
  total_cents integer not null default 0,

  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index billing_invoices_job_idx on public.billing_invoices(job_id);
create index billing_invoices_profile_idx on public.billing_invoices(profile_id);
create index billing_invoices_branch_idx on public.billing_invoices(branch_id);

create table public.billing_invoice_lines (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.billing_invoices(id) on delete cascade,
  ticket_id uuid references public.billing_tickets(id),
  kind billing_invoice_line_kind not null,
  item_id uuid references public.billing_items(id),
  variation_id uuid references public.billing_item_variations(id),
  description text not null,

  -- Per-batch presentation: which pickup lot this line came from.
  lot_date date,

  qty numeric(12,2) not null default 1,
  units integer not null default 1 check (units >= 0),
  unit_rate_cents integer not null check (unit_rate_cents >= 0),
  amount_cents integer not null,

  -- Tax applies ONLY to sales lines.
  taxable boolean not null default false,
  constraint billing_invoice_lines_only_sales_taxable check (taxable = (kind = 'sale')),

  created_at timestamptz not null default now()
);
create index billing_invoice_lines_invoice_idx on public.billing_invoice_lines(invoice_id);
create index billing_invoice_lines_ticket_idx on public.billing_invoice_lines(ticket_id);

-- ------------------------------------------------------- accounting queue
-- A confirmed cascade re-rates the affected invoices AND creates one tracked
-- task per affected invoice, because QuickBooks cannot detect the diff itself.
create table public.billing_accounting_queue (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.billing_invoices(id) on delete cascade,
  reason text not null,
  status billing_queue_status not null default 'needs_update',
  waived boolean not null default false,       -- "this invoice only, do not change"
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  resolved_by uuid references auth.users(id),
  resolved_at timestamptz
);
create index billing_accounting_queue_status_idx on public.billing_accounting_queue(status) where status = 'needs_update';
create index billing_accounting_queue_invoice_idx on public.billing_accounting_queue(invoice_id);

create trigger billing_invoices_touch before update on public.billing_invoices
  for each row execute function public.billing_touch_updated_at();

-- --------------------------------------------------------------------- RLS
alter table public.billing_invoices          enable row level security;
alter table public.billing_invoice_lines     enable row level security;
alter table public.billing_accounting_queue  enable row level security;

create policy branch_scoped_all on public.billing_invoices for all to authenticated
  using (public.billing_user_has_branch(branch_id))
  with check (public.billing_user_has_branch(branch_id));

create policy branch_scoped_all on public.billing_invoice_lines for all to authenticated
  using (exists (select 1 from public.billing_invoices i where i.id = invoice_id and public.billing_user_has_branch(i.branch_id)))
  with check (exists (select 1 from public.billing_invoices i where i.id = invoice_id and public.billing_user_has_branch(i.branch_id)));

-- Accounting needs to see the whole queue regardless of branch; billers see theirs.
create policy authenticated_read on public.billing_accounting_queue for select to authenticated using (true);
create policy branch_scoped_write on public.billing_accounting_queue for all to authenticated
  using (exists (select 1 from public.billing_invoices i where i.id = invoice_id and public.billing_user_has_branch(i.branch_id)))
  with check (exists (select 1 from public.billing_invoices i where i.id = invoice_id and public.billing_user_has_branch(i.branch_id)));
