-- 016_job_questionnaire_architecture.sql
--
-- VerisNova - Stage 1: job-level questionnaire ownership, versioning and stable
-- question identity.
--
-- ROLE-AGNOSTIC BY DESIGN. Nothing in this schema assumes an industry, function
-- or profession. Questions are described by competency label, source, difficulty
-- and phase only - all derived from recruiter-provided job data.
--
-- SAFETY
--   * Purely additive. No DROP, no DELETE, no UPDATE of existing rows.
--   * Idempotent - safe to re-run (create ... if not exists / add column if not exists).
--   * Existing jobs default to INDIVIDUALIZED, which is exactly today's behaviour,
--     so no live interview changes behaviour when this is applied.
--   * Rollback: 016_job_questionnaire_architecture_rollback.sql
--
-- Apply against: Verisnova-Production (qvhbtxionaquyyuktdsr)

begin;

-- ---------------------------------------------------------------------------
-- 1. Questionnaire owned by the JOB (one per job)
-- ---------------------------------------------------------------------------
create table if not exists public.job_questionnaires (
  questionnaire_id   uuid primary key default gen_random_uuid(),
  organization_id    uuid not null,
  job_id             uuid not null references public.job_positions(job_id) on delete cascade,
  active_version_id  uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create unique index if not exists ux_job_questionnaires_job
  on public.job_questionnaires (job_id);

create index if not exists idx_job_questionnaires_org
  on public.job_questionnaires (organization_id);

-- ---------------------------------------------------------------------------
-- 2. Immutable-once-finalized versions
-- ---------------------------------------------------------------------------
create table if not exists public.job_questionnaire_versions (
  questionnaire_version_id uuid primary key default gen_random_uuid(),
  questionnaire_id         uuid not null
                             references public.job_questionnaires(questionnaire_id) on delete cascade,
  organization_id          uuid not null,
  version_number           integer not null,
  status                   text not null default 'DRAFT',
  generated_by             text not null default 'AI',
  interview_mode           text not null default 'STANDARD',
  target_question_count    integer,
  interview_duration_minutes integer,
  generation_model         text,
  generation_meta          jsonb not null default '{}'::jsonb,
  created_by               uuid,
  created_at               timestamptz not null default now(),
  finalized_by             uuid,
  finalized_at             timestamptz
);

create unique index if not exists ux_jqv_questionnaire_version
  on public.job_questionnaire_versions (questionnaire_id, version_number);

create index if not exists idx_jqv_org_status
  on public.job_questionnaire_versions (organization_id, status);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'chk_jqv_status'
  ) then
    alter table public.job_questionnaire_versions
      add constraint chk_jqv_status
      check (status in ('DRAFT', 'FINALIZED', 'SUPERSEDED'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'chk_jqv_generated_by'
  ) then
    alter table public.job_questionnaire_versions
      add constraint chk_jqv_generated_by
      check (generated_by in ('AI', 'RECRUITER_EDITED', 'RECRUITER_CREATED'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'chk_jqv_interview_mode'
  ) then
    alter table public.job_questionnaire_versions
      add constraint chk_jqv_interview_mode
      check (interview_mode in ('STANDARD', 'INDIVIDUALIZED'));
  end if;
end;
$$;

-- Deferred FK for the questionnaire -> active version pointer (circular reference).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'fk_job_questionnaires_active_version'
  ) then
    alter table public.job_questionnaires
      add constraint fk_job_questionnaires_active_version
      foreign key (active_version_id)
      references public.job_questionnaire_versions(questionnaire_version_id)
      on delete set null;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. The questions inside a version
--
-- question_order is intentionally NOT unique: recruiter reordering swaps values
-- and a unique constraint would force a temporary-value dance on every drag.
-- Ordering is normalised by the application inside a transaction.
-- ---------------------------------------------------------------------------
create table if not exists public.job_questionnaire_questions (
  questionnaire_question_id uuid primary key default gen_random_uuid(),
  questionnaire_version_id  uuid not null
                              references public.job_questionnaire_versions(questionnaire_version_id)
                              on delete cascade,
  organization_id           uuid not null,
  question_order            integer not null,
  question_text             text not null,
  question_type             text,
  source_type               text not null default 'job',
  competency_label          text,
  target_skill_id           uuid,
  difficulty_level          integer not null default 3,
  phase_hint                text not null default 'core',
  allow_follow_up           boolean not null default true,
  is_mandatory              boolean not null default true,
  evaluation_criteria       text,
  origin                    text not null default 'AI',
  rendering_mode            text,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

create index if not exists idx_jqq_version_order
  on public.job_questionnaire_questions (questionnaire_version_id, question_order);

create index if not exists idx_jqq_org
  on public.job_questionnaire_questions (organization_id);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'chk_jqq_origin'
  ) then
    alter table public.job_questionnaire_questions
      add constraint chk_jqq_origin
      check (origin in ('AI', 'RECRUITER'));
  end if;

  -- Role-agnostic source taxonomy. 'experience' and 'behavioral' are generic
  -- interview constructs, not profession categories.
  if not exists (
    select 1 from pg_constraint where conname = 'chk_jqq_source_type'
  ) then
    alter table public.job_questionnaire_questions
      add constraint chk_jqq_source_type
      check (source_type in ('job', 'experience', 'behavioral', 'resume'));
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Job-level interview mode + resume-question toggle
--
-- Default INDIVIDUALIZED preserves today's per-candidate behaviour for all 19
-- existing jobs. New jobs are set to STANDARD explicitly by the application.
-- ---------------------------------------------------------------------------
alter table public.job_positions
  add column if not exists interview_mode text not null default 'INDIVIDUALIZED',
  add column if not exists resume_questions_enabled boolean not null default true;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'chk_job_positions_interview_mode'
  ) then
    alter table public.job_positions
      add constraint chk_job_positions_interview_mode
      check (interview_mode in ('STANDARD', 'INDIVIDUALIZED'));
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Which questionnaire version an interview was snapshotted from.
--    This is what keeps historical reports pinned to the version actually used.
-- ---------------------------------------------------------------------------
alter table public.interviews
  add column if not exists questionnaire_version_id uuid,
  add column if not exists questionnaire_snapshot_at timestamptz;

create index if not exists idx_interviews_questionnaire_version
  on public.interviews (questionnaire_version_id);

-- ---------------------------------------------------------------------------
-- 6. Stable question identity.
--
--    The original design routed identity through public.questions, which was
--    never populated (0 rows), leaving question_id NULL everywhere. These two
--    columns create a real identity chain that does not depend on question text:
--
--      job_questionnaire_questions.questionnaire_question_id
--        -> interview_questions.source_questionnaire_question_id
--      interview_questions.interview_question_id
--        -> session_questions.interview_question_id
-- ---------------------------------------------------------------------------
alter table public.interview_questions
  add column if not exists source_questionnaire_question_id uuid;

create index if not exists idx_interview_questions_source_qq
  on public.interview_questions (source_questionnaire_question_id);

alter table public.session_questions
  add column if not exists interview_question_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'fk_session_questions_interview_question'
  ) then
    alter table public.session_questions
      add constraint fk_session_questions_interview_question
      foreign key (interview_question_id)
      references public.interview_questions(interview_question_id)
      on delete set null;
  end if;
end;
$$;

create index if not exists idx_session_questions_interview_question
  on public.session_questions (interview_question_id);

commit;
