import { Prisma } from "@prisma/client"

import { prisma } from "@/lib/server/prisma"

type FastCandidateRow = {
  candidate_id: string
  interview_id: string | null
  attempt_id: string | null
  candidate_name: string | null
  job_title: string | null
  status: string | null
  score: unknown | null
  fallback_score: unknown | null
  veris_screening_score: unknown | null
  ai_summary: string | null
  decision: string | null
  recruiter_decision_status: string | null
  recruiter_decision_at: Date | string | null
  recruiter_decision_notes: string | null
  access_type: string | null
  start_time: Date | null
  end_time: Date | null
  expires_at: Date | null
  started_at: Date | null
  ended_at: Date | null
  created_at: Date
}

type FastVerisRow = {
  candidate_name: string | null
  job_title: string | null
  interview_id: string
  attempt_id: string
  attempt_status: string | null
  started_at: string | null
  ended_at: string | null
  final_score: unknown | null
  decision: string | null
  ai_summary: string | null
}

function toNumberOrNull(value: unknown) {
  if (value === null || value === undefined) {
    return null
  }

  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function shortText(value: string | null, maxWords = 20) {
  if (!value) {
    return "-"
  }

  const words = value.trim().split(/\s+/).filter(Boolean)
  return words.length <= maxWords ? words.join(" ") : `${words.slice(0, maxWords).join(" ")}...`
}

function normalizeStatus(status: string | null) {
  return String(status ?? "PENDING").trim().toUpperCase() || "PENDING"
}

function normalizeRecommendation(value: string | null, score: number | null) {
  const normalized = String(value ?? "").trim().toUpperCase()

  if (normalized === "HIRE" || normalized === "STRONG_HIRE" || normalized === "STRONG HIRE") {
    return "HIRE"
  }

  if (normalized === "REVIEW" || normalized === "HOLD" || normalized === "REVIEW_REQUIRED") {
    return "REVIEW REQUIRED"
  }

  if (normalized === "FLAGGED") {
    return "FLAGGED"
  }

  if (normalized === "REJECT" || normalized === "NO_HIRE") {
    return "REJECT"
  }

  if (score === null) {
    return "REVIEW REQUIRED"
  }

  if (score >= 75) {
    return "HIRE"
  }

  if (score >= 60) {
    return "REVIEW REQUIRED"
  }

  return "REJECT"
}

function deriveRiskLevel(row: FastVerisRow, score: number | null) {
  const normalizedDecision = String(row.decision ?? "").toUpperCase()

  if (normalizedDecision === "FLAGGED") {
    return "HIGH"
  }

  if (score !== null && score < 60) {
    return "MEDIUM"
  }

  return "LOW"
}

export async function getFastDashboardCandidates(organizationId: string, limit: number | "all" = 5) {
  const safeLimit = limit === "all" ? null : Math.max(1, Math.min(Math.trunc(limit) || 5, 20))
  const rows = await prisma.$queryRaw<FastCandidateRow[]>(Prisma.sql`
    select
      c.candidate_id::text as candidate_id,
      i.interview_id::text as interview_id,
      la.attempt_id::text as attempt_id,
      c.full_name as candidate_name,
      coalesce(jp.job_title, sj.title, '-') as job_title,
      case
        when i.interview_id is null and sm.id is not null then 'SCREENED'
        when upper(coalesce(i.status, la.status, '')) in ('COMPLETED', 'SUBMITTED', 'EVALUATED') or la.ended_at is not null then 'COMPLETED'
        when la.attempt_id is not null and la.ended_at is null then 'IN_PROGRESS'
        when li.invite_id is not null and li.used_at is null and li.expires_at is not null and li.expires_at <= now() then 'EXPIRED'
        when li.invite_id is not null then 'INVITED'
        else coalesce(nullif(upper(c.status), ''), 'PENDING')
      end as status,
      coalesce(
        iev.final_score,
        case
          when upper(coalesce(i.status, la.status, '')) not in ('COMPLETED', 'SUBMITTED', 'EVALUATED')
            and la.ended_at is null then null
          when la.termination_metadata->>'final_score' ~ '^[0-9]+(\\.[0-9]+)?$'
            then (la.termination_metadata->>'final_score')::numeric
          else null
        end,
        case
          when upper(coalesce(i.status, la.status, '')) in ('COMPLETED', 'SUBMITTED', 'EVALUATED')
            or la.ended_at is not null then score_summary.fallback_score
          else null
        end
      ) as score,
      score_summary.fallback_score,
      sm.match_score as veris_screening_score,
      iev.ai_summary,
      iev.decision,
      rd.status as recruiter_decision_status,
      rd.decided_at as recruiter_decision_at,
      rd.notes as recruiter_decision_notes,
      li.access_type,
      li.start_time,
      li.end_time,
      li.expires_at,
      la.started_at,
      la.ended_at,
      coalesce(i.created_at, sm.created_at, c.created_at) as created_at
    from public.candidates c
    left join lateral (
      select *
      from public.interviews i
      where i.candidate_id = c.candidate_id
        and i.organization_id = c.organization_id
      order by i.created_at desc
      limit 1
    ) i on true
    left join public.job_positions jp on jp.job_id = i.job_id
    left join lateral (
      select ia.*
      from public.interview_attempts ia
      where ia.interview_id = i.interview_id
      order by ia.started_at desc nulls last
      limit 1
    ) la on true
    left join public.interview_evaluations iev on iev.attempt_id = la.attempt_id
    left join lateral (
      select
        case
          when count(*) filter (
            where ans.answer_text is not null
              and nullif(trim(ans.answer_text), '') is not null
              and lower(trim(ans.answer_text)) <> 'no response provided.'
          ) = 0 then null::numeric
          when count(iae.answer_id) filter (where iae.evaluator_type = 'AI') > 0 then
            round(avg(
              coalesce(iae.skill_score, 0) * 40
              + coalesce(iae.clarity_score, 0) * 20
              + coalesce(iae.depth_score, 0) * 20
              + coalesce(iae.confidence_score, 0) * 15
              + greatest(0, 1 - coalesce(iae.fraud_score, 0)) * 5
            ))
          else null::numeric
        end as fallback_score
      from public.interview_answers ans
      left join public.interview_answer_evaluations iae
        on iae.answer_id = ans.answer_id
       and iae.evaluator_type = 'AI'
      where ans.attempt_id = la.attempt_id
    ) score_summary on true
    left join lateral (
      select inv.*
      from public.interview_invites inv
      where inv.interview_id = i.interview_id
      order by inv.created_at desc
      limit 1
    ) li on true
    left join lateral (
      select sm.*
      from public.candidate_job_matches sm
      where sm.candidate_id = c.candidate_id
        and sm.organization_id = c.organization_id
      order by sm.created_at desc
      limit 1
    ) sm on true
    left join public.jobs sj on sj.id = sm.job_id
    left join public.candidate_recruiter_decisions rd
      on rd.organization_id = c.organization_id
      and rd.candidate_id = c.candidate_id
      and (rd.interview_id = i.interview_id or (rd.interview_id is null and i.interview_id is null))
    where c.organization_id = ${organizationId}::uuid
    order by coalesce(i.created_at, sm.created_at, c.created_at) desc
    ${safeLimit ? Prisma.sql`limit ${safeLimit}` : Prisma.empty}
  `).catch(() => [] as FastCandidateRow[])

  return rows
    .map((row) => {
      const status = normalizeStatus(row.status)
      const interviewCompleted = Boolean(row.ended_at || ["COMPLETED", "SUBMITTED", "EVALUATED"].includes(status))

      return {
        candidateId: row.candidate_id,
        interviewId: row.interview_id,
        attemptId: row.attempt_id,
        candidateName: row.candidate_name || "Candidate",
        jobTitle: row.job_title || "-",
        status,
        score: toNumberOrNull(row.score ?? row.fallback_score),
        verisScreeningScore: toNumberOrNull(row.veris_screening_score),
        aiSummaryShort: interviewCompleted ? shortText(row.ai_summary) : "-",
        aiSummaryFull: interviewCompleted ? row.ai_summary : null,
        decision: interviewCompleted ? row.decision : null,
        recruiterDecisionStatus: row.recruiter_decision_status,
        recruiterDecisionAt: row.recruiter_decision_at,
        recruiterDecisionNotes: row.recruiter_decision_notes,
        accessType: row.access_type ?? "FLEXIBLE",
        startTime: row.start_time,
        endTime: row.end_time,
        expiresAt: row.expires_at,
        startedAt: row.started_at,
        endedAt: row.ended_at,
        createdAt: row.created_at,
        answerSummaries: [],
      }
    })
    .filter((candidate) => normalizeStatus(candidate.status) !== "EXPIRED")
}

export async function getFastVerisSummaryCards(organizationId: string, limit = 4) {
  const safeLimit = Math.max(1, Math.min(Math.trunc(limit) || 4, 20))
  const rows = await prisma.$queryRaw<FastVerisRow[]>(Prisma.sql`
    select
      c.full_name as candidate_name,
      jp.job_title,
      i.interview_id::text,
      ia.attempt_id::text,
      ia.status as attempt_status,
      ia.started_at::text as started_at,
      ia.ended_at::text as ended_at,
      iev.final_score,
      iev.decision,
      iev.ai_summary
    from public.interview_attempts ia
    inner join public.interviews i on i.interview_id = ia.interview_id
    inner join public.candidates c on c.candidate_id = i.candidate_id
    inner join public.job_positions jp on jp.job_id = i.job_id
    left join public.interview_evaluations iev on iev.attempt_id = ia.attempt_id
    where i.organization_id = ${organizationId}::uuid
      and (
        upper(coalesce(i.status, ia.status, '')) in ('COMPLETED', 'SUBMITTED', 'EVALUATED')
        or ia.ended_at is not null
      )
    order by coalesce(ia.ended_at, ia.started_at, i.created_at) desc nulls last
    limit ${safeLimit}
  `).catch(() => [] as FastVerisRow[])

  return rows.map((row) => {
    const score = toNumberOrNull(row.final_score)
    const recommendation = normalizeRecommendation(row.decision, score)
    const riskLevel = deriveRiskLevel(row, score)
    const summary = row.ai_summary?.trim() || null

    return {
      candidateName: row.candidate_name || "Candidate",
      jobTitle: row.job_title || "-",
      interviewId: row.interview_id,
      attemptId: row.attempt_id,
      attemptStatus: row.attempt_status,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      riskLevel,
      recommendation,
      recommendationReason: summary ? shortText(summary, 28) : "Review evidence and pipeline signals before final decision.",
      scoreLabel: score === null ? "-" : `${Math.round(score)}%`,
      strengthsShort: summary ? shortText(summary, 14) : "Evaluation evidence captured.",
      weaknessesShort: riskLevel === "LOW" ? "No major risk signals detected." : "Review behavioral risk signals.",
      behavioralFlagsShort: riskLevel === "LOW" ? "None" : "Behavioral signals require review.",
    }
  })
}

export async function getFastDashboardSnapshot(organizationId: string) {
  // Keep first paint to one bounded query. Recording/transcript aggregation
  // and Veris cards are filled by the silent full refresh after the dashboard
  // shell is already interactive.
  const candidates = await getFastDashboardCandidates(organizationId, 5)

  return {
    candidates,
    recordedInterviews: [],
    veris: [],
  }
}
