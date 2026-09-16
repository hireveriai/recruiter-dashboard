-- Rollback for 021_ai_feedback_generation_limit.sql
-- Apply against: Verisnova-Production (qvhbtxionaquyyuktdsr)

begin;

do $$
begin
  if exists (
    select 1 from pg_constraint where conname = 'chk_ai_gen_idempotency_entity_type'
  ) then
    alter table public.ai_generation_idempotency
      drop constraint chk_ai_gen_idempotency_entity_type;
  end if;

  alter table public.ai_generation_idempotency
    add constraint chk_ai_gen_idempotency_entity_type
    check (entity_type in ('job_questionnaire', 'assessment'));
end;
$$;

alter table public.interviews
  drop constraint if exists chk_interviews_feedback_generation_attempts;

alter table public.interviews
  drop column if exists candidate_feedback_generation_attempts;

commit;
