-- Interview lifecycle email notifications (candidate started / completed an interview).
--
-- Adds:
--   1. organizations.notify_recruiting_team - org-level toggle (default true).
--   2. interviews.created_by threading through fn_create_interview_link so a real
--      "recruiter" can be resolved for an interview (column already existed but was
--      never populated).
--   3. interview_notification_events / interview_notification_deliveries - an
--      idempotent event + per-recipient delivery ledger. No equivalent table existed
--      before; the dashboard's "Alerts" panel derives INTERVIEW_STARTED/COMPLETED
--      live from interviews/interview_attempts and is left untouched.

begin;

alter table public.organizations
  add column if not exists notify_recruiting_team boolean not null default true;

-- interview_notification_events: one row per (attempt, event_type). The unique
-- constraint is what makes event recording idempotent against page refresh, API
-- retry, webhook-style retry, candidate reconnect, or a race between two backend
-- requests processing the same attempt.
create table if not exists public.interview_notification_events (
  event_id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(organization_id),
  interview_id uuid not null references public.interviews(interview_id),
  attempt_id uuid not null references public.interview_attempts(attempt_id),
  event_type text not null check (event_type in ('INTERVIEW_STARTED', 'INTERVIEW_COMPLETED')),
  event_at timestamptz not null default now(),
  status text not null default 'PENDING' check (status in ('PENDING', 'PROCESSED', 'FAILED')),
  error text,
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  constraint interview_notification_events_unique unique (attempt_id, event_type)
);

create index if not exists idx_interview_notification_events_status
  on public.interview_notification_events (status, created_at);

create index if not exists idx_interview_notification_events_org
  on public.interview_notification_events (organization_id);

-- interview_notification_deliveries: one row per (event, recipient email). This is
-- both the dedup guard (a recruiter who is also a team member gets exactly one row)
-- and the per-recipient send/retry ledger.
create table if not exists public.interview_notification_deliveries (
  delivery_id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.interview_notification_events(event_id),
  organization_id uuid not null references public.organizations(organization_id),
  recipient_user_id uuid references public.users(user_id),
  recipient_email text not null,
  recipient_kind text not null check (recipient_kind in ('RECRUITER', 'TEAM_MEMBER')),
  status text not null default 'PENDING' check (status in ('PENDING', 'SENT', 'FAILED')),
  attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  constraint interview_notification_deliveries_unique unique (event_id, recipient_email)
);

create index if not exists idx_interview_notification_deliveries_status
  on public.interview_notification_deliveries (status, created_at);

create index if not exists idx_interview_notification_deliveries_event
  on public.interview_notification_deliveries (event_id);

-- Thread an optional p_created_by through interview link creation so
-- interviews.created_by (existed already, never populated) becomes the "assigned
-- recruiter" used to resolve notification recipients. Additive: existing callers
-- that omit the new trailing argument keep working unchanged.
create or replace function public.fn_create_interview_link(
  p_organization_id uuid,
  p_job_id uuid,
  p_candidate_id uuid,
  p_access_type text default 'FLEXIBLE',
  p_start_time timestamptz default null,
  p_end_time timestamptz default null,
  p_app_url text default 'http://localhost:3000',
  p_created_by uuid default null
)
returns table (
  interview_id uuid,
  token text,
  link text
)
language plpgsql
as $$
declare
  v_candidate_org_id uuid;
  v_template_id uuid;
  v_coding_weight integer;
  v_verbal_weight integer;
  v_system_design_weight integer;
  v_total_duration integer;
  v_mode text;
  v_interview_duration integer := 30;
  v_coding_required text;
  v_coding_recommended boolean;
  v_behavioral_weight integer;
  v_other_total integer;
  v_remaining integer;
  v_scaled_coding integer;
  v_scaled_system integer;
  v_interview_id uuid;
  v_token uuid;
  v_expires_at timestamptz;
  v_max_attempts integer;
begin
  select c.organization_id
  into v_candidate_org_id
  from public.candidates c
  where c.candidate_id = p_candidate_id
  limit 1;

  if v_candidate_org_id is null then
    raise exception 'CANDIDATE_NOT_FOUND: candidate not found';
  end if;

  select coalesce(jp.interview_duration_minutes, 30)
  into v_interview_duration
  from public.job_positions jp
  where jp.job_id = p_job_id
    and jp.organization_id = p_organization_id
  limit 1;

  select jp.coding_required, jp.coding_recommended
  into v_coding_required, v_coding_recommended
  from public.job_positions jp
  where jp.job_id = p_job_id
    and jp.organization_id = p_organization_id
  limit 1;

  if v_interview_duration is null then
    raise exception 'JOB_NOT_FOUND: job not found for this organization';
  end if;

  if v_candidate_org_id <> p_organization_id then
    raise exception 'ORGANIZATION_MISMATCH: candidate and job must belong to the same organization';
  end if;

  if upper(coalesce(p_access_type, 'FLEXIBLE')) = 'SCHEDULED' then
    if p_start_time is null or p_end_time is null then
      raise exception 'INVALID_TIME: start and end time required';
    end if;

    if p_start_time >= p_end_time then
      raise exception 'INVALID_TIME: end time must be after start time';
    end if;

    v_expires_at := p_end_time;
  else
    v_expires_at := now() + interval '24 hours';
  end if;

  select
    ic.template_id,
    ic.coding_weight,
    ic.verbal_weight,
    ic.system_design_weight,
    ic.total_duration_minutes,
    ic.mode
  into
    v_template_id,
    v_coding_weight,
    v_verbal_weight,
    v_system_design_weight,
    v_total_duration,
    v_mode
  from public.interview_configs ic
  where ic.job_id = p_job_id
  order by ic.created_at desc
  limit 1;

  if v_template_id is null then
    select
      etp.template_id,
      etp.coding_weight,
      etp.verbal_weight,
      etp.system_design_weight,
      etp.total_duration_minutes,
      'AI'
    into
      v_template_id,
      v_coding_weight,
      v_verbal_weight,
      v_system_design_weight,
      v_total_duration,
      v_mode
    from public.evaluation_template_pool etp
    where coalesce(etp.is_active, true) = true
    order by etp.created_at desc
    limit 1;
  end if;

  if v_template_id is null then
    raise exception 'TEMPLATE_NOT_FOUND: no active evaluation template found';
  end if;

  v_behavioral_weight := case
    when upper(coalesce(v_coding_required, 'AUTO')) = 'YES' then 20
    when upper(coalesce(v_coding_required, 'AUTO')) = 'NO' then 45
    else 30
  end;

  v_remaining := greatest(0, 100 - v_behavioral_weight);
  v_other_total := coalesce(v_coding_weight, 0) + coalesce(v_system_design_weight, 0);

  if v_other_total = 0 then
    v_scaled_coding := v_remaining;
    v_scaled_system := 0;
  else
    v_scaled_coding := round((v_remaining::numeric * coalesce(v_coding_weight, 0)) / v_other_total);
    v_scaled_system := v_remaining - v_scaled_coding;
  end if;

  v_coding_weight := v_scaled_coding;
  v_system_design_weight := v_scaled_system;
  v_verbal_weight := v_behavioral_weight;

  v_interview_id := gen_random_uuid();
  v_token := gen_random_uuid();
  v_total_duration := coalesce(v_interview_duration, v_total_duration, 30);

  insert into public.interview_configs (
    interview_id,
    job_id,
    template_id,
    coding_weight,
    verbal_weight,
    system_design_weight,
    total_duration_minutes,
    mode,
    is_active
  )
  values (
    v_interview_id,
    p_job_id,
    v_template_id,
    v_coding_weight,
    v_verbal_weight,
    v_system_design_weight,
    v_total_duration,
    coalesce(v_mode, 'AI'),
    true
  );

  insert into public.interviews (
    interview_id,
    organization_id,
    job_id,
    candidate_id,
    interview_type,
    duration_minutes,
    status,
    created_by
  )
  values (
    v_interview_id,
    p_organization_id,
    p_job_id,
    p_candidate_id,
    'COMPANY_INTERVIEW',
    v_total_duration,
    'PENDING',
    p_created_by
  )
  returning max_attempts into v_max_attempts;

  insert into public.interview_invites (
    interview_id,
    token,
    expires_at,
    status,
    attempts_used,
    max_attempts,
    access_type,
    start_time,
    end_time
  )
  values (
    v_interview_id,
    v_token::text,
    v_expires_at,
    'ACTIVE',
    0,
    -- Inherit the interview's retry budget. Hardcoding 1 here silently capped
    -- every candidate at a single attempt, because start_interview_session
    -- resolves coalesce(invite.max_attempts, interview.max_attempts, 1) and the
    -- invite value always won.
    greatest(coalesce(v_max_attempts, 1), 1),
    upper(coalesce(p_access_type, 'FLEXIBLE')),
    case when upper(coalesce(p_access_type, 'FLEXIBLE')) = 'SCHEDULED' then p_start_time else null end,
    case when upper(coalesce(p_access_type, 'FLEXIBLE')) = 'SCHEDULED' then p_end_time else null end
  );

  return query
  select
    v_interview_id,
    v_token::text,
    rtrim(coalesce(p_app_url, 'http://localhost:3000'), '/') || '/interview/' || v_token::text;
exception
  when others then
    perform public.log_backend_error(
      'fn_create_interview_link',
      sqlerrm,
      sqlstate,
      jsonb_build_object(
        'organization_id', p_organization_id,
        'job_id', p_job_id,
        'candidate_id', p_candidate_id,
        'access_type', p_access_type,
        'interview_duration_minutes', v_interview_duration
      )
    );
    raise;
end;
$$;

commit;
