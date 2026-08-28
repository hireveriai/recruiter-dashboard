-- 017_retire_question_seeding_triggers_rollback.sql
--
-- Restores the legacy question seeding triggers dropped by 017.
--
-- WARNING: the two force=TRUE triggers DELETE and regenerate a job's
-- interview_questions rows from hardcoded templates. Restoring them while the
-- job-level questionnaire architecture is active can destroy snapshotted or
-- recruiter-approved questions for in-flight interviews. Restore only as part
-- of a full rollback of that architecture.
--
-- Also remove the matching guard in
-- lib/server/services/interview-workflow.ts :: ensureInterviewWorkflowSchema,
-- otherwise the application will drop these triggers again on the next request.
--
-- The trigger functions themselves were never dropped, so this only re-binds
-- them.

begin;

create trigger trg_prepare_interview_on_insert
after insert on public.interviews
for each row
execute function public.trg_prepare_interview_on_insert();

create trigger trg_refresh_questions_from_resume
after insert or update of raw_resume, extracted_skills, extracted_claims, claimed_experience_years
on public.candidate_resume_ai
for each row
execute function public.trg_refresh_questions_from_resume();

create trigger trg_refresh_questions_from_skill_map
after insert or update or delete
on public.interview_skill_map
for each row
execute function public.trg_refresh_questions_from_skill_map();

commit;
