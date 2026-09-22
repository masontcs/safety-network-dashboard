-- CMR (SN Cash Ledger) · AP Phase 2 · vendor requests built from A/P invoices
--
-- A Requester no longer types a vendor and an amount. They pick an account, a vendor from that
-- account's CURRENT A/P snapshot (cmr_ap_lines), and tick the invoices to pay. Credits are their
-- own tickable lines with a negative balance. The request's amount is
--   Σ(selected bills) − Σ(selected credits)
-- computed HERE from the stored lines — never from anything the caller sends.
--
--   • cmr_vendor_request_invoices — the invoices a request was built from, SNAPSHOTTED at submit
--     time: vendor, number, type, dates and signed open balance are copied, so tomorrow's A/P
--     re-import (which deletes and re-inserts every line) cannot erase what the request was built
--     from. ap_line_id points at the source line while it exists and goes NULL when a re-import
--     removes it (ON DELETE SET NULL). The snapshot is the source of truth for the amount.
--   • cmr_compose_vendor_request(...) — the ONLY way those rows are written. In one transaction
--     it locks the account (FOR SHARE — so a concurrent cmr_ap_replace_import, which takes
--     FOR UPDATE, waits and the lines can't change underneath), refuses an unknown or inactive
--     account, keeps only lines that are in that account's CURRENT import, payable (Bill /
--     Credit) and belong to the named vendor — refusing the whole call if ANY submitted id isn't
--     — sums them, then inserts the request (or, when editing a still-queued one, updates it and
--     replaces its snapshot) and snapshots every matched line.
--
-- cmr_vendor_requests is NOT altered: it already has account_id (not null, → cmr_accounts),
-- vendor and amount_cents; this function simply fills them from the selected invoices. Its
-- amount check (0 … 99,999,999,999) stays, so a selection whose credits cancel or exceed its
-- bills is refused here (NOT_POSITIVE) rather than stored as a negative payment.
--
-- Placing, declining and undoing a placement are unchanged (cmr_place_request_* /
-- cmr_unplace_request). Withdrawing a request deletes it and its snapshot rows cascade.
--
-- Service-role only, exactly like every other cmr_* object: RLS on with NO policies, the
-- default anon/authenticated privileges revoked, and the function executable by service_role
-- alone. The app calls it server-side only, after /api/cmr/requests has checked the caller's
-- cmr_access grant (guardCmrCanRequest) and the own-request rule. Nothing is seeded.

-- ── 1. the snapshot ─────────────────────────────────────────────────────────
create table public.cmr_vendor_request_invoices (
  id                 uuid primary key default gen_random_uuid(),
  request_id         uuid not null references public.cmr_vendor_requests(id) on delete cascade,
  -- The source A/P line while it still exists; NULL once a re-import has replaced it.
  ap_line_id         uuid references public.cmr_ap_lines(id) on delete set null,
  vendor_name        text not null,
  invoice_num        text,
  doc_type           text not null,
  bill_date          date,
  due_date           date,
  -- Signed, as QuickBooks reports it: Bills positive, Credits negative.
  open_balance_cents bigint not null,
  created_at         timestamptz not null default now(),
  constraint cmr_vendor_request_invoices_vendor_len
    check (char_length(vendor_name) between 1 and 200),
  constraint cmr_vendor_request_invoices_invoice_len
    check (invoice_num is null or char_length(invoice_num) between 1 and 100),
  -- Only payable lines can be requested.
  constraint cmr_vendor_request_invoices_doc_type_chk
    check (doc_type in ('Bill', 'Credit')),
  constraint cmr_vendor_request_invoices_balance_chk
    check (open_balance_cents between -99999999999 and 99999999999)
);

comment on table public.cmr_vendor_request_invoices is
  'SN Cash Ledger (CMR) AP Phase 2: the A/P invoices a vendor request was built from, copied at submit time so a later A/P re-import cannot erase them. The request''s amount_cents is the sum of these rows. Written only by cmr_compose_vendor_request. Service-role only (RLS on, no policies).';
comment on column public.cmr_vendor_request_invoices.ap_line_id is
  'The cmr_ap_lines row this was copied from, while it exists. Set NULL when a re-import replaces the account''s A/P snapshot; the copied fields remain the record.';
comment on column public.cmr_vendor_request_invoices.open_balance_cents is
  'Signed open balance at submit time, in cents: Bills positive, Credits negative.';

create index cmr_vendor_request_invoices_request_idx on public.cmr_vendor_request_invoices (request_id);
create index cmr_vendor_request_invoices_ap_line_idx on public.cmr_vendor_request_invoices (ap_line_id);

alter table public.cmr_vendor_request_invoices enable row level security;
revoke all on table public.cmr_vendor_request_invoices from anon, authenticated;

-- ── 2. composing a request from A/P lines (service role only) ──────────────
-- p_request_id  NULL → submit a new request (requested_by = p_actor, status queued).
--               set  → re-compose that request: it must still be queued; its account, vendor,
--                      amount, due date and notes are replaced and its snapshot rows are
--                      replaced by the new selection.
-- p_owner       NULL for a Controller. For a Requester it is their own id, and an edit of a
--               request someone else submitted is refused (FORBIDDEN) — the app checks this
--               first; this re-checks it with the request row locked.
-- p_vendor_name the vendor EXACTLY as the A/P lines carry it (QuickBooks spelling, spaces and
--               all) — the lines are matched on it.
-- p_vendor      the request's display vendor (the same name, whitespace-squashed and at most
--               80 characters, which is the cmr_vendor_requests.vendor limit).
-- p_ap_line_ids the ticked cmr_ap_lines ids. Amounts are never taken from the caller.
--
-- Refusals (raised as the exception message; the app maps each to a response):
--   NOT_FOUND     — no such account, or (editing) no such request
--   INACTIVE      — the account is deactivated
--   NO_LINES      — no invoice ids were given
--   STALE_LINES   — at least one id is not a payable line of this vendor in the account's
--                   CURRENT import (paid off / re-imported / another vendor or account)
--   NOT_POSITIVE  — the selected credits equal or exceed the selected bills
--   TOO_LARGE     — the total exceeds the request amount limit
--   NOT_QUEUED    — (editing) the request was already placed or declined
--   FORBIDDEN     — (editing) a Requester's edit of someone else's request
--
-- Returns the request id.
create function public.cmr_compose_vendor_request(
  p_request_id  uuid,
  p_actor       uuid,
  p_owner       uuid,
  p_account_id  uuid,
  p_vendor_name text,
  p_vendor      text,
  p_ap_line_ids uuid[],
  p_due_date    date,
  p_notes       text
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_active    boolean;
  v_wanted    int;
  v_found     int;
  v_total     bigint;
  v_id        uuid;
  v_status    text;
  v_requester uuid;
begin
  -- FOR SHARE: a concurrent A/P re-import of this account (FOR UPDATE) waits until we commit,
  -- so the lines we read and copy below are the current ones for the whole transaction.
  select active into v_active
    from public.cmr_accounts
   where id = p_account_id
     for share;

  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if not v_active then
    raise exception 'INACTIVE' using errcode = 'P0001';
  end if;

  -- Editing: the request must still be queued (and a Requester's own) — checked with its row
  -- locked, before anything about the selection, so a request placed a moment ago says so.
  if p_request_id is not null then
    select status, requested_by into v_status, v_requester
      from public.cmr_vendor_requests
     where id = p_request_id
       for update;
    if not found then
      raise exception 'NOT_FOUND' using errcode = 'P0002';
    end if;
    if v_status <> 'queued' then
      raise exception 'NOT_QUEUED' using errcode = 'P0001';
    end if;
    if p_owner is not null and v_requester <> p_owner then
      raise exception 'FORBIDDEN' using errcode = 'P0001';
    end if;
  end if;

  select count(distinct x) into v_wanted
    from unnest(coalesce(p_ap_line_ids, '{}'::uuid[])) as x
   where x is not null;
  if v_wanted = 0 then
    raise exception 'NO_LINES' using errcode = 'P0001';
  end if;

  select count(*), coalesce(sum(l.open_balance_cents), 0)
    into v_found, v_total
    from public.cmr_ap_lines l
    join public.cmr_ap_imports i on i.id = l.import_id and i.is_current
   where l.id = any(p_ap_line_ids)
     and l.account_id = p_account_id
     and i.account_id = p_account_id
     and l.vendor_name = p_vendor_name
     and l.payable;

  if v_found <> v_wanted then
    raise exception 'STALE_LINES' using errcode = 'P0001';
  end if;
  if v_total <= 0 then
    raise exception 'NOT_POSITIVE' using errcode = 'P0001';
  end if;
  if v_total > 99999999999 then
    raise exception 'TOO_LARGE' using errcode = 'P0001';
  end if;

  if p_request_id is null then
    insert into public.cmr_vendor_requests
      (requested_by, account_id, vendor, amount_cents, due_date, notes, status)
    values
      (p_actor, p_account_id, p_vendor, v_total, p_due_date, p_notes, 'queued')
    returning id into v_id;
  else
    update public.cmr_vendor_requests
       set account_id   = p_account_id,
           vendor       = p_vendor,
           amount_cents = v_total,
           due_date     = p_due_date,
           notes        = p_notes
     where id = p_request_id;

    delete from public.cmr_vendor_request_invoices
     where request_id = p_request_id;

    v_id := p_request_id;
  end if;

  insert into public.cmr_vendor_request_invoices
    (request_id, ap_line_id, vendor_name, invoice_num, doc_type, bill_date, due_date,
     open_balance_cents)
  select v_id, l.id, l.vendor_name, l.invoice_num, l.doc_type, l.bill_date, l.due_date,
         l.open_balance_cents
    from public.cmr_ap_lines l
   where l.id = any(p_ap_line_ids)
     and l.account_id = p_account_id
     and l.vendor_name = p_vendor_name
     and l.payable;

  return v_id;
end;
$$;

comment on function public.cmr_compose_vendor_request(uuid, uuid, uuid, uuid, text, text, uuid[], date, text) is
  'SN Cash Ledger AP Phase 2: submit (p_request_id NULL) or re-compose (a still-queued request) a vendor request from ticked A/P lines, in one transaction — lock the account FOR SHARE, refuse an unknown (NOT_FOUND) or inactive (INACTIVE) account, refuse NO_LINES / STALE_LINES (any id not a payable line of that vendor in the account''s current import) / NOT_POSITIVE / TOO_LARGE, and for an edit NOT_FOUND / NOT_QUEUED / FORBIDDEN (p_owner set and not the submitter); amount_cents = the sum of the lines; snapshot every line into cmr_vendor_request_invoices. Returns the request id. Service-role only.';

revoke all on function public.cmr_compose_vendor_request(uuid, uuid, uuid, uuid, text, text, uuid[], date, text) from public, anon, authenticated;
grant execute on function public.cmr_compose_vendor_request(uuid, uuid, uuid, uuid, text, text, uuid[], date, text) to service_role;
