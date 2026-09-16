-- 021_ai_feedback_generation_limit.sql
--
-- VerisNova - server-enforced AI generation limit for candidate feedback
-- generated from completed VERIS AI Interviews (sibling feature to
-- 020_ai_generation_limit.sql's questionnaire/assessment limit).
--
-- Candidate feedback has no draft/version row to hang a counter on (interviews
-- is a singleton row, overwritten in place on regenerate), so the counter goes
-- directly on public.interviews. The limit is per interview, for its whole
-- lifetime - there is no "new draft" concept here to reset against.
--
-- SAFETY
--   * Purely additive. No DROP, no DELETE, no UPDATE of existing rows.
--   * Idempotent - safe to re-run (add column if not exists).
--   * Existing rows default to 0, so no interview that already has feedback
--     retroactively counts against the new allowance.
--   * Rollback: 021_ai_feedback_generation_limit_rollback.sql
--
-- Apply against: Verisnova-Production (qvhbtxionaquyyuktdsr)

begin;

alter table public.interviews
  add column if not exists candidate_feedback_generation_attempts integer not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'chk_interviews_feedback_generation_attempts'
  ) then
    alter table public.interviews
      add constraint chk_interviews_feedback_generation_attempts
      check (candidate_feedback_generation_attempts >= 0);
  end if;
end;
$$;

-- Reuse the idempotency cache from 020_ai_generation_limit.sql for candidate
-- feedback generation requests too.
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
    check (entity_type in ('job_questionnaire', 'assessment', 'candidate_feedback'));
end;
$$;

commit;
