-- 016_job_questionnaire_architecture_rollback.sql
--
-- Reverses 016_job_questionnaire_architecture.sql.
--
-- WARNING: dropping the questionnaire tables destroys any generated or
-- recruiter-edited questionnaires. Interviews already snapshotted into
-- interview_questions keep their questions (those rows live in
-- interview_questions and are not touched here) but lose the link back to the
-- version they came from.
--
-- Run only if Stage 1 must be backed out before recruiters have authored
-- questionnaire content worth keeping.

begin;

-- Identity links (safe: all added by 016, referenced only by new code)
alter table public.session_questions
  drop constraint if exists fk_session_questions_interview_question;
drop index if exists public.idx_session_questions_interview_question;
alter table public.session_questions
  drop column if exists interview_question_id;

drop index if exists public.idx_interview_questions_source_qq;
alter table public.interview_questions
  drop column if exists source_questionnaire_question_id;

drop index if exists public.idx_interviews_questionnaire_version;
alter table public.interviews
  drop column if exists questionnaire_version_id,
  drop column if exists questionnaire_snapshot_at;

alter table public.job_positions
  drop constraint if exists chk_job_positions_interview_mode;
alter table public.job_positions
  drop column if exists interview_mode,
  drop column if exists resume_questions_enabled;

-- Questionnaire tables (children first)
alter table public.job_questionnaires
  drop constraint if exists fk_job_questionnaires_active_version;

drop table if exists public.job_questionnaire_questions;
drop table if exists public.job_questionnaire_versions;
drop table if exists public.job_questionnaires;

commit;
