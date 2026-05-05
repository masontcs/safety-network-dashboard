-- Reference / Config Tables
-- businesses, entities, branches, payroll config, revenue codes

CREATE TABLE businesses (
  id                 uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  name               text        NOT NULL,
  code               text        NOT NULL UNIQUE,
  is_active          boolean     NOT NULL DEFAULT true,
  hq_allocation_pct  numeric(6,4) NOT NULL DEFAULT 0
);

CREATE TABLE entities (
  id    uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name  text NOT NULL,
  code  text NOT NULL UNIQUE
);

CREATE TABLE branches (
  id                    uuid    DEFAULT gen_random_uuid() PRIMARY KEY,
  name                  text    NOT NULL,
  business_id           uuid    NOT NULL REFERENCES businesses(id),
  is_revenue_generating boolean NOT NULL DEFAULT false,
  is_corporate          boolean NOT NULL DEFAULT false,
  UNIQUE (name, business_id)
);

CREATE TABLE payroll_item_groups (
  id    uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name  text NOT NULL UNIQUE
);

CREATE TABLE payroll_items (
  id                  uuid         DEFAULT gen_random_uuid() PRIMARY KEY,
  name                text         NOT NULL UNIQUE,
  group_id            uuid         NOT NULL REFERENCES payroll_item_groups(id),
  is_confirmed        boolean      NOT NULL DEFAULT false,
  ai_suggested_group  text,
  ai_confidence       numeric(6,4)
);

-- branch_id is nullable: corp/hq codes are not tied to a specific revenue branch
CREATE TABLE payroll_codes (
  id              uuid    DEFAULT gen_random_uuid() PRIMARY KEY,
  code            text    NOT NULL UNIQUE,
  branch_id       uuid    REFERENCES branches(id),
  entity_id       uuid    NOT NULL REFERENCES entities(id),
  labor_type      text    NOT NULL CHECK (labor_type IN (
                            'direct','admin_hourly','admin_salary',
                            'corp_hourly','corp_salary','hq_hourly','hq_salary'
                          )),
  allocation_type text    NOT NULL CHECK (allocation_type IN ('none','corp','hq')),
  is_active       boolean NOT NULL DEFAULT true
);

CREATE TABLE revenue_codes (
  id          uuid    DEFAULT gen_random_uuid() PRIMARY KEY,
  code        text    NOT NULL UNIQUE,
  branch_id   uuid    NOT NULL REFERENCES branches(id),
  entity_id   uuid    NOT NULL REFERENCES entities(id),
  is_active   boolean NOT NULL DEFAULT true
);

-- Indexes
CREATE INDEX idx_branches_business_id ON branches(business_id);
CREATE INDEX idx_payroll_items_group_id ON payroll_items(group_id);
CREATE INDEX idx_payroll_codes_branch_entity ON payroll_codes(branch_id, entity_id);
CREATE INDEX idx_payroll_codes_allocation_type ON payroll_codes(allocation_type);
CREATE INDEX idx_revenue_codes_branch_entity ON revenue_codes(branch_id, entity_id);
