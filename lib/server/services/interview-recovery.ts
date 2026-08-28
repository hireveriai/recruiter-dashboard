import crypto from "crypto"
import { Prisma } from "@prisma/client"

import { ApiError } from "@/lib/server/errors"
import { getInterviewAppUrl } from "@/lib/server/interview-url"
import { prepareRecoveryQuestionnaire } from "@/lib/server/interview/recovery-questionnaire"
import { prisma } from "@/lib/server/prisma"

const RECOVERY_LINK_TTL_HOURS = 24
const RECOVERY_COMPLETION_THRESHOLD = 0.85

type RecoveryAction = "approve" | "deny" | "expire"

type RecoveryCandidateRow = {
  interview_id: string
  organization_id: string
  candidate_id: string
  max_attempts: number | null
  recovery_allowed: boolean | null
  recovery_used: boolean | null
  interview_status: string | null
  attempt_id: string
  attempt_number: number
  attempt_status: string | null
  completion_percentage: string | number | null
  interruption_reason: string | null
  interruption_detected_at: Date | string | null
  timer_remaining_seconds: number | null
  attempts_used: number
}

function asNumber(value: string | number | null | undefined) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0
  if (typeof value === "string") {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function normalizeCompletion(value: string | number | null | undefined) {
  const raw = asNumber(value)
  return raw > 1 ? raw / 100 : raw
}

function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex")
}

function createRecoveryToken() {
  return `hrv_rec_${crypto.randomBytes(32).toString("base64url")}`
}

export async function ensureInterviewRecoverySchema() {
  await prisma.$executeRawUnsafe(`
    alter table if exists public.interviews
      add column if not exists recovery_allowed boolean not null default true,
      add column if not exists recovery_used boolean not null default false,
      add column if not exists final_status text,
      add column if not exists forensic_timeline_id uuid,
      alter column max_attempts set default 2
  `)

  await prisma.$executeRawUnsafe(`
    update public.interviews
    set max_attempts = greatest(coalesce(max_attempts, 1), 2)
    where max_attempts is null or max_attempts < 2
  `)

  await prisma.$executeRawUnsafe(`
    alter table if exists public.interview_attempts
      add column if not exists interruption_reason text,
      add column if not exists interruption_detected_at timestamptz,
      add column if not exists completion_percentage numeric(6,4),
      add column if not exists transcript_status text not null default 'PENDING',
      add column if not exists recording_status text not null default 'PENDING',
      add column if not exists timer_remaining_seconds integer,
      add column if not exists inherited_from_attempt_id uuid references public.interview_attempts(attempt_id),
      add column if not exists recovery_link_issued_at timestamptz,
      add column if not exists recovery_link_expires_at timestamptz,
      add column if not exists recovery_decision text,
      add column if not exists recovery_decided_by uuid,
      add column if not exists recovery_decided_at timestamptz,
      add column if not exists recovery_token_hash text,
      add column if not exists recovery_token_used_at timestamptz,
      add column if not exists recovery_policy jsonb not null default '{}'::jsonb
  `)

  await prisma.$executeRawUnsafe(`
    create table if not exists public.interview_recovery_events (
      recovery_event_id uuid primary key default gen_random_uuid(),
      interview_id uuid not null references public.interviews(interview_id) on delete cascade,
      attempt_id uuid references public.interview_attempts(attempt_id) on delete set null,
      inherited_from_attempt_id uuid references public.interview_attempts(attempt_id) on delete set null,
      event_type text not null,
      classifier text,
      reason text,
      source text not null default 'system',
      idempotency_key text,
      occurred_at timestamptz not null default now(),
      actor_id uuid,
      metadata jsonb not null default '{}'::jsonb
    )
  `)

  await prisma.$executeRawUnsafe(`
    create unique index if not exists ux_recovery_events_idempotency
      on public.interview_recovery_events(interview_id, idempotency_key)
      where idempotency_key is not null
  `)

  await prisma.$executeRawUnsafe(`
    create unique index if not exists ux_interview_active_recovery_token
      on public.interview_attempts(recovery_token_hash)
      where recovery_token_hash is not null and recovery_token_used_at is null
  `)
}

async function getRecoveryCandidate(organizationId: string, interviewId: string) {
  await ensureInterviewRecoverySchema()

  const rows = await prisma.$queryRaw<RecoveryCandidateRow[]>(Prisma.sql`
    select
      i.interview_id::text,
      i.organization_id::text,
      i.candidate_id::text,
      i.max_attempts,
      i.recovery_allowed,
      i.recovery_used,
      i.status as interview_status,
      ia.attempt_id::text,
      ia.attempt_number,
      ia.status as attempt_status,
      ia.completion_percentage,
      ia.interruption_reason,
      ia.interruption_detected_at,
      ia.timer_remaining_seconds,
      (
        select count(*)::int
        from public.interview_attempts counted
        where counted.interview_id = i.interview_id
      ) as attempts_used
    from public.interviews i
    join lateral (
      select *
      from public.interview_attempts latest
      where latest.interview_id = i.interview_id
      order by latest.attempt_number desc, latest.started_at desc
      limit 1
    ) ia on true
    where i.interview_id = ${interviewId}::uuid
      and i.organization_id = ${organizationId}::uuid
    limit 1
  `)

  const row = rows[0]
  if (!row) {
    throw new ApiError(404, "INTERVIEW_NOT_FOUND", "Interview not found")
  }

  return row
}

function assertRecoveryAllowed(row: RecoveryCandidateRow) {
  const completion = normalizeCompletion(row.completion_percentage)
  const attemptStatus = String(row.attempt_status ?? "").toUpperCase()
  const interviewStatus = String(row.interview_status ?? "").toUpperCase()
  const technicalStatus = ["INTERRUPTED", "RECOVERY_ALLOWED"].includes(attemptStatus)

  if (!row.recovery_allowed) {
    throw new ApiError(409, "RECOVERY_DISABLED", "Recovery is disabled for this interview")
  }

  if (row.recovery_used) {
    throw new ApiError(409, "RECOVERY_ALREADY_USED", "A recovery attempt has already been used")
  }

  if (row.attempts_used >= Math.max(row.max_attempts ?? 2, 1)) {
    throw new ApiError(409, "MAX_ATTEMPTS_REACHED", "Maximum interview attempts reached")
  }

  if (interviewStatus === "COMPLETED" || attemptStatus === "COMPLETED") {
    throw new ApiError(409, "INTERVIEW_ALREADY_COMPLETED", "Completed interviews cannot be recovered")
  }

  if (!technicalStatus || !row.interruption_detected_at) {
    throw new ApiError(409, "NO_TECHNICAL_INTERRUPTION", "No recoverable technical interruption was detected")
  }

  if (completion >= RECOVERY_COMPLETION_THRESHOLD) {
    throw new ApiError(409, "COMPLETION_TOO_HIGH", "Completion is above the recovery threshold")
  }
}

export async function decideInterviewRecovery(params: {
  organizationId: string
  recruiterId: string
  interviewId: string
  action: RecoveryAction
  idempotencyKey?: string | null
}) {
  const row = await getRecoveryCandidate(params.organizationId, params.interviewId)
  const normalizedAction = params.action

  if (normalizedAction === "expire") {
    await prisma.$executeRaw(Prisma.sql`
      update public.interview_attempts
      set recovery_decision = 'EXPIRED',
          recovery_decided_by = ${params.recruiterId}::uuid,
          recovery_decided_at = now(),
          recovery_token_hash = null
      where attempt_id = ${row.attempt_id}::uuid
    `)

    await prisma.$executeRaw(Prisma.sql`
      insert into public.interview_recovery_events (
        interview_id, attempt_id, event_type, reason, source, actor_id, idempotency_key, metadata
      )
      values (
        ${row.interview_id}::uuid, ${row.attempt_id}::uuid, 'RECOVERY_EXPIRED',
        'Recruiter expired recovery access', 'recruiter_dashboard', ${params.recruiterId}::uuid,
        ${params.idempotencyKey ?? `expire:${row.attempt_id}`}::text, '{}'::jsonb
      )
      on conflict (interview_id, idempotency_key)
      where idempotency_key is not null
      do nothing
    `)

    return { status: "EXPIRED", recoveryLink: null }
  }

  if (normalizedAction === "deny") {
    await prisma.$executeRaw(Prisma.sql`
      update public.interview_attempts
      set recovery_decision = 'DENIED',
          recovery_decided_by = ${params.recruiterId}::uuid,
          recovery_decided_at = now(),
          recovery_token_hash = null
      where attempt_id = ${row.attempt_id}::uuid
    `)

    await prisma.$executeRaw(Prisma.sql`
      update public.interviews
      set recovery_allowed = false,
          final_status = 'RECOVERY_DENIED'
      where interview_id = ${row.interview_id}::uuid
    `)

    await prisma.$executeRaw(Prisma.sql`
      insert into public.interview_recovery_events (
        interview_id, attempt_id, event_type, reason, source, actor_id, idempotency_key, metadata
      )
      values (
        ${row.interview_id}::uuid, ${row.attempt_id}::uuid, 'RECOVERY_DENIED',
        'Recruiter denied recovery access', 'recruiter_dashboard', ${params.recruiterId}::uuid,
        ${params.idempotencyKey ?? `deny:${row.attempt_id}`}::text, '{}'::jsonb
      )
      on conflict (interview_id, idempotency_key)
      where idempotency_key is not null
      do nothing
    `)

    return { status: "DENIED", recoveryLink: null }
  }

  assertRecoveryAllowed(row)

  const token = createRecoveryToken()
  const tokenHash = hashToken(token)
  const expiresAt = new Date(Date.now() + RECOVERY_LINK_TTL_HOURS * 60 * 60 * 1000)
  const appUrl = getInterviewAppUrl().replace(/\/$/, "")

  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.$queryRaw<Array<{ token: string | null; expires_at: Date | string | null }>>(Prisma.sql`
      select ii.token, ii.expires_at
      from public.interview_attempts ia
      left join public.interview_invites ii
        on ii.interview_id = ia.interview_id
       and ii.access_type = 'RECOVERY'
       and ii.status = 'ACTIVE'
       and ii.expires_at > now()
      where ia.attempt_id = ${row.attempt_id}::uuid
        and ia.recovery_token_hash is not null
        and ia.recovery_token_used_at is null
        and ia.recovery_link_expires_at > now()
      order by ii.created_at desc
      limit 1
    `)

    if (existing[0]?.token) {
      return {
        token: existing[0].token,
        expiresAt: existing[0].expires_at,
        reused: true,
      }
    }

    await tx.$executeRaw(Prisma.sql`
      update public.interview_attempts
      set status = 'RECOVERY_ALLOWED',
          recovery_decision = 'APPROVED',
          recovery_decided_by = ${params.recruiterId}::uuid,
          recovery_decided_at = now(),
          recovery_link_issued_at = now(),
          recovery_link_expires_at = ${expiresAt}::timestamptz,
          recovery_token_hash = ${tokenHash}::text,
          recovery_policy = jsonb_build_object(
            'timer_mode', 'CONTINUE_REMAINING_TIME',
            'completion_threshold', ${RECOVERY_COMPLETION_THRESHOLD}::numeric,
            'max_attempts', ${Math.max(row.max_attempts ?? 2, 1)}::integer
          )
      where attempt_id = ${row.attempt_id}::uuid
        and recovery_token_used_at is null
    `)

    await tx.$executeRaw(Prisma.sql`
      update public.interviews
      set status = 'RECOVERY_ALLOWED',
          final_status = 'RECOVERY_ALLOWED',
          recovery_allowed = true
      where interview_id = ${row.interview_id}::uuid
    `)

    await tx.$executeRaw(Prisma.sql`
      insert into public.interview_invites (
        interview_id,
        token,
        expires_at,
        max_attempts,
        attempts_used,
        status,
        issued_by,
        access_type,
        created_at,
        updated_at
      )
      values (
        ${row.interview_id}::uuid,
        ${token}::text,
        ${expiresAt}::timestamptz,
        1,
        0,
        'ACTIVE',
        ${params.recruiterId}::uuid,
        'RECOVERY',
        now(),
        now()
      )
    `)

    await tx.$executeRaw(Prisma.sql`
      insert into public.interview_recovery_events (
        interview_id, attempt_id, event_type, classifier, reason, source, actor_id, idempotency_key, metadata
      )
      values (
        ${row.interview_id}::uuid,
        ${row.attempt_id}::uuid,
        'RECOVERY_APPROVED',
        'NETWORK_ISSUE',
        'Recruiter approved controlled forensic recovery',
        'recruiter_dashboard',
        ${params.recruiterId}::uuid,
        ${params.idempotencyKey ?? `approve:${row.attempt_id}`}::text,
        jsonb_build_object(
          'timer_remaining_seconds', ${row.timer_remaining_seconds ?? null}::integer,
          'completion_percentage', ${normalizeCompletion(row.completion_percentage)}::numeric,
          'link_expires_at', ${expiresAt}::timestamptz
        )
      )
      on conflict (interview_id, idempotency_key)
      where idempotency_key is not null
      do nothing
    `)

    return { token, expiresAt, reused: false }
  })

  // Prepare the alternate questionnaire now rather than when the candidate
  // opens the link, so generation is never in their critical path. This is a
  // no-op when the candidate had not yet seen a question, and is skipped if an
  // alternate already exists from an earlier recovery.
  //
  // Never allowed to block recovery: a failure here leaves the original
  // questionnaire in place, which is strictly better than denying access.
  let questionnaire = null
  try {
    questionnaire = await prepareRecoveryQuestionnaire({
      organizationId: params.organizationId,
      interviewId: params.interviewId,
    })

    await prisma.$executeRaw(Prisma.sql`
      insert into public.interview_recovery_events (
        interview_id, attempt_id, event_type, reason, source, actor_id, idempotency_key, metadata
      )
      values (
        ${row.interview_id}::uuid,
        ${row.attempt_id}::uuid,
        'RECOVERY_QUESTIONS_PREPARED',
        ${questionnaire.outcome}::text,
        'recruiter_dashboard',
        ${params.recruiterId}::uuid,
        ${`recovery_questions:${row.attempt_id}`}::text,
        ${JSON.stringify(questionnaire)}::jsonb
      )
      on conflict (interview_id, idempotency_key)
      where idempotency_key is not null
      do nothing
    `)
  } catch (error) {
    console.error("Recovery questionnaire preparation failed", {
      interviewId: params.interviewId,
      error: error instanceof Error ? error.message : error,
    })
  }

  return {
    status: "APPROVED",
    recoveryLink: `${appUrl}/interview/${result.token}`,
    expiresAt: result.expiresAt,
    reused: result.reused,
    questionnaire,
  }
}

export async function getInterviewRecoveryAudit(organizationId: string, interviewId: string) {
  await ensureInterviewRecoverySchema()

  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
    select
      ire.recovery_event_id::text as "eventId",
      ire.event_type as "eventType",
      ire.classifier,
      ire.reason,
      ire.source,
      ire.occurred_at as "occurredAt",
      ire.attempt_id::text as "attemptId",
      ire.inherited_from_attempt_id::text as "inheritedFromAttemptId",
      ire.metadata
    from public.interview_recovery_events ire
    join public.interviews i on i.interview_id = ire.interview_id
    where ire.interview_id = ${interviewId}::uuid
      and i.organization_id = ${organizationId}::uuid
    order by ire.occurred_at asc
  `)

  return rows
}
