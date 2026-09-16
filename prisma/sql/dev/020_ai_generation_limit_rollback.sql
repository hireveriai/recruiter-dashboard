-- Rollback for 020_ai_generation_limit.sql
-- Apply against: Verisnova-Production (qvhbtxionaquyyuktdsr)

begin;

drop table if exists public.ai_generation_idempotency;

alter table public.assessment_versions
  drop constraint if exists chk_assessment_versions_generation_attempts;

alter table public.job_questionnaire_versions
  drop constraint if exists chk_jqv_generation_attempts;

alter table public.assessment_versions
  drop column if exists generation_attempts;

alter table public.job_questionnaire_versions
  drop column if exists generation_attempts;

commit;
