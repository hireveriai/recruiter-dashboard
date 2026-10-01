-- 025_veris_live_debrief.sql
--
-- VERIS Live: screen-share timeline events and the post-interview VERIS Debrief.
--
--   * live_interview_events may now record SCREEN_SHARE_STARTED / SCREEN_SHARE_STOPPED
--     (written by the LiveKit webhook from the candidate's screen-share track).
--   * live_interview_debriefs stores one AI-assisted debrief per Live interview:
--     the structured summary, the model used and a digest of the evidence it was
--     built from (so the dashboard can tell when new evidence makes it stale).
--     It never stores a hire/reject verdict or a score.
--
-- Additive and idempotent. Rollback: 025_veris_live_debrief_rollback.sql

begin;

alter table public.live_interview_events drop constraint if exists chk_live_event_type;
alter table public.live_interview_events
  add constraint chk_live_event_type check (event_type in (
    'SESSION_STARTED', 'SESSION_COMPLETED', 'SESSION_CANCELLED',
    'PARTICIPANT_JOINED', 'PARTICIPANT_LEFT', 'RECORDING_CONSENT',
    'QUESTION_ASKED', 'QUESTION_COVERED', 'QUESTION_SKIPPED', 'MANUAL_QUESTION',
    'RECORDING_STARTED', 'RECORDING_STOPPED', 'COPILOT_SUGGESTION', 'TIMER_OVERTIME',
    'INVITATIONS_SENT', 'INVITATION_REVOKED',
    'SCREEN_SHARE_STARTED', 'SCREEN_SHARE_STOPPED'
  ));

create table if not exists public.live_interview_debriefs (
  debrief_id      uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  interview_id    uuid not null references public.interviews(interview_id) on delete cascade,
  summary         jsonb not null default '{}'::jsonb,
  model           text,
  evidence_digest text not null,
  generated_by    uuid,
  generated_at    timestamptz not null default now()
);

create unique index if not exists ux_live_interview_debriefs_interview
  on public.live_interview_debriefs (interview_id);

-- Same tenancy rule as every other Live child table: the row must belong to a
-- LIVE interview of the same organization, and can't be moved to another one.
create or replace function public.fn_live_debrief_guard()
returns trigger
language plpgsql
as $$
declare
  v_interview_org uuid;
  v_delivery text;
begin
  select i.organization_id, i.delivery_mode into v_interview_org, v_delivery
  from public.interviews i
  where i.interview_id = new.interview_id;

  if v_interview_org is null or v_interview_org <> new.organization_id or v_delivery <> 'LIVE' then
    raise exception 'LIVE_CHILD_ORG_MISMATCH: debrief does not belong to a LIVE interview of this organization';
  end if;

  if tg_op = 'UPDATE' and (new.organization_id <> old.organization_id or new.interview_id <> old.interview_id) then
    raise exception 'LIVE_CHILD_IMMUTABLE: debrief ownership cannot change';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_live_debriefs_guard on public.live_interview_debriefs;
create trigger trg_live_debriefs_guard
  before insert or update on public.live_interview_debriefs
  for each row execute function public.fn_live_debrief_guard();

-- Server-only, like every other tenant table.
alter table public.live_interview_debriefs enable row level security;

commit;
