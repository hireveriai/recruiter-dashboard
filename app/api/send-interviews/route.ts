import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"

import { getRecruiterRequestContext } from "@/lib/server/auth-context"
import { ApiError } from "@/lib/server/errors"
import { errorResponse } from "@/lib/server/response"
import { prisma } from "@/lib/server/prisma"
import {
  getLatestInterviewInviteForEmail,
  recordInterviewInviteTracking,
} from "@/lib/server/services/interview.service"
import {
  createPreparingInterview,
  prepareInterviewQuestionsWithRetry,
  sendInterviewEmailForInterview,
} from "@/lib/server/services/interview-workflow"
import {
  getMatchesForInviteSelection,
  getScreeningJob,
  normalizeEmail,
  recordInterviewInviteForScreening,
} from "@/lib/server/ai-screening/service"
import { assertTrialCreditsAvailable, deductTrialCredits, getOrCreateTrialCredits } from "@/lib/server/services/trial-credits"

export const runtime = "nodejs"
export const maxDuration = 300

const LINK_CREATION_BATCH_SIZE = 2
const PREPARATION_BATCH_SIZE = 12
type MatchScope = "BATCH" | "GLOBAL"
type InterviewAccessType = "FLEXIBLE" | "SCHEDULED"
type CandidateInterviewSchedule = {
  candidateId: string
  accessType: InterviewAccessType
  startTime: string | null
  endTime: string | null
}

type QueuedScreeningInvite = {
  interviewId: string
  candidateId: string
  candidateName: string
  email: string
  inviteLink: string
  matchId: string | null
  screeningJobId: string
  organizationId: string
  jobId: string
  companyName: string
  roleTitle: string
  duration: number | null
  expiryDate: string | null
}

type OrganizationEmailBrandRow = {
  organization_name: string | null
}

type InterviewJobEmailRow = {
  job_title: string | null
  interview_duration_minutes: number | null
}

function resolveMatchScope(value: unknown, includeAllCandidates: boolean): MatchScope {
  const normalized = typeof value === "string" ? value.trim().toUpperCase() : ""

  if (normalized === "GLOBAL") {
    return "GLOBAL"
  }

  if (normalized === "BATCH") {
    return "BATCH"
  }

  return includeAllCandidates ? "GLOBAL" : "BATCH"
}

function resolveAccessType(value: unknown): InterviewAccessType {
  const normalized = typeof value === "string" ? value.trim().toUpperCase() : ""

  if (normalized === "SCHEDULED") {
    return "SCHEDULED"
  }

  return "FLEXIBLE"
}

function normalizeScheduleTime(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    return null
  }

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return null
  }

  return date.toISOString()
}

function normalizeCandidateIds(values: string[] | undefined) {
  return [...new Set((values ?? []).map((value) => String(value ?? "").trim()).filter(Boolean))]
}

function parseCandidateSchedules(value: unknown): CandidateInterviewSchedule[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.map((item) => {
    const record = item && typeof item === "object" ? item as Record<string, unknown> : {}
    const candidateId = String(record.candidateId ?? record.candidate_id ?? "").trim()
    const accessType = resolveAccessType(record.accessType ?? record.access_type)
    const startTime = normalizeScheduleTime(record.startTime ?? record.start_time)
    const endTime = normalizeScheduleTime(record.endTime ?? record.end_time)

    if (!candidateId) {
      throw new ApiError(400, "INVALID_CANDIDATE_SCHEDULE", "Candidate schedule is missing a candidate.")
    }

    if (accessType === "SCHEDULED") {
      if (!startTime || !endTime) {
        throw new ApiError(400, "INVALID_CANDIDATE_SCHEDULE", "Start time and end time are required for scheduled interviews.")
      }

      if (new Date(endTime) <= new Date(startTime)) {
        throw new ApiError(400, "INVALID_CANDIDATE_SCHEDULE", "End time must be after start time for every scheduled candidate.")
      }
    }

    return {
      candidateId,
      accessType,
      startTime: accessType === "SCHEDULED" ? startTime : null,
      endTime: accessType === "SCHEDULED" ? endTime : null,
    }
  })
}

async function processInBatches<T, R>(items: T[], batchSize: number, worker: (item: T) => Promise<R>) {
  const results: R[] = []

  for (let index = 0; index < items.length; index += batchSize) {
    const batch = items.slice(index, index + batchSize)
    const batchResults = await Promise.all(batch.map(worker))
    results.push(...batchResults)
  }

  return results
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message
  }

  return "Unknown error"
}

async function prepareAndSendQueuedScreeningInvite(input: QueuedScreeningInvite) {
  console.log("VERIS bulk interview preparation started", {
    interviewId: input.interviewId,
    candidateId: input.candidateId,
  })

  try {
    await prepareInterviewQuestionsWithRetry({
      organizationId: input.organizationId,
      interviewId: input.interviewId,
      totalQuestions: 10,
      interviewDurationMinutes: input.duration ?? undefined,
      maxAttempts: 1,
      generationTimeoutMs: 30000,
    })
    console.log("VERIS bulk interview questions ready", {
      interviewId: input.interviewId,
      candidateId: input.candidateId,
    })

    const emailResult = await sendInterviewEmailForInterview(input.organizationId, input.interviewId)
    if (!emailResult.emailSent) {
      throw new Error(emailResult.emailError || "Interview email could not be sent")
    }
    console.log("VERIS bulk interview email sent", {
      interviewId: input.interviewId,
      candidateId: input.candidateId,
    })

    await recordInterviewInviteForScreening({
      interviewId: input.interviewId,
      candidateId: input.candidateId,
      screeningJobId: input.screeningJobId,
      email: input.email,
      inviteLink: input.inviteLink,
      matchId: input.matchId,
      emailStatus: "SENT",
    })
    await recordInterviewInviteTracking({
      interviewId: input.interviewId,
      companyId: input.organizationId,
      jobId: input.jobId,
      candidateEmail: input.email,
    })

    return {
      interviewId: input.interviewId,
      candidateId: input.candidateId,
      candidateName: input.candidateName,
      email: input.email,
      status: "SENT" as const,
      error: null,
      inviteLink: input.inviteLink,
    }
  } catch (error) {
    const errorMessage = getErrorMessage(error)
    console.error("Queued VERIS interview preparation failed", {
      interviewId: input.interviewId,
      candidateId: input.candidateId,
      error: errorMessage,
    })

    await recordInterviewInviteForScreening({
      interviewId: input.interviewId,
      candidateId: input.candidateId,
      screeningJobId: input.screeningJobId,
      email: input.email,
      inviteLink: input.inviteLink,
      matchId: input.matchId,
      emailStatus: "FAILED",
    }).catch((recordError) => {
      console.warn("Failed to record queued VERIS invite failure", {
        interviewId: input.interviewId,
        error: getErrorMessage(recordError),
      })
    })

    return {
      interviewId: input.interviewId,
      candidateId: input.candidateId,
      candidateName: input.candidateName,
      email: input.email,
      status: "FAILED" as const,
      error: errorMessage,
      inviteLink: input.inviteLink,
    }
  }
}

async function getOrganizationEmailBrand(organizationId: string) {
  const rows = await prisma.$queryRaw<OrganizationEmailBrandRow[]>(Prisma.sql`
    select organization_name
    from public.organizations
    where organization_id = ${organizationId}::uuid
    limit 1
  `)

  return rows[0]?.organization_name ?? "Hiring Team"
}

async function getInterviewJobEmailContext(organizationId: string, jobId: string) {
  const rows = await prisma.$queryRaw<InterviewJobEmailRow[]>(Prisma.sql`
    select job_title, interview_duration_minutes
    from public.job_positions
    where organization_id = ${organizationId}::uuid
      and job_id = ${jobId}::uuid
    limit 1
  `)

  return rows[0] ?? null
}

export async function POST(request: Request) {
  try {
    const auth = await getRecruiterRequestContext(request)
    const body = (await request.json()) as {
      job_id?: string
      jobId?: string
      mode?: "STRONG_FIT" | "TOP_N" | "SELECTED"
      selection?: "STRONG_FIT" | "TOP_N" | "SELECTED"
      topN?: number
      top_n?: number
      candidateIds?: string[]
      candidate_ids?: string[]
      candidates?: Array<{
        candidateId?: string
        candidate_id?: string
        accessType?: string
        access_type?: string
        startTime?: string | null
        start_time?: string | null
        endTime?: string | null
        end_time?: string | null
      }>
      batchId?: string
      batch_id?: string
      matchScope?: string
      match_scope?: string
      runId?: string
      run_id?: string
      includeAllCandidates?: boolean
      include_all_candidates?: boolean
      confirmDuplicateInvites?: boolean
      confirm_duplicate_invites?: boolean
    }
    const screeningJobId = String(body.job_id ?? body.jobId ?? "").trim()
    const mode = body.mode ?? body.selection ?? "STRONG_FIT"
    const topN = Number(body.topN ?? body.top_n ?? 10)
    const batchId = String(body.batchId ?? body.batch_id ?? "").trim()
    const legacyIncludeAllCandidates = body.includeAllCandidates === true || body.include_all_candidates === true
    const matchScope = resolveMatchScope(body.matchScope ?? body.match_scope, legacyIncludeAllCandidates)
    const includeAllCandidates = matchScope === "GLOBAL"
    const runId = String(body.runId ?? body.run_id ?? "").trim()
    const confirmDuplicateInvites = body.confirmDuplicateInvites === true || body.confirm_duplicate_invites === true
    const candidateSchedules = parseCandidateSchedules(body.candidates)
    const candidateIds = Array.isArray(body.candidateIds)
      ? body.candidateIds
      : Array.isArray(body.candidate_ids)
        ? body.candidate_ids
        : candidateSchedules.length > 0
          ? candidateSchedules.map((schedule) => schedule.candidateId)
          : undefined
    const explicitCandidateIds = normalizeCandidateIds(candidateIds)
    const scheduleByCandidateId = new Map(candidateSchedules.map((schedule) => [schedule.candidateId, schedule]))

    if (!screeningJobId) {
      throw new ApiError(400, "JOB_NOT_SELECTED", "Job not selected")
    }

    if (mode !== "STRONG_FIT" && mode !== "TOP_N" && mode !== "SELECTED") {
      throw new ApiError(400, "INVALID_SELECTION_MODE", "Invalid interview selection mode")
    }

    if (mode === "SELECTED" && explicitCandidateIds.length === 0) {
      throw new ApiError(
        400,
        "SELECTED_CANDIDATES_REQUIRED",
        "Selected interview send requires explicit candidate IDs. No interview links were sent."
      )
    }

    if (!includeAllCandidates && !batchId && mode !== "SELECTED") {
      throw new ApiError(400, "UPLOAD_BATCH_REQUIRED", "Current upload is required. Use Search All Candidates to send from the full database.")
    }

    const job = await getScreeningJob(auth.organizationId, screeningJobId)

    if (!job) {
      throw new ApiError(400, "JD_NOT_PROCESSED", "Process JD first")
    }

    const interviewJobId = job.sourceJobPositionId || job.id
    const [companyName, interviewJob] = await Promise.all([
      getOrganizationEmailBrand(auth.organizationId),
      getInterviewJobEmailContext(auth.organizationId, interviewJobId),
    ])
    const emailRoleTitle = interviewJob?.job_title || job.roleTitle || job.title
    const emailDuration = interviewJob?.interview_duration_minutes ?? null
    const selected = await getMatchesForInviteSelection({
      organizationId: auth.organizationId,
      jobId: screeningJobId,
      mode,
      topN: Number.isFinite(topN) ? topN : 10,
      candidateIds: explicitCandidateIds,
      uploadBatchId: batchId || null,
      includeAllCandidates: mode === "SELECTED" ? false : includeAllCandidates,
      runId: runId || null,
    })

    if (selected.length === 0) {
      throw new ApiError(400, "NO_MATCHES_SELECTED", "No matched candidates were selected")
    }

    if (mode === "SELECTED") {
      const requestedCandidateIds = new Set(explicitCandidateIds)
      const unexpectedCandidates = selected.filter((match) => !requestedCandidateIds.has(match.candidate_id))

      if (unexpectedCandidates.length > 0 || selected.length > requestedCandidateIds.size) {
        console.error("VERIS selected interview send returned candidates outside the requested selection", {
          organizationId: auth.organizationId,
          screeningJobId,
          requestedCount: requestedCandidateIds.size,
          selectedCount: selected.length,
          unexpectedCandidateIds: unexpectedCandidates.map((match) => match.candidate_id),
        })
        throw new ApiError(
          409,
          "SELECTION_SCOPE_MISMATCH",
          "Selected candidate scope changed unexpectedly. No interview links were sent. Please refresh VERIS Screening and try again."
        )
      }
    }

    const selectedWithEmailCount = selected.filter((match) => normalizeEmail(match.email)).length
    if (selectedWithEmailCount > 0) {
      await assertTrialCreditsAvailable({
        organizationId: auth.organizationId,
        kind: "INTERVIEW",
        amount: selectedWithEmailCount,
      })
    }

    if (!confirmDuplicateInvites) {
      const duplicateWarnings = (
        await Promise.all(
          selected.map(async (match) => {
            const email = normalizeEmail(match.email)

            if (!email) {
              return null
            }

            const latest = await getLatestInterviewInviteForEmail({
              companyId: auth.organizationId,
              candidateEmail: email,
            })

            return latest
              ? {
                  candidateId: match.candidate_id,
                  candidateName: match.candidate_name,
                  email,
                  lastSentAt: latest.lastSentAt,
                }
              : null
          })
        )
      ).filter((warning): warning is NonNullable<typeof warning> => Boolean(warning))

      if (duplicateWarnings.length > 0) {
        return NextResponse.json(
          {
            success: false,
            warning: true,
            duplicates: duplicateWarnings,
            lastSentAt: duplicateWarnings[0]?.lastSentAt ?? null,
            message: "Duplicate interview invite detected for this company",
          },
          { status: 409 }
        )
      }
    }

    const queuedInvites: QueuedScreeningInvite[] = []
    const linkResults = await processInBatches(selected, LINK_CREATION_BATCH_SIZE, async (match) => {
      const email = normalizeEmail(match.email)

      if (!email) {
        return {
          interviewId: null,
          candidateId: match.candidate_id,
          candidateName: match.candidate_name,
          email: match.email,
          status: "SKIPPED",
          error: "Candidate email is missing or invalid",
          inviteLink: null,
        }
      }

      try {
        const link = await createPreparingInterview({
          organizationId: auth.organizationId,
          jobId: interviewJobId,
          candidateId: match.candidate_id,
          accessType: scheduleByCandidateId.get(match.candidate_id)?.accessType ?? "FLEXIBLE",
          startTime: scheduleByCandidateId.get(match.candidate_id)?.startTime ?? undefined,
          endTime: scheduleByCandidateId.get(match.candidate_id)?.endTime ?? undefined,
          createdBy: auth.userId,
        })
        queuedInvites.push({
          interviewId: link.interviewId,
          candidateId: match.candidate_id,
          candidateName: match.candidate_name,
          email,
          inviteLink: link.link,
          matchId: match.match_id ?? null,
          screeningJobId,
          organizationId: auth.organizationId,
          jobId: interviewJobId,
          companyName,
          roleTitle: emailRoleTitle,
          duration: emailDuration,
          expiryDate: scheduleByCandidateId.get(match.candidate_id)?.endTime ?? null,
        })

        return {
          interviewId: link.interviewId,
          candidateId: match.candidate_id,
          candidateName: match.candidate_name,
          email,
          status: "QUEUED",
          error: null,
          inviteLink: link.link,
        }
      } catch (error) {
        return {
          interviewId: null,
          candidateId: match.candidate_id,
          candidateName: match.candidate_name,
          email,
          status: "FAILED",
          error: getErrorMessage(error),
          inviteLink: null,
        }
      }
    })

    const deliveryResults = queuedInvites.length > 0
      ? await processInBatches(queuedInvites, PREPARATION_BATCH_SIZE, prepareAndSendQueuedScreeningInvite)
      : []
    const deliveryResultByInterviewId = new Map(
      deliveryResults.map((result) => [result.interviewId, result])
    )
    const results = linkResults.map((result) => {
      if (result.status !== "QUEUED" || !result.interviewId) {
        return result
      }

      return deliveryResultByInterviewId.get(result.interviewId) ?? {
        ...result,
        status: "FAILED" as const,
        error: "Interview preparation did not return a final result",
      }
    })
    console.log("VERIS bulk interview pipeline completed", {
      requestedCount: selected.length,
      sentCount: results.filter((result) => result.status === "SENT").length,
      failedCount: results.filter((result) => result.status === "FAILED").length,
      skippedCount: results.filter((result) => result.status === "SKIPPED").length,
    })

    const chargeableLinkCount = results.filter((result) => result.inviteLink).length
    const trialCredits = chargeableLinkCount > 0
      ? await deductTrialCredits({
          organizationId: auth.organizationId,
          kind: "INTERVIEW",
          amount: chargeableLinkCount,
          source: "interview_batch",
          sourceIds: results
            .filter((result) => result.inviteLink && result.interviewId)
            .map((result) => result.interviewId as string),
        })
      : await getOrCreateTrialCredits(auth.organizationId)

    return NextResponse.json({
      success: true,
      data: {
        requestedCount: selected.length,
        sentCount: results.filter((result) => result.status === "SENT").length,
        queuedCount: results.filter((result) => result.status === "QUEUED").length,
        skippedCount: results.filter((result) => result.status === "SKIPPED").length,
        failedCount: results.filter((result) => result.status === "FAILED").length,
        matchScope,
        results,
        trialCredits,
      },
    })
  } catch (error) {
    return errorResponse(error)
  }
}
