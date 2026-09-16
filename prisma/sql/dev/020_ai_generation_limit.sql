-- 020_ai_generation_limit.sql
--
-- VerisNova - server-enforced AI question generation limit for VERIS AI
-- Interview questionnaires and VERIS Assessments.
--
-- Adds a per-draft/version attempt counter (max 3 generations, enforced in
-- application code via an atomic conditional UPDATE) and a small idempotency
-- table so a retried generation request never double-consumes an attempt.
--
-- SAFETY
--   * Purely additive. No DROP, no DELETE, no UPDATE of existing rows.
--   * Idempotent - safe to re-run (add column if not exists / create table if not exists).
--   * Existing rows default generation_attempts to 0, which is correct: no
--     historical version had this concept, so none of them count against a
--     recruiter's future allowance.
--   * Rollback: 020_ai_generation_limit_rollback.sql
--
-- Apply against: Verisnova-Production (qvhbtxionaquyyuktdsr)

begin;

-- ---------------------------------------------------------------------------
-- 1. Per-version AI generation attempt counters.
-- ---------------------------------------------------------------------------
alter table public.job_questionnaire_versions
  add column if not exists generation_attempts integer not null default 0;

alter table public.assessment_versions
  add column if not exists generation_attempts integer not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'chk_jqv_generation_attempts'
  ) then
    alter table public.job_questionnaire_versions
      add constraint chk_jqv_generation_attempts
      check (generation_attempts >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'chk_assessment_versions_generation_attempts'
  ) then
    alter table public.assessment_versions
      add constraint chk_assessment_versions_generation_attempts
      check (generation_attempts >= 0);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Idempotency cache for generation requests.
--
-- Keyed by (entity_type, entity_id, idempotency_key). entity_id is the
-- stable parent (questionnaire_id / assessment_id, not the version, since a
-- retried request may need to resolve to the same forked draft). Stores the
-- full response payload so a retry replays the original result without
-- re-running AI generation or re-touching the attempt counter.
-- ---------------------------------------------------------------------------
create table if not exists public.ai_generation_idempotency (
  entity_type      text not null,
  entity_id        uuid not null,
  idempotency_key  text not null,
  result           jsonb not null,
  created_at       timestamptz not null default now(),
  primary key (entity_type, entity_id, idempotency_key)
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'chk_ai_gen_idempotency_entity_type'
  ) then
    alter table public.ai_generation_idempotency
      add constraint chk_ai_gen_idempotency_entity_type
      check (entity_type in ('job_questionnaire', 'assessment'));
  end if;
end;
$$;

create index if not exists idx_ai_gen_idempotency_created_at
  on public.ai_generation_idempotency (created_at);

commit;
