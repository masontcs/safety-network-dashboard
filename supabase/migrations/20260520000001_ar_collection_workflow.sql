-- AR collection workflow fields
-- Adds: collection_phase + contact_frequency on ar_customers
--       communication_type + contact_name + outcome on ar_customer_notes

-- ── ar_customers additions ─────────────────────────────────────────────────────

-- collection_phase: who is responsible for this account right now
ALTER TABLE ar_customers
  ADD COLUMN IF NOT EXISTS collection_phase text NOT NULL DEFAULT 'collection_team'
  CHECK (collection_phase IN (
    'collection_team',  -- standard AR team handling
    'branch_manager',   -- escalated to branch manager
    'vp_high_level',    -- escalated to VP / executive
    'do_not_contact',   -- do not contact this customer
    'pending_write_off' -- motion to write off
  ));

-- contact_frequency: how often to reach out (nullable = not set)
ALTER TABLE ar_customers
  ADD COLUMN IF NOT EXISTS contact_frequency text NULL
  CHECK (contact_frequency IS NULL OR contact_frequency IN (
    'weekly',
    'bi_weekly',
    'monthly',
    'portal',         -- customer pays via portal
    'paid_when_paid', -- GC won't pay until they're paid
    'do_not_call'
  ));

-- ── ar_customer_notes additions ────────────────────────────────────────────────

-- communication_type: how the interaction happened
ALTER TABLE ar_customer_notes
  ADD COLUMN IF NOT EXISTS communication_type text NULL
  CHECK (communication_type IS NULL OR communication_type IN (
    'email',
    'phone_call',
    'text',
    'in_person',
    'portal'
  ));

-- contact_name: who at the customer was spoken with
ALTER TABLE ar_customer_notes
  ADD COLUMN IF NOT EXISTS contact_name text NULL;

-- outcome: result / tone of the interaction
ALTER TABLE ar_customer_notes
  ADD COLUMN IF NOT EXISTS outcome text NULL
  CHECK (outcome IS NULL OR outcome IN (
    'positive',
    'no_answer',
    'needs_follow_up',
    'roadblock',
    'promise_to_pay',
    'escalated',
    'unproductive'
  ));
