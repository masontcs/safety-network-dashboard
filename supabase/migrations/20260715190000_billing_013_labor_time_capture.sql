-- billing_013_labor_time_capture
-- Labor layer 1: time capture. Techs record TIME SEGMENTS by activity type
-- (0700-1100 Transit); hours are always DERIVED, never typed. Billing (layer 2)
-- rolls these up into charge lines and is deliberately kept separate — adjusting
-- a bill must never mutate a tech's recorded time.
--
-- Times are plain `time` (no timezone), consistent with the rest of billing which
-- avoids zone math. end_time < start_time means the segment crossed midnight.

-- How time was spent. Global list — NOT an item category, purely descriptive.
CREATE TABLE billing_activity_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Field techs. Their own end of the system isn't built yet; for now admins enter
-- labor on their behalf. This data is disposable — tickets/jobs/techs get reset
-- before real launch.
CREATE TABLE billing_technicians (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- One worked segment. Duration is computed from start/end (+24h when wrapped).
CREATE TABLE billing_ticket_labor (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES billing_tickets(id) ON DELETE CASCADE,
  technician_id uuid NOT NULL REFERENCES billing_technicians(id) ON DELETE RESTRICT,
  activity_type_id uuid NOT NULL REFERENCES billing_activity_types(id) ON DELETE RESTRICT,
  start_time time NOT NULL,
  end_time time NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Equal times are ambiguous (zero-length or a full 24h?), so they're rejected.
  CONSTRAINT billing_ticket_labor_distinct_times_chk CHECK (start_time <> end_time)
);

-- FK indexes (avoids the seq-scan-on-delete trap from perf_009).
CREATE INDEX billing_ticket_labor_ticket_id_idx ON billing_ticket_labor(ticket_id);
CREATE INDEX billing_ticket_labor_technician_id_idx ON billing_ticket_labor(technician_id);
CREATE INDEX billing_ticket_labor_activity_type_id_idx ON billing_ticket_labor(activity_type_id);

ALTER TABLE billing_activity_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_technicians ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_ticket_labor ENABLE ROW LEVEL SECURITY;
-- No policies: access is via the billing API using the service role, which bypasses
-- RLS. SELECT/INSERT/UPDATE/DELETE intentionally denied to anon/authenticated.

INSERT INTO billing_activity_types (name, sort_order) VALUES
  ('Yard', 1), ('Transit', 2), ('Onsite', 3)
ON CONFLICT (name) DO NOTHING;

-- Disposable test crew so the model can be exercised before the tech app exists.
INSERT INTO billing_technicians (name) VALUES
  ('Test Tech A'), ('Test Tech B'), ('Test Tech C'), ('Test Tech D');
