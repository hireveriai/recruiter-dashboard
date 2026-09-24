-- 022_interview_focus_plans_rollback.sql
--
-- Reverses 022_interview_focus_plans.sql.
--
-- Removes the focus plan tables and the two nullable provenance columns.
-- Questionnaire versions and questions themselves are untouched; they only
-- lose the record of which focus plan / focus area produced them. Turn the
-- INTERVIEW_FOCUS_ENABLED flag off before running this.

begin;

alter table if exists public.job_questionnaire_questions
  drop column if exists focus_area_key;

alter table if exists public.job_questionnaire_versions
  drop constraint if exists fk_jqv_focus_plan;

drop index if exists public.idx_jqv_focus_plan;

alter table if exists public.job_questionnaire_versions
  drop column if exists focus_plan_id;

drop table if exists public.interview_focus_areas;
drop table if exists public.interview_focus_plans;

drop function if exists public.fn_interview_focus_areas_guard();
drop function if exists public.fn_interview_focus_plans_guard();
drop function if exists public.fn_interview_focus_areas_delete_guard();
drop function if exists public.fn_interview_focus_plans_delete_guard();

commit;
