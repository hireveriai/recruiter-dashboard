-- Workspace-scoped free trial credits for new recruiter organizations.
create table if not exists public.workspace_trial_credits (
  organization_id uuid primary key references public.organizations(organization_id) on delete cascade,
  interview_credits_remaining integer not null default 10,
  screening_credits_remaining integer not null default 25,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workspace_trial_credits_interview_non_negative check (interview_credits_remaining >= 0),
  constraint workspace_trial_credits_screening_non_negative check (screening_credits_remaining >= 0)
);

insert into public.workspace_trial_credits (
  organization_id,
  interview_credits_remaining,
  screening_credits_remaining
)
select
  o.organization_id,
  10,
  25
from public.organizations o
where not exists (
  select 1
  from public.workspace_trial_credits c
  where c.organization_id = o.organization_id
);

create index if not exists workspace_trial_credits_updated_at_idx
  on public.workspace_trial_credits (updated_at desc);

create or replace function public.ensure_workspace_trial_credits()
returns trigger
language plpgsql
as $$
begin
  insert into public.workspace_trial_credits (
    organization_id,
    interview_credits_remaining,
    screening_credits_remaining
  )
  values (
    new.organization_id,
    10,
    25
  )
  on conflict (organization_id) do nothing;

  return new;
end;
$$;

drop trigger if exists organizations_seed_workspace_trial_credits on public.organizations;
create trigger organizations_seed_workspace_trial_credits
  after insert on public.organizations
  for each row
  execute function public.ensure_workspace_trial_credits();

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

create index if not exists workspace_trial_credit_events_org_kind_created_idx
  on public.workspace_trial_credit_events (organization_id, kind, created_at desc);

create unique index if not exists workspace_trial_credit_events_source_uidx
  on public.workspace_trial_credit_events (organization_id, kind, source, source_id)
  where source_id is not null;
