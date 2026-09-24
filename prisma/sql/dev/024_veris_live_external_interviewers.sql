-- 024_veris_live_external_interviewers.sql
--
-- VERIS Live: interview panel members do not have to be team members.
-- An INTERVIEWER participant is either
--   * a team member  (user_id set; must be an active, non-removed user of the org), or
--   * an external panelist identified only by email (user_id null).
--
-- Unchanged guarantees:
--   * A candidate row can never become an interviewer (role/identity immutable).
--   * NEW: an interviewer can never use the interview candidate's email.
--   * One row per interviewer email per interview (plus the existing
--     one-row-per-user index for team members).
--
-- Additive and idempotent. Rollback: 024_veris_live_external_interviewers_rollback.sql

begin;

alter table public.interview_participants drop constraint if exists chk_ip_identity;
alter table public.interview_participants
  add constraint chk_ip_identity check (
    (role = 'CANDIDATE' and candidate_id is not null and user_id is null)
    or (role = 'INTERVIEWER' and candidate_id is null)
  );

create unique index if not exists ux_interview_participants_interviewer_email
  on public.interview_participants (interview_id, lower(email)) where role = 'INTERVIEWER';

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

  -- Team-member interviewers must be active users of this organization.
  if new.role = 'INTERVIEWER' and new.user_id is not null and not exists (
    select 1 from public.users u
    where u.user_id = new.user_id
      and u.organization_id = new.organization_id
      and coalesce(u.is_active, true)
      and u.team_removed_at is null
  ) then
    raise exception 'LIVE_PARTICIPANT_INTERVIEWER_INVALID: interviewer must be an active user of this organization';
  end if;

  -- Nobody can sit on the panel of their own interview.
  if new.role = 'INTERVIEWER' and exists (
    select 1 from public.candidates c
    where c.candidate_id = v_interview.candidate_id
      and lower(trim(c.email)) = lower(trim(new.email))
  ) then
    raise exception 'LIVE_PARTICIPANT_CANDIDATE_AS_INTERVIEWER: the candidate cannot be an interviewer';
  end if;

  if tg_op = 'UPDATE' then
    if new.organization_id <> old.organization_id
      or new.interview_id <> old.interview_id
      or new.role <> old.role
      or new.user_id is distinct from old.user_id
      or new.candidate_id is distinct from old.candidate_id
      or new.livekit_identity <> old.livekit_identity
      or (new.role = 'INTERVIEWER' and lower(new.email) <> lower(old.email)) then
      raise exception 'LIVE_PARTICIPANT_IMMUTABLE: participant identity, role and session cannot change';
    end if;
    new.updated_at := now();
  end if;

  return new;
end;
$$;

commit;
