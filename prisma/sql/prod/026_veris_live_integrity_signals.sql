-- 026_veris_live_integrity_signals.sql
--
-- VERIS Live: integrity and session evidence on the existing interview timeline.
--
-- Event types only; no new table or column. Each observation is a start / end
-- pair on live_interview_events (append-only), like screen sharing:
--   FACE_NOT_VISIBLE          / FACE_NOT_VISIBLE_ENDED
--   MULTIPLE_FACES_DETECTED   / MULTIPLE_FACES_CLEARED
--   CAMERA_UNAVAILABLE        / CAMERA_RESTORED
--   PAGE_VISIBILITY_HIDDEN    / PAGE_VISIBILITY_RESTORED
-- plus SESSION_CHANGE_DETECTED (the candidate's link joined from a new browser
-- session during the interview). Payloads hold timing and a reason code only:
-- never frames, images, biometric data, IP addresses or device details.
--
-- Additive and idempotent. Rollback: 026_veris_live_integrity_signals_rollback.sql

begin;

alter table public.live_interview_events drop constraint if exists chk_live_event_type;
alter table public.live_interview_events
  add constraint chk_live_event_type check (event_type in (
    'SESSION_STARTED', 'SESSION_COMPLETED', 'SESSION_CANCELLED',
    'PARTICIPANT_JOINED', 'PARTICIPANT_LEFT', 'RECORDING_CONSENT',
    'QUESTION_ASKED', 'QUESTION_COVERED', 'QUESTION_SKIPPED', 'MANUAL_QUESTION',
    'RECORDING_STARTED', 'RECORDING_STOPPED', 'COPILOT_SUGGESTION', 'TIMER_OVERTIME',
    'INVITATIONS_SENT', 'INVITATION_REVOKED',
    'SCREEN_SHARE_STARTED', 'SCREEN_SHARE_STOPPED',
    'FACE_NOT_VISIBLE', 'FACE_NOT_VISIBLE_ENDED',
    'MULTIPLE_FACES_DETECTED', 'MULTIPLE_FACES_CLEARED',
    'CAMERA_UNAVAILABLE', 'CAMERA_RESTORED',
    'PAGE_VISIBILITY_HIDDEN', 'PAGE_VISIBILITY_RESTORED',
    'SESSION_CHANGE_DETECTED'
  ));

commit;
