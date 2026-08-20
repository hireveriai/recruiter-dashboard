-- ============================================================================
-- 013_free_entitlement_functions.sql
--
-- Authoritative server-side logic for the free-entitlement request flow.
--
-- The logic lives in Postgres (matching the existing sp_/fn_ convention used
-- by sp_onboard_recruiter, fn_create_interview_link, hv_purge_organization,
-- ...) so that the recruiter app, the candidate app, the auth app and any
-- future admin surface all share one implementation and one transaction
-- boundary. No application can bypass these checks by calling a different API.
--
-- Rollback: 013_free_entitlement_functions_rollback.sql
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- Constants
-- ---------------------------------------------------------------------------

create or replace function public.fn_free_entitlement_config()
returns table (
  recruiter_ai_interviews integer,
  recruiter_veris_screenings integer,
  candidate_practice_interviews integer,
  auto_approve_max_risk integer,
  ip_soft_limit_24h integer,
  ip_hard_limit_24h integer,
  reapply_cooldown interval
)
language sql
immutable
as $fn_free_entitlement_config$
  select 10, 25, 1, 20, 2, 20, interval '14 days';
$fn_free_entitlement_config$;

-- ---------------------------------------------------------------------------
-- Email / domain helpers
-- ---------------------------------------------------------------------------

create or replace function public.fn_email_domain(p_email text)
returns text
language sql
immutable
as $fn_email_domain$
  select nullif(lower(trim(split_part(coalesce(p_email, ''), '@', 2))), '');
$fn_email_domain$;

-- Normalizes an address so that alias tricks do not read as separate humans:
--   Jatin.Singh+trial@Gmail.com -> jatinsingh@gmail.com
--   sam+two@acme.com            -> sam@acme.com
create or replace function public.fn_normalize_email(p_email text)
returns text
language plpgsql
immutable
as $fn_normalize_email$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_local text;
  v_domain text;
begin
  if v_email = '' or position('@' in v_email) = 0 then
    return nullif(v_email, '');
  end if;

  v_local := split_part(v_email, '@', 1);
  v_domain := split_part(v_email, '@', 2);

  -- Drop the plus tag everywhere; it is universally an alias, never an inbox.
  v_local := split_part(v_local, '+', 1);

  -- Google ignores dots in the local part.
  if v_domain in ('gmail.com', 'googlemail.com') then
    v_local := replace(v_local, '.', '');
    v_domain := 'gmail.com';
  end if;

  if v_local = '' then
    return null;
  end if;

  return v_local || '@' || v_domain;
end;
$fn_normalize_email$;

-- Pulls the registrable-ish host out of a company website value.
create or replace function public.fn_website_domain(p_website text)
returns text
language plpgsql
immutable
as $fn_website_domain$
declare
  v text := lower(trim(coalesce(p_website, '')));
begin
  if v = '' then
    return null;
  end if;

  v := regexp_replace(v, '^[a-z]+://', '');
  v := split_part(v, '/', 1);
  v := split_part(v, '?', 1);
  v := split_part(v, ':', 1);
  v := regexp_replace(v, '^www\.', '');

  return nullif(v, '');
end;
$fn_website_domain$;

create or replace function public.fn_email_domain_kind(p_domain text)
returns text
language sql
stable
as $fn_email_domain_kind$
  select coalesce(
    (select kind from public.email_domain_reputation where domain = lower(coalesce(p_domain, ''))),
    'CORPORATE'
  );
$fn_email_domain_kind$;

-- Loose "does the company name look like the email domain" comparison.
create or replace function public.fn_company_matches_domain(p_company_name text, p_domain text)
returns boolean
language plpgsql
immutable
as $fn_company_matches_domain$
declare
  v_company text;
  v_root text;
begin
  if coalesce(p_company_name, '') = '' or coalesce(p_domain, '') = '' then
    return false;
  end if;

  v_company := regexp_replace(lower(p_company_name), '[^a-z0-9]', '', 'g');
  v_root := regexp_replace(lower(split_part(p_domain, '.', 1)), '[^a-z0-9]', '', 'g');

  if v_company = '' or length(v_root) < 3 then
    return false;
  end if;

  return position(v_root in v_company) > 0 or position(v_company in v_root) > 0;
end;
$fn_company_matches_domain$;

-- ---------------------------------------------------------------------------
-- Audit helper
-- ---------------------------------------------------------------------------

create or replace function public.fn_log_trial_request_event(
  p_request_id uuid,
  p_from_status text,
  p_to_status text,
  p_actor text,
  p_actor_type text,
  p_reason text,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language sql
as $fn_log_trial_request_event$
  insert into public.trial_request_events (
    request_id, from_status, to_status, actor, actor_type, reason, metadata
  )
  values (
    p_request_id, p_from_status, p_to_status, p_actor,
    coalesce(p_actor_type, 'SYSTEM'), p_reason, coalesce(p_metadata, '{}'::jsonb)
  );
$fn_log_trial_request_event$;

-- ---------------------------------------------------------------------------
-- Grant application (exactly once, transactional)
-- ---------------------------------------------------------------------------

-- Applies the entitlement for an APPROVED request. Safe to call any number of
-- times and from any number of concurrent transactions: the unique grant_key
-- means only the first caller ever writes credits.
create or replace function public.fn_apply_trial_grant(p_request_id uuid)
returns table (granted boolean, grant_id uuid)
language plpgsql
as $fn_apply_trial_grant$
#variable_conflict use_column
declare
  v_request public.trial_requests%rowtype;
  v_cfg record;
  v_grant_key text;
  v_grant_id uuid;
  v_practice_org_id uuid;
begin
  select * into v_request
  from public.trial_requests
  where request_id = p_request_id
  for update;

  if not found then
    raise exception 'TRIAL_REQUEST_NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_request.status <> 'APPROVED' then
    raise exception 'TRIAL_REQUEST_NOT_APPROVED' using errcode = 'P0001';
  end if;

  select * into v_cfg from public.fn_free_entitlement_config();
  v_grant_key := v_request.request_type || ':' || v_request.subject_key;

  insert into public.trial_grants (
    grant_key, request_id, request_type, organization_id, identity_id,
    ai_interview_credits, veris_screening_credits, practice_interview_credits
  )
  values (
    v_grant_key,
    v_request.request_id,
    v_request.request_type,
    v_request.organization_id,
    v_request.identity_id,
    case when v_request.request_type = 'RECRUITER_TRIAL' then v_cfg.recruiter_ai_interviews else 0 end,
    case when v_request.request_type = 'RECRUITER_TRIAL' then v_cfg.recruiter_veris_screenings else 0 end,
    case when v_request.request_type = 'CANDIDATE_PRACTICE' then v_cfg.candidate_practice_interviews else 0 end
  )
  on conflict (grant_key) do nothing
  returning public.trial_grants.grant_id into v_grant_id;

  if v_grant_id is null then
    -- Already granted for this subject. Nothing to add: this is the
    -- double-approve / concurrent-approve path.
    return query select false, (select tg.grant_id from public.trial_grants tg where tg.grant_key = v_grant_key);
    return;
  end if;

  if v_request.request_type = 'RECRUITER_TRIAL' then
    insert into public.workspace_trial_credits (
      organization_id, interview_credits_remaining, screening_credits_remaining,
      trial_status, trial_request_id, trial_granted_at
    )
    values (
      v_request.organization_id,
      v_cfg.recruiter_ai_interviews,
      v_cfg.recruiter_veris_screenings,
      'APPROVED',
      v_request.request_id,
      now()
    )
    on conflict (organization_id) do update
    set interview_credits_remaining =
          public.workspace_trial_credits.interview_credits_remaining + v_cfg.recruiter_ai_interviews,
        screening_credits_remaining =
          public.workspace_trial_credits.screening_credits_remaining + v_cfg.recruiter_veris_screenings,
        trial_status = 'APPROVED',
        trial_request_id = v_request.request_id,
        trial_granted_at = now(),
        updated_at = now();

    insert into public.workspace_trial_credit_events (
      organization_id, kind, amount, source, source_id, metadata
    )
    values
      (v_request.organization_id, 'INTERVIEW', v_cfg.recruiter_ai_interviews,
       'free_trial_grant', v_request.request_id::text,
       jsonb_build_object('grant', true, 'requestId', v_request.request_id)),
      (v_request.organization_id, 'SCREENING', v_cfg.recruiter_veris_screenings,
       'free_trial_grant', v_request.request_id::text,
       jsonb_build_object('grant', true, 'requestId', v_request.request_id))
    on conflict do nothing;

  elsif v_request.request_type = 'CANDIDATE_PRACTICE' then
    -- Reuses the existing practice subscription/credit system. The primary key
    -- is deterministic, so a retry can never create a second free plan.
    --
    -- organizationId is NOT NULL in production, so resolve it properly rather
    -- than relying on the candidate row already existing: a candidate may
    -- request the free interview before ever creating one.
    select c.organization_id
    into v_practice_org_id
    from public.candidate_identity_links cil
    join public.candidates c on c.candidate_id = cil.candidate_id
    where cil.identity_id = v_request.identity_id
      and cil.purpose = 'practice'
    order by c.created_at desc
    limit 1;

    if v_practice_org_id is null then
      select o.organization_id
      into v_practice_org_id
      from public.organizations o
      where lower(o.organization_name) in ('practice arena', 'practice')
      order by case when lower(o.organization_name) = 'practice arena' then 0 else 1 end
      limit 1;
    end if;

    if v_practice_org_id is null then
      insert into public.organizations (organization_name, is_active)
      values ('Practice Arena', true)
      returning public.organizations.organization_id into v_practice_org_id;
    end if;

    insert into public.hireveri_user_subscriptions (
      id, "userId", "planId", "organizationId",
      "totalCredits", "usedCredits", "screeningCredits",
      status, "amountPaid", currency, "activatedAt", "startedAt", "updatedAt"
    )
    values (
      'free-practice-' || v_request.identity_id::text,
      v_request.identity_id::text,
      'practice-free-trial',
      v_practice_org_id,
      v_cfg.candidate_practice_interviews,
      0, 0,
      'active', 0, 'INR', now(), now(), now()
    )
    on conflict (id) do nothing;
  end if;

  perform public.fn_log_trial_request_event(
    v_request.request_id, 'APPROVED', 'APPROVED', 'system', 'SYSTEM',
    'entitlement_granted',
    jsonb_build_object('grantId', v_grant_id, 'grantKey', v_grant_key)
  );

  return query select true, v_grant_id;
end;
$fn_apply_trial_grant$;

-- ---------------------------------------------------------------------------
-- Recruiter trial request
-- ---------------------------------------------------------------------------

create or replace function public.fn_request_recruiter_trial(
  p_organization_id uuid,
  p_user_id uuid,
  p_email text,
  p_email_verified boolean,
  p_company_name text,
  p_company_website text,
  p_request_ip text default null,
  p_user_agent text default null,
  p_device_hash text default null
)
returns table (
  request_id uuid,
  status text,
  risk_level text,
  risk_score integer,
  risk_reasons text[],
  auto_decision boolean
)
language plpgsql
as $fn_request_recruiter_trial$
#variable_conflict use_column
declare
  v_cfg record;
  v_subject_key text := 'org:' || p_organization_id::text;
  v_email text := lower(trim(coalesce(p_email, '')));
  v_email_norm text := public.fn_normalize_email(p_email);
  v_domain text := public.fn_email_domain(p_email);
  v_domain_kind text;
  v_site_domain text := public.fn_website_domain(p_company_website);
  v_score integer := 0;
  v_reasons text[] := '{}';
  -- Duplicate and burst signals are gates, not points: a strong company
  -- signal must never be able to outvote "this domain already has a trial".
  v_force_review boolean := false;
  v_status text;
  v_request_id uuid;
  v_ip_count integer := 0;
  v_domain_granted integer := 0;
  v_existing public.trial_requests%rowtype;
  v_validation jsonb;
begin
  if p_organization_id is null then
    raise exception 'ORGANIZATION_REQUIRED' using errcode = 'P0001';
  end if;

  select * into v_cfg from public.fn_free_entitlement_config();

  -- Already granted for this organization: idempotent, never a second grant.
  if exists (
    select 1 from public.trial_grants
    where grant_key = 'RECRUITER_TRIAL:' || v_subject_key
  ) then
    select * into v_existing
    from public.trial_requests
    where request_type = 'RECRUITER_TRIAL'
      and subject_key = v_subject_key
      and status = 'APPROVED'
    limit 1;

    return query select v_existing.request_id, 'APPROVED'::text, v_existing.risk_level,
                        v_existing.risk_score, v_existing.risk_reasons, v_existing.auto_decision;
    return;
  end if;

  -- An open request already exists: return it rather than creating a duplicate.
  select * into v_existing
  from public.trial_requests
  where request_type = 'RECRUITER_TRIAL'
    and subject_key = v_subject_key
    and status = 'PENDING_REVIEW'
  limit 1;

  if found then
    return query select v_existing.request_id, v_existing.status, v_existing.risk_level,
                        v_existing.risk_score, v_existing.risk_reasons, v_existing.auto_decision;
    return;
  end if;

  -- A recent rejection must not be re-submittable immediately.
  if exists (
    select 1 from public.trial_requests
    where request_type = 'RECRUITER_TRIAL'
      and subject_key = v_subject_key
      and status = 'REJECTED'
      and decided_at > now() - v_cfg.reapply_cooldown
  ) then
    raise exception 'TRIAL_REAPPLY_TOO_SOON' using errcode = 'P0001';
  end if;

  -- Hard IP throttle.
  select count(*) into v_ip_count
  from public.trial_requests
  where request_ip is not null
    and request_ip = p_request_ip
    and created_at > now() - interval '24 hours';

  if p_request_ip is not null and v_ip_count >= v_cfg.ip_hard_limit_24h then
    raise exception 'TRIAL_REQUEST_RATE_LIMITED' using errcode = 'P0001';
  end if;

  -- ---- risk signals -------------------------------------------------------
  v_domain_kind := public.fn_email_domain_kind(v_domain);

  if not coalesce(p_email_verified, false) then
    v_score := v_score + 40;
    v_reasons := v_reasons || 'email_not_verified'::text;
  end if;

  if v_domain is null then
    v_score := v_score + 60;
    v_reasons := v_reasons || 'missing_email_domain'::text;
  elsif v_domain_kind = 'DISPOSABLE' then
    v_score := v_score + 70;
    v_reasons := v_reasons || 'disposable_email_domain'::text;
  elsif v_domain_kind = 'PUBLIC' then
    v_score := v_score + 35;
    v_reasons := v_reasons || 'public_email_domain'::text;
  end if;

  if coalesce(trim(p_company_name), '') = '' then
    v_score := v_score + 25;
    v_reasons := v_reasons || 'missing_company_name'::text;
  end if;

  if v_site_domain is null then
    v_score := v_score + 15;
    v_reasons := v_reasons || 'missing_company_website'::text;
  elsif v_domain is not null and v_domain_kind = 'CORPORATE' then
    if v_site_domain = v_domain or v_site_domain like '%.' || v_domain or v_domain like '%.' || v_site_domain then
      v_score := v_score - 25;
      v_reasons := v_reasons || 'website_matches_email_domain'::text;
    else
      v_score := v_score + 20;
      v_reasons := v_reasons || 'website_domain_mismatch'::text;
    end if;
  end if;

  if v_domain_kind = 'CORPORATE' and public.fn_company_matches_domain(p_company_name, v_domain) then
    v_score := v_score - 15;
    v_reasons := v_reasons || 'company_name_matches_domain'::text;
  end if;

  -- Another organization on the same corporate domain already holds a trial.
  if v_domain is not null and v_domain_kind = 'CORPORATE' then
    select count(*) into v_domain_granted
    from public.trial_grants g
    join public.trial_requests r on r.request_id = g.request_id
    where g.request_type = 'RECRUITER_TRIAL'
      and r.email_domain = v_domain
      and (g.organization_id is distinct from p_organization_id);

    if v_domain_granted > 0 then
      v_score := v_score + 60;
      v_reasons := v_reasons || 'domain_already_received_trial'::text;
      v_force_review := true;
    end if;
  end if;

  if p_request_ip is not null and v_ip_count >= v_cfg.ip_soft_limit_24h then
    v_score := v_score + 30;
    v_reasons := v_reasons || 'ip_request_burst'::text;
    v_force_review := true;
  end if;

  if p_device_hash is not null and exists (
    select 1 from public.trial_grants g
    join public.trial_requests r on r.request_id = g.request_id
    where r.device_hash = p_device_hash
      and g.request_type = 'RECRUITER_TRIAL'
  ) then
    v_score := v_score + 40;
    v_reasons := v_reasons || 'device_already_received_trial'::text;
    v_force_review := true;
  end if;

  v_score := greatest(v_score, 0);

  v_validation := jsonb_build_object(
    'emailDomain', v_domain,
    'emailDomainKind', v_domain_kind,
    'websiteDomain', v_site_domain,
    'emailVerified', coalesce(p_email_verified, false),
    'ipRequests24h', v_ip_count,
    'domainGrantCount', v_domain_granted,
    'forcedReview', v_force_review
  );

  if v_score <= v_cfg.auto_approve_max_risk and not v_force_review then
    v_status := 'APPROVED';
  else
    v_status := 'PENDING_REVIEW';
  end if;

  begin
    insert into public.trial_requests (
      request_type, status, subject_key, organization_id, requested_by_user_id,
      contact_email, email_normalized, email_domain, email_verified,
      company_name, company_website, company_domain,
      risk_score, risk_level, risk_reasons, validation,
      auto_decision, decided_at, decided_by, decision_reason,
      request_ip, user_agent, device_hash
    )
    values (
      'RECRUITER_TRIAL', v_status, v_subject_key, p_organization_id, p_user_id,
      nullif(v_email, ''), v_email_norm, v_domain, coalesce(p_email_verified, false),
      nullif(trim(coalesce(p_company_name, '')), ''),
      nullif(trim(coalesce(p_company_website, '')), ''),
      v_site_domain,
      v_score,
      case when v_score <= 20 then 'LOW' when v_score <= 60 then 'MEDIUM' else 'HIGH' end,
      v_reasons, v_validation,
      v_status = 'APPROVED',
      case when v_status = 'APPROVED' then now() end,
      case when v_status = 'APPROVED' then 'auto-validator' end,
      case when v_status = 'APPROVED' then 'company_validation_passed' end,
      p_request_ip, p_user_agent, p_device_hash
    )
    returning public.trial_requests.request_id into v_request_id;
  exception
    when unique_violation then
      -- Lost a race against a concurrent submit: return the winner.
      select * into v_existing
      from public.trial_requests
      where request_type = 'RECRUITER_TRIAL'
        and subject_key = v_subject_key
        and status in ('PENDING_REVIEW', 'APPROVED')
      order by case when status = 'APPROVED' then 0 else 1 end
      limit 1;

      return query select v_existing.request_id, v_existing.status, v_existing.risk_level,
                          v_existing.risk_score, v_existing.risk_reasons, v_existing.auto_decision;
      return;
  end;

  perform public.fn_log_trial_request_event(
    v_request_id, null, v_status, coalesce(p_user_id::text, 'user'), 'USER',
    'trial_requested', v_validation || jsonb_build_object('riskScore', v_score, 'riskReasons', v_reasons)
  );

  if v_status = 'PENDING_REVIEW' then
    update public.workspace_trial_credits
    set trial_status = 'PENDING_REVIEW',
        trial_request_id = v_request_id,
        updated_at = now()
    where organization_id = p_organization_id;

    if not found then
      insert into public.workspace_trial_credits (
        organization_id, interview_credits_remaining, screening_credits_remaining,
        trial_status, trial_request_id
      )
      values (p_organization_id, 0, 0, 'PENDING_REVIEW', v_request_id)
      on conflict (organization_id) do update
      set trial_status = 'PENDING_REVIEW',
          trial_request_id = v_request_id,
          updated_at = now();
    end if;
  else
    perform public.fn_apply_trial_grant(v_request_id);
  end if;

  return query
    select r.request_id, r.status, r.risk_level, r.risk_score, r.risk_reasons, r.auto_decision
    from public.trial_requests r
    where r.request_id = v_request_id;
end;
$fn_request_recruiter_trial$;

-- ---------------------------------------------------------------------------
-- Candidate free practice request
-- ---------------------------------------------------------------------------

create or replace function public.fn_request_candidate_practice(
  p_identity_id uuid,
  p_email text,
  p_email_verified boolean,
  p_request_ip text default null,
  p_user_agent text default null,
  p_device_hash text default null
)
returns table (
  request_id uuid,
  status text,
  risk_level text,
  risk_score integer,
  risk_reasons text[],
  auto_decision boolean
)
language plpgsql
as $fn_request_candidate_practice$
#variable_conflict use_column
declare
  v_cfg record;
  v_subject_key text := 'identity:' || p_identity_id::text;
  v_email text := lower(trim(coalesce(p_email, '')));
  v_email_norm text := public.fn_normalize_email(p_email);
  v_domain text := public.fn_email_domain(p_email);
  v_domain_kind text;
  v_score integer := 0;
  v_reasons text[] := '{}';
  -- Any sign that this free interview may already have been collected sends
  -- the request to a human instead of being outvoted by a clean score.
  v_force_review boolean := false;
  v_status text;
  v_request_id uuid;
  v_ip_count integer := 0;
  v_existing public.trial_requests%rowtype;
  v_validation jsonb;
begin
  if p_identity_id is null then
    raise exception 'IDENTITY_REQUIRED' using errcode = 'P0001';
  end if;

  select * into v_cfg from public.fn_free_entitlement_config();

  if exists (
    select 1 from public.trial_grants
    where grant_key = 'CANDIDATE_PRACTICE:' || v_subject_key
  ) then
    select * into v_existing
    from public.trial_requests
    where request_type = 'CANDIDATE_PRACTICE'
      and subject_key = v_subject_key
      and status = 'APPROVED'
    limit 1;

    return query select v_existing.request_id, 'APPROVED'::text, v_existing.risk_level,
                        v_existing.risk_score, v_existing.risk_reasons, v_existing.auto_decision;
    return;
  end if;

  select * into v_existing
  from public.trial_requests
  where request_type = 'CANDIDATE_PRACTICE'
    and subject_key = v_subject_key
    and status = 'PENDING_REVIEW'
  limit 1;

  if found then
    return query select v_existing.request_id, v_existing.status, v_existing.risk_level,
                        v_existing.risk_score, v_existing.risk_reasons, v_existing.auto_decision;
    return;
  end if;

  if exists (
    select 1 from public.trial_requests
    where request_type = 'CANDIDATE_PRACTICE'
      and subject_key = v_subject_key
      and status = 'REJECTED'
      and decided_at > now() - v_cfg.reapply_cooldown
  ) then
    raise exception 'TRIAL_REAPPLY_TOO_SOON' using errcode = 'P0001';
  end if;

  select count(*) into v_ip_count
  from public.trial_requests
  where request_ip is not null
    and request_ip = p_request_ip
    and created_at > now() - interval '24 hours';

  if p_request_ip is not null and v_ip_count >= v_cfg.ip_hard_limit_24h then
    raise exception 'TRIAL_REQUEST_RATE_LIMITED' using errcode = 'P0001';
  end if;

  -- ---- risk signals -------------------------------------------------------
  v_domain_kind := public.fn_email_domain_kind(v_domain);

  if not coalesce(p_email_verified, false) then
    v_score := v_score + 40;
    v_reasons := v_reasons || 'email_not_verified'::text;
  end if;

  if v_domain is null then
    v_score := v_score + 60;
    v_reasons := v_reasons || 'missing_email_domain'::text;
  elsif v_domain_kind = 'DISPOSABLE' then
    v_score := v_score + 70;
    v_reasons := v_reasons || 'disposable_email_domain'::text;
  end if;

  -- The same human behind a new address: normalized email already used a
  -- free practice entitlement.
  if v_email_norm is not null and exists (
    select 1 from public.trial_grants g
    join public.trial_requests r on r.request_id = g.request_id
    where g.request_type = 'CANDIDATE_PRACTICE'
      and r.email_normalized = v_email_norm
      and g.identity_id is distinct from p_identity_id
  ) then
    v_score := v_score + 70;
    v_reasons := v_reasons || 'normalized_email_already_used_free_practice'::text;
    v_force_review := true;
  end if;

  -- Same browser/device already collected a free practice.
  if p_device_hash is not null and exists (
    select 1 from public.trial_grants g
    join public.trial_requests r on r.request_id = g.request_id
    where g.request_type = 'CANDIDATE_PRACTICE'
      and r.device_hash = p_device_hash
      and g.identity_id is distinct from p_identity_id
  ) then
    v_score := v_score + 60;
    v_reasons := v_reasons || 'device_already_used_free_practice'::text;
    v_force_review := true;
  end if;

  if p_request_ip is not null and exists (
    select 1 from public.trial_grants g
    join public.trial_requests r on r.request_id = g.request_id
    where g.request_type = 'CANDIDATE_PRACTICE'
      and r.request_ip = p_request_ip
      and g.identity_id is distinct from p_identity_id
      and g.granted_at > now() - interval '30 days'
  ) then
    v_score := v_score + 25;
    v_reasons := v_reasons || 'ip_already_used_free_practice'::text;
  end if;

  if p_request_ip is not null and v_ip_count >= v_cfg.ip_soft_limit_24h then
    v_score := v_score + 30;
    v_reasons := v_reasons || 'ip_request_burst'::text;
    v_force_review := true;
  end if;

  -- A brand new identity created moments ago is a weak signal on its own,
  -- so it only nudges the score rather than deciding the outcome.
  if exists (
    select 1 from public.identity_users
    where identity_id = p_identity_id
      and created_at > now() - interval '2 minutes'
  ) then
    v_score := v_score + 5;
    v_reasons := v_reasons || 'account_created_moments_ago'::text;
  end if;

  v_score := greatest(v_score, 0);

  v_validation := jsonb_build_object(
    'emailDomain', v_domain,
    'emailDomainKind', v_domain_kind,
    'emailVerified', coalesce(p_email_verified, false),
    'normalizedEmail', v_email_norm,
    'ipRequests24h', v_ip_count,
    'forcedReview', v_force_review
  );

  v_status := case
    when v_score <= v_cfg.auto_approve_max_risk and not v_force_review then 'APPROVED'
    else 'PENDING_REVIEW'
  end;

  begin
    insert into public.trial_requests (
      request_type, status, subject_key, identity_id,
      contact_email, email_normalized, email_domain, email_verified,
      risk_score, risk_level, risk_reasons, validation,
      auto_decision, decided_at, decided_by, decision_reason,
      request_ip, user_agent, device_hash
    )
    values (
      'CANDIDATE_PRACTICE', v_status, v_subject_key, p_identity_id,
      nullif(v_email, ''), v_email_norm, v_domain, coalesce(p_email_verified, false),
      v_score,
      case when v_score <= 20 then 'LOW' when v_score <= 60 then 'MEDIUM' else 'HIGH' end,
      v_reasons, v_validation,
      v_status = 'APPROVED',
      case when v_status = 'APPROVED' then now() end,
      case when v_status = 'APPROVED' then 'auto-validator' end,
      case when v_status = 'APPROVED' then 'eligibility_checks_passed' end,
      p_request_ip, p_user_agent, p_device_hash
    )
    returning public.trial_requests.request_id into v_request_id;
  exception
    when unique_violation then
      select * into v_existing
      from public.trial_requests
      where request_type = 'CANDIDATE_PRACTICE'
        and subject_key = v_subject_key
        and status in ('PENDING_REVIEW', 'APPROVED')
      order by case when status = 'APPROVED' then 0 else 1 end
      limit 1;

      return query select v_existing.request_id, v_existing.status, v_existing.risk_level,
                          v_existing.risk_score, v_existing.risk_reasons, v_existing.auto_decision;
      return;
  end;

  perform public.fn_log_trial_request_event(
    v_request_id, null, v_status, p_identity_id::text, 'USER',
    'practice_requested', v_validation || jsonb_build_object('riskScore', v_score, 'riskReasons', v_reasons)
  );

  if v_status = 'APPROVED' then
    perform public.fn_apply_trial_grant(v_request_id);
  end if;

  return query
    select r.request_id, r.status, r.risk_level, r.risk_score, r.risk_reasons, r.auto_decision
    from public.trial_requests r
    where r.request_id = v_request_id;
end;
$fn_request_candidate_practice$;

-- ---------------------------------------------------------------------------
-- Admin decisions
-- ---------------------------------------------------------------------------

create or replace function public.fn_approve_trial_request(
  p_request_id uuid,
  p_actor text,
  p_reason text default null
)
returns table (request_id uuid, status text, granted boolean)
language plpgsql
as $fn_approve_trial_request$
#variable_conflict use_column
declare
  v_request public.trial_requests%rowtype;
  v_granted boolean := false;
begin
  -- The row lock serializes concurrent approvals of the same request.
  select * into v_request
  from public.trial_requests
  where public.trial_requests.request_id = p_request_id
  for update;

  if not found then
    raise exception 'TRIAL_REQUEST_NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_request.status = 'APPROVED' then
    -- Idempotent: fn_apply_trial_grant is a no-op once the grant exists.
    select g.granted into v_granted from public.fn_apply_trial_grant(p_request_id) g;
    return query select v_request.request_id, v_request.status, coalesce(v_granted, false);
    return;
  end if;

  if v_request.status not in ('PENDING_REVIEW', 'REJECTED') then
    raise exception 'TRIAL_REQUEST_NOT_DECIDABLE' using errcode = 'P0001';
  end if;

  update public.trial_requests
  set status = 'APPROVED',
      decided_at = now(),
      decided_by = coalesce(p_actor, 'admin'),
      decision_reason = coalesce(p_reason, 'approved_by_admin'),
      auto_decision = false,
      updated_at = now()
  where public.trial_requests.request_id = p_request_id;

  perform public.fn_log_trial_request_event(
    p_request_id, v_request.status, 'APPROVED', coalesce(p_actor, 'admin'), 'ADMIN', p_reason
  );

  select g.granted into v_granted from public.fn_apply_trial_grant(p_request_id) g;

  return query select p_request_id, 'APPROVED'::text, coalesce(v_granted, false);
end;
$fn_approve_trial_request$;

create or replace function public.fn_reject_trial_request(
  p_request_id uuid,
  p_actor text,
  p_reason text default null
)
returns table (request_id uuid, status text)
language plpgsql
as $fn_reject_trial_request$
#variable_conflict use_column
declare
  v_request public.trial_requests%rowtype;
begin
  select * into v_request
  from public.trial_requests
  where public.trial_requests.request_id = p_request_id
  for update;

  if not found then
    raise exception 'TRIAL_REQUEST_NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_request.status = 'REJECTED' then
    return query select v_request.request_id, v_request.status;
    return;
  end if;

  if v_request.status = 'APPROVED' then
    -- Never claw back an entitlement that was already handed out here; that
    -- is a separate, deliberate operation.
    raise exception 'TRIAL_REQUEST_ALREADY_APPROVED' using errcode = 'P0001';
  end if;

  update public.trial_requests
  set status = 'REJECTED',
      decided_at = now(),
      decided_by = coalesce(p_actor, 'admin'),
      decision_reason = coalesce(p_reason, 'rejected_by_admin'),
      auto_decision = false,
      updated_at = now()
  where public.trial_requests.request_id = p_request_id;

  perform public.fn_log_trial_request_event(
    p_request_id, v_request.status, 'REJECTED', coalesce(p_actor, 'admin'), 'ADMIN', p_reason
  );

  if v_request.request_type = 'RECRUITER_TRIAL' and v_request.organization_id is not null then
    update public.workspace_trial_credits
    set trial_status = 'REJECTED', updated_at = now()
    where organization_id = v_request.organization_id
      and trial_status = 'PENDING_REVIEW';
  end if;

  return query select p_request_id, 'REJECTED'::text;
end;
$fn_reject_trial_request$;

-- ---------------------------------------------------------------------------
-- State readers
-- ---------------------------------------------------------------------------

create or replace function public.fn_get_recruiter_trial_state(p_organization_id uuid)
returns jsonb
language sql
stable
as $fn_get_recruiter_trial_state$
  with latest as (
    select *
    from public.trial_requests
    where request_type = 'RECRUITER_TRIAL'
      and organization_id = p_organization_id
    order by case status when 'APPROVED' then 0 when 'PENDING_REVIEW' then 1 else 2 end,
             created_at desc
    limit 1
  ),
  granted as (
    select * from public.trial_grants
    where request_type = 'RECRUITER_TRIAL'
      and grant_key = 'RECRUITER_TRIAL:org:' || p_organization_id::text
  ),
  credits as (
    select * from public.workspace_trial_credits where organization_id = p_organization_id
  )
  select jsonb_build_object(
    'organizationId', p_organization_id,
    'status', coalesce(
      (select status from latest),
      (select trial_status from credits),
      'NOT_REQUESTED'
    ),
    'requestId', (select request_id from latest),
    'requestedAt', (select created_at from latest),
    'decidedAt', (select decided_at from latest),
    'decisionReason', (select decision_reason from latest),
    'riskLevel', (select risk_level from latest),
    'autoDecision', (select auto_decision from latest),
    'granted', exists (select 1 from granted),
    'grantedAt', (select granted_at from granted),
    'expiresAt', (select expires_at from granted),
    'interviewCreditsRemaining', coalesce((select interview_credits_remaining from credits), 0),
    'screeningCreditsRemaining', coalesce((select screening_credits_remaining from credits), 0)
  );
$fn_get_recruiter_trial_state$;

create or replace function public.fn_get_candidate_practice_state(p_identity_id uuid)
returns jsonb
language sql
stable
as $fn_get_candidate_practice_state$
  with latest as (
    select *
    from public.trial_requests
    where request_type = 'CANDIDATE_PRACTICE'
      and identity_id = p_identity_id
    order by case status when 'APPROVED' then 0 when 'PENDING_REVIEW' then 1 else 2 end,
             created_at desc
    limit 1
  ),
  granted as (
    select * from public.trial_grants
    where request_type = 'CANDIDATE_PRACTICE'
      and grant_key = 'CANDIDATE_PRACTICE:identity:' || p_identity_id::text
  ),
  sub as (
    select * from public.hireveri_user_subscriptions
    where id = 'free-practice-' || p_identity_id::text
  )
  select jsonb_build_object(
    'identityId', p_identity_id,
    'status', coalesce((select status from latest), 'NOT_REQUESTED'),
    'requestId', (select request_id from latest),
    'requestedAt', (select created_at from latest),
    'decidedAt', (select decided_at from latest),
    'decisionReason', (select decision_reason from latest),
    'riskLevel', (select risk_level from latest),
    'granted', exists (select 1 from granted),
    'grantedAt', (select granted_at from granted),
    'freeCreditsRemaining', coalesce((select "totalCredits" from sub), 0),
    'freeCreditsUsed', coalesce((select "usedCredits" from sub), 0),
    'consumed', coalesce((select "totalCredits" from sub), 0) = 0
                and coalesce((select "usedCredits" from sub), 0) > 0
  );
$fn_get_candidate_practice_state$;

commit;
