-- Western Highways (WH) · Phase 1 · QuickBooks ONLINE A/R + A/P Aging Detail snapshots
--
-- WH ("Western Highways Traffic Truck Products") is a separate QuickBooks Online company. Its
-- exports look nothing like the QuickBooks Desktop files the Safety Network parsers were built
-- for, so WH gets its own parsers (lib/wh/ar-import.ts, lib/wh/ap-import.ts) and — the point of
-- this migration — its own tables. WH is NEVER folded into the SN entity dimension and never
-- appears in an SN view: no SN table is touched here.
--
-- The model mirrors CMR A/P's daily-replace snapshot, one snapshot PER REPORT rather than per
-- account (WH is a single company):
--
--   • wh_ar_imports / wh_ap_imports — one row per report's CURRENT upload: the report's own
--     "as of" date, which file, the report's TOTAL, the receivable/payable total, whether it
--     reconciled, how many lines, who and when. is_current + a partial unique index guarantee
--     at most ONE current import per report.
--   • wh_ar_lines / wh_ap_lines — every detail line of that upload, in signed integer cents.
--     ALL lines are kept so the import reconciles to the report's TOTAL; only the normal open
--     items are flagged (A/R: Invoice + Credit Memo; A/P: Bill + Vendor Credit). The A/R
--     Check and the A/P Journal Entries / Bill Payment are stored for reconciliation only.
--     The database enforces those rules itself, as cmr_ap_lines does.
--   • wh_ar_replace_import / wh_ap_replace_import — the ONLY way a snapshot is written: in one
--     transaction, take a transaction-scoped advisory lock (WH has no parent row to lock, so
--     the lock is what serialises two simultaneous uploads of the same report), delete the
--     current import (its lines go with it, ON DELETE CASCADE), insert the new import and its
--     lines, then derive the flags and sum the totals HERE rather than trusting the caller.
--
-- The previous import row is deleted rather than kept as history: the audit log (actions
-- wh.ar.import / wh.ap.import, written by the app for every commit) is the permanent record of
-- each upload and of the snapshot it replaced.
--
-- Nothing is seeded. Payroll and revenue are later WH phases and are not created here.
--
-- Service-role only, exactly like every billing_* and cmr_* object: RLS on with NO policies,
-- the default anon/authenticated privileges revoked, and the functions executable by
-- service_role alone. The app reads and writes server-side only, and every /wh page and
-- /api/wh/* route resolves access first (lib/wh/access.ts — admin or executive, mirroring how
-- the SN dashboards gate, with no new inheritance and no new grant table).

-- ── 1. shared helpers ───────────────────────────────────────────────────────
--
-- WH's A/R and A/P are overwhelmingly INTERCOMPANY — the counterparties are the other Safety
-- Network entities, so "owed to / by WH" is mostly internal paper rather than outside money.
-- Every line carries a flag computed by this one rule, and the check constraints below hold
-- the stored value to it, so an outside-vs-internal figure in a view can never drift from the
-- names it came from. Mirrors isIntercompanyName in lib/wh/qbo.ts.
create function public.wh_is_intercompany(p_name text)
returns boolean
language sql
immutable
parallel safe
security invoker
set search_path = ''
as $$
  select coalesce(p_name, '') ~* 'safety[[:space:]]+network';
$$;

comment on function public.wh_is_intercompany(text) is
  'Western Highways: true when a counterparty name contains "Safety Network" (any case, any run of whitespace) — i.e. the line is an intercompany transfer, not outside exposure. Immutable, so wh_ar_lines / wh_ap_lines can enforce their is_intercompany column with a check constraint. Mirrors isIntercompanyName in lib/wh/qbo.ts.';

revoke all on function public.wh_is_intercompany(text) from public, anon, authenticated;
grant execute on function public.wh_is_intercompany(text) to service_role;

-- ── 2. A/R imports ──────────────────────────────────────────────────────────
create table public.wh_ar_imports (
  id                      uuid primary key default gen_random_uuid(),
  -- The report's own "As of" date, read from its title block. Nullable: a future export
  -- without one would still import, dated by the app.
  report_as_of            date,
  source_filename         text,
  report_total_cents      bigint,
  receivable_total_cents  bigint not null default 0,
  line_count              int not null default 0,
  reconciled              boolean not null default false,
  imported_by             uuid references public.user_profiles(id) on delete set null,
  imported_at             timestamptz not null default now(),
  is_current              boolean not null default true,
  constraint wh_ar_imports_filename_len
    check (source_filename is null or char_length(source_filename) between 1 and 255),
  constraint wh_ar_imports_line_count_chk
    check (line_count >= 0)
);

comment on table public.wh_ar_imports is
  'Western Highways: the CURRENT QuickBooks Online A/R Aging Detail upload. At most one row is current (wh_ar_imports_one_current_idx). Written only by wh_ar_replace_import. Service-role only (RLS on, no policies).';
comment on column public.wh_ar_imports.report_total_cents is
  'The report''s own TOTAL row open balance, in cents. The import reconciles when the sum of all its lines equals this.';
comment on column public.wh_ar_imports.receivable_total_cents is
  'Sum of the Invoice + Credit Memo lines, in cents — the normal open receivable. Computed by wh_ar_replace_import from the lines, never taken from the caller.';
comment on column public.wh_ar_imports.reconciled is
  'Sum of every line''s open balance equals report_total_cents. Computed by wh_ar_replace_import; false means the file was not read faithfully and the figures should not be trusted.';

-- One current A/R snapshot, full stop: the index key is a constant, so a second current row
-- cannot exist no matter who inserts it.
create unique index wh_ar_imports_one_current_idx
  on public.wh_ar_imports ((true)) where is_current;
-- foreign key (performance advisor: unindexed_foreign_keys)
create index wh_ar_imports_imported_by_idx on public.wh_ar_imports (imported_by);

alter table public.wh_ar_imports enable row level security;
revoke all on table public.wh_ar_imports from anon, authenticated;

-- ── 3. A/R lines ────────────────────────────────────────────────────────────
create table public.wh_ar_lines (
  id                 uuid primary key default gen_random_uuid(),
  import_id          uuid not null references public.wh_ar_imports(id) on delete cascade,
  txn_date           date,
  txn_type           text not null,
  num                text,
  -- The customer name exactly as QuickBooks spells it, embedded code and all, so a view groups
  -- the way the report reads and a re-import matches. customer_code is that code pulled out.
  customer_name      text not null,
  customer_code      text,
  location           text,
  due_date           date,
  aging_bucket       text,
  amount_cents       bigint,
  open_balance_cents bigint not null,
  receivable         boolean not null default false,
  is_intercompany    boolean not null default false,
  created_at         timestamptz not null default now(),
  constraint wh_ar_lines_customer_len
    check (char_length(customer_name) between 1 and 200),
  constraint wh_ar_lines_code_len
    check (customer_code is null or char_length(customer_code) between 1 and 40),
  constraint wh_ar_lines_num_len
    check (num is null or char_length(num) between 1 and 100),
  constraint wh_ar_lines_type_len
    check (char_length(txn_type) between 1 and 40),
  constraint wh_ar_lines_location_len
    check (location is null or char_length(location) between 1 and 120),
  constraint wh_ar_lines_bucket_chk
    check (aging_bucket is null or aging_bucket in ('Current', '1-30', '31-60', '61-90', '>90')),
  constraint wh_ar_lines_balance_chk
    check (open_balance_cents between -99999999999 and 99999999999),
  constraint wh_ar_lines_amount_chk
    check (amount_cents is null or amount_cents between -99999999999 and 99999999999),
  -- Only an Invoice or a Credit Memo is a normal open receivable.
  constraint wh_ar_lines_receivable_chk
    check (receivable = (txn_type in ('Invoice', 'Credit Memo'))),
  -- The stored flag must equal the rule it claims to apply.
  constraint wh_ar_lines_intercompany_chk
    check (is_intercompany = public.wh_is_intercompany(customer_name))
);

comment on table public.wh_ar_lines is
  'Western Highways: every detail line of the current A/R Aging Detail import, in signed cents (invoices positive, credit memos negative). Non-receivable lines (e.g. an unapplied Check) are kept so the import reconciles to the report TOTAL. Service-role only (RLS on, no policies).';
comment on column public.wh_ar_lines.receivable is
  'True only for txn_type Invoice or Credit Memo (enforced by wh_ar_lines_receivable_chk).';
comment on column public.wh_ar_lines.is_intercompany is
  'The customer is another Safety Network entity — internal paper, not outside exposure (enforced by wh_ar_lines_intercompany_chk against wh_is_intercompany).';
comment on column public.wh_ar_lines.aging_bucket is
  'The report group the line sat under: Current, 1-30, 31-60, 61-90 or >90.';

create index wh_ar_lines_import_idx on public.wh_ar_lines (import_id);
create index wh_ar_lines_customer_idx on public.wh_ar_lines (customer_name);
create index wh_ar_lines_import_bucket_idx on public.wh_ar_lines (import_id, aging_bucket);
create index wh_ar_lines_import_intercompany_idx on public.wh_ar_lines (import_id, is_intercompany);
create index wh_ar_lines_import_location_idx on public.wh_ar_lines (import_id, location);

alter table public.wh_ar_lines enable row level security;
revoke all on table public.wh_ar_lines from anon, authenticated;

-- ── 4. A/P imports ──────────────────────────────────────────────────────────
create table public.wh_ap_imports (
  id                   uuid primary key default gen_random_uuid(),
  -- The A/P export carries NO title block, so the app derives this from the data (due date +
  -- past-due days, which every past-due line agrees on) and the uploader confirms it.
  report_as_of         date,
  source_filename      text,
  report_total_cents   bigint,
  payable_total_cents  bigint not null default 0,
  line_count           int not null default 0,
  reconciled           boolean not null default false,
  imported_by          uuid references public.user_profiles(id) on delete set null,
  imported_at          timestamptz not null default now(),
  is_current           boolean not null default true,
  constraint wh_ap_imports_filename_len
    check (source_filename is null or char_length(source_filename) between 1 and 255),
  constraint wh_ap_imports_line_count_chk
    check (line_count >= 0)
);

comment on table public.wh_ap_imports is
  'Western Highways: the CURRENT QuickBooks Online A/P Aging Detail upload. At most one row is current (wh_ap_imports_one_current_idx). Written only by wh_ap_replace_import. Service-role only (RLS on, no policies).';
comment on column public.wh_ap_imports.report_as_of is
  'The report''s as-of day. The QBO A/P export has no title block, so the app derives it as due date + past-due days (unanimous across every past-due line) and the uploader confirms or overrides it before committing.';
comment on column public.wh_ap_imports.payable_total_cents is
  'Sum of the Bill + Vendor Credit lines, in cents — what WH actually owes. Computed by wh_ap_replace_import from the lines, never taken from the caller.';

create unique index wh_ap_imports_one_current_idx
  on public.wh_ap_imports ((true)) where is_current;
create index wh_ap_imports_imported_by_idx on public.wh_ap_imports (imported_by);

alter table public.wh_ap_imports enable row level security;
revoke all on table public.wh_ap_imports from anon, authenticated;

-- ── 5. A/P lines ────────────────────────────────────────────────────────────
create table public.wh_ap_lines (
  id                 uuid primary key default gen_random_uuid(),
  import_id          uuid not null references public.wh_ap_imports(id) on delete cascade,
  txn_date           date,
  txn_type           text not null,
  num                text,
  vendor_name        text not null,
  vendor_code        text,
  location           text,
  due_date           date,
  -- QuickBooks' own "Past due" column, the one the A/R report does not have. Negative when the
  -- bill is not due yet, which is why it is a plain int rather than a non-negative one.
  past_due_days      int,
  aging_bucket       text,
  amount_cents       bigint,
  open_balance_cents bigint not null,
  payable            boolean not null default false,
  is_intercompany    boolean not null default false,
  created_at         timestamptz not null default now(),
  constraint wh_ap_lines_vendor_len
    check (char_length(vendor_name) between 1 and 200),
  constraint wh_ap_lines_code_len
    check (vendor_code is null or char_length(vendor_code) between 1 and 40),
  constraint wh_ap_lines_num_len
    check (num is null or char_length(num) between 1 and 100),
  constraint wh_ap_lines_type_len
    check (char_length(txn_type) between 1 and 40),
  constraint wh_ap_lines_location_len
    check (location is null or char_length(location) between 1 and 120),
  constraint wh_ap_lines_past_due_chk
    check (past_due_days is null or past_due_days between -36500 and 36500),
  constraint wh_ap_lines_bucket_chk
    check (aging_bucket is null or aging_bucket in ('Current', '1-30', '31-60', '61-90', '>90')),
  constraint wh_ap_lines_balance_chk
    check (open_balance_cents between -99999999999 and 99999999999),
  constraint wh_ap_lines_amount_chk
    check (amount_cents is null or amount_cents between -99999999999 and 99999999999),
  -- Only a Bill or a Vendor Credit is something WH actually owes.
  constraint wh_ap_lines_payable_chk
    check (payable = (txn_type in ('Bill', 'Vendor Credit'))),
  constraint wh_ap_lines_intercompany_chk
    check (is_intercompany = public.wh_is_intercompany(vendor_name))
);

comment on table public.wh_ap_lines is
  'Western Highways: every detail line of the current A/P Aging Detail import, in signed cents (bills positive, vendor credits and reversing entries negative). Journal Entry / Bill Payment lines are kept so the import reconciles to the report TOTAL and are never payable. Service-role only (RLS on, no policies).';
comment on column public.wh_ap_lines.payable is
  'True only for txn_type Bill or Vendor Credit (enforced by wh_ap_lines_payable_chk).';
comment on column public.wh_ap_lines.is_intercompany is
  'The vendor is another Safety Network entity — internal paper, not outside exposure (enforced by wh_ap_lines_intercompany_chk against wh_is_intercompany).';

create index wh_ap_lines_import_idx on public.wh_ap_lines (import_id);
create index wh_ap_lines_vendor_idx on public.wh_ap_lines (vendor_name);
create index wh_ap_lines_import_bucket_idx on public.wh_ap_lines (import_id, aging_bucket);
create index wh_ap_lines_import_intercompany_idx on public.wh_ap_lines (import_id, is_intercompany);
create index wh_ap_lines_import_location_idx on public.wh_ap_lines (import_id, location);
create index wh_ap_lines_import_payable_idx on public.wh_ap_lines (import_id, payable);

alter table public.wh_ap_lines enable row level security;
revoke all on table public.wh_ap_lines from anon, authenticated;

-- ── 6. replacing the A/R snapshot (service role only) ───────────────────────
-- p_lines is a JSON array of objects with the keys
--   txn_date, txn_type, num, customer_name, customer_code, location, due_date, aging_bucket,
--   amount_cents, open_balance_cents
-- exactly as lib/wh/ar-import.ts produced them. receivable and is_intercompany are NOT taken
-- from the caller: they are derived here, and receivable_total_cents / reconciled are computed
-- here from the rows that actually landed.
--
-- Race safety: WH has no parent row to lock, so the function takes a transaction-scoped
-- advisory lock. Two simultaneous uploads of the A/R report therefore run one after the other
-- and exactly one snapshot remains; the A/P function uses a different key, so an A/R and an
-- A/P upload never block each other.
--
-- Refusals (raised as the exception message, which the app maps to a response):
--   BAD_LINES — p_lines is not a JSON array
--   NO_LINES  — the array is empty (an import that stores nothing would silently wipe the
--               current snapshot)
--
-- Returns the new import's id.
create function public.wh_ar_replace_import(
  p_actor              uuid,
  p_source_filename    text,
  p_report_as_of       date,
  p_report_total_cents bigint,
  p_lines              jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_import_id uuid;
  v_count     int;
  v_sum       bigint;
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'BAD_LINES' using errcode = 'P0001';
  end if;

  v_count := jsonb_array_length(p_lines);
  if v_count = 0 then
    raise exception 'NO_LINES' using errcode = 'P0001';
  end if;

  -- Serialise concurrent A/R uploads (see the note above).
  perform pg_advisory_xact_lock(hashtext('wh_ar_replace_import'));

  -- The previous snapshot goes first (its lines cascade), so the partial unique index never
  -- sees two current imports.
  delete from public.wh_ar_imports where is_current;

  insert into public.wh_ar_imports
    (report_as_of, source_filename, report_total_cents, receivable_total_cents, line_count,
     reconciled, imported_by, is_current)
  values
    (p_report_as_of, nullif(btrim(p_source_filename), ''), p_report_total_cents, 0, v_count,
     false, p_actor, true)
  returning id into v_import_id;

  insert into public.wh_ar_lines
    (import_id, txn_date, txn_type, num, customer_name, customer_code, location, due_date,
     aging_bucket, amount_cents, open_balance_cents, receivable, is_intercompany)
  select v_import_id, l.txn_date, l.txn_type, l.num, l.customer_name, l.customer_code,
         l.location, l.due_date, l.aging_bucket, l.amount_cents, l.open_balance_cents,
         l.txn_type in ('Invoice', 'Credit Memo'),
         public.wh_is_intercompany(l.customer_name)
    from jsonb_to_recordset(p_lines) as l(
           txn_date           date,
           txn_type           text,
           num                text,
           customer_name      text,
           customer_code      text,
           location           text,
           due_date           date,
           aging_bucket       text,
           amount_cents       bigint,
           open_balance_cents bigint
         );

  select coalesce(sum(open_balance_cents), 0) into v_sum
    from public.wh_ar_lines
   where import_id = v_import_id;

  update public.wh_ar_imports
     set receivable_total_cents = coalesce((
           select sum(open_balance_cents)
             from public.wh_ar_lines
            where import_id = v_import_id
              and receivable
         ), 0),
         reconciled = (p_report_total_cents is not null and v_sum = p_report_total_cents)
   where id = v_import_id;

  return v_import_id;
end;
$$;

comment on function public.wh_ar_replace_import(uuid, text, date, bigint, jsonb) is
  'Western Highways: replace the A/R Aging Detail snapshot in one transaction — take the A/R advisory lock, refuse a non-array (BAD_LINES) or empty (NO_LINES) payload, delete the current import (lines cascade), insert the new current import and its lines, derive receivable and is_intercompany from the data, then sum the receivable total and set reconciled. Returns the new wh_ar_imports id. Service-role only.';

revoke all on function public.wh_ar_replace_import(uuid, text, date, bigint, jsonb) from public, anon, authenticated;
grant execute on function public.wh_ar_replace_import(uuid, text, date, bigint, jsonb) to service_role;

-- ── 7. replacing the A/P snapshot (service role only) ───────────────────────
-- Same contract as the A/R function, with the A/P report's extra past_due_days column and
-- Bill / Vendor Credit as the payable rule. Its advisory lock key differs, so A/R and A/P
-- uploads never wait on one another.
create function public.wh_ap_replace_import(
  p_actor              uuid,
  p_source_filename    text,
  p_report_as_of       date,
  p_report_total_cents bigint,
  p_lines              jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_import_id uuid;
  v_count     int;
  v_sum       bigint;
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'BAD_LINES' using errcode = 'P0001';
  end if;

  v_count := jsonb_array_length(p_lines);
  if v_count = 0 then
    raise exception 'NO_LINES' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtext('wh_ap_replace_import'));

  delete from public.wh_ap_imports where is_current;

  insert into public.wh_ap_imports
    (report_as_of, source_filename, report_total_cents, payable_total_cents, line_count,
     reconciled, imported_by, is_current)
  values
    (p_report_as_of, nullif(btrim(p_source_filename), ''), p_report_total_cents, 0, v_count,
     false, p_actor, true)
  returning id into v_import_id;

  insert into public.wh_ap_lines
    (import_id, txn_date, txn_type, num, vendor_name, vendor_code, location, due_date,
     past_due_days, aging_bucket, amount_cents, open_balance_cents, payable, is_intercompany)
  select v_import_id, l.txn_date, l.txn_type, l.num, l.vendor_name, l.vendor_code,
         l.location, l.due_date, l.past_due_days, l.aging_bucket, l.amount_cents,
         l.open_balance_cents,
         l.txn_type in ('Bill', 'Vendor Credit'),
         public.wh_is_intercompany(l.vendor_name)
    from jsonb_to_recordset(p_lines) as l(
           txn_date           date,
           txn_type           text,
           num                text,
           vendor_name        text,
           vendor_code        text,
           location           text,
           due_date           date,
           past_due_days      int,
           aging_bucket       text,
           amount_cents       bigint,
           open_balance_cents bigint
         );

  select coalesce(sum(open_balance_cents), 0) into v_sum
    from public.wh_ap_lines
   where import_id = v_import_id;

  update public.wh_ap_imports
     set payable_total_cents = coalesce((
           select sum(open_balance_cents)
             from public.wh_ap_lines
            where import_id = v_import_id
              and payable
         ), 0),
         reconciled = (p_report_total_cents is not null and v_sum = p_report_total_cents)
   where id = v_import_id;

  return v_import_id;
end;
$$;

comment on function public.wh_ap_replace_import(uuid, text, date, bigint, jsonb) is
  'Western Highways: replace the A/P Aging Detail snapshot in one transaction — take the A/P advisory lock, refuse a non-array (BAD_LINES) or empty (NO_LINES) payload, delete the current import (lines cascade), insert the new current import and its lines, derive payable and is_intercompany from the data, then sum the payable total and set reconciled. Returns the new wh_ap_imports id. Service-role only.';

revoke all on function public.wh_ap_replace_import(uuid, text, date, bigint, jsonb) from public, anon, authenticated;
grant execute on function public.wh_ap_replace_import(uuid, text, date, bigint, jsonb) to service_role;
