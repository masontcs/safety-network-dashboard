-- Audit log table: immutable record of user actions in the system.
-- All reads/writes go through the service role (API routes only).
-- No RLS policies are defined, so anon/authenticated clients cannot
-- read or write this table directly.

CREATE TABLE IF NOT EXISTS audit_logs (
  id                uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id           uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  user_display_name text        NOT NULL,
  user_role         text        NOT NULL,
  action            text        NOT NULL,
  resource_type     text,
  resource_id       text,
  resource_label    text,
  metadata          jsonb       NOT NULL DEFAULT '{}',
  ip_address        text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_logs_created_at_idx  ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_user_id_idx     ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS audit_logs_action_idx      ON audit_logs(action);
CREATE INDEX IF NOT EXISTS audit_logs_resource_idx    ON audit_logs(resource_type, resource_id);

-- Enable RLS — no policies defined means service-role-only access
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
