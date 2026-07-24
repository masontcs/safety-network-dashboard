-- billing_027_customer_portal
--
-- Customer portal foundation. Portal users are EXTERNAL Supabase auth users with NO
-- user_profiles row (so the staff middleware + billing/dashboard layout gates already
-- reject them from every internal interface). They reach ONLY /portal/*, which is gated
-- at the layout level and reads through the service client scoped strictly to their own
-- customer's opted-in profiles. RLS below is defense-in-depth, not the primary gate.
--
-- Also closes a pre-existing hole: billing_quotes / billing_quote_lines shipped in 026
-- with RLS OFF. Enable it with the same branch-scoped staff policy the rest of billing uses.

-- ── Opt-in per profile ──────────────────────────────────────────────────────
-- Which billing profiles are visible in the portal. Off by default: nothing is exposed
-- until an admin explicitly turns a profile on.
ALTER TABLE billing_profiles
  ADD COLUMN IF NOT EXISTS portal_enabled boolean NOT NULL DEFAULT false;

-- ── Portal accounts ─────────────────────────────────────────────────────────
-- One row per external person who can sign in. Belongs to a customer; auth_user_id is
-- null until they first authenticate (magic link), then linked by matching email.
-- 'owner' can later invite/manage members (built in a follow-up); 'member' is view-first.
CREATE TABLE billing_portal_accounts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id  uuid NOT NULL REFERENCES billing_customers(id) ON DELETE CASCADE,
  auth_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  email        text NOT NULL,
  name         text,
  role         text NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  is_active    boolean NOT NULL DEFAULT true,
  invited_by   uuid,                       -- staff user_profiles.id who provisioned this
  last_login_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (customer_id, email)
);
-- Email is matched case-insensitively at login; enforce uniqueness that way too.
CREATE UNIQUE INDEX billing_portal_accounts_email_lower_idx
  ON billing_portal_accounts (customer_id, lower(email));
CREATE INDEX billing_portal_accounts_auth_user_idx ON billing_portal_accounts (auth_user_id);
CREATE INDEX billing_portal_accounts_customer_idx  ON billing_portal_accounts (customer_id);

COMMENT ON TABLE billing_portal_accounts IS
  'External customer-portal logins. No user_profiles row; can only reach /portal/*.';

-- RLS: a portal user may read only their OWN account row via the anon client. Everything
-- else the portal shows is fetched with the service client, scoped in app code. Service
-- role bypasses RLS, so these policies never block the app itself.
ALTER TABLE billing_portal_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY portal_account_self_read ON billing_portal_accounts
  FOR SELECT USING (auth_user_id = auth.uid());

-- ── Close the 026 quotes RLS gap ────────────────────────────────────────────
ALTER TABLE billing_quotes ENABLE ROW LEVEL SECURITY;
CREATE POLICY branch_scoped_all ON billing_quotes
  FOR ALL USING (billing_user_has_branch(branch_id))
  WITH CHECK (billing_user_has_branch(branch_id));

-- Quote lines carry no branch of their own; scope them through their parent quote.
ALTER TABLE billing_quote_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY branch_scoped_all ON billing_quote_lines
  FOR ALL USING (
    EXISTS (SELECT 1 FROM billing_quotes q
            WHERE q.id = billing_quote_lines.quote_id
              AND billing_user_has_branch(q.branch_id))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM billing_quotes q
            WHERE q.id = billing_quote_lines.quote_id
              AND billing_user_has_branch(q.branch_id))
  );
