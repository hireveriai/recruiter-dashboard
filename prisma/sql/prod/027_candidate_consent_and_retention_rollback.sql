-- Rollback for 027_candidate_consent_and_retention.sql.
--
-- Deploy calm-room and recruiter-dashboard code without consent/retention first:
-- calm-room session start requires interview_consents once this feature ships.

DROP FUNCTION IF EXISTS public.fn_purge_interview_candidate_data(uuid);
DROP FUNCTION IF EXISTS public.fn_anonymize_candidate(uuid);
DROP FUNCTION IF EXISTS public.fn_retention_exec(text, text, uuid[], uuid, uuid);

DROP INDEX IF EXISTS public.idx_interview_attempts_media_purge;

ALTER TABLE public.interviews DROP COLUMN IF EXISTS candidate_data_purged_at;
ALTER TABLE public.interview_attempts DROP COLUMN IF EXISTS media_purged_at;

ALTER TABLE public.organizations
  DROP CONSTRAINT IF EXISTS organizations_candidate_data_retention_days_check;
ALTER TABLE public.organizations DROP COLUMN IF EXISTS candidate_data_retention_days;

DROP TABLE IF EXISTS public.interview_consents;
