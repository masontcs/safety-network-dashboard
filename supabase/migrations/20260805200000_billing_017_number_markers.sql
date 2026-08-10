-- billing_017_number_markers
-- Make job and ticket numbers self-describing:
--   Job    = [entity letter][7-digit seq][branch code]J   e.g. S0000004BKJ
--   Ticket = [entity letter][7-digit seq][branch code]T   e.g. S0000005BKT
--   Invoice= [entity letter][7-digit seq][branch code]     e.g. S0000003BK   (unchanged)
-- Sequences are per (entity, branch): each branch counts its own jobs and tickets.
-- The app now passes the branch for jobs/tickets so the counter keys on it.

create or replace function public.billing_next_number(
  p_kind text,
  p_entity uuid,
  p_branch uuid default null
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_letter char(1);
  v_code   char(2) := '';
  v_seq    bigint;
  v_suffix text := '';
begin
  select letter into v_letter from public.billing_entity_settings where entity_id = p_entity;
  if v_letter is null then
    raise exception 'No billing_entity_settings row (letter) for entity %', p_entity;
  end if;

  if p_branch is not null then
    select code into v_code from public.billing_branch_settings where branch_id = p_branch;
    if v_code is null then
      raise exception 'No billing_branch_settings row (code) for branch %', p_branch;
    end if;
  end if;

  update public.billing_counters
     set next_seq = next_seq + 1
   where kind = p_kind
     and entity_id = p_entity
     and branch_id is not distinct from p_branch
  returning next_seq - 1 into v_seq;

  if v_seq is null then
    insert into public.billing_counters (kind, entity_id, branch_id, next_seq)
    values (p_kind, p_entity, p_branch, 2);
    v_seq := 1;
  end if;

  v_suffix := case p_kind when 'job' then 'J' when 'ticket' then 'T' else '' end;
  return v_letter || lpad(v_seq::text, 7, '0') || v_code || v_suffix;
end;
$$;

revoke execute on function public.billing_next_number(text, uuid, uuid) from public;
revoke execute on function public.billing_next_number(text, uuid, uuid) from anon;
revoke execute on function public.billing_next_number(text, uuid, uuid) from authenticated;
grant  execute on function public.billing_next_number(text, uuid, uuid) to service_role;

-- ── Renumber existing jobs/tickets to the new per-(entity,branch) format ─────────
with ranked as (
  select j.id, es.letter, bs.code,
         row_number() over (partition by j.entity_id, j.branch_id order by j.created_at, j.id) as rn
  from public.billing_jobs j
  join public.billing_entity_settings es on es.entity_id = j.entity_id
  join public.billing_branch_settings bs on bs.branch_id = j.branch_id
)
update public.billing_jobs j
   set job_number = r.letter || lpad(r.rn::text, 7, '0') || r.code || 'J'
  from ranked r
 where r.id = j.id;

with ranked as (
  select t.id, es.letter, bs.code,
         row_number() over (partition by jb.entity_id, jb.branch_id order by t.created_at, t.id) as rn
  from public.billing_tickets t
  join public.billing_jobs jb on jb.id = t.job_id
  join public.billing_entity_settings es on es.entity_id = jb.entity_id
  join public.billing_branch_settings bs on bs.branch_id = jb.branch_id
)
update public.billing_tickets t
   set ticket_number = r.letter || lpad(r.rn::text, 7, '0') || r.code || 'T'
  from ranked r
 where r.id = t.id;

-- ── Seed the new per-(entity,branch) counters so new numbers continue after these ─
insert into public.billing_counters (kind, entity_id, branch_id, next_seq)
select 'job', j.entity_id, j.branch_id, count(*) + 1
  from public.billing_jobs j
 group by j.entity_id, j.branch_id
on conflict (kind, entity_id, coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid))
do update set next_seq = excluded.next_seq;

insert into public.billing_counters (kind, entity_id, branch_id, next_seq)
select 'ticket', jb.entity_id, jb.branch_id, count(*) + 1
  from public.billing_tickets t
  join public.billing_jobs jb on jb.id = t.job_id
 group by jb.entity_id, jb.branch_id
on conflict (kind, entity_id, coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid))
do update set next_seq = excluded.next_seq;
