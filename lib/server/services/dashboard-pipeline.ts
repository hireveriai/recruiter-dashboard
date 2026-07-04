import { Prisma } from "@prisma/client"

import { getInterviewAppUrl } from "@/lib/server/interview-url"
import { prisma } from "@/lib/server/prisma"
import { deriveInterviewStatus, isInviteUsable } from "@/lib/server/services/interview-status"
import { ensureInterviewRecoverySchema } from "@/lib/server/services/interview-recovery"
import { finalizeStaleInterviewAttempts } from "@/lib/server/services/interview-stale-finalizer"

type DashboardPipelineOptions = {
  organizationId: string
  limit?: number | "all"
  finalizeStale?: boolean
  ensureRecoverySchema?: boolean
}

type DashboardPipelineItem = {
  inviteId: string
  link: string
  candidateName: string
  jobTitle: string
  accessType: string
  startTime: Date | string | null
  endTime: Date | string | null
  expiresAt: Date | string | null
  startedAt: Date | string | null
  endedAt: Date | string | null
  createdAt: Date | string | null
  interviewId: string
  status: string | null
  questionStatus: string | null
  emailStatus: string | null
  failureReason: string | null
  lastError: string | null
  recovery?: {
    available: boolean
    reason: string | null
    completionPercentage: number
    attemptId: string
    timerRemainingSeconds: number | null
  } | null
}

type DashboardPipelineData = {
  pipeline: {
    pending: number
    inProgress: number
    completed: number
    flagged: number
    reviewed: number
    reviewRequired: number
  }
  pendingInterviews: DashboardPipelineItem[]
  pendingTotal: number
}

type PipelineRow = {
  total_pending: number
  total_in_progress: number
  total_completed: number
  total_flagged: number
  total_reviewed: number
  total_review_required: number
  interview_id: string | null
  interview_status: string | null
  question_status: string | null
  email_status: string | null
  latest_attempt_id: string | null
  latest_attempt_status: string | null
  latest_attempt_started_at: Date | string | null
  latest_attempt_ended_at: Date | string | null
  latest_invite_id: string | null
  latest_invite_token: string | null
  latest_invite_access_type: string | null
  latest_invite_start_time: Date | string | null
  latest_invite_end_time: Date | string | null
  latest_invite_expires_at: Date | string | null
  latest_invite_created_at: Date | string | null
  latest_invite_status: string | null
  latest_invite_used_at: Date | string | null
  candidate_name: string | null
  job_title: string | null
  failure_reason: string | null
  last_error: string | null
  created_at: Date | string
  max_attempts: number | null
  recovery_allowed: boolean | null
  recovery_used: boolean | null
  recovery_attempt_number: number | null
  interruption_reason: string | null
  completion_percentage: string | number | null
  required_question_count: number | null
  answered_question_count: number | null
  timer_remaining_seconds: number | null
  recruiter_decision_status: string | null
}
type PendingPipelineRow = PipelineRow & {
  interview_id: string
}

let recoverySchemaReady: Promise<void> | null = null

function ensureRecoverySchemaOnce() {
  if (!recoverySchemaReady) {
    recoverySchemaReady = ensureInterviewRecoverySchema().catch((error) => {
      recoverySchemaReady = null
      throw error
    })
  }

  return recoverySchemaReady
}

function getRecovery(row: PipelineRow) {
  if (!row.latest_attempt_id || !["INTERRUPTED", "RECOVERY_ALLOWED"].includes(String(row.latest_attempt_status ?? "").toUpperCase())) {
    return null
  }

  if (
    Number(row.required_question_count ?? 0) > 0 &&
    Number(row.answered_question_count ?? 0) >= Number(row.required_question_count)
  ) {
    return null
  }

  const completionRaw = Number(row.completion_percentage ?? 0)
  const completion = completionRaw > 1 ? completionRaw : completionRaw * 100

  return {
    available:
      Boolean(row.recovery_allowed) &&
      !row.recovery_used &&
      Number(row.recovery_attempt_number ?? 0) < Math.max(row.max_attempts ?? 2, 1),
    reason: row.interruption_reason,
    completionPercentage: Math.round(completion),
    attemptId: row.latest_attempt_id,
    timerRemainingSeconds: row.timer_remaining_seconds,
  }
}

function getDisplayStatus(row: PipelineRow) {
  return deriveInterviewStatus({
    interviewStatus: row.interview_status,
    questionStatus: row.question_status,
    emailStatus: row.email_status,
    latestAttempt: row.latest_attempt_id
      ? {
          attemptId: row.latest_attempt_id,
          endedAt: row.latest_attempt_ended_at,
          status: row.latest_attempt_status,
          requiredQuestionCount: row.required_question_count,
          answeredQuestionCount: row.answered_question_count,
          completionPercentage: row.completion_percentage === null ? null : Number(row.completion_percentage),
        }
      : null,
    latestInvite: row.latest_invite_id
      ? {
          expiresAt: row.latest_invite_expires_at,
          status: row.latest_invite_status,
          usedAt: row.latest_invite_used_at,
        }
      : null,
  })
}

function isPendingQueueRow(row: PipelineRow, displayStatus: string, recovery: ReturnType<typeof getRecovery>) {
  const normalizedInterviewStatus = String(row.interview_status ?? "").toUpperCase()
  const normalizedDisplayStatus = String(displayStatus).toUpperCase()

  if (recovery || normalizedDisplayStatus === "PREPARATION_FAILED") {
    return true
  }

  return (
    normalizedInterviewStatus === "READY" &&
    Boolean(row.latest_invite_id) &&
    isInviteUsable({
      status: row.latest_invite_status,
      expiresAt: row.latest_invite_expires_at,
      usedAt: row.latest_invite_used_at,
    })
  )
}

function buildPendingItem(row: PendingPipelineRow, appUrl: string, displayStatus: string, recovery: ReturnType<typeof getRecovery>): DashboardPipelineItem {
  const normalizedEmailStatus = String(row.email_status ?? "").toUpperCase()
  const normalizedDisplayStatus = String(displayStatus).toUpperCase()
  const status = recovery
    ? "INTERRUPTED"
    : normalizedDisplayStatus === "PREPARATION_FAILED"
      ? "PREPARATION_FAILED"
      : normalizedEmailStatus === "FAILED"
        ? "EMAIL_FAILED"
        : normalizedEmailStatus === "SENDING"
          ? "SENDING_EMAIL"
          : "READY"

  return {
    inviteId: row.latest_invite_id ?? row.latest_attempt_id ?? row.interview_id,
    link: row.latest_invite_token ? `${appUrl}/interview/${row.latest_invite_token}` : "",
    interviewId: row.interview_id,
    candidateName: row.candidate_name ?? "-",
    jobTitle: row.job_title ?? "-",
    accessType: recovery ? "RECOVERY" : row.latest_invite_access_type ?? "FLEXIBLE",
    startTime: row.latest_invite_start_time ?? null,
    endTime: row.latest_invite_end_time ?? null,
    expiresAt: row.latest_invite_expires_at ?? null,
    startedAt: row.latest_attempt_started_at ?? null,
    endedAt: row.latest_attempt_ended_at ?? null,
    createdAt: row.latest_invite_created_at ?? row.created_at,
    status,
    questionStatus: row.question_status ?? null,
    emailStatus: row.email_status ?? null,
    failureReason: row.failure_reason ?? null,
    lastError: row.last_error ?? null,
    recovery,
  }
}

export async function getDashboardPipelineData(
  options: DashboardPipelineOptions
): Promise<DashboardPipelineData> {
  if (options.ensureRecoverySchema !== false) {
    await ensureRecoverySchemaOnce()
  }
  if (options.finalizeStale !== false) {
    await finalizeStaleInterviewAttempts(options.organizationId)
  }
  const appUrl = getInterviewAppUrl().replace(/\/$/, "")
  const take = options.limit === "all" || options.limit === undefined ? undefined : options.limit

  const rows = await prisma.$queryRaw<PipelineRow[]>`
    with base as (
      select
        i.interview_id,
        i.status as interview_status,
        i.question_status,
        i.email_status,
        i.failure_reason,
        i.last_error,
        i.created_at,
        i.max_attempts,
        i.recovery_allowed,
        i.recovery_used,
        c.full_name as candidate_name,
        jp.job_title,
        inv.invite_id,
        inv.token as latest_invite_token,
        inv.access_type as latest_invite_access_type,
        inv.start_time as latest_invite_start_time,
        inv.end_time as latest_invite_end_time,
        inv.expires_at as latest_invite_expires_at,
        inv.created_at as latest_invite_created_at,
        inv.status as latest_invite_status,
        inv.used_at as latest_invite_used_at,
        ia.attempt_id,
        ia.status as latest_attempt_status,
        ia.started_at as latest_attempt_started_at,
        ia.ended_at as latest_attempt_ended_at,
        ia.attempt_number as recovery_attempt_number,
        ia.interruption_reason,
        ia.completion_percentage,
        completion_stats.required_question_count,
        completion_stats.answered_question_count,
        ia.timer_remaining_seconds,
        rd.status as recruiter_decision_status
      from public.interviews i
      left join public.candidates c on c.candidate_id = i.candidate_id
      left join public.job_positions jp on jp.job_id = i.job_id
      left join lateral (
        select *
        from public.interview_invites latest_invite
        where latest_invite.interview_id = i.interview_id
        order by latest_invite.created_at desc
        limit 1
      ) inv on true
      left join lateral (
        select *
        from public.interview_attempts latest
        where latest.interview_id = i.interview_id
        order by latest.attempt_number desc, latest.started_at desc
        limit 1
      ) ia on true
      left join lateral (
        select
          greatest(coalesce(i.question_count, 0), 1)::int as required_question_count,
          count(distinct ans.answer_id) filter (
            where (
                nullif(trim(coalesce(ans.answer_text, '')), '') is not null
                and lower(trim(coalesce(ans.answer_text, ''))) <> 'no response provided.'
              )
              or nullif(trim(coalesce(cs.code_text, '')), '') is not null
          )::int as answered_question_count
        from public.interview_answers ans
        left join public.interview_code_submissions cs
          on cs.answer_id = ans.answer_id
        where ans.attempt_id = ia.attempt_id
      ) completion_stats on true
      left join public.candidate_recruiter_decisions rd
        on rd.organization_id = i.organization_id
        and rd.candidate_id = i.candidate_id
        and rd.interview_id = i.interview_id
      where i.organization_id = ${options.organizationId}::uuid
    ),
    classified as (
      select
        *,
        case
          when upper(coalesce(latest_attempt_status, '')) in ('INTERRUPTED', 'RECOVERY_ALLOWED')
            and not (
              coalesce(answered_question_count, 0) >= greatest(coalesce(required_question_count, 0), 1)
            ) then true
          else false
        end as has_recovery,
        case
          when upper(coalesce(interview_status, '')) = 'FAILED' or upper(coalesce(question_status, '')) = 'FAILED' then 'PREPARATION_FAILED'
          when upper(coalesce(interview_status, '')) = 'PREPARING' or upper(coalesce(question_status, '')) = 'GENERATING' then 'PREPARING_INTERVIEW'
          when upper(coalesce(interview_status, '')) = 'COMPLETED'
            or upper(coalesce(latest_attempt_status, '')) = 'COMPLETED'
            or latest_attempt_ended_at is not null
            or coalesce(answered_question_count, 0) >= greatest(coalesce(required_question_count, 0), 1)
            then 'COMPLETED'
          when upper(coalesce(interview_status, '')) = 'FLAGGED' then 'FLAGGED'
          when attempt_id is not null then 'IN_PROGRESS'
          when upper(coalesce(interview_status, '')) = 'READY' and upper(coalesce(email_status, '')) = 'FAILED' then 'EMAIL_FAILED'
          when upper(coalesce(email_status, '')) = 'SENDING' then 'SENDING_EMAIL'
          when invite_id is not null
            and upper(coalesce(latest_invite_status, '')) <> ''
            and (
              upper(coalesce(latest_invite_status, 'ACTIVE')) <> 'ACTIVE'
              or latest_invite_used_at is not null
              or (latest_invite_expires_at is not null and latest_invite_expires_at <= now())
            )
            then case
              when latest_invite_expires_at is not null and latest_invite_expires_at <= now() and latest_invite_used_at is null then 'EXPIRED'
              else upper(coalesce(latest_invite_status, ''))
            end
          when upper(coalesce(interview_status, '')) = 'READY' then 'READY'
          else coalesce(upper(nullif(interview_status, '')), 'PENDING')
        end as display_status
      from base
    ),
    counted as (
      select
        *,
        (
          has_recovery
          or display_status = 'PREPARATION_FAILED'
          or (
            upper(coalesce(interview_status, '')) = 'READY'
            and invite_id is not null
            and upper(coalesce(latest_invite_status, 'ACTIVE')) = 'ACTIVE'
            and latest_invite_used_at is null
            and (latest_invite_expires_at is null or latest_invite_expires_at > now())
          )
        ) as is_pending_queue
      from classified
    ),
    aggregate as (
      select
        count(*) filter (where display_status in ('FLAGGED', 'PREPARATION_FAILED'))::int as total_flagged,
        count(*) filter (where display_status <> 'FLAGGED' and is_pending_queue)::int as total_pending,
        count(*) filter (where display_status <> 'FLAGGED' and display_status = 'IN_PROGRESS')::int as total_in_progress,
        count(*) filter (where display_status <> 'FLAGGED' and display_status = 'COMPLETED')::int as total_completed,
        count(*) filter (where display_status <> 'FLAGGED' and display_status = 'COMPLETED' and recruiter_decision_status is not null)::int as total_reviewed,
        count(*) filter (where display_status <> 'FLAGGED' and display_status = 'COMPLETED' and recruiter_decision_status is null)::int as total_review_required
      from counted
    ),
    pending_rows as (
      select *
      from counted
      where display_status <> 'FLAGGED'
        and is_pending_queue
      order by coalesce(
        latest_attempt_ended_at,
        latest_attempt_started_at,
        latest_invite_start_time,
        latest_invite_created_at,
        created_at
      ) desc nulls last
      ${take ? Prisma.sql`limit ${take}` : Prisma.empty}
    )
    select
      aggregate.total_pending,
      aggregate.total_in_progress,
      aggregate.total_completed,
      aggregate.total_flagged,
      aggregate.total_reviewed,
      aggregate.total_review_required,
      pending_rows.interview_id::text,
      pending_rows.interview_status,
      pending_rows.question_status,
      pending_rows.email_status,
      pending_rows.failure_reason,
      pending_rows.last_error,
      pending_rows.created_at,
      pending_rows.max_attempts,
      pending_rows.recovery_allowed,
      pending_rows.recovery_used,
      pending_rows.candidate_name,
      pending_rows.job_title,
      pending_rows.invite_id::text as latest_invite_id,
      pending_rows.latest_invite_token,
      pending_rows.latest_invite_access_type,
      pending_rows.latest_invite_start_time,
      pending_rows.latest_invite_end_time,
      pending_rows.latest_invite_expires_at,
      pending_rows.latest_invite_created_at,
      pending_rows.latest_invite_status,
      pending_rows.latest_invite_used_at,
      pending_rows.attempt_id::text as latest_attempt_id,
      pending_rows.latest_attempt_status,
      pending_rows.latest_attempt_started_at,
      pending_rows.latest_attempt_ended_at,
      pending_rows.recovery_attempt_number,
      pending_rows.interruption_reason,
      pending_rows.completion_percentage,
      pending_rows.required_question_count,
      pending_rows.answered_question_count,
      pending_rows.timer_remaining_seconds,
      pending_rows.recruiter_decision_status
    from aggregate
    left join pending_rows on true
  `

  const pendingInterviews: DashboardPipelineItem[] = []
  const firstRow = rows[0]
  const pending = Number(firstRow?.total_pending ?? 0)
  const inProgress = Number(firstRow?.total_in_progress ?? 0)
  const completed = Number(firstRow?.total_completed ?? 0)
  const flagged = Number(firstRow?.total_flagged ?? 0)
  const reviewed = Number(firstRow?.total_reviewed ?? 0)
  const reviewRequired = Number(firstRow?.total_review_required ?? 0)

  rows.forEach((row) => {
    if (!row.interview_id) {
      return
    }

    const displayStatus = getDisplayStatus(row)
    const normalizedDisplayStatus = String(displayStatus).toUpperCase()
    const recovery = getRecovery(row)

    const pendingRow = row as PendingPipelineRow

    if (isPendingQueueRow(pendingRow, displayStatus, recovery)) {
      pendingInterviews.push(buildPendingItem(pendingRow, appUrl, displayStatus, recovery))
    }
  })

  return {
    pipeline: {
      pending,
      inProgress,
      completed,
      flagged,
      reviewed,
      reviewRequired,
    },
    pendingInterviews,
    pendingTotal: pending,
  }
}
