/**
 * VERIS Live Interview — recruiter-dashboard control plane.
 *
 * A Live interview is a row in public.interviews with delivery_mode = 'LIVE'.
 * It reuses the job, candidate and questionnaire snapshot (interview_questions)
 * of the AI flow, but it NEVER creates interview_invites or interview_attempts
 * rows: every Calm Room and candidate-dashboard path is keyed on those, so
 * Live sessions stay invisible to the AI runtime. status / question_status /
 * email_status are pinned to non-AI values as defence in depth; the real
 * lifecycle lives in live_status.
 *
 * Invitation secrets: only SHA-256 hashes are stored. Raw tokens exist only
 * inside the outgoing email and are never returned by any function here.
 */

import { Prisma } from "@prisma/client"

import { ApiError } from "@/lib/server/errors"
import { prisma } from "@/lib/server/prisma"
import {
  generateInviteToken,
  generateLivekitIdentity,
  generateRoomName,
  hashInviteToken,
  inviteExpiry,
} from "@/lib/server/veris-live/tokens"

export const LIVE_CREDIT_SOURCE = "live_interview"
export const LIVE_STATUSES = ["SCHEDULED", "INVITATIONS_SENT", "IN_PROGRESS", "COMPLETED", "CANCELLED", "EXPIRED"] as const
export const PANEL_ROLES = ["HIRING_MANAGER", "INTERVIEWER", "PANEL_MEMBER"] as const
export type LiveStatus = (typeof LIVE_STATUSES)[number]
export type PanelRole = (typeof PANEL_ROLES)[number]
export type LiveBucket = "upcoming" | "in_progress" | "completed"

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_INTERVIEWERS = 8
const TERMINAL_STATUSES: LiveStatus[] = ["COMPLETED", "CANCELLED", "EXPIRED"]

// ---------------------------------------------------------------------------
// Validation (pure)

export type CreateLiveInterviewInput = {
  jobId: string
  candidateId: string
  scheduledStartAt: Date
  scheduledTimezone: string | null
  durationMinutes: number
  interviewers: Array<{ userId: string; panelRole: PanelRole }>
  sendInvitations: boolean
}

function badRequest(message: string): never {
  throw new ApiError(400, "INVALID_LIVE_INTERVIEW", message)
}

export function parseCreateLiveInterviewInput(body: unknown, now = new Date()): CreateLiveInterviewInput {
  const raw = (body && typeof body === "object" ? body : {}) as Record<string, unknown>

  const jobId = String(raw.jobId ?? "").trim()
  const candidateId = String(raw.candidateId ?? "").trim()
  if (!UUID_PATTERN.test(jobId)) badRequest("A valid job is required.")
  if (!UUID_PATTERN.test(candidateId)) badRequest("A valid candidate is required.")

  const scheduledStartAt = new Date(String(raw.scheduledStartAt ?? ""))
  if (Number.isNaN(scheduledStartAt.getTime())) badRequest("A valid scheduled start time is required.")
  // Allow a small grace window for "start now" scheduling.
  if (scheduledStartAt.getTime() < now.getTime() - 15 * 60_000) badRequest("Scheduled start time cannot be in the past.")
  if (scheduledStartAt.getTime() > now.getTime() + 180 * 24 * 60 * 60_000) badRequest("Scheduled start time is too far in the future.")

  const durationMinutes = Math.floor(Number(raw.durationMinutes ?? 45))
  if (!Number.isFinite(durationMinutes) || durationMinutes < 10 || durationMinutes > 240) {
    badRequest("Duration must be between 10 and 240 minutes.")
  }

  const timezoneRaw = typeof raw.scheduledTimezone === "string" ? raw.scheduledTimezone.trim() : ""
  let scheduledTimezone: string | null = null
  if (timezoneRaw) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: timezoneRaw })
      scheduledTimezone = timezoneRaw
    } catch {
      badRequest("Unknown timezone.")
    }
  }

  const interviewerList = Array.isArray(raw.interviewers) ? raw.interviewers : []
  if (interviewerList.length === 0) badRequest("Add at least one interviewer.")
  if (interviewerList.length > MAX_INTERVIEWERS) badRequest(`At most ${MAX_INTERVIEWERS} interviewers are allowed.`)

  const seen = new Set<string>()
  const interviewers = interviewerList.map((entry) => {
    const item = (entry && typeof entry === "object" ? entry : {}) as Record<string, unknown>
    const userId = String(item.userId ?? "").trim().toLowerCase()
    if (!UUID_PATTERN.test(userId)) badRequest("Each interviewer must be a valid team member.")
    if (seen.has(userId)) badRequest("An interviewer was added more than once.")
    seen.add(userId)
    const panelRole = String(item.panelRole ?? "INTERVIEWER").toUpperCase() as PanelRole
    if (!PANEL_ROLES.includes(panelRole)) badRequest("Unknown panel role.")
    return { userId, panelRole }
  })

  return {
    jobId,
    candidateId,
    scheduledStartAt,
    scheduledTimezone,
    durationMinutes,
    interviewers,
    sendInvitations: raw.sendInvitations !== false,
  }
}

export function bucketStatuses(bucket: LiveBucket): LiveStatus[] {
  if (bucket === "in_progress") return ["IN_PROGRESS"]
  if (bucket === "completed") return ["COMPLETED", "CANCELLED", "EXPIRED"]
  return ["SCHEDULED", "INVITATIONS_SENT"]
}

export function getVerisLiveAppUrl() {
  const configured = process.env.VERIS_LIVE_APP_URL?.trim()
  return (configured || "https://live.verisnova.com").replace(/\/$/, "")
}

// ---------------------------------------------------------------------------
// Dependencies that touch billing / questionnaire / email, injectable for tests.

export type LiveInterviewDeps = {
  assertCredits: (organizationId: string) => Promise<void>
  deductCredit: (organizationId: string, interviewId: string) => Promise<void>
  ensureQuestionnaire: (organizationId: string, jobId: string, userId: string) => Promise<string>
  snapshotQuestionnaire: (organizationId: string, interviewId: string, versionId: string) => Promise<unknown>
  sendInvitationEmail: (params: InvitationEmail) => Promise<unknown>
}

export type InvitationEmail = {
  to: string
  name: string
  link: string
  audience: "CANDIDATE" | "INTERVIEWER"
  companyName: string | null
  roleTitle: string | null
  candidateName: string | null
  durationMinutes: number | null
  scheduledStartUtc: Date
  organizationTimezone: string | null
}

async function defaultDeps(): Promise<LiveInterviewDeps> {
  const [credits, questionnaire, email] = await Promise.all([
    import("@/lib/server/services/trial-credits"),
    import("@/lib/server/services/job-questionnaire"),
    import("@/lib/services/email.service"),
  ])
  return {
    assertCredits: (organizationId) => credits.assertTrialCreditsAvailable({ organizationId, kind: "INTERVIEW" }).then(() => undefined),
    deductCredit: (organizationId, interviewId) =>
      credits
        .deductTrialCredits({ organizationId, kind: "INTERVIEW", source: LIVE_CREDIT_SOURCE, sourceId: interviewId })
        .then(() => undefined),
    ensureQuestionnaire: async (organizationId, jobId, userId) => {
      const result = await questionnaire.ensureFinalizedQuestionnaireVersion({ organizationId, jobId, createdBy: userId })
      return result.version.questionnaire_version_id
    },
    snapshotQuestionnaire: (organizationId, interviewId, versionId) =>
      questionnaire.snapshotVersionToInterview({ organizationId, interviewId, versionId }),
    sendInvitationEmail: (params) => email.sendLiveInterviewInvitationEmail(params),
  }
}

function logLive(event: string, fields: Record<string, unknown>) {
  // Never pass tokens, hashes, emails or notes here.
  console.info(JSON.stringify({ scope: "veris_live", event, ...fields }))
}

// ---------------------------------------------------------------------------
// Create

type CandidateRow = { candidate_id: string; full_name: string | null; email: string | null }
type InterviewerRow = { user_id: string; full_name: string | null; email: string | null }

export async function createLiveInterview(params: {
  organizationId: string
  userId: string
  input: CreateLiveInterviewInput
  deps?: LiveInterviewDeps
}) {
  const { organizationId, userId, input } = params
  const deps = params.deps ?? (await defaultDeps())

  const jobs = await prisma.$queryRaw<Array<{ job_id: string }>>(Prisma.sql`
    select job_id::text from public.job_positions
    where job_id = ${input.jobId}::uuid and organization_id = ${organizationId}::uuid
    limit 1
  `)
  if (!jobs[0]) throw new ApiError(404, "JOB_NOT_FOUND", "Job not found.")

  const candidates = await prisma.$queryRaw<CandidateRow[]>(Prisma.sql`
    select candidate_id::text, full_name, email from public.candidates
    where candidate_id = ${input.candidateId}::uuid and organization_id = ${organizationId}::uuid
    limit 1
  `)
  const candidate = candidates[0]
  if (!candidate) throw new ApiError(404, "CANDIDATE_NOT_FOUND", "Candidate not found.")
  if (!candidate.email?.trim()) throw new ApiError(400, "CANDIDATE_EMAIL_REQUIRED", "Candidate needs an email address.")

  const userIds = input.interviewers.map((entry) => entry.userId)
  const interviewerRows = await prisma.$queryRaw<InterviewerRow[]>(Prisma.sql`
    select user_id::text, full_name, email from public.users
    where organization_id = ${organizationId}::uuid
      and user_id in (${Prisma.join(userIds.map((id) => Prisma.sql`${id}::uuid`))})
      and coalesce(is_active, true) = true
      and team_removed_at is null
  `)
  const interviewerById = new Map(interviewerRows.map((row) => [row.user_id.toLowerCase(), row]))
  for (const id of userIds) {
    const row = interviewerById.get(id)
    if (!row) throw new ApiError(400, "INTERVIEWER_NOT_IN_ORG", "Every interviewer must be an active member of your team.")
    if (!row.email?.trim()) throw new ApiError(400, "INTERVIEWER_EMAIL_REQUIRED", "Every interviewer needs an email address.")
    // A candidate can never also sit on their own panel.
    if (row.email.trim().toLowerCase() === candidate.email.trim().toLowerCase()) {
      throw new ApiError(400, "CANDIDATE_CANNOT_INTERVIEW", "The candidate cannot also be an interviewer.")
    }
  }

  await deps.assertCredits(organizationId)
  const versionId = await deps.ensureQuestionnaire(organizationId, input.jobId, userId)

  const roomName = generateRoomName()
  const created = await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ interview_id: string }>>(Prisma.sql`
      insert into public.interviews (
        organization_id, job_id, candidate_id, interview_type, created_by, is_active,
        duration_minutes, status, question_status, email_status,
        delivery_mode, live_status, live_room_name, scheduled_start_at, scheduled_timezone
      ) values (
        ${organizationId}::uuid, ${input.jobId}::uuid, ${input.candidateId}::uuid, 'COMPANY_INTERVIEW',
        ${userId}::uuid, true, ${input.durationMinutes}, 'LIVE', 'NOT_APPLICABLE', 'NOT_APPLICABLE',
        'LIVE', 'SCHEDULED', ${roomName}, ${input.scheduledStartAt}, ${input.scheduledTimezone}
      )
      returning interview_id::text
    `)
    const interviewId = rows[0].interview_id

    await tx.$executeRaw(Prisma.sql`
      insert into public.interview_participants
        (organization_id, interview_id, role, candidate_id, display_name, email, livekit_identity)
      values
        (${organizationId}::uuid, ${interviewId}::uuid, 'CANDIDATE', ${input.candidateId}::uuid,
         ${candidate.full_name?.trim() || "Candidate"}, ${candidate.email!.trim()}, ${generateLivekitIdentity()})
    `)
    for (const entry of input.interviewers) {
      const row = interviewerById.get(entry.userId)!
      await tx.$executeRaw(Prisma.sql`
        insert into public.interview_participants
          (organization_id, interview_id, role, panel_role, user_id, display_name, email, livekit_identity)
        values
          (${organizationId}::uuid, ${interviewId}::uuid, 'INTERVIEWER', ${entry.panelRole}, ${entry.userId}::uuid,
           ${row.full_name?.trim() || "Interviewer"}, ${row.email!.trim()}, ${generateLivekitIdentity()})
      `)
    }
    return interviewId
  })

  try {
    await deps.snapshotQuestionnaire(organizationId, created, versionId)
    await deps.deductCredit(organizationId, created)
  } catch (error) {
    // Nothing references a just-created Live interview; remove it (cascade
    // clears participants) so a failed create costs nothing and leaves no row.
    await prisma.$executeRaw(Prisma.sql`
      delete from public.interviews
      where interview_id = ${created}::uuid and organization_id = ${organizationId}::uuid and delivery_mode = 'LIVE'
    `)
    logLive("create_failed", { organizationId, interviewId: created })
    throw error
  }

  logLive("created", { organizationId, interviewId: created, interviewers: input.interviewers.length })

  let invitations: InvitationResult | null = null
  if (input.sendInvitations) {
    invitations = await sendLiveInvitations({ organizationId, interviewId: created, deps })
  }

  return { interviewId: created, invitations }
}

// ---------------------------------------------------------------------------
// Read

type LiveInterviewRow = {
  interview_id: string
  job_id: string
  job_title: string | null
  candidate_id: string
  candidate_name: string | null
  live_status: LiveStatus
  scheduled_start_at: Date | null
  scheduled_timezone: string | null
  duration_minutes: number | null
  live_started_at: Date | null
  live_ended_at: Date | null
  created_at: Date
  interviewer_count: number
  question_count: number
}

function mapLiveRow(row: LiveInterviewRow) {
  return {
    interviewId: row.interview_id,
    jobId: row.job_id,
    jobTitle: row.job_title,
    candidateId: row.candidate_id,
    candidateName: row.candidate_name,
    liveStatus: row.live_status,
    scheduledStartAt: row.scheduled_start_at?.toISOString() ?? null,
    scheduledTimezone: row.scheduled_timezone,
    durationMinutes: row.duration_minutes,
    startedAt: row.live_started_at?.toISOString() ?? null,
    endedAt: row.live_ended_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    interviewerCount: Number(row.interviewer_count ?? 0),
    questionCount: Number(row.question_count ?? 0),
  }
}

const LIVE_SELECT = Prisma.sql`
  select
    i.interview_id::text, i.job_id::text, jp.job_title, i.candidate_id::text, c.full_name as candidate_name,
    i.live_status, i.scheduled_start_at, i.scheduled_timezone, i.duration_minutes,
    i.live_started_at, i.live_ended_at, i.created_at,
    (select count(*)::int from public.interview_participants p
      where p.interview_id = i.interview_id and p.role = 'INTERVIEWER') as interviewer_count,
    (select count(*)::int from public.interview_questions q where q.interview_id = i.interview_id) as question_count
  from public.interviews i
  left join public.job_positions jp on jp.job_id = i.job_id
  left join public.candidates c on c.candidate_id = i.candidate_id
`

/** Scheduled sessions whose window has fully passed without starting become EXPIRED. */
async function expireStaleSessions(organizationId: string) {
  await prisma.$executeRaw(Prisma.sql`
    update public.interviews
    set live_status = 'EXPIRED'
    where organization_id = ${organizationId}::uuid
      and delivery_mode = 'LIVE'
      and live_status in ('SCHEDULED', 'INVITATIONS_SENT')
      and scheduled_start_at + make_interval(mins => coalesce(duration_minutes, 60)) + interval '24 hours' < now()
  `)
}

export async function listLiveInterviews(params: { organizationId: string; bucket: LiveBucket; limit?: number }) {
  await expireStaleSessions(params.organizationId)
  const statuses = bucketStatuses(params.bucket)
  const limit = Math.min(Math.max(params.limit ?? 50, 1), 200)
  const order = params.bucket === "completed"
    ? Prisma.sql`order by coalesce(i.live_ended_at, i.scheduled_start_at) desc`
    : Prisma.sql`order by i.scheduled_start_at asc`

  const rows = await prisma.$queryRaw<LiveInterviewRow[]>(Prisma.sql`
    ${LIVE_SELECT}
    where i.organization_id = ${params.organizationId}::uuid
      and i.delivery_mode = 'LIVE'
      and i.live_status in (${Prisma.join(statuses)})
    ${order}
    limit ${limit}
  `)
  return rows.map(mapLiveRow)
}

type ParticipantRow = {
  participant_id: string
  role: "CANDIDATE" | "INTERVIEWER"
  panel_role: PanelRole | null
  user_id: string | null
  display_name: string
  email: string
  invite_status: string
  invite_sent_at: Date | null
  invite_expires_at: Date | null
  revoked_at: Date | null
  join_status: string
  first_joined_at: Date | null
  last_left_at: Date | null
}

export async function getLiveInterviewDetail(params: { organizationId: string; interviewId: string }) {
  if (!UUID_PATTERN.test(params.interviewId)) throw new ApiError(404, "LIVE_INTERVIEW_NOT_FOUND", "Live interview not found.")

  const rows = await prisma.$queryRaw<LiveInterviewRow[]>(Prisma.sql`
    ${LIVE_SELECT}
    where i.organization_id = ${params.organizationId}::uuid
      and i.interview_id = ${params.interviewId}::uuid
      and i.delivery_mode = 'LIVE'
    limit 1
  `)
  if (!rows[0]) throw new ApiError(404, "LIVE_INTERVIEW_NOT_FOUND", "Live interview not found.")

  // invite_token_hash and livekit_identity are deliberately not selected.
  const participants = await prisma.$queryRaw<ParticipantRow[]>(Prisma.sql`
    select participant_id::text, role, panel_role, user_id::text, display_name, email,
           invite_status, invite_sent_at, invite_expires_at, revoked_at,
           join_status, first_joined_at, last_left_at
    from public.interview_participants
    where interview_id = ${params.interviewId}::uuid and organization_id = ${params.organizationId}::uuid
    order by case role when 'CANDIDATE' then 0 else 1 end, created_at
  `)

  return {
    ...mapLiveRow(rows[0]),
    participants: participants.map((p) => ({
      participantId: p.participant_id,
      role: p.role,
      panelRole: p.panel_role,
      userId: p.user_id,
      displayName: p.display_name,
      email: p.email,
      inviteStatus: p.invite_status,
      inviteSentAt: p.invite_sent_at?.toISOString() ?? null,
      inviteExpiresAt: p.invite_expires_at?.toISOString() ?? null,
      revokedAt: p.revoked_at?.toISOString() ?? null,
      joinStatus: p.join_status,
      firstJoinedAt: p.first_joined_at?.toISOString() ?? null,
      lastLeftAt: p.last_left_at?.toISOString() ?? null,
    })),
  }
}

// ---------------------------------------------------------------------------
// Invitations

export type InvitationResult = { sent: number; failed: number }

type InviteTargetRow = {
  participant_id: string
  role: "CANDIDATE" | "INTERVIEWER"
  display_name: string
  email: string
  scheduled_start_at: Date
  duration_minutes: number | null
  live_status: LiveStatus
  job_title: string | null
  candidate_name: string | null
  organization_name: string | null
  organization_timezone: string | null
}

/**
 * Issue (or re-issue) invitation links. Each send rotates the participant's
 * token, so any earlier link for that participant stops working. Revoked
 * participants are skipped unless explicitly targeted, which reinstates them.
 */
export async function sendLiveInvitations(params: {
  organizationId: string
  interviewId: string
  participantIds?: string[]
  deps?: LiveInterviewDeps
}): Promise<InvitationResult> {
  const deps = params.deps ?? (await defaultDeps())
  const targeted = params.participantIds?.filter((id) => UUID_PATTERN.test(id)) ?? null
  if (params.participantIds && targeted?.length === 0) badRequest("No valid participants selected.")

  const targets = await prisma.$queryRaw<InviteTargetRow[]>(Prisma.sql`
    select p.participant_id::text, p.role, p.display_name, p.email,
           i.scheduled_start_at, i.duration_minutes, i.live_status,
           jp.job_title, c.full_name as candidate_name,
           to_jsonb(o) ->> 'organization_name' as organization_name,
           to_jsonb(o) ->> 'timezone' as organization_timezone
    from public.interview_participants p
    join public.interviews i on i.interview_id = p.interview_id and i.organization_id = p.organization_id
    left join public.job_positions jp on jp.job_id = i.job_id
    left join public.candidates c on c.candidate_id = i.candidate_id
    left join public.organizations o on o.organization_id = i.organization_id
    where p.interview_id = ${params.interviewId}::uuid
      and p.organization_id = ${params.organizationId}::uuid
      and i.delivery_mode = 'LIVE'
      ${targeted
        ? Prisma.sql`and p.participant_id in (${Prisma.join(targeted.map((id) => Prisma.sql`${id}::uuid`))})`
        : Prisma.sql`and p.revoked_at is null`}
    order by case p.role when 'CANDIDATE' then 0 else 1 end, p.created_at
  `)
  if (targets.length === 0) throw new ApiError(404, "LIVE_INTERVIEW_NOT_FOUND", "Live interview not found.")
  if (TERMINAL_STATUSES.includes(targets[0].live_status) || targets[0].live_status === "IN_PROGRESS") {
    throw new ApiError(409, "LIVE_INTERVIEW_NOT_SCHEDULED", "Invitations can only be sent before the interview starts.")
  }

  const appUrl = getVerisLiveAppUrl()
  let sent = 0
  let failed = 0

  for (const target of targets) {
    const token = generateInviteToken()
    const expiresAt = inviteExpiry(target.scheduled_start_at, target.duration_minutes ?? 60)

    await prisma.$executeRaw(Prisma.sql`
      update public.interview_participants
      set invite_token_hash = ${hashInviteToken(token)},
          invite_expires_at = ${expiresAt},
          invite_status = 'PENDING',
          revoked_at = null,
          updated_at = now()
      where participant_id = ${target.participant_id}::uuid and organization_id = ${params.organizationId}::uuid
    `)

    try {
      await deps.sendInvitationEmail({
        to: target.email,
        name: target.display_name,
        link: `${appUrl}/join/${token}`,
        audience: target.role,
        companyName: target.organization_name,
        roleTitle: target.job_title,
        candidateName: target.candidate_name,
        durationMinutes: target.duration_minutes,
        scheduledStartUtc: target.scheduled_start_at,
        organizationTimezone: target.organization_timezone,
      })
      await prisma.$executeRaw(Prisma.sql`
        update public.interview_participants
        set invite_status = 'SENT', invite_sent_at = now(), updated_at = now()
        where participant_id = ${target.participant_id}::uuid
      `)
      sent += 1
    } catch (error) {
      await prisma.$executeRaw(Prisma.sql`
        update public.interview_participants
        set invite_status = 'FAILED', updated_at = now()
        where participant_id = ${target.participant_id}::uuid
      `)
      failed += 1
      logLive("invitation_failed", {
        organizationId: params.organizationId,
        interviewId: params.interviewId,
        participantId: target.participant_id,
        reason: error instanceof Error ? error.message.slice(0, 200) : "unknown",
      })
    }
  }

  if (sent > 0) {
    await prisma.$executeRaw(Prisma.sql`
      update public.interviews set live_status = 'INVITATIONS_SENT'
      where interview_id = ${params.interviewId}::uuid and organization_id = ${params.organizationId}::uuid
        and live_status = 'SCHEDULED'
    `)
  }
  await prisma.$executeRaw(Prisma.sql`
    insert into public.live_interview_events (organization_id, interview_id, event_type, payload)
    values (${params.organizationId}::uuid, ${params.interviewId}::uuid, 'INVITATIONS_SENT',
            ${JSON.stringify({ sent, failed })}::jsonb)
  `)
  logLive("invitations_sent", { organizationId: params.organizationId, interviewId: params.interviewId, sent, failed })

  return { sent, failed }
}

export async function revokeLiveInvitation(params: { organizationId: string; interviewId: string; participantId: string }) {
  if (!UUID_PATTERN.test(params.participantId) || !UUID_PATTERN.test(params.interviewId)) {
    throw new ApiError(404, "PARTICIPANT_NOT_FOUND", "Participant not found.")
  }
  const updated = await prisma.$executeRaw(Prisma.sql`
    update public.interview_participants p
    set invite_token_hash = null, invite_status = 'REVOKED', revoked_at = now(), updated_at = now()
    from public.interviews i
    where p.participant_id = ${params.participantId}::uuid
      and p.interview_id = ${params.interviewId}::uuid
      and p.organization_id = ${params.organizationId}::uuid
      and i.interview_id = p.interview_id
      and i.delivery_mode = 'LIVE'
  `)
  if (updated === 0) throw new ApiError(404, "PARTICIPANT_NOT_FOUND", "Participant not found.")

  await prisma.$executeRaw(Prisma.sql`
    insert into public.live_interview_events (organization_id, interview_id, participant_id, event_type)
    values (${params.organizationId}::uuid, ${params.interviewId}::uuid, ${params.participantId}::uuid, 'INVITATION_REVOKED')
  `)
  logLive("invitation_revoked", params)
}

export async function cancelLiveInterview(params: { organizationId: string; interviewId: string }) {
  if (!UUID_PATTERN.test(params.interviewId)) throw new ApiError(404, "LIVE_INTERVIEW_NOT_FOUND", "Live interview not found.")
  const updated = await prisma.$executeRaw(Prisma.sql`
    update public.interviews
    set live_status = 'CANCELLED', live_ended_at = coalesce(live_ended_at, now())
    where interview_id = ${params.interviewId}::uuid
      and organization_id = ${params.organizationId}::uuid
      and delivery_mode = 'LIVE'
      and live_status in ('SCHEDULED', 'INVITATIONS_SENT')
  `)
  if (updated === 0) {
    throw new ApiError(409, "LIVE_INTERVIEW_NOT_CANCELLABLE", "Only interviews that have not started can be cancelled.")
  }
  // Kill every outstanding link.
  await prisma.$executeRaw(Prisma.sql`
    update public.interview_participants
    set invite_token_hash = null, updated_at = now()
    where interview_id = ${params.interviewId}::uuid and organization_id = ${params.organizationId}::uuid
  `)
  await prisma.$executeRaw(Prisma.sql`
    insert into public.live_interview_events (organization_id, interview_id, event_type)
    values (${params.organizationId}::uuid, ${params.interviewId}::uuid, 'SESSION_CANCELLED')
  `)
  logLive("cancelled", params)
}

export async function listEligibleInterviewers(organizationId: string) {
  const rows = await prisma.$queryRaw<Array<{ user_id: string; full_name: string | null; email: string | null; role: string | null }>>(Prisma.sql`
    select user_id::text, full_name, email, role
    from public.users
    where organization_id = ${organizationId}::uuid
      and coalesce(is_active, true) = true
      and team_removed_at is null
      and email is not null
    order by full_name nulls last, email
  `)
  return rows.map((row) => ({ userId: row.user_id, name: row.full_name, email: row.email, role: row.role }))
}

// ---------------------------------------------------------------------------
// Report (Stage D)
//
// Shows each interviewer's SUBMITTED ratings side by side; never combines
// them into a score and never shows private notes or unsubmitted drafts.

type ReportEventRow = {
  event_type: string
  participant_id: string | null
  interview_question_id: string | null
  payload: Record<string, unknown>
  occurred_at: Date
}

export async function getLiveInterviewReport(params: { organizationId: string; interviewId: string }) {
  const detail = await getLiveInterviewDetail(params)
  const nameOf = new Map(detail.participants.map((p) => [p.participantId, p.displayName]))
  const roleOf = new Map(detail.participants.map((p) => [p.participantId, p.role]))

  const [interviewRow] = await prisma.$queryRaw<Array<{ live_started_at: Date | null; consented: string[] }>>(Prisma.sql`
    select i.live_started_at,
           coalesce(array_agg(p.participant_id::text) filter (where p.recording_consent_at is not null), '{}') as consented
    from public.interviews i
    left join public.interview_participants p on p.interview_id = i.interview_id
    where i.interview_id = ${params.interviewId}::uuid and i.organization_id = ${params.organizationId}::uuid
    group by i.live_started_at
  `)

  const questions = await prisma.$queryRaw<Array<{ interview_question_id: string; question_order: number; question_text: string | null; reference_context: Record<string, unknown> | null }>>(Prisma.sql`
    select interview_question_id::text, question_order, question_text, reference_context
    from public.interview_questions where interview_id = ${params.interviewId}::uuid order by question_order
  `)

  const events = await prisma.$queryRaw<ReportEventRow[]>(Prisma.sql`
    select event_type, participant_id::text, interview_question_id::text, payload, occurred_at
    from public.live_interview_events
    where interview_id = ${params.interviewId}::uuid and organization_id = ${params.organizationId}::uuid
    order by occurred_at, event_id
  `)

  const status = new Map<string, string>()
  const manualQuestions: Array<{ text: string; askedBy: string | null; at: string }> = []
  let copilotSuggestions = 0
  for (const e of events) {
    if (e.interview_question_id && e.event_type === "QUESTION_ASKED" && !status.has(e.interview_question_id)) status.set(e.interview_question_id, "ASKED")
    if (e.interview_question_id && e.event_type === "QUESTION_COVERED") status.set(e.interview_question_id, "COVERED")
    if (e.interview_question_id && e.event_type === "QUESTION_SKIPPED") status.set(e.interview_question_id, "SKIPPED")
    if (e.event_type === "MANUAL_QUESTION" && typeof e.payload?.text === "string") {
      manualQuestions.push({ text: e.payload.text, askedBy: e.participant_id ? nameOf.get(e.participant_id) ?? null : null, at: e.occurred_at.toISOString() })
    }
    if (e.event_type === "COPILOT_SUGGESTION") copilotSuggestions += 1
  }

  const ratings = await prisma.$queryRaw<Array<{ participant_id: string; target_type: string; interview_question_id: string | null; focus_area_key: string | null; rating: number | null; evidence: string | null; submitted_at: Date }>>(Prisma.sql`
    select participant_id::text, target_type, interview_question_id::text, focus_area_key, rating, evidence, submitted_at
    from public.live_evaluator_ratings
    where interview_id = ${params.interviewId}::uuid and organization_id = ${params.organizationId}::uuid
      and submitted_at is not null
  `)
  const interviewers = detail.participants.filter((p) => p.role === "INTERVIEWER")
  const scorecards = interviewers.map((p) => {
    const mine = ratings.filter((r) => r.participant_id === p.participantId)
    return {
      participantId: p.participantId,
      interviewer: p.displayName,
      panelRole: p.panelRole,
      submittedAt: mine[0]?.submitted_at.toISOString() ?? null,
      ratings: mine.map((r) => ({
        targetType: r.target_type,
        questionId: r.interview_question_id,
        focusArea: r.focus_area_key,
        rating: r.rating,
        evidence: r.evidence,
      })),
    }
  })

  const segments = await prisma.$queryRaw<Array<{ participant_id: string; started_at_ms: number | null; ended_at_ms: number | null; text: string }>>(Prisma.sql`
    select participant_id::text, started_at_ms, ended_at_ms, text
    from public.live_transcript_segments
    where interview_id = ${params.interviewId}::uuid and organization_id = ${params.organizationId}::uuid
      and source = 'POST_TRANSCRIPTION'
    order by started_at_ms nulls last, created_at
  `)

  const recordings = await prisma.$queryRaw<Array<{ recording_id: string; kind: string; participant_id: string | null; status: string; transcription_status: string | null; started_at: Date; ended_at: Date | null }>>(Prisma.sql`
    select recording_id::text, kind, participant_id::text, status, transcription_status, started_at, ended_at
    from public.live_recordings
    where interview_id = ${params.interviewId}::uuid and organization_id = ${params.organizationId}::uuid
    order by started_at
  `)

  const consented = new Set(interviewRow?.consented ?? [])
  return {
    interview: detail,
    participants: detail.participants.map((p) => ({ ...p, recordingConsent: consented.has(p.participantId) })),
    questions: questions.map((q) => ({
      questionId: q.interview_question_id,
      order: q.question_order,
      text: q.question_text ?? "",
      focusArea: (q.reference_context?.focus_area_key as string | undefined) ?? (q.reference_context?.anchor as string | undefined) ?? null,
      status: status.get(q.interview_question_id) ?? "NOT_ASKED",
    })),
    manualQuestions,
    copilotSuggestions,
    timeline: events
      .filter((e) => e.event_type !== "COPILOT_SUGGESTION")
      .map((e) => ({
        type: e.event_type,
        participant: e.participant_id ? nameOf.get(e.participant_id) ?? null : null,
        at: e.occurred_at.toISOString(),
      })),
    scorecards,
    transcript: segments.map((s) => ({
      speaker: nameOf.get(s.participant_id) ?? "Participant",
      role: roleOf.get(s.participant_id) ?? null,
      startMs: s.started_at_ms,
      endMs: s.ended_at_ms,
      text: s.text,
    })),
    recordings: recordings.map((r) => ({
      recordingId: r.recording_id,
      kind: r.kind,
      speaker: r.participant_id ? nameOf.get(r.participant_id) ?? null : null,
      status: r.status,
      transcriptionStatus: r.transcription_status,
      startedAt: r.started_at.toISOString(),
      endedAt: r.ended_at?.toISOString() ?? null,
    })),
  }
}

export async function getLiveRecordingPath(params: { organizationId: string; interviewId: string; recordingId: string }) {
  if (!UUID_PATTERN.test(params.recordingId) || !UUID_PATTERN.test(params.interviewId)) {
    throw new ApiError(404, "RECORDING_NOT_FOUND", "Recording not found.")
  }
  const rows = await prisma.$queryRaw<Array<{ storage_path: string | null }>>(Prisma.sql`
    select r.storage_path from public.live_recordings r
    join public.interviews i on i.interview_id = r.interview_id and i.delivery_mode = 'LIVE'
    where r.recording_id = ${params.recordingId}::uuid
      and r.interview_id = ${params.interviewId}::uuid
      and r.organization_id = ${params.organizationId}::uuid
      and r.status = 'COMPLETE'
  `)
  if (!rows[0]?.storage_path) throw new ApiError(404, "RECORDING_NOT_FOUND", "Recording not found.")
  return rows[0].storage_path
}
