-- billing_018_void_tickets
-- Voiding a ticket: a reversible flag that removes the ticket (and everything on it —
-- equipment ledger, labor, charges) from ALL downstream counting. A voided ticket is not
-- billable, its equipment is not on rent, and it drops out of dashboard/dispatch/tech
-- totals. Voiding is reversible (un-void) — that's why this is a flag, not a terminal
-- status. Prior status is preserved so restoring puts the ticket right back where it was.
--
-- Invoice integrity is protected in the API, not here: a ticket that already has lines on
-- a non-void invoice cannot be voided until that invoice is voided first.

alter table public.billing_tickets
  add column if not exists is_voided boolean not null default false,
  add column if not exists voided_at timestamptz,
  add column if not exists voided_by uuid;

-- Fast "hide the voided ones" filters on the hot list/lookup paths.
create index if not exists billing_tickets_is_voided_idx
  on public.billing_tickets (is_voided)
  where is_voided = true;
