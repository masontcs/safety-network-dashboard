-- billing_026_quotes
--
-- Quotes (bids). A quote is built off a price list for a PROFILE, sent to the customer,
-- and — once won — converted into a job + first ticket (the convert flow lands next).
-- Kept deliberately close to the invoice shape so the two read the same.

CREATE TYPE billing_quote_status AS ENUM ('draft', 'sent', 'won', 'lost');

CREATE TABLE billing_quotes (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_number     text NOT NULL,
  profile_id       uuid NOT NULL REFERENCES billing_profiles(id),
  entity_id        uuid NOT NULL REFERENCES entities(id),
  branch_id        uuid NOT NULL REFERENCES branches(id),
  status           billing_quote_status NOT NULL DEFAULT 'draft',
  quote_date       date NOT NULL DEFAULT CURRENT_DATE,
  job_name         text,
  notes            text,
  tax_rate_pct     numeric NOT NULL DEFAULT 0,
  subtotal_cents   integer NOT NULL DEFAULT 0,
  tax_cents        integer NOT NULL DEFAULT 0,
  total_cents      integer NOT NULL DEFAULT 0,
  converted_job_id uuid REFERENCES billing_jobs(id),
  created_by       uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX billing_quotes_profile_idx ON billing_quotes (profile_id);
CREATE INDEX billing_quotes_branch_idx  ON billing_quotes (branch_id);

CREATE TABLE billing_quote_lines (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id        uuid NOT NULL REFERENCES billing_quotes(id) ON DELETE CASCADE,
  kind            text NOT NULL DEFAULT 'equipment',
  item_id         uuid REFERENCES billing_items(id),
  variation_id    uuid REFERENCES billing_item_variations(id),
  description     text NOT NULL DEFAULT '',
  billing_type    billing_type,
  qty             numeric NOT NULL DEFAULT 1,
  units           integer NOT NULL DEFAULT 1,
  unit_rate_cents integer NOT NULL DEFAULT 0,
  amount_cents    integer NOT NULL DEFAULT 0,
  taxable         boolean NOT NULL DEFAULT false,
  sort_order      integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX billing_quote_lines_quote_idx ON billing_quote_lines (quote_id);

COMMENT ON TABLE billing_quotes IS 'Bids built off a price list; convert a won quote to a job + first ticket.';
