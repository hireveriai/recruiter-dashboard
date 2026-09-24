-- Minimal pre-existing schema needed (on top of interview-focus-baseline.sql)
-- to apply 023_veris_live against an empty test database. Column shapes follow
-- production; test-only, never run against a real environment.

create table if not exists public.organizations (
  organization_id uuid primary key,
  organization_name text,
  timezone text
);

create table if not exists public.users (
  user_id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  full_name text,
  email text not null,
  role text not null default 'RECRUITER',
  is_active boolean not null default true,
  team_removed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.candidates (
  candidate_id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  full_name text not null,
  email text not null,
  status text,
  resume_text text,
  created_at timestamptz not null default now()
);

alter table public.interviews
  add column if not exists created_by uuid,
  add column if not exists is_active boolean not null default true,
  add column if not exists duration_minutes integer default 30,
  add column if not exists question_count integer default 10,
  add column if not exists status text,
  add column if not exists question_status text default 'PENDING',
  add column if not exists email_status text default 'PENDING',
  add column if not exists final_status text;

create table if not exists public.interview_invites (
  invite_id uuid primary key default gen_random_uuid(),
  interview_id uuid references public.interviews(interview_id) on delete cascade,
  token text unique,
  status text default 'ACTIVE',
  used_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.interview_attempts
  add column if not exists status text,
  add column if not exists started_at timestamptz default now(),
  add column if not exists ended_at timestamptz;

create table if not exists public.interview_evaluations (
  evaluation_id uuid primary key default gen_random_uuid(),
  attempt_id uuid unique references public.interview_attempts(attempt_id) on delete cascade,
  final_score numeric,
  decision text
);

alter table public.job_positions
  add column if not exists is_active boolean not null default true;
