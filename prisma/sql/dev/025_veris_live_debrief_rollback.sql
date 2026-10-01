-- Rollback for 025_veris_live_debrief.sql
-- Drops stored debriefs and the screen-share timeline events, then restores
-- the 023 event-type list.

begin;

drop table if exists public.live_interview_debriefs;
drop function if exists public.fn_live_debrief_guard();

-- live_interview_events is append-only by trigger; lift it just for this cleanup.
alter table public.live_interview_events disable trigger trg_live_events_append_only;
delete from public.live_interview_events where event_type in ('SCREEN_SHARE_STARTED', 'SCREEN_SHARE_STOPPED');
alter table public.live_interview_events enable trigger trg_live_events_append_only;

alter table public.live_interview_events drop constraint if exists chk_live_event_type;
alter table public.live_interview_events
  add constraint chk_live_event_type check (event_type in (
    'SESSION_STARTED', 'SESSION_COMPLETED', 'SESSION_CANCELLED',
    'PARTICIPANT_JOINED', 'PARTICIPANT_LEFT', 'RECORDING_CONSENT',
    'QUESTION_ASKED', 'QUESTION_COVERED', 'QUESTION_SKIPPED', 'MANUAL_QUESTION',
    'RECORDING_STARTED', 'RECORDING_STOPPED', 'COPILOT_SUGGESTION', 'TIMER_OVERTIME',
    'INVITATIONS_SENT', 'INVITATION_REVOKED'
  ));

commit;
