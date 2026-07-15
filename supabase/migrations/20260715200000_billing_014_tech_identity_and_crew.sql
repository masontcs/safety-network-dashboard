-- billing_014_tech_identity_and_crew
-- Phase 0 of the tech app: give technicians a login, assign crew (and a lead) to a
-- ticket, and record who typed a labor entry.

-- A technician can exist as a name before they have a login, so user_id is nullable.
-- One login = one technician.
ALTER TABLE billing_technicians ADD COLUMN user_id uuid UNIQUE;
COMMENT ON COLUMN billing_technicians.user_id IS
  'The tech''s auth user (user_profiles.id / auth.users.id). Null until they are given a login.';

-- Crew on a ticket. The LEAD is just the crew member with is_lead set — assigned per
-- TICKET (not per job) so it can change day to day as crews shuffle. The lead is
-- accountable for the whole crew's time being in and is the only one who can submit.
CREATE TABLE billing_ticket_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES billing_tickets(id) ON DELETE CASCADE,
  technician_id uuid NOT NULL REFERENCES billing_technicians(id) ON DELETE RESTRICT,
  is_lead boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ticket_id, technician_id)
);

-- At most one lead per ticket.
CREATE UNIQUE INDEX billing_ticket_assignments_one_lead_idx
  ON billing_ticket_assignments(ticket_id) WHERE is_lead;

-- FK indexes (avoids the seq-scan-on-delete trap from perf_009).
CREATE INDEX billing_ticket_assignments_ticket_id_idx ON billing_ticket_assignments(ticket_id);
CREATE INDEX billing_ticket_assignments_technician_id_idx ON billing_ticket_assignments(technician_id);

ALTER TABLE billing_ticket_assignments ENABLE ROW LEVEL SECURITY;
-- No policies: access is via the API using the service role, which bypasses RLS.

-- Audit trail for "the lead entered time on behalf of a tech whose phone died".
-- The HOURS belong to technician_id (that is what gets billed and paid); entered_by
-- only records who typed them. Null = entered by the tech themselves / legacy rows.
ALTER TABLE billing_ticket_labor ADD COLUMN entered_by uuid;
COMMENT ON COLUMN billing_ticket_labor.entered_by IS
  'Auth user who typed this entry (lead tech or office admin). The hours still belong to technician_id.';
