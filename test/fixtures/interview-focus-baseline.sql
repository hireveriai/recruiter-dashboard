-- Minimal pre-existing schema needed to apply 016_job_questionnaire_architecture
-- and 022_interview_focus_plans against an empty test database. Column shapes
-- follow production; only the columns the questionnaire / focus code reads and
-- writes are included. Test-only: never run against a real environment.

create table if not exists public.experience_level_pool (
  experience_level_id smallint primary key,
  label text not null
);

insert into public.experience_level_pool (experience_level_id, label) values
  (1, 'Fresher / Student'), (2, 'Junior'), (3, 'Mid'), (4, 'Senior')
on conflict do nothing;

create table if not exists public.job_positions (
  job_id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  job_title text not null,
  job_description text,
  experience_level_id smallint not null references public.experience_level_pool(experience_level_id),
  core_skills text[] not null default '{}',
  difficulty_profile text,
  interview_duration_minutes integer not null default 30
);

create table if not exists public.interviews (
  interview_id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  job_id uuid not null references public.job_positions(job_id),
  candidate_id uuid not null default gen_random_uuid(),
  interview_type text not null default 'AI',
  created_at timestamptz not null default now()
);

create table if not exists public.interview_questions (
  interview_question_id uuid primary key default gen_random_uuid(),
  interview_id uuid not null references public.interviews(interview_id) on delete cascade,
  question_id uuid,
  question_order integer not null,
  is_mandatory boolean not null default true,
  allow_follow_up boolean not null default true,
  question_text text,
  question_type text,
  source_type text,
  reference_context jsonb not null default '{}'::jsonb,
  is_dynamic boolean not null default false,
  phase_hint text not null default 'core',
  difficulty_level integer not null default 3,
  target_skill_id uuid
);

create table if not exists public.session_questions (
  session_question_id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null default gen_random_uuid(),
  question_id uuid,
  content text,
  question_kind text default 'core'
);

-- Only so 020_ai_generation_limit can be applied (it adds a column here).
create table if not exists public.assessment_versions (
  assessment_version_id uuid primary key default gen_random_uuid()
);

create table if not exists public.interview_attempts (
  attempt_id uuid primary key default gen_random_uuid(),
  interview_id uuid not null references public.interviews(interview_id) on delete cascade
);
