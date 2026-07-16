-- billing_017_flat_rate_key
-- Charge items (Labor / Lump Sum / Misc) have ONE rate, not six.
--
-- The six billing types are RENTAL CADENCES (daily, weekly_billed_daily, ...). A
-- "1 Man Crew" has an hourly rate — asking which rental cadence it bills under is a
-- meaningless question, and answering it by convention ("put the hourly rate in the
-- daily cell") makes the editor lie about what the number means.
--
-- So the rate KEY gets a 'flat' member: a rate with no cadence. Charge items price
-- exactly one cell per tier ('flat'); equipment prices the cadence cells. This reuses
-- the whole tier machinery — % cascade, freeze-after-tier, sticky overrides, the
-- compiled rate grid — instead of bolting on a parallel path for charge items.
--
-- The rental engine still only ever reads the six cadences; 'flat' is invisible to it.

ALTER TYPE billing_type ADD VALUE IF NOT EXISTS 'flat';
