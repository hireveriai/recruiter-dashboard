-- ============================================================================
-- 018_recruiter_trial_manual_review_rollback.sql
--
-- Restores the 013 behaviour where a low-risk recruiter trial request approves
-- and grants itself without an admin review. Only run this if manual review
-- has to be abandoned.
-- ============================================================================

begin;

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

commit;
