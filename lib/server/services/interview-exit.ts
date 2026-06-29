import { Prisma } from "@prisma/client"

import { ApiError } from "@/lib/server/errors"
import { prisma } from "@/lib/server/prisma"

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

const FINAL_ATTEMPT_STATUSES = [
  "COMPLETED",
  "SUBMITTED",
  "EVALUATED",
  "FAILED",
  "TIME_EXPIRED",
  "ABANDONED",
  "MANUAL_EXIT",
]

type RecordInterviewEarlyExitInput = {
  token: string
  attemptId?: string | null
  reason?: string | null
  source?: string | null
  completionPercentage?: number | null
  timerRemainingSeconds?: number | null
  metadata?: Record<string, unknown> | null
}

type EarlyExitRow = {
  attempt_id: string
  interview_id: string
  status: string
  early_exit: boolean | null
  termination_reason: string | null
}

function normalizeReason(reason: string | null | undefined) {
  const normalized = String(reason ?? "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "_")
  return normalized || "candidate_left_interview"
}

function normalizeSource(source: string | null | undefined) {
  const normalized = String(source ?? "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "_")
  return normalized || "client"
}

function clampCompletionPercentage(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return null
  }

  const numeric = Number(value)
  if (!Number.isFinite(numeric)) {
    return null
  }

  if (numeric > 1) {
    return Math.max(0, Math.min(1, numeric / 100))
  }

  return Math.max(0, Math.min(1, numeric))
}

function normalizeTimerRemainingSeconds(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return null
  }

  const numeric = Number(value)
  return Number.isFinite(numeric) ? Math.max(0, Math.round(numeric)) : null
}

function quoted(values: string[]) {
  return values.map((value) => `'${value}'`).join(", ")
}

async function ensureEarlyExitColumns() {
  await prisma.$executeRawUnsafe(`
    alter table if exists public.interview_attempts
      add column if not exists early_exit boolean not null default false,
      add column if not exists termination_type text,
      add column if not exists termination_reason text,
      add column if not exists termination_metadata jsonb not null default '{}'::jsonb,
      add column if not exists termination_detected_at timestamptz,
      add column if not exists disconnect_reason text,
      add column if not exists last_activity_at timestamptz,
      add column if not exists inactivity_seconds integer
  `)
}

export async function recordInterviewEarlyExit(input: RecordInterviewEarlyExitInput) {
  const token = input.token?.trim()

  if (!token) {
    throw new ApiError(400, "INTERVIEW_EXIT_TOKEN_REQUIRED", "Interview token is required")
  }

  await ensureEarlyExitColumns()

  const reason = normalizeReason(input.reason)
  const source = normalizeSource(input.source)
  const completionPercentage = clampCompletionPercentage(input.completionPercentage)
  const timerRemainingSeconds = normalizeTimerRemainingSeconds(input.timerRemainingSeconds)
  const metadata = {
    ...(input.metadata && typeof input.metadata === "object" ? input.metadata : {}),
    reason,
    source,
    reportedAt: new Date().toISOString(),
  }
  const metadataJson = JSON.stringify(metadata)

  const rows = await prisma.$queryRaw<EarlyExitRow[]>(Prisma.sql`
    with scoped_interview as (
      select ii.interview_id
      from public.interview_invites ii
      where ii.token = ${token}
      order by ii.created_at desc nulls last
      limit 1
    ),
    target_attempt as (
      select ia.attempt_id, ia.interview_id
      from public.interview_attempts ia
      inner join scoped_interview si on si.interview_id = ia.interview_id
      where
        (${input.attemptId ?? null}::uuid is null or ia.attempt_id = ${input.attemptId ?? null}::uuid)
        and upper(coalesce(ia.status, '')) in (${Prisma.raw(quoted(ACTIVE_ATTEMPT_STATUSES))})
        and ia.ended_at is null
      order by ia.started_at desc
      limit 1
    ),
    updated_attempt as (
      update public.interview_attempts ia
      set
        status = 'MANUAL_EXIT',
        ended_at = coalesce(ia.ended_at, now()),
        early_exit = true,
        interruption_reason = coalesce(ia.interruption_reason, ${reason}),
        interruption_detected_at = coalesce(ia.interruption_detected_at, now()),
        termination_type = 'manual_exit',
        termination_reason = ${reason},
        disconnect_reason = ${reason},
        termination_detected_at = coalesce(ia.termination_detected_at, now()),
        last_activity_at = coalesce(ia.last_activity_at, now()),
        completion_percentage = coalesce(${completionPercentage}::numeric, ia.completion_percentage),
        timer_remaining_seconds = coalesce(${timerRemainingSeconds}::int, ia.timer_remaining_seconds),
        termination_metadata = coalesce(ia.termination_metadata, '{}'::jsonb) || ${metadataJson}::jsonb,
        inactivity_seconds = case
          when ia.last_activity_at is null then ia.inactivity_seconds
          else greatest(extract(epoch from (now() - ia.last_activity_at))::int, 0)
        end
      from target_attempt ta
      where ia.attempt_id = ta.attempt_id
      returning ia.attempt_id::text, ia.interview_id::text, ia.status, ia.early_exit, ia.termination_reason
    ),
    closed_interview as (
      update public.interviews i
      set
        status = 'COMPLETED',
        final_status = 'MANUAL_EXIT'
      from updated_attempt ua
      where i.interview_id = ua.interview_id::uuid
        and not exists (
          select 1
          from public.interview_attempts active
          where active.interview_id = i.interview_id
            and active.attempt_id <> ua.attempt_id::uuid
            and upper(coalesce(active.status, '')) not in (${Prisma.raw(quoted(FINAL_ATTEMPT_STATUSES))})
            and active.ended_at is null
        )
      returning i.interview_id
    )
    select * from updated_attempt
  `)

  const result = rows[0]

  if (!result?.attempt_id) {
    return {
      recorded: false,
      reason: "NO_ACTIVE_ATTEMPT",
    }
  }

  return {
    recorded: true,
    attemptId: result.attempt_id,
    interviewId: result.interview_id,
    status: result.status,
    earlyExit: Boolean(result.early_exit),
    terminationReason: result.termination_reason,
  }
}
