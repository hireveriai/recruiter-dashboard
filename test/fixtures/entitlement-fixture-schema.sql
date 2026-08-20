-- Minimal slice of the production schema that the free-entitlement functions
-- touch. Used only by test/free-entitlements.integration.test.mjs so the
-- entitlement logic can be exercised against a real Postgres without needing a
-- full production dump.
--
-- Column names and types mirror production (including the quoted camelCase
-- columns on the billing tables).

create extension if not exists pgcrypto;

create table if not exists public.organizations (
  organization_id uuid primary key default gen_random_uuid(),
  organization_name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.users (
  user_id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(organization_id) on delete cascade,
  full_name text,
  email text not null,
  role text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.identity_users (
  identity_id uuid primary key default gen_random_uuid(),
  email text,
  primary_email text,
  intent text,
  is_verified boolean default false,
  created_at timestamptz default now()
);

create table if not exists public.candidates (
  candidate_id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(organization_id) on delete cascade,
  full_name text,
  email text,
  status text,
  created_at timestamptz not null default now()
);

create table if not exists public.candidate_identity_links (
  identity_id uuid not null,
  candidate_id uuid not null references public.candidates(candidate_id) on delete cascade,
  purpose text not null default 'practice',
  created_at timestamptz not null default now(),
  primary key (identity_id, candidate_id)
);

create table if not exists public.hireveri_plans (
  id text primary key,
  name text not null,
  slug text not null,
  price integer not null,
  price_inr integer not null,
  price_usd integer not null,
  "interviewLimit" integer not null,
  "screeningCredits" integer not null default 0,
  "order" integer not null,
  "isActive" boolean not null default true,
  "planType" text not null default 'INTERVIEW',
  description text,
  features jsonb not null default '[]'::jsonb,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

create table if not exists public.hireveri_user_subscriptions (
  id text primary key,
  "userId" text not null,
  "planId" text not null references public.hireveri_plans(id),
  "organizationId" uuid,
  "totalCredits" integer not null,
  "usedCredits" integer not null default 0,
  "screeningCredits" integer not null default 0,
  status text not null default 'pending',
  "amountPaid" integer not null default 0,
  currency text not null default 'INR',
  "activatedAt" timestamptz,
  "expiresAt" timestamptz,
  "startedAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

-- The pre-migration shape: defaults of 10 / 25, seeded by a trigger on
-- organizations. Migration 012 is what removes this behaviour, and the tests
-- assert that it does.
create table if not exists public.workspace_trial_credits (
  organization_id uuid primary key references public.organizations(organization_id) on delete cascade,
  interview_credits_remaining integer not null default 10,
  screening_credits_remaining integer not null default 25,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workspace_trial_credits_interview_non_negative check (interview_credits_remaining >= 0),
  constraint workspace_trial_credits_screening_non_negative check (screening_credits_remaining >= 0)
);

create table if not exists public.workspace_trial_credit_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(organization_id) on delete cascade,
  kind text not null,
  amount integer not null,
  source text,
  source_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint workspace_trial_credit_events_kind_check check (kind in ('INTERVIEW', 'SCREENING')),
  constraint workspace_trial_credit_events_amount_positive check (amount > 0)
);

create unique index if not exists workspace_trial_credit_events_source_uidx
  on public.workspace_trial_credit_events (organization_id, kind, source, source_id)
  where source_id is not null;

create or replace function public.ensure_workspace_trial_credits()
returns trigger
language plpgsql
as $legacy_seed$
begin
  insert into public.workspace_trial_credits (
    organization_id, interview_credits_remaining, screening_credits_remaining
  )
  values (new.organization_id, 10, 25)
  on conflict (organization_id) do nothing;
  return new;
end;
$legacy_seed$;

drop trigger if exists organizations_seed_workspace_trial_credits on public.organizations;
create trigger organizations_seed_workspace_trial_credits
  after insert on public.organizations
  for each row
  execute function public.ensure_workspace_trial_credits();

insert into public.hireveri_plans (id, name, slug, price, price_inr, price_usd, "interviewLimit", "screeningCredits", "order", "planType")
values
  ('starter-plan', 'Starter', 'starter', 14999, 14999, 199, 50, 120, 1, 'INTERVIEW'),
  ('practice-candidate-starter-plan', 'Starter', 'practice-starter', 299, 299, 5, 1, 0, 1, 'PRACTICE_CANDIDATE')
on conflict (id) do nothing;
