-- CMR (SN Cash Ledger) · Phase 0 · cmr_access
--
-- Who may open the Cash Ledger at all. Access is EXPLICIT-GRANT ONLY: a user with no row here
-- cannot reach any /cmr page or /api/cmr route — platform admins included (no role inheritance
-- from user_profiles.role). Enforced in the app by lib/api/cmr.ts getCmrContext + middleware.
--
--   controller → full read/write; manages access
--   requester  → read everything; may only submit vendor requests (later phase)
--   viewer     → read-only
--
-- Service-role only, like every billing_* table: RLS on with NO policies, so anon/authenticated
-- get nothing through PostgREST. The app reads/writes it server-side with the service client.

create table public.cmr_access (
  user_id    uuid primary key references public.user_profiles(id) on delete cascade,
  role       text not null check (role in ('controller', 'requester', 'viewer')),
  created_by uuid references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table public.cmr_access is
  'SN Cash Ledger (CMR) access grants. Explicit grant only — no admin inheritance. Service-role only (RLS on, no policies).';

-- Covers the created_by foreign key (performance advisor: unindexed_foreign_keys).
create index cmr_access_created_by_idx on public.cmr_access (created_by);

alter table public.cmr_access enable row level security;

-- Belt and braces: RLS with no policies already denies anon/authenticated; also drop the
-- default table privileges so the table is not even selectable by those roles.
revoke all on table public.cmr_access from anon, authenticated;

-- Seed: Mason Doty (the sole platform admin) as the first Controller. Jordan / Russ are
-- granted later from the Access screen.
insert into public.cmr_access (user_id, role, created_by)
values ('8556367e-4010-45cc-b91d-f6f5fdf3e9cf', 'controller', '8556367e-4010-45cc-b91d-f6f5fdf3e9cf')
on conflict (user_id) do nothing;
