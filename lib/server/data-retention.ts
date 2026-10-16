/**
 * Candidate interview data (answers, transcripts, scores, candidate details) is
 * deleted after the organization's chosen number of days by the calm-room
 * data-retention job (calm-room/app/lib/dataRetention.ts); null means the
 * platform default. Recordings and identity documents always go after 30 days,
 * independent of this setting. Keep these values in sync with calm-room and
 * with the CHECK constraint in prisma/sql/prod/027_candidate_consent_and_retention.sql.
 */
export const CANDIDATE_DATA_RETENTION_OPTIONS = [90, 180, 365, 730] as const
export const DEFAULT_CANDIDATE_DATA_RETENTION_DAYS = 365
export const MEDIA_RETENTION_DAYS = 30
