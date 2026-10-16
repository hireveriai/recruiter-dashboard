-- Candidate consent for AI interviews, and candidate-data retention.
--
-- interview_consents: one row per interview (and consent version) recording that
--   the candidate agreed to recording, AI evaluation and integrity monitoring
--   before the interview could start. calm-room /api/session/start refuses to
--   start an attempt without it.
-- organizations.candidate_data_retention_days: how long an organization keeps
--   candidate interview data (answers, transcripts, scores, candidate details).
--   NULL means the platform default of 365 days. Media (recordings, identity
--   documents) is always removed 30 days after the interview, independent of
--   this setting.
-- interview_attempts.media_purged_at / interviews.candidate_data_purged_at:
--   set by the calm-room data-retention job so each purge runs exactly once.
--
-- Additive; current code ignores all of it. Rollback:
-- 027_candidate_consent_and_retention_rollback.sql.

CREATE TABLE IF NOT EXISTS public.interview_consents (
  consent_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  interview_id uuid NOT NULL REFERENCES public.interviews (interview_id) ON DELETE CASCADE,
  candidate_id uuid,
  invite_id uuid,
  consent_version text NOT NULL,
  consented_at timestamptz NOT NULL DEFAULT now(),
  ip_address text,
  user_agent text,
  UNIQUE (interview_id, consent_version)
);

-- Server-side access only (service role / direct connection), like the other
-- candidate tables.
ALTER TABLE public.interview_consents ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS candidate_data_retention_days integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'organizations_candidate_data_retention_days_check'
  ) THEN
    ALTER TABLE public.organizations
      ADD CONSTRAINT organizations_candidate_data_retention_days_check
      CHECK (candidate_data_retention_days IS NULL OR candidate_data_retention_days IN (90, 180, 365, 730));
  END IF;
END $$;

ALTER TABLE public.interview_attempts
  ADD COLUMN IF NOT EXISTS media_purged_at timestamptz;

ALTER TABLE public.interviews
  ADD COLUMN IF NOT EXISTS candidate_data_purged_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_interview_attempts_media_purge
  ON public.interview_attempts (ended_at)
  WHERE media_purged_at IS NULL;

-- Runs each statement only if its table and columns exist, so schema drift
-- between environments skips a step instead of failing the whole purge.
-- $1 = attempt ids (uuid[]), $2 = interview id, $3 = candidate id.
CREATE OR REPLACE FUNCTION public.fn_retention_exec(p_label text, p_sql text, p_attempts uuid[], p_interview_id uuid, p_candidate_id uuid)
RETURNS bigint
LANGUAGE plpgsql
AS $$
DECLARE
  v_count bigint := 0;
BEGIN
  EXECUTE p_sql USING p_attempts, p_interview_id, p_candidate_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
EXCEPTION
  WHEN undefined_table OR undefined_column THEN
    RAISE NOTICE 'retention: skipped % (%)', p_label, SQLERRM;
    RETURN -1;
END;
$$;

-- Deletes one interview's candidate content (answers, transcripts, scores,
-- signals, live-interview notes) and marks it purged. The interview, attempt
-- and invite rows stay, so credits, billing and audit history remain intact.
-- When the candidate has no other unpurged interview, the candidate is
-- anonymized too. Media files are removed separately by the calm-room job.
CREATE OR REPLACE FUNCTION public.fn_purge_interview_candidate_data(p_interview_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_attempts uuid[];
  v_candidate uuid;
  v_counts jsonb := '{}'::jsonb;
  v_step record;
BEGIN
  SELECT candidate_id INTO v_candidate
  FROM public.interviews
  WHERE interview_id = p_interview_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  SELECT coalesce(array_agg(attempt_id), '{}') INTO v_attempts
  FROM public.interview_attempts
  WHERE interview_id = p_interview_id;

  FOR v_step IN
    SELECT * FROM (VALUES
      (1, 'answer_evaluations', 'delete from public.answer_evaluations where answer_id in (select answer_id from public.interview_answers where attempt_id = any($1))'),
      (2, 'interview_code_submissions', 'delete from public.interview_code_submissions where attempt_id = any($1)'),
      (3, 'interview_answers', 'delete from public.interview_answers where attempt_id = any($1)'),
      (4, 'session_questions', 'delete from public.session_questions where attempt_id = any($1)'),
      (5, 'interview_signals', 'delete from public.interview_signals where attempt_id = any($1)'),
      (6, 'interview_browser_logs', 'delete from public.interview_browser_logs where interview_id = $2'),
      (7, 'interview_evaluations', 'delete from public.interview_evaluations where attempt_id = any($1)'),
      (8, 'attempt_skill_scores', 'delete from public.attempt_skill_scores where attempt_id = any($1)'),
      (9, 'interview_attempt_scores', 'delete from public.interview_attempt_scores where attempt_id = any($1)'),
      (10, 'attempt_question_map', 'delete from public.attempt_question_map where attempt_id = any($1)'),
      (11, 'resume_reality_gap', 'delete from public.resume_reality_gap where attempt_id = any($1)'),
      (12, 'candidate_resume_ai', 'delete from public.candidate_resume_ai where interview_id = $2 or attempt_id = any($1)'),
      (13, 'interview_skill_state', 'delete from public.interview_skill_state where attempt_id = any($1)'),
      (14, 'interview_skill_profiles', 'delete from public.interview_skill_profiles where attempt_id = any($1)'),
      (15, 'live_transcript_segments', 'delete from public.live_transcript_segments where interview_id = $2'),
      (16, 'live_interviewer_notes', 'delete from public.live_interviewer_notes where interview_id = $2'),
      (17, 'live_interview_debriefs', 'delete from public.live_interview_debriefs where interview_id = $2'),
      (18, 'live_evaluator_ratings', 'delete from public.live_evaluator_ratings where interview_id = $2'),
      (19, 'live_interview_events', 'delete from public.live_interview_events where interview_id = $2'),
      (20, 'interview_recovery_events', 'delete from public.interview_recovery_events where interview_id = $2'),
      (21, 'interview_recordings.transcript', 'update public.interview_recordings set transcript = null where attempt_id = any($1) and transcript is not null'),
      (22, 'interview_results.final_score', 'update public.interview_results set final_score = null where interview_id = $2'),
      (23, 'interview_attempts.termination_metadata', 'update public.interview_attempts set termination_metadata = ''{}''::jsonb where attempt_id = any($1)')
    ) AS steps(step_order, label, sql)
    ORDER BY step_order
  LOOP
    v_counts := v_counts || jsonb_build_object(
      v_step.label,
      public.fn_retention_exec(v_step.label, v_step.sql, v_attempts, p_interview_id, v_candidate)
    );
  END LOOP;

  UPDATE public.interviews
  SET candidate_data_purged_at = now()
  WHERE interview_id = p_interview_id;

  IF v_candidate IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.interviews
    WHERE candidate_id = v_candidate
      AND interview_id <> p_interview_id
      AND candidate_data_purged_at IS NULL
  ) THEN
    v_counts := v_counts || jsonb_build_object('candidate', public.fn_anonymize_candidate(v_candidate));
  END IF;

  RETURN jsonb_build_object('found', true, 'interview_id', p_interview_id, 'counts', v_counts);
END;
$$;

-- Removes a candidate's personal details while keeping the row, because
-- interviews, invites and assessments reference it (NO ACTION foreign keys).
CREATE OR REPLACE FUNCTION public.fn_anonymize_candidate(p_candidate_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_counts jsonb := '{}'::jsonb;
  v_step record;
BEGIN
  FOR v_step IN
    SELECT * FROM (VALUES
      (1, 'candidate_resumes', 'delete from public.candidate_resumes where candidate_id = $3'),
      (2, 'candidate_job_matches', 'delete from public.candidate_job_matches where candidate_id = $3'),
      (3, 'candidate_primary_skills', 'delete from public.candidate_primary_skills where candidate_id = $3'),
      (4, 'resume_enhancement_sessions', 'delete from public.resume_enhancement_sessions where candidate_id = $3'),
      (5, 'candidate_identity_verifications', 'delete from public.candidate_identity_verifications where candidate_id = $3'),
      (6, 'candidates', 'update public.candidates set full_name = ''Deleted candidate'', first_name = null, last_name = null, email = null, phone = null, resume_url = null, resume_text = null, extracted_json = ''{}''::jsonb, date_of_birth = null, gender = null, country = null, updated_at = now() where candidate_id = $3')
    ) AS steps(step_order, label, sql)
    ORDER BY step_order
  LOOP
    v_counts := v_counts || jsonb_build_object(
      v_step.label,
      public.fn_retention_exec(v_step.label, v_step.sql, '{}'::uuid[], NULL, p_candidate_id)
    );
  END LOOP;

  RETURN v_counts;
END;
$$;
