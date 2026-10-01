-- Rollback for 026_veris_live_integrity_signals.sql
-- Removes the integrity / session evidence events, then restores the 025
-- event-type list (screen sharing stays).

begin;

-- live_interview_events is append-only by trigger; lift it just for this cleanup.
alter table public.live_interview_events disable trigger trg_live_events_append_only;
delete from public.live_interview_events where event_type in (
  'FACE_NOT_VISIBLE', 'FACE_NOT_VISIBLE_ENDED',
  'MULTIPLE_FACES_DETECTED', 'MULTIPLE_FACES_CLEARED',
  'CAMERA_UNAVAILABLE', 'CAMERA_RESTORED',
  'PAGE_VISIBILITY_HIDDEN', 'PAGE_VISIBILITY_RESTORED',
  'SESSION_CHANGE_DETECTED'
);
alter table public.live_interview_events enable trigger trg_live_events_append_only;

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

commit;
