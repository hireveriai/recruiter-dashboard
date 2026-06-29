import { prisma } from "@/lib/server/prisma"

const STALE_ATTEMPT_THRESHOLD_SECONDS = 300
const SESSION_END_BUFFER_SECONDS = 0

const ACTIVE_ATTEMPT_STATUSES = [
  "STARTED",
  "IN_PROGRESS",
  "RECONNECTING",
  "QUESTION_ACTIVE",
  "ANSWER_RECORDING",
  "ANSWER_PROCESSING",
  "QUESTION_GENERATING",
  "FOLLOWUP_GENERATING",
  "READY",
  "CREATED",
  "RECOVERY_USED",
  "INTERRUPTED",
]

const FINALIZE_INTERVAL_MS = 5_000
const lastFinalizedAtByOrganization = new Map<string, number>()
const finalizeInFlightByOrganization = new Map<string, Promise<void>>()

function quotedStatuses() {
  return ACTIVE_ATTEMPT_STATUSES.map((status) => `'${status}'`).join(", ")
}

export async function finalizeStaleInterviewAttempts(organizationId: string) {
  const lastFinalizedAt = lastFinalizedAtByOrganization.get(organizationId) ?? 0
  if (Date.now() - lastFinalizedAt < FINALIZE_INTERVAL_MS) {
    return
  }

  const existing = finalizeInFlightByOrganization.get(organizationId)
  if (existing) {
    return existing
  }

  const operation = prisma.$executeRawUnsafe(
    `
    with stale_attempts as (
      select
        ia.attempt_id,
        ia.interview_id,
        case
          when ia.ends_at is not null
            and ia.ends_at < now() - ($2::int * interval '1 second')
            then 'TIME_EXPIRED'
          else 'ABANDONED'
        end as final_status,
        case
          when ia.ends_at is not null
            and ia.ends_at < now() - ($2::int * interval '1 second')
            then 'timeout'
          else 'watchdog_timeout'
        end as termination_type,
        case
          when ia.ends_at is not null
            and ia.ends_at < now() - ($2::int * interval '1 second')
            then 'session_time_expired'
          else 'heartbeat_timeout'
        end as disconnect_reason
      from public.interview_attempts ia
      inner join public.interviews i
        on i.interview_id = ia.interview_id
      where i.organization_id = $1::uuid
        and upper(coalesce(ia.status, '')) in (${quotedStatuses()})
        and (
          (
            ia.ends_at is not null
            and ia.ends_at < now() - ($2::int * interval '1 second')
          )
          or (
            coalesce(ia.last_activity_at, ia.started_at) < now() - ($3::int * interval '1 second')
          )
        )
      limit 250
    ),
    finalized_attempts as (
      update public.interview_attempts ia
      set status = stale_attempts.final_status,
          ended_at = coalesce(ia.ended_at, least(now(), coalesce(ia.ends_at, now()))),
          termination_type = stale_attempts.termination_type,
          disconnect_reason = stale_attempts.disconnect_reason,
          termination_detected_at = coalesce(ia.termination_detected_at, now()),
          recovered_successfully = false,
          early_exit = case
            when stale_attempts.final_status = 'TIME_EXPIRED' then ia.early_exit
            else true
          end,
          inactivity_seconds = case
            when stale_attempts.final_status = 'TIME_EXPIRED' then
              greatest(extract(epoch from (now() - coalesce(ia.ends_at, now())))::int, 0)
            else greatest(extract(epoch from (now() - coalesce(ia.last_activity_at, ia.started_at)))::int, 0)
          end
      from stale_attempts
      where ia.attempt_id = stale_attempts.attempt_id
      returning ia.attempt_id, ia.interview_id, stale_attempts.final_status
    ),
    closed_interviews as (
      select distinct fa.interview_id, fa.final_status
      from finalized_attempts fa
      where not exists (
        select 1
        from public.interview_attempts active
        where active.interview_id = fa.interview_id
          and active.attempt_id <> fa.attempt_id
          and upper(coalesce(active.status, '')) in (${quotedStatuses()})
      )
    )
    update public.interviews i
    set status = 'COMPLETED',
        final_status = coalesce(i.final_status, closed_interviews.final_status)
    from closed_interviews
    where i.interview_id = closed_interviews.interview_id
    `,
    organizationId,
    SESSION_END_BUFFER_SECONDS,
    STALE_ATTEMPT_THRESHOLD_SECONDS
  )
    .then(() => {
      lastFinalizedAtByOrganization.set(organizationId, Date.now())
    })
    .finally(() => {
      finalizeInFlightByOrganization.delete(organizationId)
    })

  finalizeInFlightByOrganization.set(organizationId, operation)
  return operation
}
