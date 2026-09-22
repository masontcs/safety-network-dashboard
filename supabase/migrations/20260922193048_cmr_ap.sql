-- CMR (SN Cash Ledger) · AP Phase 1 · QuickBooks A/P Aging Detail imports
--
-- A Controller uploads an account's QuickBooks A/P Aging Detail report (a fresh one each day)
-- and it REPLACES that account's AP snapshot: a new aging is the current truth, so an invoice
-- paid off since the last upload simply falls out.
--
--   • cmr_ap_imports — one row per account's CURRENT upload: which file, the report's own
--     TOTAL, the payable total, how many lines, who and when. is_current + a partial unique
--     index guarantee at most one current import per account.
--   • cmr_ap_lines   — every detail line of that upload, in signed integer cents (Bills
--     positive, Credits negative). ALL lines are kept so the import reconciles to the
--     report's TOTAL; only Bill and Credit lines are payable (General Journal, Bill Pmt -Check,
--     "AP ADJUSTMENT ACCOUNT" lines are stored for reconciliation only and never requestable).
--     The database enforces that rule itself (cmr_ap_lines_payable_chk).
--   • cmr_ap_replace_import(...) — the ONLY way a snapshot is written: in one transaction it
--     locks the account, refuses an unknown or inactive one, deletes the account's previous
--     current import (its lines go with it, ON DELETE CASCADE), and inserts the new import and
--     its lines. Two uploads for the same account at once serialise on the account lock, so
--     exactly one snapshot per account remains.
--
-- The previous import row is deleted rather than kept as history: the audit log
-- (action cmr.ap.import, written by the app for every commit) is the permanent record of each
-- upload and of the snapshot it replaced.
--
-- Nothing is seeded. AP Phase 2 adds cmr_vendor_request_invoices, which snapshots the invoices
-- a request was built from, so a later re-import cannot erase them.
--
-- Service-role only, exactly like every other cmr_* object: RLS on with NO policies, the
-- default anon/authenticated privileges revoked, and the function executable by service_role
-- alone. The app reads/writes server-side only, and every /api/cmr/ap route checks the caller's
-- cmr_access grant first.

-- ── 1. imports ──────────────────────────────────────────────────────────────
create table public.cmr_ap_imports (
  id                  uuid primary key default gen_random_uuid(),
  -- ON DELETE RESTRICT: an account is deactivated, never deleted, and its AP goes with it.
  account_id          uuid not null references public.cmr_accounts(id) on delete restrict,
  source_filename     text,
  report_total_cents  bigint,
  payable_total_cents bigint,
  line_count          int not null default 0,
  imported_by         uuid references public.user_profiles(id) on delete set null,
  imported_at         timestamptz not null default now(),
  is_current          boolean not null default true,
  constraint cmr_ap_imports_filename_len
    check (source_filename is null or char_length(source_filename) between 1 and 255),
  constraint cmr_ap_imports_line_count_chk
    check (line_count >= 0)
);

comment on table public.cmr_ap_imports is
  'SN Cash Ledger (CMR) AP: one row per account''s current QuickBooks A/P Aging Detail upload. Written only by cmr_ap_replace_import. Service-role only (RLS on, no policies).';
comment on column public.cmr_ap_imports.report_total_cents is
  'The report''s own TOTAL row, in cents. The import reconciles when the sum of all its lines equals this.';
comment on column public.cmr_ap_imports.payable_total_cents is
  'Sum of the Bill + Credit lines, in cents — what is actually owed through Cash Ledger. Computed by cmr_ap_replace_import from the lines, never taken from the caller.';
comment on column public.cmr_ap_imports.is_current is
  'The account''s current snapshot. At most one per account (cmr_ap_imports_one_current_idx).';

create unique index cmr_ap_imports_one_current_idx
  on public.cmr_ap_imports (account_id) where is_current;
create index cmr_ap_imports_account_idx on public.cmr_ap_imports (account_id);
-- foreign key (performance advisor: unindexed_foreign_keys)
create index cmr_ap_imports_imported_by_idx on public.cmr_ap_imports (imported_by);

alter table public.cmr_ap_imports enable row level security;
revoke all on table public.cmr_ap_imports from anon, authenticated;

-- ── 2. lines ────────────────────────────────────────────────────────────────
create table public.cmr_ap_lines (
  id                 uuid primary key default gen_random_uuid(),
  import_id          uuid not null references public.cmr_ap_imports(id) on delete cascade,
  -- Denormalised from the import so a vendor / account view needs no join.
  account_id         uuid not null references public.cmr_accounts(id) on delete restrict,
  vendor_name        text not null,
  invoice_num        text,
  doc_type           text not null,
  bill_date          date,
  due_date           date,
  aging_days         int,
  aging_bucket       text,
  open_balance_cents bigint not null,
  payable            boolean not null default false,
  created_at         timestamptz not null default now(),
  constraint cmr_ap_lines_vendor_len
    check (char_length(vendor_name) between 1 and 200),
  constraint cmr_ap_lines_invoice_len
    check (invoice_num is null or char_length(invoice_num) between 1 and 100),
  constraint cmr_ap_lines_doc_type_len
    check (char_length(doc_type) between 1 and 40),
  constraint cmr_ap_lines_bucket_len
    check (aging_bucket is null or char_length(aging_bucket) between 1 and 20),
  constraint cmr_ap_lines_balance_chk
    check (open_balance_cents between -99999999999 and 99999999999),
  -- Only a Bill or a Credit can ever be paid through Cash Ledger.
  constraint cmr_ap_lines_payable_chk
    check (payable = (doc_type in ('Bill', 'Credit')))
);

comment on table public.cmr_ap_lines is
  'SN Cash Ledger (CMR) AP: every detail line of an account''s current A/P Aging Detail import, in signed cents (Bills positive, Credits negative). Only Bill/Credit lines are payable. Service-role only (RLS on, no policies).';
comment on column public.cmr_ap_lines.payable is
  'True only for doc_type Bill or Credit (enforced by cmr_ap_lines_payable_chk). Other lines are kept so the import reconciles to the report TOTAL, and are never requestable.';
comment on column public.cmr_ap_lines.aging_bucket is
  'The report group the line sat under: Current, 1 - 30, 31 - 60, 61 - 90 or > 90.';

create index cmr_ap_lines_import_idx on public.cmr_ap_lines (import_id);
create index cmr_ap_lines_account_payable_idx on public.cmr_ap_lines (account_id, payable);
create index cmr_ap_lines_vendor_idx on public.cmr_ap_lines (vendor_name);

alter table public.cmr_ap_lines enable row level security;
revoke all on table public.cmr_ap_lines from anon, authenticated;

-- ── 3. replacing an account's snapshot (service role only) ─────────────────
-- p_lines is a JSON array of objects with the keys
--   vendor_name, invoice_num, doc_type, bill_date, due_date, aging_days, aging_bucket,
--   open_balance_cents
-- exactly as the app's parser produced them. payable is NOT taken from the caller: it is
-- derived here from doc_type, and payable_total_cents is summed here from the lines.
--
-- Refusals (raised as the exception message, which the app maps to a response):
--   NOT_FOUND  — no such account
--   INACTIVE   — the account is deactivated
--   BAD_LINES  — p_lines is not a JSON array
--
-- Returns the new import's id.
create function public.cmr_ap_replace_import(
  p_account_id         uuid,
  p_actor              uuid,
  p_source_filename    text,
  p_report_total_cents bigint,
  p_lines              jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_active    boolean;
  v_import_id uuid;
  v_count     int;
begin
  -- Lock the account: concurrent uploads for the same account run one after the other, and
  -- the account cannot be deactivated half-way through.
  select active into v_active
    from public.cmr_accounts
   where id = p_account_id
     for update;

  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if not v_active then
    raise exception 'INACTIVE' using errcode = 'P0001';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'BAD_LINES' using errcode = 'P0001';
  end if;

  v_count := jsonb_array_length(p_lines);

  -- The previous snapshot goes first (its lines cascade), so the partial unique index never
  -- sees two current imports for the account.
  delete from public.cmr_ap_imports
   where account_id = p_account_id
     and is_current;

  insert into public.cmr_ap_imports
    (account_id, source_filename, report_total_cents, payable_total_cents, line_count,
     imported_by, is_current)
  values
    (p_account_id, nullif(btrim(p_source_filename), ''), p_report_total_cents, 0, v_count,
     p_actor, true)
  returning id into v_import_id;

  insert into public.cmr_ap_lines
    (import_id, account_id, vendor_name, invoice_num, doc_type, bill_date, due_date,
     aging_days, aging_bucket, open_balance_cents, payable)
  select v_import_id, p_account_id, l.vendor_name, l.invoice_num, l.doc_type, l.bill_date,
         l.due_date, l.aging_days, l.aging_bucket, l.open_balance_cents,
         l.doc_type in ('Bill', 'Credit')
    from jsonb_to_recordset(p_lines) as l(
           vendor_name        text,
           invoice_num        text,
           doc_type           text,
           bill_date          date,
           due_date           date,
           aging_days         int,
           aging_bucket       text,
           open_balance_cents bigint
         );

  update public.cmr_ap_imports
     set payable_total_cents = coalesce((
           select sum(open_balance_cents)
             from public.cmr_ap_lines
            where import_id = v_import_id
              and payable
         ), 0)
   where id = v_import_id;

  return v_import_id;
end;
$$;

comment on function public.cmr_ap_replace_import(uuid, uuid, text, bigint, jsonb) is
  'SN Cash Ledger AP: replace an account''s A/P snapshot in one transaction — lock the account, refuse an unknown (NOT_FOUND) or inactive (INACTIVE) one, delete its current import (lines cascade), insert the new current import and its lines, derive payable from doc_type and sum the payable total. Returns the new cmr_ap_imports id. Service-role only.';

revoke all on function public.cmr_ap_replace_import(uuid, uuid, text, bigint, jsonb) from public, anon, authenticated;
grant execute on function public.cmr_ap_replace_import(uuid, uuid, text, bigint, jsonb) to service_role;
