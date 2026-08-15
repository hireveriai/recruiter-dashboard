begin;

alter table public.job_positions
  add column if not exists interview_duration_minutes integer not null default 30;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'chk_job_positions_interview_duration'
  ) then
    alter table public.job_positions
      add constraint chk_job_positions_interview_duration
      check (interview_duration_minutes in (30, 45, 60));
  end if;
end $$;

update public.job_positions
set interview_duration_minutes = 30
where interview_duration_minutes is null;

create or replace function public.fn_create_job(
  p_organization_id uuid,
  p_job_title text,
  p_job_description text,
  p_experience_level_id smallint,
  p_core_skills text[],
  p_difficulty_profile text,
  p_skill_baseline jsonb default '[]'::jsonb,
  p_coding_required text default 'AUTO',
  p_coding_assessment_type text default null,
  p_coding_difficulty text default null,
  p_coding_duration_minutes integer default null,
  p_coding_languages text[] default array[]::text[],
  p_interview_duration_minutes integer default 30
)
returns table (
  job_id uuid
)
language plpgsql
as $$
declare
  v_job_id uuid;
  v_coding_recommended boolean := false;
  v_recommended_type text := null;
  v_recommendation_reason text := null;
begin
  if not exists (
    select 1
    from public.experience_level_pool elp
    where elp.experience_level_id = p_experience_level_id
  ) then
    raise exception 'INVALID_EXPERIENCE_LEVEL: experience_level_id does not exist';
  end if;

  if p_coding_required not in ('NO', 'YES', 'AUTO') then
    raise exception 'INVALID_CODING_REQUIRED: coding_required must be NO, YES, or AUTO';
  end if;

  if p_coding_assessment_type is not null and p_coding_assessment_type not in ('LIVE_CODING', 'DEBUGGING', 'SQL', 'BACKEND_LOGIC', 'DSA') then
    raise exception 'INVALID_CODING_ASSESSMENT_TYPE: unsupported coding_assessment_type';
  end if;

  if p_coding_difficulty is not null and p_coding_difficulty not in ('EASY', 'MEDIUM', 'HARD') then
    raise exception 'INVALID_CODING_DIFFICULTY: coding_difficulty must be EASY, MEDIUM, or HARD';
  end if;

  if p_coding_duration_minutes is not null and p_coding_duration_minutes not in (10, 15, 20, 30) then
    raise exception 'INVALID_CODING_DURATION: coding_duration_minutes must be 10, 15, 20, or 30';
  end if;

  if p_interview_duration_minutes not in (30, 45, 60) then
    raise exception 'INVALID_INTERVIEW_DURATION: interview_duration_minutes must be 30, 45, or 60';
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

  select
    recommendation.coding_recommended,
    recommendation.coding_assessment_type,
    recommendation.coding_recommendation_reason
  into
    v_coding_recommended,
    v_recommended_type,
    v_recommendation_reason
  from public.fn_recommend_coding_assessment(
    p_job_title,
    p_job_description,
    coalesce(p_core_skills, array[]::text[])
  ) recommendation;

  if p_coding_required = 'YES' then
    v_coding_recommended := true;
    v_recommendation_reason := 'Recruiter explicitly enabled coding assessment.';
  elsif p_coding_required = 'NO' then
    v_coding_recommended := false;
    v_recommendation_reason := 'Recruiter explicitly disabled coding assessment.';
  end if;

  insert into public.job_positions (
    organization_id,
    job_title,
    job_description,
    experience_level_id,
    core_skills,
    difficulty_profile,
    interview_duration_minutes,
    coding_required,
    coding_assessment_type,
    coding_difficulty,
    coding_duration_minutes,
    coding_languages,
    coding_recommended,
    coding_recommendation_reason
  )
  values (
    p_organization_id,
    p_job_title,
    nullif(p_job_description, ''),
    p_experience_level_id,
    coalesce(p_core_skills, array[]::text[]),
    p_difficulty_profile,
    p_interview_duration_minutes,
    p_coding_required,
    coalesce(p_coding_assessment_type, v_recommended_type),
    p_coding_difficulty,
    p_coding_duration_minutes,
    coalesce(p_coding_languages, array[]::text[]),
    coalesce(v_coding_recommended, false),
    v_recommendation_reason
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
        'experience_level_id', p_experience_level_id,
        'coding_required', p_coding_required,
        'interview_duration_minutes', p_interview_duration_minutes
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
    status
  )
  values (
    v_interview_id,
    p_organization_id,
    p_job_id,
    p_candidate_id,
    'COMPANY_INTERVIEW',
    v_total_duration,
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

