-- billing_012_ticket_photos
-- Photo attachments for tickets. Files live in a PRIVATE storage bucket; this
-- table holds the metadata. All access is through the billing API using the
-- service role, so RLS is enabled with no policies (direct client access denied).

CREATE TABLE billing_ticket_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES billing_tickets(id) ON DELETE CASCADE,
  storage_path text NOT NULL UNIQUE,
  file_name text NOT NULL,
  content_type text,
  size_bytes integer,
  uploaded_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- FK index (avoids the seq-scan-on-delete trap from perf_009).
CREATE INDEX billing_ticket_photos_ticket_id_idx ON billing_ticket_photos(ticket_id);

ALTER TABLE billing_ticket_photos ENABLE ROW LEVEL SECURITY;
-- No policies: reads/writes go through the API (service role bypasses RLS).
-- SELECT / INSERT / UPDATE / DELETE intentionally denied to anon/authenticated.

-- Private bucket for the actual image files.
INSERT INTO storage.buckets (id, name, public)
VALUES ('ticket-photos', 'ticket-photos', false)
ON CONFLICT (id) DO NOTHING;
