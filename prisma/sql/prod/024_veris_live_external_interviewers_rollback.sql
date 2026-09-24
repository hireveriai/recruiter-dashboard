-- Rollback for 024_veris_live_external_interviewers.sql
-- Removes external (email-only) interviewers first, since 023 requires user_id.

begin;

delete from public.interview_participants where role = 'INTERVIEWER' and user_id is null;

drop index if exists public.ux_interview_participants_interviewer_email;

alter table public.interview_participants drop constraint if exists chk_ip_identity;
alter table public.interview_participants
  add constraint chk_ip_identity check (
    (role = 'CANDIDATE' and candidate_id is not null and user_id is null)
    or (role = 'INTERVIEWER' and user_id is not null and candidate_id is null)
  );

create or replace function public.fn_interview_participants_guard()
returns trigger
language plpgsql
as $$
declare
  v_interview record;
begin
  select i.organization_id, i.candidate_id, i.delivery_mode
    into v_interview
  from public.interviews i
  where i.interview_id = new.interview_id;

  if v_interview.organization_id is null or v_interview.organization_id <> new.organization_id then
    raise exception 'LIVE_PARTICIPANT_ORG_MISMATCH: participant organization does not own this interview';
  end if;

  if v_interview.delivery_mode <> 'LIVE' then
    raise exception 'LIVE_PARTICIPANT_NOT_LIVE: participants can only be added to LIVE interviews';
  end if;

  if new.role = 'CANDIDATE' and new.candidate_id <> v_interview.candidate_id then
    raise exception 'LIVE_PARTICIPANT_CANDIDATE_MISMATCH: candidate participant must be the interview candidate';
  end if;

  if new.role = 'INTERVIEWER' and not exists (
    select 1 from public.users u
    where u.user_id = new.user_id
      and u.organization_id = new.organization_id
      and coalesce(u.is_active, true)
      and u.team_removed_at is null
  ) then
    raise exception 'LIVE_PARTICIPANT_INTERVIEWER_INVALID: interviewer must be an active user of this organization';
  end if;

  if tg_op = 'UPDATE' then
    if new.organization_id <> old.organization_id
      or new.interview_id <> old.interview_id
      or new.role <> old.role
      or new.user_id is distinct from old.user_id
      or new.candidate_id is distinct from old.candidate_id
      or new.livekit_identity <> old.livekit_identity then
      raise exception 'LIVE_PARTICIPANT_IMMUTABLE: participant identity, role and session cannot change';
    end if;
    new.updated_at := now();
  end if;

  return new;
end;
$$;

commit;
