-- Security advisor rls_disabled_in_public: this table was created without RLS, leaving it
-- reachable via the public anon key. The app only reads/writes it server-side with the service
-- role (which bypasses RLS), so enabling RLS with no policy denies anon/authenticated while the
-- app is unaffected — matching every other billing_* table.
alter table public.billing_house_account_config enable row level security;
