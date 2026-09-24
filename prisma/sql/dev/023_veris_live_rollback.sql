-- 023_veris_live_rollback.sql
--
-- Reverses 023_veris_live.sql. Turn VERIS_LIVE_ENABLED off first.
-- Deletes every Live interview (and, by cascade, its participants, events,
-- notes, ratings, transcript segments and recording rows) before dropping the
-- columns, then restores the four AI listing functions to their pre-023
-- production definitions. AI interviews are not touched.

begin;

CREATE OR REPLACE FUNCTION public.fn_recruiter_get_candidates_screen(p_organization_id uuid, p_limit integer DEFAULT 20)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
AS $function$
  select coalesce(jsonb_agg(row_payload order by created_at desc), '[]'::jsonb)
  from (
    select
      c.created_at,
      jsonb_build_object(
        'candidateId', c.candidate_id,
        'candidateName', c.full_name,
        'email', c.email,
        'status', coalesce(i.status, c.status, 'PENDING'),
        'jobTitle', jp.job_title,
        'interviewId', i.interview_id,
        'attemptId', ia.attempt_id,
        'score', ie.final_score,
        'decision', ie.decision,
        'createdAt', c.created_at,
        'endedAt', ia.ended_at
      ) as row_payload
    from public.candidates c
    left join lateral (
      select i.*
      from public.interviews i
      where i.organization_id = c.organization_id
        and i.candidate_id = c.candidate_id
      order by i.created_at desc
      limit 1
    ) i on true
    left join public.job_positions jp on jp.job_id = i.job_id
    left join lateral (
      select ia.*
      from public.interview_attempts ia
      where ia.interview_id = i.interview_id
      order by ia.started_at desc
      limit 1
    ) ia on true
    left join public.interview_evaluations ie on ie.attempt_id = ia.attempt_id
    where c.organization_id = p_organization_id
    order by c.created_at desc
    limit greatest(coalesce(p_limit, 20), 1)
  ) rows;
$function$;

CREATE OR REPLACE FUNCTION public.fn_recruiter_get_dashboard_screen(p_organization_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
AS $function$
  select jsonb_build_object(
    'jobs', (select count(*)::int from public.job_positions where organization_id = p_organization_id),
    'candidates', (select count(*)::int from public.candidates where organization_id = p_organization_id),
    'interviews', (select count(*)::int from public.interviews where organization_id = p_organization_id),
    'completedInterviews', (
      select count(*)::int
      from public.interviews
      where organization_id = p_organization_id
        and upper(coalesce(status, '')) in ('COMPLETED', 'SUBMITTED', 'EVALUATED')
    )
  );
$function$;

CREATE OR REPLACE FUNCTION public.fn_recruiter_get_interviews_screen(p_organization_id uuid, p_limit integer DEFAULT 200)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
AS $function$
  select coalesce(jsonb_agg(row_payload order by created_at desc), '[]'::jsonb)
  from (
    select
      i.created_at,
      jsonb_build_object(
        'interviewId', i.interview_id,
        'candidateId', i.candidate_id,
        'candidateName', c.full_name,
        'jobTitle', jp.job_title,
        'status', i.status,
        'questionStatus', i.question_status,
        'emailStatus', i.email_status,
        'inviteStatus', inv.status,
        'attemptId', ia.attempt_id,
        'attemptStatus', ia.status,
        'score', ie.final_score,
        'decision', ie.decision,
        'createdAt', i.created_at,
        'startedAt', ia.started_at,
        'endedAt', ia.ended_at
      ) as row_payload
    from public.interviews i
    join public.candidates c on c.candidate_id = i.candidate_id
    join public.job_positions jp on jp.job_id = i.job_id
    left join lateral (
      select inv.*
      from public.interview_invites inv
      where inv.interview_id = i.interview_id
      order by inv.created_at desc
      limit 1
    ) inv on true
    left join lateral (
      select ia.*
      from public.interview_attempts ia
      where ia.interview_id = i.interview_id
      order by ia.started_at desc
      limit 1
    ) ia on true
    left join public.interview_evaluations ie on ie.attempt_id = ia.attempt_id
    where i.organization_id = p_organization_id
    order by i.created_at desc
    limit greatest(coalesce(p_limit, 200), 1)
  ) rows;
$function$;

CREATE OR REPLACE FUNCTION public.fn_recruiter_get_jobs_screen(p_organization_id uuid, p_include_inactive boolean DEFAULT false, p_view text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
AS $function$
declare
  v_supports_active boolean;
  v_supports_coding boolean;
  v_supports_question_type boolean;
  v_jobs jsonb;
begin
  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'job_positions'
      and column_name = 'is_active'
  ) into v_supports_active;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'job_positions'
      and column_name in (
        'coding_required',
        'coding_assessment_type',
        'coding_difficulty',
        'coding_duration_minutes',
        'coding_languages'
      )
    group by table_schema, table_name
    having count(*) = 5
  ) into v_supports_coding;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'job_positions'
      and column_name = 'question_type_default'
  ) into v_supports_question_type;

  select coalesce(jsonb_agg(
    case when p_view = 'selector' then
      jsonb_build_object(
        'jobId', jp.job_id,
        'jobTitle', jp.job_title,
        'isActive', coalesce(nullif(to_jsonb(jp)->>'is_active', '')::boolean, true)
      )
    else
      jsonb_build_object(
        'jobId', jp.job_id,
        'jobTitle', jp.job_title,
        'jobDescription', jp.job_description,
        'experienceLevelId', jp.experience_level_id,
        'difficultyProfile', jp.difficulty_profile::text,
        'interviewDurationMinutes', jp.interview_duration_minutes,
        'questionTypeDefault', coalesce(to_jsonb(jp)->>'question_type_default', 'AUTO'),
        'coreSkills', coalesce(to_jsonb(jp)->'core_skills', '[]'::jsonb),
        'codingRequired', to_jsonb(jp)->>'coding_required',
        'codingAssessmentType', to_jsonb(jp)->>'coding_assessment_type',
        'codingDifficulty', to_jsonb(jp)->>'coding_difficulty',
        'codingDurationMinutes', to_jsonb(jp)->'coding_duration_minutes',
        'codingLanguages', coalesce(to_jsonb(jp)->'coding_languages', '[]'::jsonb),
        'isActive', coalesce(nullif(to_jsonb(jp)->>'is_active', '')::boolean, true),
        '_count', jsonb_build_object(
          'interviews',
          (
            select count(*)::int
            from public.interviews i
            where i.job_id = jp.job_id
          )
        )
      )
    end
    order by jp.job_id desc
  ), '[]'::jsonb)
  into v_jobs
  from public.job_positions jp
  where jp.organization_id = p_organization_id
    and (
      p_include_inactive
      or not v_supports_active
      or coalesce(nullif(to_jsonb(jp)->>'is_active', '')::boolean, true)
    );

  return jsonb_build_object(
    'jobs', v_jobs,
    'meta', jsonb_strip_nulls(jsonb_build_object(
      'supportsJobActiveState', v_supports_active,
      'supportsCodingConfig', case when p_view = 'selector' then null else v_supports_coding end,
      'supportsQuestionTypeDefault', case when p_view = 'selector' then null else v_supports_question_type end,
      'view', case when p_view = 'selector' then 'selector' else null end
    ))
  );
end;
$function$;

delete from public.interviews where delivery_mode = 'LIVE';

drop table if exists public.live_recordings;
drop table if exists public.live_transcript_segments;
drop table if exists public.live_evaluator_ratings;
drop table if exists public.live_interviewer_notes;
drop table if exists public.live_interview_events;
drop table if exists public.interview_participants;

drop function if exists public.fn_live_append_only_guard();
drop function if exists public.fn_live_child_guard();
drop function if exists public.fn_interview_participants_guard();

drop index if exists public.idx_interviews_org_delivery_live_status;
drop index if exists public.ux_interviews_live_room_name;

alter table public.interviews
  drop constraint if exists chk_interviews_live_fields,
  drop constraint if exists chk_interviews_live_status,
  drop constraint if exists chk_interviews_delivery_mode,
  drop column if exists live_ended_at,
  drop column if exists live_started_at,
  drop column if exists scheduled_timezone,
  drop column if exists scheduled_start_at,
  drop column if exists live_room_name,
  drop column if exists live_status,
  drop column if exists delivery_mode;

commit;
