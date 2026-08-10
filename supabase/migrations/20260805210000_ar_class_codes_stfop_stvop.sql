-- Map two AR class codes that were resolving to NULL branch (so branch-scoped users
-- couldn't see the customers, e.g. OMNI UNDERGROUND INC). The AR import derives an
-- invoice's branch from ar_class_codes[class_code]; unmapped codes fall through to null.
--   STFOP -> Fresno   (Safety Network STS)
--   STVOP -> Visalia  (Safety Network STS)
-- (SGN-FRM is intentionally left unmapped pending a routing decision; INC-CNST is a
--  separate division handled via the exclusion mechanism, not a branch.)

insert into ar_class_codes (code, branch_id, entity_code)
select 'STFOP', b.id, 'STS' from branches b where b.name = 'Fresno' limit 1
on conflict (code) do update set branch_id = excluded.branch_id;

insert into ar_class_codes (code, branch_id, entity_code)
select 'STVOP', b.id, 'STS' from branches b where b.name = 'Visalia' limit 1
on conflict (code) do update set branch_id = excluded.branch_id;

-- Backfill invoices already imported under these codes (import replaces per-entity, so
-- future imports will also pick up the mapping above).
update ar_invoices ai set branch_id = b.id
  from branches b where b.name = 'Fresno'  and ai.raw_class_code = 'STFOP' and ai.branch_id is null;
update ar_invoices ai set branch_id = b.id
  from branches b where b.name = 'Visalia' and ai.raw_class_code = 'STVOP' and ai.branch_id is null;
