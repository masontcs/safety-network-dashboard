-- CMR (SN Cash Ledger) · Phase 2 · cmr_recurring_vendors
--
-- The remembered schedule of recurring payments, grouped into three sections:
--   weekly  · monthly  · urgent (Urgent Payment Plans — the only section with plan terms / due date)
--
--   • Money is integer cents. amount_cents is the usual payment; last_amount_sent_cents is what
--     actually went out last time (null until the Controller records one).
--   • No hard delete. Later phases (daily ledger, the "due" suggestion engine) reference these
--     rows, so a vendor is retired with active = false and can be reactivated.
--   • on_hold is separate from active: an active vendor that is on hold is still a real vendor,
--     just paused — the Phase 7 suggestion engine will skip it.
--   • plan_terms / plan_due_date are only allowed when section = 'urgent' (enforced here AND in
--     the API, which clears them when a vendor moves out of Urgent).
--   • sort_order is the position WITHIN a section. Reordering goes through
--     cmr_reorder_recurring_vendors() so a section's order is written in one statement.
--   • account_id → cmr_accounts ON DELETE RESTRICT (accounts are never deleted either).
--
-- Service-role only, exactly like cmr_access / cmr_accounts: RLS on with NO policies, and the
-- default anon/authenticated privileges revoked. The app reads/writes it server-side only, and
-- every /api/cmr/recurring route checks the caller's cmr_access grant first.

create table public.cmr_recurring_vendors (
  id                     uuid primary key default gen_random_uuid(),
  account_id             uuid not null references public.cmr_accounts(id) on delete restrict,
  vendor_name            text not null,
  amount_cents           bigint not null default 0,
  section                text not null,
  recurrence_detail      text,
  last_amount_sent_cents bigint,
  plan_terms             text,
  plan_due_date          date,
  notes                  text,
  on_hold                boolean not null default false,
  active                 boolean not null default true,
  sort_order             int not null default 0,
  created_by             uuid references public.user_profiles(id) on delete set null,
  created_at             timestamptz not null default now(),
  constraint cmr_recurring_vendors_section_chk
    check (section in ('weekly', 'monthly', 'urgent')),
  constraint cmr_recurring_vendors_name_len
    check (char_length(btrim(vendor_name)) between 1 and 80),
  -- $0.00 … $999,999,999.99
  constraint cmr_recurring_vendors_amount_chk
    check (amount_cents between 0 and 99999999999),
  constraint cmr_recurring_vendors_last_sent_chk
    check (last_amount_sent_cents is null or last_amount_sent_cents between 0 and 99999999999),
  constraint cmr_recurring_vendors_recurrence_len
    check (recurrence_detail is null or char_length(btrim(recurrence_detail)) between 1 and 80),
  constraint cmr_recurring_vendors_plan_terms_len
    check (plan_terms is null or char_length(btrim(plan_terms)) between 1 and 200),
  constraint cmr_recurring_vendors_notes_len
    check (notes is null or char_length(btrim(notes)) between 1 and 500),
  constraint cmr_recurring_vendors_plan_urgent_only
    check (section = 'urgent' or (plan_terms is null and plan_due_date is null))
);

comment on table public.cmr_recurring_vendors is
  'SN Cash Ledger (CMR) recurring vendors (weekly / monthly / urgent payment plans). Controller-managed; retire with active=false, never delete. Service-role only (RLS on, no policies).';

-- List order: section, then position within it.
create index cmr_recurring_vendors_section_idx on public.cmr_recurring_vendors (section, sort_order);

-- Cover the foreign keys (performance advisor: unindexed_foreign_keys).
create index cmr_recurring_vendors_account_idx on public.cmr_recurring_vendors (account_id);
create index cmr_recurring_vendors_created_by_idx on public.cmr_recurring_vendors (created_by);

alter table public.cmr_recurring_vendors enable row level security;
revoke all on table public.cmr_recurring_vendors from anon, authenticated;

-- Atomic reorder of ONE section: p_ids is every vendor id in that section (inactive included)
-- in its new order; each row gets sort_order = its 0-based position. The API checks that p_ids
-- is exactly the section's current set.
create function public.cmr_reorder_recurring_vendors(p_ids uuid[])
returns void
language sql
security invoker
set search_path = ''
as $$
  update public.cmr_recurring_vendors as v
     set sort_order = (o.ord - 1)::int
    from unnest(p_ids) with ordinality as o(id, ord)
   where v.id = o.id
     and v.sort_order is distinct from (o.ord - 1)::int;
$$;

comment on function public.cmr_reorder_recurring_vendors(uuid[]) is
  'SN Cash Ledger: rewrite cmr_recurring_vendors.sort_order for one section from an ordered id list in one statement. Service-role only.';

revoke all on function public.cmr_reorder_recurring_vendors(uuid[]) from public, anon, authenticated;
grant execute on function public.cmr_reorder_recurring_vendors(uuid[]) to service_role;
