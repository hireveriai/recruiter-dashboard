-- Minimal pre-2026-09-16 shape of the tables Employee targeting touches, so
-- integration tests can replay the real migrations on top of it, in order:
--   db/migrations/20260916_employee_activities.sql
--   db/migrations/20260917_employee_activity_job_optional.sql
--   db/migrations/20260929_employee_departments_projects_targeting.sql
-- Columns mirror prisma/schema.prisma (Prisma selects every model column).

create table public.organizations (
  organization_id uuid primary key default gen_random_uuid(),
  organization_name text not null,
  timezone text not null default 'Asia/Kolkata',
  "timezoneLabel" text not null default 'India Standard Time',
  gst_number text,
  billing_address text,
  finance_email text,
  invoice_recipient_email text,
  billing_country_code char(2) not null default 'IN',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- role is plain text in production (not the "UserRole" enum the Prisma
-- model declares), so it is text here too: an enum-typed Prisma filter on it
-- fails against production and must fail in tests as well.
create table public.users (
  user_id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  full_name text,
  email text not null unique,
  role text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  phone text,
  password_hash text,
  is_email_verified boolean default false,
  is_phone_verified boolean default false,
  last_login_at timestamptz,
  user_type_id smallint,
  first_name text,
  last_name text,
  team_removed_at timestamptz
);

create table public.permissions (
  permission_code text primary key,
  description text
);

create table public.role_permissions (
  recruiter_role_id smallint not null,
  permission text not null,
  primary key (recruiter_role_id, permission)
);

create table public.assessments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  job_id uuid not null,
  title text not null,
  description text,
  duration_minutes integer not null default 30,
  passing_percentage numeric(5,2) not null default 60,
  question_count integer,
  difficulty text,
  question_types text[] not null default '{}',
  randomize_questions boolean not null default false,
  randomize_options boolean not null default false,
  link_expiry_days integer not null default 7,
  status text not null default 'DRAFT',
  settings jsonb not null default '{}',
  active_version_id uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.assessment_versions (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references public.assessments (id),
  version_number integer not null,
  status text not null default 'DRAFT',
  generation_model text,
  generation_meta jsonb not null default '{}',
  generation_attempts integer not null default 0,
  created_at timestamptz not null default now(),
  unique (assessment_id, version_number)
);

create table public.assessment_invites (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references public.assessments (id),
  version_id uuid not null references public.assessment_versions (id),
  job_id uuid not null,
  candidate_id uuid not null,
  organization_id uuid not null,
  token_hash text not null unique,
  status text not null default 'INVITED',
  expires_at timestamptz not null,
  sent_at timestamptz,
  opened_at timestamptz,
  completed_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now()
);

create table public.assessment_attempts (
  id uuid primary key default gen_random_uuid(),
  invite_id uuid not null unique references public.assessment_invites (id),
  assessment_id uuid not null references public.assessments (id),
  version_id uuid not null references public.assessment_versions (id),
  job_id uuid not null,
  candidate_id uuid not null,
  organization_id uuid not null,
  started_at timestamptz,
  ends_at timestamptz,
  submitted_at timestamptz,
  timed_out_at timestamptz,
  status text not null default 'NOT_STARTED',
  objective_score numeric(8,2),
  subjective_score numeric(8,2),
  score numeric(8,2),
  max_score numeric(8,2),
  percentage numeric(5,2),
  passed boolean,
  credit_deducted boolean not null default false,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.assessment_results (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null unique references public.assessment_attempts (id),
  assessment_id uuid not null references public.assessments (id),
  job_id uuid not null,
  candidate_id uuid not null,
  organization_id uuid not null,
  objective_score numeric(8,2),
  subjective_score numeric(8,2),
  total_score numeric(8,2),
  max_score numeric(8,2),
  percentage numeric(5,2),
  passed boolean,
  risk_level text,
  summary jsonb not null default '{}',
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.assessment_answer_evaluations (
  id uuid primary key default gen_random_uuid(),
  answer_id uuid not null unique,
  score numeric(6,2),
  max_score numeric(6,2),
  feedback text,
  rubric_result jsonb,
  provider text,
  model text,
  status text not null default 'PENDING',
  evaluated_at timestamptz,
  created_at timestamptz not null default now()
);
