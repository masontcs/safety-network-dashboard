-- Prospect quotes: bid a company that isn't a customer yet. A quote is now EITHER for an
-- existing billing profile (profile_id) OR a prospect (prospect_company). A prospect quote
-- prices against a chosen price list + tier (no profile config to read), and on "won" it
-- creates a real customer + profile, recorded here for traceability.
alter table billing_quotes
  alter column profile_id drop not null,
  add column if not exists prospect_company text,
  add column if not exists prospect_contact_name text,
  add column if not exists prospect_contact_email text,
  add column if not exists prospect_contact_phone text,
  add column if not exists prospect_price_list_id uuid references billing_price_lists(id),
  add column if not exists prospect_tier_id uuid references billing_price_list_tiers(id),
  add column if not exists converted_customer_id uuid references billing_customers(id),
  add column if not exists converted_profile_id uuid references billing_profiles(id);

alter table billing_quotes
  drop constraint if exists billing_quotes_profile_or_prospect;
alter table billing_quotes
  add constraint billing_quotes_profile_or_prospect
  check (profile_id is not null or prospect_company is not null);

comment on column billing_quotes.prospect_company is 'Set for a prospect (not-yet-customer) quote; mutually sufficient with profile_id via the profile_or_prospect check.';
