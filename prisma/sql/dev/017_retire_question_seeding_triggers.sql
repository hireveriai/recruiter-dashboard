-- 017_retire_question_seeding_triggers.sql
--
-- Retires the legacy database-side question seeding triggers.
--
-- WHY
--   interview_auto_seed_orchestration_patch.sql installed three triggers that
--   generate interview questions from hardcoded PL/pgSQL string templates:
--
--     trg_prepare_interview_on_insert     on interviews            (force=false)
--     trg_refresh_questions_from_resume   on candidate_resume_ai   (force=TRUE)
--     trg_refresh_questions_from_skill_map on interview_skill_map  (force=TRUE)
--
--   The two force=TRUE triggers DELETE every dynamic interview_questions row
--   for an interview and reseed it from templates. With a job-level
--   questionnaire that is now destructive: a resume-AI write or a skill-map
--   change mid-flight would wipe a snapshotted questionnaire, break the stable
--   question identity chain, and silently replace recruiter-approved questions
--   with generic templates.
--
--   Those templates are also not role-agnostic - they hardcode phrasing such as
--   "when it starts failing in production", which is wrong for most of the
--   roles this platform serves.
--
-- CURRENT STATE (verified in production before writing this)
--   trg_prepare_interview_on_insert : NOT PRESENT
--   candidate_resume_ai             : 0 rows  -> its trigger has never fired
--   interview_skill_map             : 0 rows  -> its trigger has never fired
--   interview_questions seeded by the patch : 0 rows
--   So this retires a dormant mechanism, not a live one.
--
-- SAFETY
--   * Drops triggers only. The underlying functions are RETAINED so this is
--     reversible by re-creating the triggers (see the rollback script), and so
--     any operator relying on a manual ensure_interview_prepared(...) call is
--     not broken.
--   * No question data is read, written or deleted.
--   * Idempotent.
--
--   NOTE: dropping these in SQL alone is not sufficient in this codebase -
--   runtime "ensure*" schema functions re-apply DDL on live requests. The
--   matching guard lives in
--   lib/server/services/interview-workflow.ts :: ensureInterviewWorkflowSchema.

begin;

drop trigger if exists trg_prepare_interview_on_insert on public.interviews;
drop trigger if exists trg_refresh_questions_from_resume on public.candidate_resume_ai;
drop trigger if exists trg_refresh_questions_from_skill_map on public.interview_skill_map;

commit;
