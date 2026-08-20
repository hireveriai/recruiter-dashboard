-- ============================================================================
-- 012_free_entitlement_requests.sql
--
-- Request/review/approval driven free entitlements.
--
-- Before this migration:
--   * every new organization received 10 AI interviews + 25 VERIS screenings
--     automatically, via the `organizations_seed_workspace_trial_credits`
--     trigger on public.organizations and via the column defaults on
--     public.workspace_trial_credits.
--   * practice candidates had no free entitlement concept at all.
--
-- After this migration:
--   * workspace_trial_credits still holds the organization credit balance
--     (nothing is duplicated), but new rows start at 0/0 and carry a trial
--     status.
--   * trial_requests records every free-entitlement request and its review
--     state, trial_grants is the exactly-once idempotency anchor for the
--     actual credit grant, and trial_request_events is the audit trail.
--   * candidate free practice is granted as a zero-price row in the existing
--     hireveri_user_subscriptions table, so consumePracticeInterviewCredit and
--     every other existing practice code path keeps working unchanged.
--
-- This migration is additive and preserves every existing balance.
-- Rollback: 012_free_entitlement_requests_rollback.sql
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Reference data: email domain classification
-- ---------------------------------------------------------------------------

create table if not exists public.email_domain_reputation (
  domain text primary key,
  kind text not null,
  notes text,
  created_at timestamptz not null default now(),
  constraint email_domain_reputation_kind_check
    check (kind in ('DISPOSABLE', 'PUBLIC', 'TRUSTED'))
);

insert into public.email_domain_reputation (domain, kind) values
  ('gmail.com', 'PUBLIC'),
  ('googlemail.com', 'PUBLIC'),
  ('yahoo.com', 'PUBLIC'),
  ('yahoo.co.in', 'PUBLIC'),
  ('outlook.com', 'PUBLIC'),
  ('hotmail.com', 'PUBLIC'),
  ('live.com', 'PUBLIC'),
  ('msn.com', 'PUBLIC'),
  ('icloud.com', 'PUBLIC'),
  ('me.com', 'PUBLIC'),
  ('aol.com', 'PUBLIC'),
  ('proton.me', 'PUBLIC'),
  ('protonmail.com', 'PUBLIC'),
  ('zoho.com', 'PUBLIC'),
  ('gmx.com', 'PUBLIC'),
  ('yandex.com', 'PUBLIC'),
  ('rediffmail.com', 'PUBLIC'),
  ('mailinator.com', 'DISPOSABLE'),
  ('yopmail.com', 'DISPOSABLE'),
  ('guerrillamail.com', 'DISPOSABLE'),
  ('sharklasers.com', 'DISPOSABLE'),
  ('10minutemail.com', 'DISPOSABLE'),
  ('tempmail.com', 'DISPOSABLE'),
  ('temp-mail.org', 'DISPOSABLE'),
  ('throwawaymail.com', 'DISPOSABLE'),
  ('trashmail.com', 'DISPOSABLE'),
  ('getnada.com', 'DISPOSABLE'),
  ('dispostable.com', 'DISPOSABLE'),
  ('fakeinbox.com', 'DISPOSABLE'),
  ('maildrop.cc', 'DISPOSABLE'),
  ('mohmal.com', 'DISPOSABLE'),
  ('emailondeck.com', 'DISPOSABLE'),
  ('spam4.me', 'DISPOSABLE'),
  ('mailnesia.com', 'DISPOSABLE'),
  ('inboxkitten.com', 'DISPOSABLE'),
  ('tempr.email', 'DISPOSABLE'),
  ('mintemail.com', 'DISPOSABLE'),
  ('discard.email', 'DISPOSABLE'),
  ('hireveri.local', 'DISPOSABLE')
on conflict (domain) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Platform administrators (trial reviewers)
-- ---------------------------------------------------------------------------

create table if not exists public.platform_admins (
  email_normalized text primary key,
  full_name text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 3. Trial requests
-- ---------------------------------------------------------------------------

create table if not exists public.trial_requests (
  request_id uuid primary key default gen_random_uuid(),
  request_type text not null,
  status text not null default 'PENDING_REVIEW',

  -- subject_key is the abuse/idempotency identity of the requester:
  --   recruiter trial    -> 'org:<organization_id>'
  --   candidate practice -> 'identity:<identity_id>'
  subject_key text not null,
  organization_id uuid references public.organizations(organization_id) on delete cascade,
  identity_id uuid,
  requested_by_user_id uuid,

  contact_email text,
  email_normalized text,
  email_domain text,
  email_verified boolean not null default false,

  company_name text,
  company_website text,
  company_domain text,

  risk_score integer not null default 0,
  risk_level text not null default 'LOW',
  risk_reasons text[] not null default '{}',
  validation jsonb not null default '{}'::jsonb,

  auto_decision boolean not null default false,
  decided_at timestamptz,
  decided_by text,
  decision_reason text,

  request_ip text,
  user_agent text,
  device_hash text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint trial_requests_type_check
    check (request_type in ('RECRUITER_TRIAL', 'CANDIDATE_PRACTICE')),
  constraint trial_requests_status_check
    check (status in ('PENDING_REVIEW', 'APPROVED', 'REJECTED', 'EXPIRED', 'CANCELLED')),
  constraint trial_requests_risk_level_check
    check (risk_level in ('LOW', 'MEDIUM', 'HIGH')),
  constraint trial_requests_subject_check
    check (
      (request_type = 'RECRUITER_TRIAL' and organization_id is not null)
      or (request_type = 'CANDIDATE_PRACTICE' and identity_id is not null)
    )
);

-- At most one open request per subject: protects against double clicks,
-- retries and concurrent submissions.
create unique index if not exists trial_requests_open_subject_uidx
  on public.trial_requests (request_type, subject_key)
  where status = 'PENDING_REVIEW';

-- At most one approved request per subject: a second approval can never
-- create a second grant path.
create unique index if not exists trial_requests_approved_subject_uidx
  on public.trial_requests (request_type, subject_key)
  where status = 'APPROVED';

create index if not exists trial_requests_status_created_idx
  on public.trial_requests (status, created_at desc);
create index if not exists trial_requests_email_idx
  on public.trial_requests (email_normalized);
create index if not exists trial_requests_ip_created_idx
  on public.trial_requests (request_ip, created_at desc);
create index if not exists trial_requests_device_idx
  on public.trial_requests (device_hash)
  where device_hash is not null;
create index if not exists trial_requests_org_idx
  on public.trial_requests (organization_id);
create index if not exists trial_requests_identity_idx
  on public.trial_requests (identity_id);
create index if not exists trial_requests_company_domain_idx
  on public.trial_requests (company_domain)
  where company_domain is not null;

-- ---------------------------------------------------------------------------
-- 4. Trial grants (exactly-once entitlement issuance)
-- ---------------------------------------------------------------------------

create table if not exists public.trial_grants (
  grant_id uuid primary key default gen_random_uuid(),
  -- grant_key is unique. It is the hard database guarantee that a subject can
  -- only ever receive one free grant of a given type, regardless of how many
  -- times Approve is clicked or how many approvals race each other.
  grant_key text not null unique,
  request_id uuid not null unique references public.trial_requests(request_id) on delete cascade,
  request_type text not null,
  organization_id uuid references public.organizations(organization_id) on delete cascade,
  identity_id uuid,
  ai_interview_credits integer not null default 0,
  veris_screening_credits integer not null default 0,
  practice_interview_credits integer not null default 0,
  granted_at timestamptz not null default now(),
  expires_at timestamptz,
  constraint trial_grants_type_check
    check (request_type in ('RECRUITER_TRIAL', 'CANDIDATE_PRACTICE')),
  constraint trial_grants_non_negative
    check (
      ai_interview_credits >= 0
      and veris_screening_credits >= 0
      and practice_interview_credits >= 0
    )
);

create index if not exists trial_grants_org_idx on public.trial_grants (organization_id);
create index if not exists trial_grants_identity_idx on public.trial_grants (identity_id);

-- ---------------------------------------------------------------------------
-- 5. Audit trail
-- ---------------------------------------------------------------------------

create table if not exists public.trial_request_events (
  event_id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.trial_requests(request_id) on delete cascade,
  from_status text,
  to_status text not null,
  actor text,
  actor_type text not null default 'SYSTEM',
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint trial_request_events_actor_type_check
    check (actor_type in ('SYSTEM', 'USER', 'ADMIN', 'MIGRATION'))
);

create index if not exists trial_request_events_request_idx
  on public.trial_request_events (request_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 6. Extend the existing org credit table rather than creating a new one
-- ---------------------------------------------------------------------------

-- Introducing trial_status must not strip credits from workspaces that predate
-- the request flow. Every row that already exists when the column is added is
-- grandfathered to APPROVED in the same transaction, so this migration is safe
-- on its own even before 014 runs.
do $add_trial_status$
declare
  v_column_existed boolean;
begin
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'workspace_trial_credits'
      and column_name = 'trial_status'
  ) into v_column_existed;

  alter table public.workspace_trial_credits
    add column if not exists trial_status text not null default 'NOT_REQUESTED',
    add column if not exists trial_request_id uuid,
    add column if not exists trial_granted_at timestamptz,
    add column if not exists trial_expires_at timestamptz;

  if not v_column_existed then
    update public.workspace_trial_credits
    set trial_status = 'APPROVED',
        trial_granted_at = coalesce(trial_granted_at, created_at);
  end if;
end
$add_trial_status$;

do $ensure_status_check$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'workspace_trial_credits_status_check'
  ) then
    alter table public.workspace_trial_credits
      add constraint workspace_trial_credits_status_check
      check (trial_status in ('NOT_REQUESTED', 'PENDING_REVIEW', 'APPROVED', 'REJECTED', 'EXPIRED', 'COMPLETED'));
  end if;
end
$ensure_status_check$;

-- New workspaces must start empty. Existing balances are untouched.
alter table public.workspace_trial_credits
  alter column interview_credits_remaining set default 0,
  alter column screening_credits_remaining set default 0;

-- ---------------------------------------------------------------------------
-- 7. Remove the automatic 10/25 grant on organization creation
-- ---------------------------------------------------------------------------

drop trigger if exists organizations_seed_workspace_trial_credits on public.organizations;

-- The function is kept but neutered: any deployment still holding a stale
-- reference to it seeds a zero-credit NOT_REQUESTED row rather than 10/25.
create or replace function public.ensure_workspace_trial_credits()
returns trigger
language plpgsql
as $ensure_wtc$
begin
  insert into public.workspace_trial_credits (
    organization_id,
    interview_credits_remaining,
    screening_credits_remaining,
    trial_status
  )
  values (new.organization_id, 0, 0, 'NOT_REQUESTED')
  on conflict (organization_id) do nothing;

  return new;
end;
$ensure_wtc$;

-- ---------------------------------------------------------------------------
-- 8. Free practice plan (reuses the existing subscription/credit system)
-- ---------------------------------------------------------------------------

insert into public.hireveri_plans (
  id, name, slug, price, price_inr, price_usd,
  "interviewLimit", "screeningCredits", "order", "isActive", "planType",
  description, features
)
values (
  'practice-free-trial', 'Free Practice', 'practice-free-trial', 0, 0, 0,
  1, 0, 0, false, 'PRACTICE_CANDIDATE',
  'One free VERIS AI practice interview with personalized feedback.',
  '["1 free AI practice interview", "Personalized VERIS feedback report"]'::jsonb
)
on conflict (id) do update
set "interviewLimit" = 1,
    "planType" = 'PRACTICE_CANDIDATE',
    price = 0,
    price_inr = 0,
    price_usd = 0,
    "isActive" = false,
    "updatedAt" = now();

commit;
