-- 023_veris_live.sql
--
-- VerisNova - Phase 3: VERIS Live Interview (human-led, candidate + one or
-- more interviewers in one LiveKit room).
--
-- MODEL
--   A Live Interview is an ordinary public.interviews row with
--   delivery_mode = 'LIVE'. It reuses the job, candidate, duration and the
--   Phase 2 questionnaire snapshot (questionnaire_version_id +
--   interview_questions) exactly like an AI interview.
--
--   A Live interview NEVER has interview_attempts or interview_invites rows.
--   Every Calm Room and candidate-dashboard query is keyed on those tables,
--   so Live rows cannot reach the AI interview engine. AI listing queries that
--   read public.interviews directly get an explicit delivery_mode = 'AI'
--   filter (application code plus the four database functions redefined at
--   the end of this file). As a second line of defence Live rows carry
--   status = 'LIVE', email_status/question_status = 'NOT_APPLICABLE', values
--   no AI status list matches.
--
-- NEW TABLES
--   interview_participants   candidate + each interviewer, own hashed invite
--   live_interview_events    append-only timeline (questions, joins, ...)
--   live_interviewer_notes   private to the interviewer who wrote them
--   live_evaluator_ratings   human ratings/evidence, separate from AI scores
--   live_transcript_segments speaker-attributed transcript
--   live_recordings          LiveKit egress outputs for the session
--
-- SAFETY
--   * Additive: new tables, new nullable/defaulted columns. Existing rows get
--     delivery_mode = 'AI' (their true value); no other existing data changes.
--   * Four AI listing functions are re-created with an added
--     delivery_mode = 'AI' filter and otherwise identical bodies.
--   * RLS enabled with no policies on every new table, matching all tenant
--     tables: only the server connection reads/writes, org-scoped in code.
--   * Triggers enforce organization consistency, role integrity and the
--     append-only / immutability rules even if application code is wrong.
--   * Idempotent. Rollback: 023_veris_live_rollback.sql

begin;

-- ---------------------------------------------------------------------------
-- 1. interviews: delivery mode + Live session fields
-- ---------------------------------------------------------------------------
alter table public.interviews
  add column if not exists delivery_mode text not null default 'AI',
  add column if not exists live_status text,
  add column if not exists live_room_name text,
  add column if not exists scheduled_start_at timestamptz,
  add column if not exists scheduled_timezone text,
  add column if not exists live_started_at timestamptz,
  add column if not exists live_ended_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'chk_interviews_delivery_mode') then
    alter table public.interviews
      add constraint chk_interviews_delivery_mode check (delivery_mode in ('AI', 'LIVE'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'chk_interviews_live_status') then
    alter table public.interviews
      add constraint chk_interviews_live_status check (
        live_status is null
        or live_status in ('SCHEDULED', 'INVITATIONS_SENT', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'EXPIRED')
      );
  end if;

  -- Live fields belong to Live interviews only, and every Live interview has them.
  if not exists (select 1 from pg_constraint where conname = 'chk_interviews_live_fields') then
    alter table public.interviews
      add constraint chk_interviews_live_fields check (
        (delivery_mode = 'LIVE' and live_status is not null and live_room_name is not null)
        or (delivery_mode = 'AI' and live_status is null and live_room_name is null)
      );
  end if;
end;
$$;

create unique index if not exists ux_interviews_live_room_name
  on public.interviews (live_room_name) where live_room_name is not null;

create index if not exists idx_interviews_org_delivery_live_status
  on public.interviews (organization_id, delivery_mode, live_status);

-- ---------------------------------------------------------------------------
-- 2. interview_participants
-- ---------------------------------------------------------------------------
create table if not exists public.interview_participants (
  participant_id      uuid primary key default gen_random_uuid(),
  organization_id     uuid not null,
  interview_id        uuid not null references public.interviews(interview_id) on delete cascade,
  role                text not null,
  panel_role          text,
  user_id             uuid,
  candidate_id        uuid,
  display_name        text not null,
  email               text not null,
  -- Opaque LiveKit identity (never PII), unique across all sessions.
  livekit_identity    text not null,
  -- Only the SHA-256 of the invitation token is stored.
  invite_token_hash   text,
  invite_expires_at   timestamptz,
  invite_status       text not null default 'PENDING',
  invite_sent_at      timestamptz,
  revoked_at          timestamptz,
  join_status         text not null default 'NOT_JOINED',
  first_joined_at     timestamptz,
  last_joined_at      timestamptz,
  last_left_at        timestamptz,
  recording_consent_at timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create unique index if not exists ux_interview_participants_livekit_identity
  on public.interview_participants (livekit_identity);
create unique index if not exists ux_interview_participants_token_hash
  on public.interview_participants (invite_token_hash) where invite_token_hash is not null;
-- Exactly one candidate per interview; one row per interviewer user.
create unique index if not exists ux_interview_participants_one_candidate
  on public.interview_participants (interview_id) where role = 'CANDIDATE';
create unique index if not exists ux_interview_participants_interviewer_user
  on public.interview_participants (interview_id, user_id) where role = 'INTERVIEWER';
create index if not exists idx_interview_participants_interview
  on public.interview_participants (interview_id);
create index if not exists idx_interview_participants_org_user
  on public.interview_participants (organization_id, user_id);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'chk_ip_role') then
    alter table public.interview_participants
      add constraint chk_ip_role check (role in ('CANDIDATE', 'INTERVIEWER'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'chk_ip_panel_role') then
    alter table public.interview_participants
      add constraint chk_ip_panel_role check (
        (role = 'CANDIDATE' and panel_role is null)
        or (role = 'INTERVIEWER' and panel_role in ('HIRING_MANAGER', 'INTERVIEWER', 'PANEL_MEMBER'))
      );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'chk_ip_identity') then
    alter table public.interview_participants
      add constraint chk_ip_identity check (
        (role = 'CANDIDATE' and candidate_id is not null and user_id is null)
        or (role = 'INTERVIEWER' and user_id is not null and candidate_id is null)
      );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'chk_ip_invite_status') then
    alter table public.interview_participants
      add constraint chk_ip_invite_status check (invite_status in ('PENDING', 'SENT', 'FAILED', 'REVOKED'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'chk_ip_join_status') then
    alter table public.interview_participants
      add constraint chk_ip_join_status check (join_status in ('NOT_JOINED', 'JOINED', 'LEFT'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'chk_ip_livekit_identity') then
    alter table public.interview_participants
      add constraint chk_ip_livekit_identity check (livekit_identity ~ '^p_[A-Za-z0-9_-]{16,64}$');
  end if;
end;
$$;

-- Participants must belong to a LIVE interview of the same organization; the
-- candidate must be that interview's candidate; an interviewer must be an
-- active user of that organization. Role, interview, org and identity never
-- change after creation, so a candidate row can never become an interviewer.
create or replace function public.fn_interview_participants_guard()
returns trigger
language plpgsql
as $$
declare
  v_interview record;
begin
  select i.organization_id, i.candidate_id, i.delivery_mode
    into v_interview
  from public.interviews i
  where i.interview_id = new.interview_id;

  if v_interview.organization_id is null or v_interview.organization_id <> new.organization_id then
    raise exception 'LIVE_PARTICIPANT_ORG_MISMATCH: participant organization does not own this interview';
  end if;

  if v_interview.delivery_mode <> 'LIVE' then
    raise exception 'LIVE_PARTICIPANT_NOT_LIVE: participants can only be added to LIVE interviews';
  end if;

  if new.role = 'CANDIDATE' and new.candidate_id <> v_interview.candidate_id then
    raise exception 'LIVE_PARTICIPANT_CANDIDATE_MISMATCH: candidate participant must be the interview candidate';
  end if;

  if new.role = 'INTERVIEWER' and not exists (
    select 1 from public.users u
    where u.user_id = new.user_id
      and u.organization_id = new.organization_id
      and coalesce(u.is_active, true)
      and u.team_removed_at is null
  ) then
    raise exception 'LIVE_PARTICIPANT_INTERVIEWER_INVALID: interviewer must be an active user of this organization';
  end if;

  if tg_op = 'UPDATE' then
    if new.organization_id <> old.organization_id
      or new.interview_id <> old.interview_id
      or new.role <> old.role
      or new.user_id is distinct from old.user_id
      or new.candidate_id is distinct from old.candidate_id
      or new.livekit_identity <> old.livekit_identity then
      raise exception 'LIVE_PARTICIPANT_IMMUTABLE: participant identity, role and session cannot change';
    end if;
    new.updated_at := now();
  end if;

  return new;
end;
$$;

drop trigger if exists trg_interview_participants_guard on public.interview_participants;
create trigger trg_interview_participants_guard
  before insert or update on public.interview_participants
  for each row execute function public.fn_interview_participants_guard();

-- ---------------------------------------------------------------------------
-- 3. Shared guard for the Live child tables: org + interview + (optional)
--    participant must all agree; interviewer-only tables reject candidates.
-- ---------------------------------------------------------------------------
create or replace function public.fn_live_child_guard()
returns trigger
language plpgsql
as $$
declare
  v_interview_org uuid;
  v_delivery text;
  v_participant record;
  v_interviewer_only boolean := tg_argv[0] = 'interviewer_only';
begin
  select i.organization_id, i.delivery_mode into v_interview_org, v_delivery
  from public.interviews i
  where i.interview_id = new.interview_id;

  if v_interview_org is null or v_interview_org <> new.organization_id or v_delivery <> 'LIVE' then
    raise exception 'LIVE_CHILD_ORG_MISMATCH: % row does not belong to a LIVE interview of this organization', tg_table_name;
  end if;

  if new.participant_id is not null then
    select p.interview_id, p.organization_id, p.role into v_participant
    from public.interview_participants p
    where p.participant_id = new.participant_id;

    if v_participant.interview_id is null
      or v_participant.interview_id <> new.interview_id
      or v_participant.organization_id <> new.organization_id then
      raise exception 'LIVE_CHILD_PARTICIPANT_MISMATCH: participant is not part of this interview';
    end if;

    if v_interviewer_only and v_participant.role <> 'INTERVIEWER' then
      raise exception 'LIVE_CHILD_INTERVIEWER_ONLY: only interviewers can write % rows', tg_table_name;
    end if;
  elsif v_interviewer_only then
    raise exception 'LIVE_CHILD_INTERVIEWER_ONLY: % rows require an interviewer', tg_table_name;
  end if;

  if tg_op = 'UPDATE' and (
    new.organization_id <> old.organization_id
    or new.interview_id <> old.interview_id
    or new.participant_id is distinct from old.participant_id
  ) then
    raise exception 'LIVE_CHILD_IMMUTABLE: % ownership cannot change', tg_table_name;
  end if;

  return new;
end;
$$;

-- Append-only: timeline and transcript rows can only disappear with their
-- interview (cascade), never be edited or deleted individually.
create or replace function public.fn_live_append_only_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'LIVE_APPEND_ONLY: % rows cannot be modified', tg_table_name;
  end if;
  if exists (select 1 from public.interviews i where i.interview_id = old.interview_id) then
    raise exception 'LIVE_APPEND_ONLY: % rows cannot be deleted while the interview exists', tg_table_name;
  end if;
  return old;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. live_interview_events (append-only timeline)
-- ---------------------------------------------------------------------------
create table if not exists public.live_interview_events (
  event_id              uuid primary key default gen_random_uuid(),
  organization_id       uuid not null,
  interview_id          uuid not null references public.interviews(interview_id) on delete cascade,
  participant_id        uuid references public.interview_participants(participant_id) on delete cascade,
  event_type            text not null,
  interview_question_id uuid,
  payload               jsonb not null default '{}'::jsonb,
  occurred_at           timestamptz not null default now()
);

create index if not exists idx_live_events_interview_time
  on public.live_interview_events (interview_id, occurred_at);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'chk_live_event_type') then
    alter table public.live_interview_events
      add constraint chk_live_event_type check (event_type in (
        'SESSION_STARTED', 'SESSION_COMPLETED', 'SESSION_CANCELLED',
        'PARTICIPANT_JOINED', 'PARTICIPANT_LEFT', 'RECORDING_CONSENT',
        'QUESTION_ASKED', 'QUESTION_COVERED', 'QUESTION_SKIPPED', 'MANUAL_QUESTION',
        'RECORDING_STARTED', 'RECORDING_STOPPED', 'COPILOT_SUGGESTION', 'TIMER_OVERTIME',
        'INVITATIONS_SENT', 'INVITATION_REVOKED'
      ));
  end if;
end;
$$;

drop trigger if exists trg_live_events_guard on public.live_interview_events;
create trigger trg_live_events_guard
  before insert on public.live_interview_events
  for each row execute function public.fn_live_child_guard('any');
drop trigger if exists trg_live_events_append_only on public.live_interview_events;
create trigger trg_live_events_append_only
  before update or delete on public.live_interview_events
  for each row execute function public.fn_live_append_only_guard();

-- ---------------------------------------------------------------------------
-- 5. live_interviewer_notes (private to the author)
-- ---------------------------------------------------------------------------
create table if not exists public.live_interviewer_notes (
  note_id               uuid primary key default gen_random_uuid(),
  organization_id       uuid not null,
  interview_id          uuid not null references public.interviews(interview_id) on delete cascade,
  participant_id        uuid not null references public.interview_participants(participant_id) on delete cascade,
  interview_question_id uuid,
  body                  text not null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists idx_live_notes_author
  on public.live_interviewer_notes (participant_id, created_at);
create index if not exists idx_live_notes_interview
  on public.live_interviewer_notes (interview_id);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'chk_live_note_body') then
    alter table public.live_interviewer_notes
      add constraint chk_live_note_body check (char_length(body) between 1 and 10000);
  end if;
end;
$$;

drop trigger if exists trg_live_notes_guard on public.live_interviewer_notes;
create trigger trg_live_notes_guard
  before insert or update on public.live_interviewer_notes
  for each row execute function public.fn_live_child_guard('interviewer_only');

-- ---------------------------------------------------------------------------
-- 6. live_evaluator_ratings (human; never combined with AI scores here)
-- ---------------------------------------------------------------------------
create table if not exists public.live_evaluator_ratings (
  rating_id             uuid primary key default gen_random_uuid(),
  organization_id       uuid not null,
  interview_id          uuid not null references public.interviews(interview_id) on delete cascade,
  participant_id        uuid not null references public.interview_participants(participant_id) on delete cascade,
  target_type           text not null,
  interview_question_id uuid,
  focus_area_key        text,
  rating                smallint,
  evidence              text,
  submitted_at          timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create unique index if not exists ux_live_ratings_target
  on public.live_evaluator_ratings (
    participant_id, target_type,
    coalesce(interview_question_id::text, ''), coalesce(focus_area_key, '')
  );
create index if not exists idx_live_ratings_interview
  on public.live_evaluator_ratings (interview_id);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'chk_live_rating_target') then
    alter table public.live_evaluator_ratings
      add constraint chk_live_rating_target check (
        (target_type = 'QUESTION' and interview_question_id is not null and focus_area_key is null)
        or (target_type = 'FOCUS_AREA' and focus_area_key is not null and interview_question_id is null)
        or (target_type = 'OVERALL' and interview_question_id is null and focus_area_key is null)
      );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'chk_live_rating_value') then
    alter table public.live_evaluator_ratings
      add constraint chk_live_rating_value check (rating is null or rating between 1 and 5);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'chk_live_rating_evidence') then
    alter table public.live_evaluator_ratings
      add constraint chk_live_rating_evidence check (evidence is null or char_length(evidence) <= 5000);
  end if;
end;
$$;

drop trigger if exists trg_live_ratings_guard on public.live_evaluator_ratings;
create trigger trg_live_ratings_guard
  before insert or update on public.live_evaluator_ratings
  for each row execute function public.fn_live_child_guard('interviewer_only');

-- ---------------------------------------------------------------------------
-- 7. live_transcript_segments (speaker-attributed, append-only)
-- ---------------------------------------------------------------------------
create table if not exists public.live_transcript_segments (
  segment_id      uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  interview_id    uuid not null references public.interviews(interview_id) on delete cascade,
  participant_id  uuid not null references public.interview_participants(participant_id) on delete cascade,
  -- Which per-participant recording this segment was transcribed from
  -- (null for live captions). Makes transcription idempotent per recording.
  recording_id    uuid,
  source          text not null,
  started_at_ms   integer,
  ended_at_ms     integer,
  text            text not null,
  created_at      timestamptz not null default now()
);

create index if not exists idx_live_transcript_recording
  on public.live_transcript_segments (recording_id) where recording_id is not null;
create index if not exists idx_live_transcript_interview
  on public.live_transcript_segments (interview_id, source, started_at_ms);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'chk_live_transcript_source') then
    alter table public.live_transcript_segments
      add constraint chk_live_transcript_source check (source in ('LIVE_CAPTION', 'POST_TRANSCRIPTION'));
  end if;
end;
$$;

drop trigger if exists trg_live_transcript_guard on public.live_transcript_segments;
create trigger trg_live_transcript_guard
  before insert on public.live_transcript_segments
  for each row execute function public.fn_live_child_guard('any');
drop trigger if exists trg_live_transcript_append_only on public.live_transcript_segments;
create trigger trg_live_transcript_append_only
  before update or delete on public.live_transcript_segments
  for each row execute function public.fn_live_append_only_guard();

-- ---------------------------------------------------------------------------
-- 8. live_recordings (LiveKit egress outputs)
-- ---------------------------------------------------------------------------
create table if not exists public.live_recordings (
  recording_id    uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  interview_id    uuid not null references public.interviews(interview_id) on delete cascade,
  -- null for the room composite; the speaker for per-participant audio
  participant_id  uuid references public.interview_participants(participant_id) on delete cascade,
  kind            text not null,
  egress_id       text,
  storage_path    text,
  status          text not null default 'STARTING',
  started_at      timestamptz not null default now(),
  ended_at        timestamptz,
  error           text,
  -- Per-participant audio only: post-interview transcription state.
  transcription_status text,
  transcribed_at  timestamptz
);

create unique index if not exists ux_live_recordings_egress
  on public.live_recordings (egress_id) where egress_id is not null;
create index if not exists idx_live_recordings_interview
  on public.live_recordings (interview_id);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'chk_live_recording_kind') then
    alter table public.live_recordings
      add constraint chk_live_recording_kind check (kind in ('COMPOSITE', 'PARTICIPANT_AUDIO'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'chk_live_recording_status') then
    alter table public.live_recordings
      add constraint chk_live_recording_status check (status in ('STARTING', 'ACTIVE', 'COMPLETE', 'FAILED'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'chk_live_recording_transcription') then
    alter table public.live_recordings
      add constraint chk_live_recording_transcription check (
        transcription_status is null or transcription_status in ('PENDING', 'RUNNING', 'DONE', 'FAILED', 'SKIPPED')
      );
  end if;
end;
$$;

drop trigger if exists trg_live_recordings_guard on public.live_recordings;
create trigger trg_live_recordings_guard
  before insert or update on public.live_recordings
  for each row execute function public.fn_live_child_guard('any');

-- ---------------------------------------------------------------------------
-- 9. Row level security: enabled, no policies (server-only), like every
--    other tenant table.
-- ---------------------------------------------------------------------------
alter table public.interview_participants enable row level security;
alter table public.live_interview_events enable row level security;
alter table public.live_interviewer_notes enable row level security;
alter table public.live_evaluator_ratings enable row level security;
alter table public.live_transcript_segments enable row level security;
alter table public.live_recordings enable row level security;

-- ---------------------------------------------------------------------------
-- 10. AI listing functions: identical to the production definitions except
--     for the added delivery_mode = 'AI' filter, so Live rows never appear in
--     AI Interview screens. (Pipeline, VERIS and reports-score functions join
--     interview_invites / interview_attempts, which Live never has, so they
--     need no change.)
-- ---------------------------------------------------------------------------
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
        and i.delivery_mode = 'AI'
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
    'interviews', (select count(*)::int from public.interviews where organization_id = p_organization_id and delivery_mode = 'AI'),
    'completedInterviews', (
      select count(*)::int
      from public.interviews
      where organization_id = p_organization_id
        and delivery_mode = 'AI'
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
      and i.delivery_mode = 'AI'
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
              and i.delivery_mode = 'AI'
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

commit;
