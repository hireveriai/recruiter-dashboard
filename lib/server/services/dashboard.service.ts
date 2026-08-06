import { Prisma } from "@prisma/client"

import { prisma } from "@/lib/server/prisma"

import { deriveInterviewStatus } from "@/lib/server/services/interview-status"
import { finalizeStaleInterviewAttempts } from "@/lib/server/services/interview-stale-finalizer"
import {
  buildAnswerFallbackSummary,
  deriveResultFromAnswerSummaries,
  fetchAnswerSummaries,
  InterviewAnswerSummary,
} from "@/lib/server/services/interview-summary"

type CandidatesDashboardOptions = {
  organizationId: string
  limit?: number | "all"
  finalizeStale?: boolean
  includeAnswerSummaries?: boolean
}

type CandidatesDashboardItem = {
  candidateId: string
  interviewId: string | null
  attemptId: string | null
  candidateName: string
  jobTitle: string
  status: string
  score: number | null
  verisScreeningScore: number | null
  aiSummaryShort: string
  aiSummaryFull: string | null
  decision: string | null
  recruiterDecisionStatus: string | null
  recruiterDecisionAt: Date | string | null
  recruiterDecisionNotes: string | null
  accessType: string
  startTime: Date | null
  endTime: Date | null
  expiresAt: Date | null
  startedAt: Date | null
  endedAt: Date | null
  createdAt: Date
  answerSummaries: InterviewAnswerSummary[]
}

type CandidateDashboardRow = {
  candidate_id: string
  candidate_name: string | null
  candidate_status: string | null
  ai_screening_status: string | null
  candidate_created_at: Date
  interview_id: string | null
  interview_status: string | null
  interview_created_at: Date | null
  job_title: string | null
  screening_job_title: string | null
  screening_match_id: string | null
  screening_match_score: number | null
  screening_recommendation: string | null
  screening_created_at: Date | null
  invite_ai_screening_match_id: string | null
  invite_access_type: string | null
  invite_start_time: Date | null
  invite_end_time: Date | null
  invite_expires_at: Date | null
  invite_status: string | null
  invite_created_at: Date | null
  invite_used_at: Date | null
  attempt_id: string | null
  attempt_status: string | null
  attempt_started_at: Date | null
  attempt_ended_at: Date | null
  final_score: unknown | null
  decision: string | null
  ai_summary: string | null
  recruiter_decision_status: string | null
  recruiter_decision_at: Date | string | null
  recruiter_decision_notes: string | null
}

function getShortSummary(text: string | null): string {
  if (!text) {
    return "-"
  }

  const words = text.trim().split(/\s+/).filter(Boolean)
  if (words.length <= 20) {
    return words.join(" ")
  }

  return `${words.slice(0, 20).join(" ")}...`
}

function deriveScreenedCandidateStatus(row: CandidateDashboardRow) {
  const screeningStatus = String(row.ai_screening_status ?? "").trim().toUpperCase()

  if (row.screening_created_at || row.screening_match_score !== null || row.screening_recommendation) {
    return "SCREENED"
  }

  if (screeningStatus === "READY") {
    return "SCREENED"
  }

  if (screeningStatus === "PROCESSING" || screeningStatus === "UPLOADING") {
    return screeningStatus
  }

  if (screeningStatus === "FAILED") {
    return "SCREENING_FAILED"
  }

  const candidateStatus = String(row.candidate_status ?? "").trim().toUpperCase()

  if (!candidateStatus || candidateStatus === "INVITED") {
    return "PENDING"
  }

  return candidateStatus
}

function deriveCandidateInterviewStatus(row: CandidateDashboardRow) {
  const latestAttempt = row.attempt_id
    ? {
        attemptId: row.attempt_id,
        status: row.attempt_status,
        endedAt: row.attempt_ended_at,
      }
    : null
  const latestInvite = row.invite_created_at || row.invite_status
    ? {
        status: row.invite_status,
        expiresAt: row.invite_expires_at,
        usedAt: row.invite_used_at,
      }
    : null
  const status = deriveInterviewStatus({
    interviewStatus: row.interview_status,
    latestAttempt,
    latestInvite,
  })

  return status === "READY" ? "INVITED" : status
}

function hasInterviewEvaluation(row: CandidateDashboardRow, answerSummaries: InterviewAnswerSummary[]) {
  const attemptStatus = String(row.attempt_status ?? "").toUpperCase()
  const interviewStatus = String(row.interview_status ?? "").toUpperCase()
  const isTerminalInterview =
    Boolean(row.attempt_ended_at) ||
    ["COMPLETED", "SUBMITTED", "EVALUATED"].includes(attemptStatus) ||
    ["COMPLETED", "SUBMITTED", "EVALUATED"].includes(interviewStatus)

  if (!isTerminalInterview) {
    return false
  }

  return (
    row.final_score !== null ||
    row.decision !== null ||
    answerSummaries.length > 0
  )
}

function hasVerisScreening(row: CandidateDashboardRow, hasInterview: boolean) {
  if (hasInterview) {
    return Boolean(
      row.screening_match_id &&
        row.invite_ai_screening_match_id &&
        row.screening_match_id === row.invite_ai_screening_match_id
    )
  }

  return Boolean(row.screening_match_id)
}

export async function getCandidatesDashboard(
  options: CandidatesDashboardOptions
): Promise<CandidatesDashboardItem[]> {
  if (options.finalizeStale !== false) {
    await finalizeStaleInterviewAttempts(options.organizationId)
  }
  const take = options.limit === "all" || options.limit === undefined ? undefined : options.limit

  const rows = await prisma.$queryRaw<CandidateDashboardRow[]>(Prisma.sql`
    select
      c.candidate_id::text as candidate_id,
      c.full_name as candidate_name,
      to_jsonb(c)->>'status' as candidate_status,
      to_jsonb(c)->>'ai_screening_status' as ai_screening_status,
      c.created_at as candidate_created_at,
      i.interview_id::text as interview_id,
      i.status as interview_status,
      i.created_at as interview_created_at,
      jp.job_title,
      sj.title as screening_job_title,
      sm.id::text as screening_match_id,
      sm.match_score as screening_match_score,
      sm.recommendation as screening_recommendation,
      sm.created_at as screening_created_at,
      inv.access_type as invite_access_type,
      inv.start_time as invite_start_time,
      inv.end_time as invite_end_time,
      inv.expires_at as invite_expires_at,
      inv.status as invite_status,
      inv.created_at as invite_created_at,
      inv.used_at as invite_used_at,
      to_jsonb(inv)->>'ai_screening_match_id' as invite_ai_screening_match_id,
      att.attempt_id::text as attempt_id,
      att.status as attempt_status,
      att.started_at as attempt_started_at,
      att.ended_at as attempt_ended_at,
      ev.final_score,
      ev.decision,
      ev.ai_summary,
      rd.status as recruiter_decision_status,
      rd.decided_at as recruiter_decision_at,
      rd.notes as recruiter_decision_notes
    from public.candidates c
    left join lateral (
      select *
      from public.interviews i
      where i.candidate_id = c.candidate_id
        and i.organization_id = c.organization_id
      order by i.created_at desc
      limit 1
    ) i on true
    left join public.job_positions jp
      on jp.job_id = i.job_id
    left join lateral (
      select sm.*
      from public.candidate_job_matches sm
      inner join public.jobs match_job
        on match_job.id = sm.job_id
      where sm.candidate_id = c.candidate_id
        and sm.organization_id = c.organization_id
        and (
          i.interview_id is null
          or match_job.source_job_position_id = i.job_id
        )
      order by sm.created_at desc
      limit 1
    ) sm on true
    left join public.jobs sj
      on sj.id = sm.job_id
    left join lateral (
      select *
      from public.interview_invites inv
      where inv.interview_id = i.interview_id
      order by inv.created_at desc
      limit 1
    ) inv on true
    left join lateral (
      select *
      from public.interview_attempts att
      where att.interview_id = i.interview_id
      order by att.started_at desc
      limit 1
    ) att on true
    left join public.interview_evaluations ev
      on ev.attempt_id = att.attempt_id
    left join public.candidate_recruiter_decisions rd
      on rd.organization_id = c.organization_id
      and rd.candidate_id = c.candidate_id
      and (
        rd.interview_id = i.interview_id
        or (rd.interview_id is null and i.interview_id is null)
      )
    where c.organization_id = ${options.organizationId}::uuid
    order by coalesce(i.created_at, sm.created_at, c.created_at) desc
    ${take ? Prisma.sql`limit ${take}` : Prisma.empty}
  `)

  const attemptIds = rows
    .map((row) => row.attempt_id)
    .filter((attemptId): attemptId is string => Boolean(attemptId))
  const answerSummaryMap = options.includeAnswerSummaries === false
    ? new Map<string, InterviewAnswerSummary[]>()
    : await fetchAnswerSummaries(attemptIds)

  return rows.map((row): CandidatesDashboardItem => {
    const hasInterview = Boolean(row.interview_id)
    const answerSummaries = row.attempt_id ? answerSummaryMap.get(row.attempt_id) ?? [] : []
    const calculatedResult = deriveResultFromAnswerSummaries(answerSummaries)
    const hasEvaluation = hasInterviewEvaluation(row, answerSummaries)
    const hasScreening = hasVerisScreening(row, hasInterview)
    const finalScore =
      !hasEvaluation
        ? null
        : row.final_score === null || row.final_score === undefined
          ? calculatedResult.score
        : Number(row.final_score)
    // Only fall back to a recomputed summary/score when there is no
    // authoritative final_score for this interview — otherwise a recruiter
    // sees two different percentages for the same candidate (the real score
    // above, and this fallback's own independently-weighted recompute).
    const hasAuthoritativeScore = row.final_score !== null && row.final_score !== undefined
    const generatedRecruiterBrief = hasAuthoritativeScore
      ? null
      : buildAnswerFallbackSummary(answerSummaries)
    const aiSummaryFull = hasEvaluation
      ? [row.ai_summary, generatedRecruiterBrief].filter(Boolean).join("\n\n") || null
      : null

    return {
      candidateId: row.candidate_id,
      interviewId: row.interview_id,
      attemptId: row.attempt_id,
      candidateName: row.candidate_name || "Candidate",
      jobTitle: row.job_title ?? row.screening_job_title ?? "-",
      status: hasInterview ? deriveCandidateInterviewStatus(row) : deriveScreenedCandidateStatus(row),
      score: finalScore === null ? null : Number.isFinite(finalScore) ? finalScore : calculatedResult.score,
      verisScreeningScore: hasScreening ? row.screening_match_score : null,
      aiSummaryShort: getShortSummary(aiSummaryFull),
      aiSummaryFull,
      decision: hasEvaluation ? row.decision ?? calculatedResult.decision : null,
      recruiterDecisionStatus: row.recruiter_decision_status,
      recruiterDecisionAt: row.recruiter_decision_at,
      recruiterDecisionNotes: row.recruiter_decision_notes,
      accessType: row.invite_access_type ?? "FLEXIBLE",
      startTime: row.invite_start_time ?? null,
      endTime: row.invite_end_time ?? null,
      expiresAt: row.invite_expires_at ?? null,
      startedAt: row.attempt_started_at ?? null,
      endedAt: row.attempt_ended_at ?? null,
      createdAt: row.interview_created_at ?? row.candidate_created_at,
      answerSummaries,
    }
  })
}
