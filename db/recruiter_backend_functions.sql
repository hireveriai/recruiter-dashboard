create extension if not exists pgcrypto;

create table if not exists public.backend_error_logs (
  error_log_id uuid primary key default gen_random_uuid(),
  function_name text not null,
  error_message text not null,
  sql_state text,
  payload jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.log_backend_error(
  p_function_name text,
  p_error_message text,
  p_sql_state text default null,
  p_payload jsonb default null
)
returns void
language plpgsql
as $$
begin
  insert into public.backend_error_logs (
    function_name,
    error_message,
    sql_state,
    payload
  )
  values (
    p_function_name,
    p_error_message,
    p_sql_state,
    p_payload
  );
exception
  when others then
    null;
end;
$$;

create or replace function public.fn_get_experience_levels()
returns table (
  experience_level_id smallint,
  label text
)
language plpgsql
as $$
begin
  return query
  select elp.experience_level_id, elp.label
  from public.experience_level_pool elp
  order by elp.experience_level_id asc;
exception
  when others then
    perform public.log_backend_error(
      'fn_get_experience_levels',
      sqlerrm,
      sqlstate,
      null
    );
    raise;
end;
$$;

create or replace function public.fn_get_recruiter_profile(
  p_user_id uuid
)
returns table (
  recruiter_name text,
  organization_name text
)
language plpgsql
as $$
begin
  return query
  select
    coalesce(u.full_name, 'Unknown Recruiter') as recruiter_name,
    coalesce(o.organization_name, '') as organization_name
  from public.users u
  left join public.organizations o
    on o.organization_id = u.organization_id
  where u.user_id = p_user_id
  limit 1;
exception
  when others then
    perform public.log_backend_error(
      'fn_get_recruiter_profile',
      sqlerrm,
      sqlstate,
      jsonb_build_object('user_id', p_user_id)
    );
    raise;
end;
$$;

create or replace function public.fn_create_job(
  p_organization_id uuid,
  p_job_title text,
  p_job_description text,
  p_experience_level_id smallint,
  p_core_skills text[],
  p_difficulty_profile text,
  p_skill_baseline jsonb default '[]'::jsonb
)
returns table (
  job_id uuid
)
language plpgsql
as $$
declare
  v_job_id uuid;
begin
  if not exists (
    select 1
    from public.experience_level_pool elp
    where elp.experience_level_id = p_experience_level_id
  ) then
    raise exception 'INVALID_EXPERIENCE_LEVEL: experience_level_id does not exist';
  end if;

  if p_skill_baseline is not null and jsonb_typeof(p_skill_baseline) = 'array' then
    if exists (
      select 1
      from jsonb_array_elements(p_skill_baseline) as baseline
      where coalesce((baseline ->> 'expected_level')::int, 0) < 1
         or coalesce((baseline ->> 'expected_level')::int, 0) > 4
    ) then
      raise exception 'INVALID_EXPECTED_LEVEL: expected_level must be between 1 and 4';
    end if;
  end if;

  insert into public.job_positions (
    organization_id,
    job_title,
    job_description,
    experience_level_id,
    core_skills,
    difficulty_profile
  )
  values (
    p_organization_id,
    p_job_title,
    nullif(p_job_description, ''),
    p_experience_level_id,
    coalesce(p_core_skills, array[]::text[]),
    p_difficulty_profile
  )
  returning job_positions.job_id into v_job_id;

  if p_skill_baseline is not null and jsonb_typeof(p_skill_baseline) = 'array' and jsonb_array_length(p_skill_baseline) > 0 then
    insert into public.company_skill_baseline (
      organization_id,
      job_id,
      skill_domain,
      expected_level
    )
    select
      p_organization_id,
      v_job_id,
      baseline ->> 'skill_domain',
      (baseline ->> 'expected_level')::int
    from jsonb_array_elements(p_skill_baseline) as baseline;
  end if;

  return query select v_job_id;
exception
  when others then
    perform public.log_backend_error(
      'fn_create_job',
      sqlerrm,
      sqlstate,
      jsonb_build_object(
        'organization_id', p_organization_id,
        'job_title', p_job_title,
        'experience_level_id', p_experience_level_id
      )
    );
    raise;
end;
$$;

create or replace function public.fn_upsert_candidate(
  p_organization_id uuid,
  p_job_id uuid,
  p_full_name text,
  p_email text,
  p_resume_url text default null,
  p_resume_text text default null
)
returns table (
  candidate_id uuid
)
language plpgsql
as $$
declare
  v_candidate_id uuid;
begin
  if not exists (
    select 1
    from public.job_positions jp
    where jp.job_id = p_job_id
      and jp.organization_id = p_organization_id
  ) then
    raise exception 'JOB_NOT_FOUND: job not found for this organization';
  end if;

  select c.candidate_id
  into v_candidate_id
  from public.candidates c
  where c.organization_id = p_organization_id
    and lower(c.email) = lower(p_email)
  order by c.created_at desc
  limit 1;

  if v_candidate_id is not null then
    update public.candidates
    set
      full_name = p_full_name,
      email = lower(p_email),
      resume_url = p_resume_url,
      resume_text = p_resume_text
    where candidates.candidate_id = v_candidate_id;
  else
    insert into public.candidates (
      organization_id,
      full_name,
      email,
      resume_url,
      resume_text
    )
    values (
      p_organization_id,
      p_full_name,
      lower(p_email),
      p_resume_url,
      p_resume_text
    )
    returning candidates.candidate_id into v_candidate_id;
  end if;

  return query select v_candidate_id;
exception
  when others then
    perform public.log_backend_error(
      'fn_upsert_candidate',
      sqlerrm,
      sqlstate,
      jsonb_build_object(
        'organization_id', p_organization_id,
        'job_id', p_job_id,
        'email', p_email
      )
    );
    raise;
end;
$$;

create or replace function public.fn_create_interview_link(
  p_organization_id uuid,
  p_job_id uuid,
  p_candidate_id uuid,
  p_access_type text default 'FLEXIBLE',
  p_start_time timestamptz default null,
  p_end_time timestamptz default null,
  p_app_url text default 'http://localhost:3000'
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

  if not exists (
    select 1
    from public.job_positions jp
    where jp.job_id = p_job_id
      and jp.organization_id = p_organization_id
  ) then
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

  v_interview_id := gen_random_uuid();
  v_token := gen_random_uuid();

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
    status
  )
  values (
    v_interview_id,
    p_organization_id,
    p_job_id,
    p_candidate_id,
    'COMPANY_INTERVIEW',
    'PENDING'
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
    p_start_time,
    p_end_time
  );

  return query
  select v_interview_id, v_token::text, concat(trim(trailing '/' from p_app_url), '/interview/', v_token::text);
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
        'access_type', p_access_type
      )
    );
    raise;
end;
$$;

create or replace function public.fn_validate_interview_token(
  p_token text
)
returns table (
  valid boolean,
  reason text,
  interview_id uuid,
  candidate_id uuid
)
language plpgsql
as $$
declare
  v_invite record;
  v_now timestamptz := now();
begin
  select
    ii.interview_id,
    i.candidate_id,
    ii.status,
    ii.expires_at,
    ii.used_at,
    ii.access_type,
    ii.start_time,
    ii.end_time
  into v_invite
  from public.interview_invites ii
  inner join public.interviews i
    on i.interview_id = ii.interview_id
  where ii.token = p_token
  limit 1;

  if v_invite is null then
    return query select false, 'INVALID_TOKEN', null::uuid, null::uuid;
    return;
  end if;

  if v_invite.used_at is not null or upper(coalesce(v_invite.status, '')) in ('USED', 'COMPLETED') then
    return query select false, 'USED', v_invite.interview_id, v_invite.candidate_id;
    return;
  end if;

  if upper(coalesce(v_invite.access_type, 'FLEXIBLE')) = 'SCHEDULED' then
    if v_invite.start_time is null or v_invite.end_time is null then
      return query select false, 'INVALID_TIME_WINDOW', v_invite.interview_id, v_invite.candidate_id;
      return;
    end if;

    if v_now < v_invite.start_time then
      return query select false, 'NOT_STARTED', v_invite.interview_id, v_invite.candidate_id;
      return;
    end if;

    if v_now > v_invite.end_time then
      return query select false, 'EXPIRED', v_invite.interview_id, v_invite.candidate_id;
      return;
    end if;
  end if;

  if v_invite.expires_at is null or upper(coalesce(v_invite.status, '')) = 'EXPIRED' or v_invite.expires_at <= v_now then
    return query select false, 'EXPIRED', v_invite.interview_id, v_invite.candidate_id;
    return;
  end if;

  if upper(coalesce(v_invite.status, 'ACTIVE')) <> 'ACTIVE' then
    return query select false, 'INACTIVE', v_invite.interview_id, v_invite.candidate_id;
    return;
  end if;

  update public.interview_invites
  set
    used_at = now(),
    attempts_used = coalesce(attempts_used, 0) + 1
  where token = p_token
    and used_at is null;

  return query select true, null::text, v_invite.interview_id, v_invite.candidate_id;
exception
  when others then
    perform public.log_backend_error(
      'fn_validate_interview_token',
      sqlerrm,
      sqlstate,
      jsonb_build_object('token', p_token)
    );
    raise;
end;
$$;

create or replace function public.fn_get_dashboard_pipeline(
  p_organization_id uuid,
  p_app_url text default 'http://localhost:3000'
)
returns jsonb
language plpgsql
as $$
declare
  v_result jsonb;
begin
  select jsonb_build_object(
    'pipeline', jsonb_build_object(
      'pending', coalesce((
        select count(*)
        from public.interview_invites ii
        inner join public.interviews i on i.interview_id = ii.interview_id
        where i.organization_id = p_organization_id
          and coalesce(ii.status, 'ACTIVE') = 'ACTIVE'
          and ii.used_at is null
          and (ii.expires_at is null or ii.expires_at > now())
      ), 0),
      'inProgress', coalesce((
        select count(*)
        from public.interview_invites ii
        inner join public.interviews i on i.interview_id = ii.interview_id
        where i.organization_id = p_organization_id
          and ii.used_at is not null
          and coalesce(ii.status, 'ACTIVE') = 'ACTIVE'
      ), 0),
      'completed', coalesce((
        select count(*)
        from public.interview_invites ii
        inner join public.interviews i on i.interview_id = ii.interview_id
        where i.organization_id = p_organization_id
          and coalesce(ii.status, '') = 'USED'
      ), 0),
      'flagged', coalesce((
        select count(*)
        from public.interview_invites ii
        inner join public.interviews i on i.interview_id = ii.interview_id
        where i.organization_id = p_organization_id
          and coalesce(ii.status, '') = 'REVOKED'
      ), 0)
    ),
    'pendingInterviews', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'inviteId', q.invite_id,
          'candidateName', q.candidate_name,
          'jobTitle', q.job_title,
          'accessType', coalesce(q.access_type, 'FLEXIBLE'),
          'createdAt', q.created_at,
          'startTime', q.start_time,
          'endTime', q.end_time,
          'expiresAt', q.expires_at,
          'link', concat(trim(trailing '/' from p_app_url), '/interview/', q.token)
        )
        order by q.created_at desc
      )
      from (
        select
          ii.invite_id,
          c.full_name as candidate_name,
          jp.job_title,
          ii.token,
          ii.created_at,
          ii.expires_at,
          ii.access_type,
          ii.start_time,
          ii.end_time
        from public.interview_invites ii
        inner join public.interviews i on i.interview_id = ii.interview_id
        inner join public.candidates c on c.candidate_id = i.candidate_id
        inner join public.job_positions jp on jp.job_id = i.job_id
        where i.organization_id = p_organization_id
          and coalesce(ii.status, 'ACTIVE') = 'ACTIVE'
          and ii.used_at is null
          and (ii.expires_at is null or ii.expires_at > now())
        order by ii.created_at desc
      ) q
    ), '[]'::jsonb),
    'recordedInterviews', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'recordingId', q.recording_id,
          'candidateName', q.candidate_name,
          'jobTitle', q.job_title,
          'audioUrl', q.audio_url,
          'transcriptPreview', q.transcript_preview,
          'retentionDays', q.retention_days,
          'expiresAt', q.expires_at,
          'createdAt', q.created_at
        )
        order by q.created_at desc
      )
      from (
        select
          ir.recording_id,
          c.full_name as candidate_name,
          jp.job_title,
          ir.audio_url,
          case
            when ir.transcript is null or btrim(ir.transcript) = '' then 'Transcript not available yet'
            else case
              when char_length(regexp_replace(ir.transcript, '\s+', ' ', 'g')) > 120
                then left(regexp_replace(ir.transcript, '\s+', ' ', 'g'), 117) || '...'
              else regexp_replace(ir.transcript, '\s+', ' ', 'g')
            end
          end as transcript_preview,
          coalesce(ir.retention_days, 30) as retention_days,
          ir.expires_at,
          ir.created_at
        from public.interview_recordings ir
        inner join public.interview_attempts ia on ia.attempt_id = ir.attempt_id
        inner join public.interviews i on i.interview_id = ia.interview_id
        inner join public.candidates c on c.candidate_id = i.candidate_id
        inner join public.job_positions jp on jp.job_id = i.job_id
        where i.organization_id = p_organization_id
        order by ir.created_at desc nulls last
      ) q
    ), '[]'::jsonb)
  ) into v_result;

  return coalesce(v_result, '{}'::jsonb);
exception
  when others then
    perform public.log_backend_error(
      'fn_get_dashboard_pipeline',
      sqlerrm,
      sqlstate,
      jsonb_build_object('organization_id', p_organization_id)
    );
    raise;
end;
$$;

create or replace function public.fn_get_dashboard_veris(
  p_organization_id uuid,
  p_limit integer default 6
)
returns table (
  attempt_id uuid,
  overall_score integer,
  risk_level text,
  strengths text,
  weaknesses text,
  hire_recommendation text,
  created_at timestamptz,
  candidate_name text,
  job_title text
)
language plpgsql
as $$
begin
  return query
  select
    s.attempt_id,
    s.overall_score,
    s.risk_level,
    s.strengths,
    s.weaknesses,
    s.hire_recommendation,
    s.created_at,
    c.full_name as candidate_name,
    jp.job_title
  from public.interview_summaries s
  inner join public.interview_attempts ia on ia.attempt_id = s.attempt_id
  inner join public.interviews i on i.interview_id = ia.interview_id
  inner join public.candidates c on c.candidate_id = i.candidate_id
  inner join public.job_positions jp on jp.job_id = i.job_id
  where i.organization_id = p_organization_id
  order by s.created_at desc
  limit coalesce(p_limit, 6);
exception
  when others then
    perform public.log_backend_error(
      'fn_get_dashboard_veris',
      sqlerrm,
      sqlstate,
      jsonb_build_object('organization_id', p_organization_id, 'limit', p_limit)
    );
    raise;
end;
$$;

create or replace function public.fn_create_interview_invite(
  p_interview_id uuid,
  p_candidate_id uuid,
  p_app_url text default 'http://localhost:3000'
)
returns table (
  interview_link text,
  token text,
  expires_at timestamptz
)
language plpgsql
as $$
declare
  v_actual_candidate_id uuid;
  v_token uuid;
  v_expires_at timestamptz := now() + interval '24 hours';
  v_max_attempts integer;
begin
  select i.candidate_id, i.max_attempts
  into v_actual_candidate_id, v_max_attempts
  from public.interviews i
  where i.interview_id = p_interview_id
  limit 1;

  if v_actual_candidate_id is null then
    raise exception 'INTERVIEW_NOT_FOUND: interview_id not found';
  end if;

  if v_actual_candidate_id <> p_candidate_id then
    raise exception 'CANDIDATE_MISMATCH: candidate_id does not match interview';
  end if;

  v_token := gen_random_uuid();

  insert into public.interview_invites (
    interview_id,
    token,
    expires_at,
    status,
    attempts_used,
    max_attempts,
    access_type
  )
  values (
    p_interview_id,
    v_token::text,
    v_expires_at,
    'ACTIVE',
    0,
    -- See fn_create_interview_link: inherit the interview's retry budget rather
    -- than pinning every invite to a single attempt.
    greatest(coalesce(v_max_attempts, 1), 1),
    'FLEXIBLE'
  );

  return query
  select concat(trim(trailing '/' from p_app_url), '/interview/', v_token::text), v_token::text, v_expires_at;
exception
  when others then
    perform public.log_backend_error(
      'fn_create_interview_invite',
      sqlerrm,
      sqlstate,
      jsonb_build_object(
        'interview_id', p_interview_id,
        'candidate_id', p_candidate_id
      )
    );
    raise;
end;
$$;

create or replace function public.fn_get_default_super_admin_role_id()
returns smallint
language plpgsql
as $$
declare
  v_role_id smallint;
begin
  select rrp.recruiter_role_id
  into v_role_id
  from public.recruiter_role_pool rrp
  where lower(coalesce(rrp.code, '')) in ('super_admin', 'super-admin', 'founder', 'org_owner', 'org-owner')
  order by rrp.recruiter_role_id
  limit 1;

  if v_role_id is null then
    select rp.recruiter_role_id
    into v_role_id
    from public.role_permissions rp
    group by rp.recruiter_role_id
    having bool_or(rp.permission = 'users.manage')
       and bool_or(rp.permission = 'organization.settings')
    order by rp.recruiter_role_id
    limit 1;
  end if;

  if v_role_id is null then
    raise exception 'DEFAULT_SUPER_ADMIN_ROLE_NOT_FOUND: no super admin role seed found';
  end if;

  return v_role_id;
exception
  when others then
    perform public.log_backend_error(
      'fn_get_default_super_admin_role_id',
      sqlerrm,
      sqlstate,
      null
    );
    raise;
end;
$$;

create or replace function public.fn_ensure_default_recruiter_profile(
  p_user_id uuid,
  p_organization_id uuid
)
returns smallint
language plpgsql
as $$
declare
  v_existing_profile boolean := false;
  v_existing_role_id smallint;
  v_company_name text;
  v_default_role_id smallint;
begin
  select true, rp.recruiter_role_id
  into v_existing_profile, v_existing_role_id
  from public.recruiter_profiles rp
  where rp.recruiter_id = p_user_id
  limit 1;

  if coalesce(v_existing_role_id, 0) > 0 then
    return v_existing_role_id;
  end if;

  v_default_role_id := public.fn_get_default_super_admin_role_id();

  select o.organization_name
  into v_company_name
  from public.organizations o
  where o.organization_id = p_organization_id
  limit 1;

  if v_existing_profile then
    update public.recruiter_profiles
    set
      recruiter_role_id = v_default_role_id,
      company_name = coalesce(company_name, v_company_name, 'Organization'),
      organization_id = p_organization_id
    where recruiter_id = p_user_id;
  else
    insert into public.recruiter_profiles (
      recruiter_id,
      company_name,
      recruiter_role_id,
      organization_id
    )
    values (
      p_user_id,
      coalesce(v_company_name, 'Organization'),
      v_default_role_id,
      p_organization_id
    )
    on conflict (recruiter_id) do update
    set
      recruiter_role_id = excluded.recruiter_role_id,
      company_name = excluded.company_name,
      organization_id = excluded.organization_id;
  end if;

  return v_default_role_id;
exception
  when others then
    perform public.log_backend_error(
      'fn_ensure_default_recruiter_profile',
      sqlerrm,
      sqlstate,
      jsonb_build_object(
        'user_id', p_user_id,
        'organization_id', p_organization_id
      )
    );
    raise;
end;
$$;

create or replace function public.fn_manage_team_member(
  p_actor_user_id uuid,
  p_organization_id uuid,
  p_target_user_id uuid,
  p_recruiter_role_id smallint default null,
  p_is_active boolean default null
)
returns table (
  user_id uuid,
  recruiter_role_id smallint,
  is_active boolean
)
language plpgsql
as $$
declare
  v_actor_can_manage boolean;
  v_target_exists boolean;
  v_target_role_id smallint;
  v_target_active boolean;
begin
  select exists (
    select 1
    from public.recruiter_profiles arp
    inner join public.role_permissions perms
      on perms.recruiter_role_id = arp.recruiter_role_id
    where arp.recruiter_id = p_actor_user_id
      and arp.organization_id = p_organization_id
      and perms.permission = 'users.manage'
  )
  into v_actor_can_manage;

  if not coalesce(v_actor_can_manage, false) then
    raise exception 'INSUFFICIENT_PERMISSION: users.manage is required';
  end if;

  select exists (
    select 1
    from public.users u
    where u.user_id = p_target_user_id
      and u.organization_id = p_organization_id
      and u.role in ('RECRUITER', 'ADMIN', 'ORG_OWNER')
  )
  into v_target_exists;

  if not coalesce(v_target_exists, false) then
    raise exception 'TEAM_MEMBER_NOT_FOUND: target user not found in organization';
  end if;

  if p_recruiter_role_id is not null then
    if not exists (
      select 1
      from public.recruiter_role_pool rrp
      where rrp.recruiter_role_id = p_recruiter_role_id
    ) then
      raise exception 'INVALID_RECRUITER_ROLE: recruiter_role_id not found';
    end if;

    update public.recruiter_profiles
    set recruiter_role_id = p_recruiter_role_id
    where recruiter_id = p_target_user_id
      and organization_id = p_organization_id;
  end if;

  if p_is_active is not null then
    update public.users
    set is_active = p_is_active
    where user_id = p_target_user_id
      and organization_id = p_organization_id;
  end if;

  select rp.recruiter_role_id, u.is_active
  into v_target_role_id, v_target_active
  from public.users u
  left join public.recruiter_profiles rp
    on rp.recruiter_id = u.user_id
  where u.user_id = p_target_user_id
    and u.organization_id = p_organization_id
  limit 1;

  return query
  select p_target_user_id, v_target_role_id, v_target_active;
exception
  when others then
    perform public.log_backend_error(
      'fn_manage_team_member',
      sqlerrm,
      sqlstate,
      jsonb_build_object(
        'actor_user_id', p_actor_user_id,
        'organization_id', p_organization_id,
        'target_user_id', p_target_user_id,
        'recruiter_role_id', p_recruiter_role_id,
        'is_active', p_is_active
      )
    );
    raise;
end;
$$;







alter table if exists public.interview_invites
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists revoked_at timestamptz,
  add column if not exists revoked_reason text;

create index if not exists idx_interview_invites_status_created_at
  on public.interview_invites (status, created_at desc);

create index if not exists idx_interview_invites_interview_id
  on public.interview_invites (interview_id);

create or replace function public.fn_update_interview_invite(
  p_organization_id uuid,
  p_invite_id uuid,
  p_access_type text default 'FLEXIBLE',
  p_start_time timestamptz default null,
  p_end_time timestamptz default null
)
returns table (
  invite_id uuid,
  interview_id uuid,
  access_type text,
  start_time timestamptz,
  end_time timestamptz,
  expires_at timestamptz,
  status text
)
language plpgsql
as $$
declare
  v_invite record;
  v_access_type text := upper(coalesce(p_access_type, 'FLEXIBLE'));
  v_expires_at timestamptz;
begin
  select
    ii.invite_id,
    ii.interview_id,
    ii.status,
    ii.used_at
  into v_invite
  from public.interview_invites ii
  inner join public.interviews i on i.interview_id = ii.interview_id
  where ii.invite_id = p_invite_id
    and i.organization_id = p_organization_id
  limit 1;

  if v_invite is null then
    raise exception 'INTERVIEW_INVITE_NOT_FOUND: interview invite not found';
  end if;

  if v_invite.used_at is not null then
    raise exception 'INTERVIEW_INVITE_LOCKED: used interview invite cannot be edited';
  end if;

  if upper(coalesce(v_invite.status, 'ACTIVE')) <> 'ACTIVE' then
    raise exception 'INTERVIEW_INVITE_INACTIVE: only active interview invites can be edited';
  end if;

  if v_access_type not in ('FLEXIBLE', 'SCHEDULED') then
    raise exception 'INVALID_ACCESS_TYPE: access type must be FLEXIBLE or SCHEDULED';
  end if;

  if v_access_type = 'SCHEDULED' then
    if p_start_time is null or p_end_time is null then
      raise exception 'INVALID_TIME: start and end time required';
    end if;

    if p_start_time >= p_end_time then
      raise exception 'INVALID_TIME: end time must be after start time';
    end if;

    v_expires_at := p_end_time;
  else
    p_start_time := null;
    p_end_time := null;
    v_expires_at := now() + interval '24 hours';
  end if;

  update public.interview_invites
  set
    access_type = v_access_type,
    start_time = p_start_time,
    end_time = p_end_time,
    expires_at = v_expires_at,
    updated_at = now()
  where invite_id = p_invite_id;

  return query
  select
    ii.invite_id,
    ii.interview_id,
    ii.access_type,
    ii.start_time,
    ii.end_time,
    ii.expires_at,
    coalesce(ii.status, 'ACTIVE')
  from public.interview_invites ii
  where ii.invite_id = p_invite_id;
exception
  when others then
    perform public.log_backend_error(
      'fn_update_interview_invite',
      sqlerrm,
      sqlstate,
      jsonb_build_object(
        'organization_id', p_organization_id,
        'invite_id', p_invite_id,
        'access_type', p_access_type,
        'start_time', p_start_time,
        'end_time', p_end_time
      )
    );
    raise;
end;
$$;

create or replace function public.fn_revoke_interview_invite(
  p_organization_id uuid,
  p_invite_id uuid,
  p_reason text default null
)
returns table (
  invite_id uuid,
  interview_id uuid,
  status text,
  revoked_at timestamptz,
  revoked_reason text
)
language plpgsql
as $$
declare
  v_invite record;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  select
    ii.invite_id,
    ii.interview_id,
    ii.status,
    ii.used_at
  into v_invite
  from public.interview_invites ii
  inner join public.interviews i on i.interview_id = ii.interview_id
  where ii.invite_id = p_invite_id
    and i.organization_id = p_organization_id
  limit 1;

  if v_invite is null then
    raise exception 'INTERVIEW_INVITE_NOT_FOUND: interview invite not found';
  end if;

  if v_invite.used_at is not null then
    raise exception 'INTERVIEW_INVITE_LOCKED: used interview invite cannot be revoked';
  end if;

  if upper(coalesce(v_invite.status, 'ACTIVE')) <> 'ACTIVE' then
    raise exception 'INTERVIEW_INVITE_INACTIVE: only active interview invites can be revoked';
  end if;

  update public.interview_invites
  set
    status = 'REVOKED',
    revoked_at = now(),
    revoked_reason = v_reason,
    updated_at = now()
  where invite_id = p_invite_id;

  return query
  select
    ii.invite_id,
    ii.interview_id,
    coalesce(ii.status, 'REVOKED'),
    ii.revoked_at,
    ii.revoked_reason
  from public.interview_invites ii
  where ii.invite_id = p_invite_id;
exception
  when others then
    perform public.log_backend_error(
      'fn_revoke_interview_invite',
      sqlerrm,
      sqlstate,
      jsonb_build_object(
        'organization_id', p_organization_id,
        'invite_id', p_invite_id,
        'reason', p_reason
      )
    );
    raise;
end;
$$;

