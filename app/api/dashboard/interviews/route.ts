import { NextResponse } from "next/server"

import { Prisma } from "@prisma/client"
import { getRecruiterRequestContext, type RecruiterRequestContext } from "@/lib/server/auth-context"
import { evaluateCandidateResponse } from "@/lib/server/ai/interview-flow"
import { errorResponse } from "@/lib/server/response"
import { prisma } from "@/lib/server/prisma"
import { getInterviewAppUrl } from "@/lib/server/interview-url"
import { deriveInterviewStatus } from "@/lib/server/services/interview-status"
import { finalizeStaleInterviewAttempts } from "@/lib/server/services/interview-stale-finalizer"
import { getRecruiterDecisionsForInterviews } from "@/lib/server/services/recruiter-decisions"
import {
  extractCandidateAnswersFromTranscript,
  fillMissingAnswersFromTranscript,
} from "@/lib/server/services/transcript-fallback"

type InterviewAnswerSummaryRow = {
  attempt_id: string
  answer_id: string
  answer_text: string | null
  code_text: string | null
  language: string | null
  answer_payload: unknown | null
  answered_at: Date | null
  question_text: string | null
  question_order: number | null
  question_type: string | null
  question_source: string | null
  skill: string | null
  ai_score: unknown | null
  ai_feedback: string | null
  skill_score: unknown | null
  clarity_score: unknown | null
  depth_score: unknown | null
  confidence_score: unknown | null
  fraud_score: unknown | null
  evaluation_json: unknown | null
  legacy_score: unknown | null
  legacy_feedback: string | null
}

type AttemptScoreSummaryRow = {
  attempt_id: string
  is_completed: boolean
  fallback_score: unknown | null
  fallback_decision: string | null
}

type AttemptExitMetadata = {
  earlyExit: boolean
  terminationType: string | null
  terminationReason: string | null
  disconnectReason: string | null
  terminationDetectedAt: string | null
  completionPercentage: number | null
}

type AttemptExitMetadataRow = {
  attempt_id: string
  early_exit: boolean | null
  termination_type: string | null
  termination_reason: string | null
  disconnect_reason: string | null
  termination_detected_at: string | null
  completion_percentage: unknown | null
}

type AttemptTranscriptRow = {
  attempt_id: string
  transcript: string | null
}

type SessionQuestionFallbackRow = {
  attempt_id: string
  session_question_id: string
  question_id: string | null
  question_text: string | null
  question_order: number | null
  question_type: string | null
  question_source: string | null
}

type InterviewRecordingRow = {
  interviewId: string
  recordingId: string
  mediaUrl: string | null
  recordingStatus: string | null
}

type RecordingColumnRow = {
  column_name: string
}

function quoteIdentifier(value: string) {
  return `"${value.replace(/"/g, "\"\"")}"`
}

async function getTableColumns(tableName: string) {
  const rows = await prisma.$queryRaw<RecordingColumnRow[]>(Prisma.sql`
    select column_name
    from information_schema.columns
    where table_schema = 'public'
      and table_name = ${tableName}
  `)

  return new Set(rows.map((row) => row.column_name))
}

function toNumberOrNull(value: unknown) {
  if (value === null || value === undefined) {
    return null
  }

  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function toPercentScore(value: number) {
  if (value >= 0 && value <= 1) {
    return value * 100
  }

  if (value > 1 && value <= 5) {
    return value * 20
  }

  return value
}

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)))
}

function getJsonNumber(source: unknown, keys: string[]) {
  if (!source || typeof source !== "object") {
    return null
  }

  for (const key of keys) {
    const value = (source as Record<string, unknown>)[key]
    const numeric = toNumberOrNull(value)
    if (numeric !== null) {
      return numeric
    }
  }

  return null
}

function mapAnswerSummaryRow(row: InterviewAnswerSummaryRow) {
  const primaryScore = toNumberOrNull(row.ai_score)
  const legacyScore = toNumberOrNull(row.legacy_score)

  return {
    answerId: row.answer_id,
    question: row.question_text || "Question text was not recorded for this answer.",
    answerText: row.code_text
      ? `[Coding submission in ${row.language || "code"}]\n${row.code_text}`
      : row.answer_text || "No response provided.",
    answerPayload: row.answer_payload ?? null,
    answeredAt: row.answered_at,
    questionOrder: row.question_order,
    questionType: row.question_type,
    questionSource: row.question_source,
    skill: row.skill,
    score: primaryScore ?? legacyScore,
    feedback: row.ai_feedback || row.legacy_feedback || null,
    skillScore: toNumberOrNull(row.skill_score),
    clarityScore: toNumberOrNull(row.clarity_score),
    depthScore: toNumberOrNull(row.depth_score),
    confidenceScore: toNumberOrNull(row.confidence_score),
    fraudScore: toNumberOrNull(row.fraud_score),
    evaluation: row.evaluation_json ?? null,
  }
}

function mapSessionQuestionFallbackRow(
  row: SessionQuestionFallbackRow,
  fallbackAnswer: string | null
): ReturnType<typeof mapAnswerSummaryRow> {
  return {
    answerId: `session-question-${row.session_question_id}`,
    question: row.question_text || "Question text was not recorded for this answer.",
    answerText: fallbackAnswer || "No response provided.",
    answerPayload: {
      recovered_from: "recording_transcript",
      session_question_id: row.session_question_id,
      question_id: row.question_id,
    },
    answeredAt: null,
    questionOrder: row.question_order,
    questionType: row.question_type,
    questionSource: row.question_source,
    skill: null,
    score: null,
    feedback: "Recovered for display from the recording transcript because the live answer row was missing.",
    skillScore: null,
    clarityScore: null,
    depthScore: null,
    confidenceScore: null,
    fraudScore: null,
    evaluation: null,
  }
}

function getAnswerMetricPercent(answer: ReturnType<typeof mapAnswerSummaryRow>, metric: "skill" | "clarity" | "depth" | "confidence" | "fraud") {
  const metricMap = {
    skill: {
      direct: answer.skillScore,
      keys: ["skill_score", "skillScore", "score"],
    },
    clarity: {
      direct: answer.clarityScore,
      keys: ["clarity_score", "clarityScore"],
    },
    depth: {
      direct: answer.depthScore,
      keys: ["depth_score", "depthScore"],
    },
    confidence: {
      direct: answer.confidenceScore,
      keys: ["confidence_score", "confidenceScore"],
    },
    fraud: {
      direct: answer.fraudScore,
      keys: ["fraud_score", "fraudScore", "suspicion_score", "suspicionScore"],
    },
  }[metric]

  const direct = metricMap.direct
  if (direct !== null && direct !== undefined) {
    return toPercentScore(Number(direct))
  }

  const jsonValue = getJsonNumber(answer.evaluation, metricMap.keys)
  if (jsonValue !== null) {
    return toPercentScore(jsonValue)
  }

  if (metric === "skill" && answer.score !== null && answer.score !== undefined) {
    return toPercentScore(Number(answer.score))
  }

  const fallback = evaluateCandidateResponse({
    skill: answer.skill || answer.question,
    answer: answer.answerText,
    fraudScore: metric === "fraud" ? 0 : undefined,
  })

  const fallbackMap = {
    skill: fallback.skill_score,
    clarity: fallback.clarity_score,
    depth: fallback.depth_score,
    confidence: fallback.confidence_score,
    fraud: fallback.suspicion_score,
  }

  return toPercentScore(fallbackMap[metric])
}

function deriveResultFromAnswerSummaries(answerSummaries: Array<ReturnType<typeof mapAnswerSummaryRow>>) {
  const substantiveAnswers = answerSummaries.filter((answer) => {
    const normalized = String(answer.answerText ?? "").trim().toLowerCase()
    return normalized && normalized !== "no response provided."
  })

  if (substantiveAnswers.length === 0) {
    return {
      score: null,
      decision: null,
    }
  }

  const scoredAnswers = substantiveAnswers.map((answer) => {
    const skill = getAnswerMetricPercent(answer, "skill")
    const clarity = getAnswerMetricPercent(answer, "clarity")
    const depth = getAnswerMetricPercent(answer, "depth")
    const confidence = getAnswerMetricPercent(answer, "confidence")
    const fraud = getAnswerMetricPercent(answer, "fraud")

    const weightedScore =
      skill * 0.4 +
      clarity * 0.2 +
      depth * 0.2 +
      confidence * 0.15 +
      Math.max(0, 100 - fraud) * 0.05

    return {
      score: weightedScore,
      fraud,
    }
  })

  const averageScore = scoredAnswers.reduce((total, item) => total + item.score, 0) / scoredAnswers.length
  const maxFraud = Math.max(...scoredAnswers.map((item) => item.fraud))
  const score = clampPercent(averageScore)

  let decision = "REJECT"
  if (maxFraud >= 70) {
    decision = "FLAGGED"
  } else if (score >= 75) {
    decision = "HIRE"
  } else if (score >= 60) {
    decision = "REVIEW"
  }

  return {
    score,
    decision,
  }
}

function buildAnswerFallbackSummary(rows: Array<ReturnType<typeof mapAnswerSummaryRow>>) {
  if (rows.length === 0) {
    return null
  }

  const scoredRows = rows
    .map((row) => row.score)
    .filter((score) => score !== null && score !== undefined)
    .map((score) => toPercentScore(Number(score)))
  const averageScore =
    scoredRows.length > 0
      ? Math.round(scoredRows.reduce((total, score) => total + Number(score), 0) / scoredRows.length)
      : null
  const answeredCount = rows.filter((row) => row.answerText && row.answerText !== "No response provided.").length
  const result = deriveResultFromAnswerSummaries(rows)

  return [
    `Transcript captured ${rows.length} question${rows.length === 1 ? "" : "s"} with ${answeredCount} substantive answer${answeredCount === 1 ? "" : "s"}.`,
    averageScore !== null ? `Average raw answer score from AI evaluation rows: ${averageScore}%.` : null,
    result.score !== null ? `Final calculated result: ${result.score}% (${result.decision}).` : null,
    "Review the transcript and per-answer AI feedback below for the detailed result.",
  ].filter(Boolean).join("\n")
}

async function fetchAnswerSummaries(attemptIds: string[]) {
  if (attemptIds.length === 0) {
    return new Map<string, ReturnType<typeof mapAnswerSummaryRow>[]>()
  }

  try {
    const rows = await prisma.$queryRawUnsafe<InterviewAnswerSummaryRow[]>(
      `
        select
          ans.attempt_id,
          ans.answer_id,
          ans.answer_text,
          cs.code_text,
          cs.language,
          ans.answer_payload,
          ans.answered_at,
          coalesce(sq.content, iq.question_text, q.question_text) as question_text,
          coalesce(sq.question_order, iq.question_order) as question_order,
          coalesce(sq.question_kind, iq.question_type, q.question_type) as question_type,
          coalesce(sq.source, iq.source_type) as question_source,
          coalesce(iq.reference_context->>'skill', iq.reference_context->>'anchor', q.skill_domain) as skill,
          iae.score as ai_score,
          iae.feedback as ai_feedback,
          iae.skill_score,
          iae.clarity_score,
          iae.depth_score,
          iae.confidence_score,
          iae.fraud_score,
          iae.evaluation_json,
          ae.raw_score as legacy_score,
          ae.rubric_reason as legacy_feedback
        from public.interview_answers ans
        left join public.session_questions sq
          on sq.session_question_id = ans.session_question_id
          or (sq.attempt_id = ans.attempt_id and sq.question_id = ans.question_id)
        left join public.interview_attempts att
          on att.attempt_id = ans.attempt_id
        left join public.interview_questions iq
          on iq.interview_id = att.interview_id
          and (
            iq.interview_question_id = ans.question_id
            or iq.question_id = ans.question_id
            or iq.interview_question_id = ans.session_question_id
            or iq.question_id = sq.question_id
          )
        left join public.questions q
          on q.question_id = coalesce(ans.question_id, sq.question_id, iq.question_id)
        left join public.interview_answer_evaluations iae
          on iae.answer_id = ans.answer_id
        left join public.answer_evaluations ae
          on ae.answer_id = ans.answer_id
        left join public.interview_code_submissions cs
          on cs.answer_id = ans.answer_id
        where ans.attempt_id = any($1::uuid[])
        order by ans.attempt_id, coalesce(sq.question_order, iq.question_order) asc nulls last, ans.answered_at asc nulls last
      `,
      attemptIds
    )

    const transcriptMap = await fetchRecordingTranscriptsForAttempts(attemptIds)
    const summaries = rows.reduce((map, row) => {
      const current = map.get(row.attempt_id) ?? []
      current.push(mapAnswerSummaryRow(row))
      map.set(row.attempt_id, current)
      return map
    }, new Map<string, ReturnType<typeof mapAnswerSummaryRow>[]>())

    for (const [attemptId, answerRows] of summaries) {
      summaries.set(attemptId, fillMissingAnswersFromTranscript(answerRows, transcriptMap.get(attemptId)))
    }

    const missingAttemptIds = attemptIds.filter((attemptId) => !summaries.has(attemptId))
    const fallbackSummaries = await fetchSessionQuestionFallbackSummaries(missingAttemptIds, transcriptMap)
    for (const [attemptId, answerRows] of fallbackSummaries) {
      summaries.set(attemptId, answerRows)
    }

    return summaries
  } catch (error) {
    console.error("Failed to fetch interview answer summaries", error)
    return new Map<string, ReturnType<typeof mapAnswerSummaryRow>[]>()
  }
}

async function fetchSessionQuestionFallbackSummaries(
  attemptIds: string[],
  transcriptMap: Map<string, string>
) {
  if (attemptIds.length === 0) {
    return new Map<string, ReturnType<typeof mapAnswerSummaryRow>[]>()
  }

  const rows = await prisma.$queryRawUnsafe<SessionQuestionFallbackRow[]>(
    `
      select
        sq.attempt_id,
        sq.session_question_id,
        sq.question_id,
        sq.content as question_text,
        sq.question_order,
        sq.question_kind as question_type,
        sq.source as question_source
      from public.session_questions sq
      where sq.attempt_id = any($1::uuid[])
      order by sq.attempt_id, sq.question_order asc nulls last, sq.asked_at asc nulls last
    `,
    attemptIds
  )

  return rows.reduce((map, row) => {
    const current = map.get(row.attempt_id) ?? []
    const transcriptAnswers = extractCandidateAnswersFromTranscript(transcriptMap.get(row.attempt_id))
    const answerIndex = row.question_order ? row.question_order - 1 : current.length
    const fallbackAnswer = transcriptAnswers[answerIndex] ?? null
    current.push(mapSessionQuestionFallbackRow(row, fallbackAnswer))
    map.set(row.attempt_id, current)
    return map
  }, new Map<string, ReturnType<typeof mapAnswerSummaryRow>[]>())
}

async function fetchRecordingTranscriptsForAttempts(attemptIds: string[]) {
  if (attemptIds.length === 0) {
    return new Map<string, string>()
  }

  const columns = await getTableColumns("interview_recordings")
  if (!columns.has("attempt_id") || !columns.has("transcript")) {
    return new Map<string, string>()
  }

  const rows = await prisma.$queryRawUnsafe<AttemptTranscriptRow[]>(
    `
      select distinct on (ir.attempt_id)
        ir.attempt_id::text,
        ir.transcript
      from public.interview_recordings ir
      where ir.attempt_id = any($1::uuid[])
        and ir.transcript is not null
        and btrim(ir.transcript) <> ''
      order by ir.attempt_id, ir.created_at desc nulls last
    `,
    attemptIds
  )

  return new Map(rows.map((row) => [row.attempt_id, row.transcript ?? ""]))
}

async function fetchAttemptScoreSummaries(attemptIds: string[]) {
  if (attemptIds.length === 0) {
    return new Map<string, { score: number | null; decision: string | null }>()
  }

  const rows = await prisma.$queryRawUnsafe<AttemptScoreSummaryRow[]>(
    `
      select
        ia.attempt_id::text,
        (
          upper(coalesce(i.status, ia.status, '')) in ('COMPLETED', 'SUBMITTED', 'EVALUATED')
          or ia.ended_at is not null
        ) as is_completed,
        coalesce(
          case
            when (
              upper(coalesce(i.status, ia.status, '')) in ('COMPLETED', 'SUBMITTED', 'EVALUATED')
              or ia.ended_at is not null
            )
            and ia.termination_metadata->>'final_score' ~ '^[0-9]+(\\.[0-9]+)?$'
              then (ia.termination_metadata->>'final_score')::numeric
            else null
          end,
          case
            when not (
              upper(coalesce(i.status, ia.status, '')) in ('COMPLETED', 'SUBMITTED', 'EVALUATED')
              or ia.ended_at is not null
            ) then null::numeric
            when count(ans.answer_id) filter (
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
          end
        ) as fallback_score,
        case
          when upper(coalesce(ia.termination_metadata->>'decision', ia.termination_metadata->>'recommendation', '')) in ('HIRE', 'STRONG_HIRE', 'STRONG HIRE') then 'HIRE'
          when upper(coalesce(ia.termination_metadata->>'decision', ia.termination_metadata->>'recommendation', '')) in ('REVIEW', 'REVIEW_REQUIRED', 'REVIEW REQUIRED') then 'REVIEW'
          when upper(coalesce(ia.termination_metadata->>'decision', ia.termination_metadata->>'recommendation', '')) = 'FLAGGED' then 'FLAGGED'
          when upper(coalesce(ia.termination_metadata->>'decision', ia.termination_metadata->>'recommendation', '')) in ('REJECT', 'NO_HIRE') then 'REJECT'
          else null
        end as fallback_decision
      from public.interview_attempts ia
      left join public.interviews i
        on i.interview_id = ia.interview_id
      left join public.interview_answers ans
        on ans.attempt_id = ia.attempt_id
      left join public.interview_answer_evaluations iae
        on iae.answer_id = ans.answer_id
       and iae.evaluator_type = 'AI'
      where ia.attempt_id = any($1::uuid[])
      group by ia.attempt_id, ia.termination_metadata, i.status
    `,
    attemptIds
  ).catch(() => [] as AttemptScoreSummaryRow[])

  return rows.reduce((map, row) => {
    map.set(row.attempt_id, {
      score: row.is_completed ? toNumberOrNull(row.fallback_score) : null,
      decision: row.is_completed ? row.fallback_decision : null,
    })
    return map
  }, new Map<string, { score: number | null; decision: string | null }>())
}

async function fetchAttemptExitMetadata(attemptIds: string[]) {
  if (attemptIds.length === 0) {
    return new Map<string, AttemptExitMetadata>()
  }

  const columns = await getTableColumns("interview_attempts")

  const selectColumn = (name: string, fallback: string) =>
    columns.has(name) ? `ia.${quoteIdentifier(name)}` : fallback

  const rows = await prisma.$queryRawUnsafe<AttemptExitMetadataRow[]>(
    `
      select
        ia.attempt_id::text,
        ${selectColumn("early_exit", "false")} as early_exit,
        ${selectColumn("termination_type", "null::text")} as termination_type,
        ${selectColumn("termination_reason", "null::text")} as termination_reason,
        ${selectColumn("disconnect_reason", "null::text")} as disconnect_reason,
        ${selectColumn("termination_detected_at", "null::timestamptz")}::text as termination_detected_at,
        ${selectColumn("completion_percentage", "null::numeric")} as completion_percentage
      from public.interview_attempts ia
      where ia.attempt_id = any($1::uuid[])
    `,
    attemptIds
  )

  return new Map(
    rows.map((row) => [
      row.attempt_id,
      {
        earlyExit: Boolean(row.early_exit),
        terminationType: row.termination_type,
        terminationReason: row.termination_reason,
        disconnectReason: row.disconnect_reason,
        terminationDetectedAt: row.termination_detected_at,
        completionPercentage: toNumberOrNull(row.completion_percentage),
      },
    ])
  )
}

async function fetchLatestRecordingsForInterviews(organizationId: string, interviewIds: string[]) {
  if (interviewIds.length === 0) {
    return new Map<string, InterviewRecordingRow>()
  }

  const columns = await prisma.$queryRaw<RecordingColumnRow[]>`
    select column_name
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'interview_recordings'
  `.catch(() => [])
  const columnSet = new Set(columns.map((row) => row.column_name))

  if (columnSet.size === 0) {
    return new Map<string, InterviewRecordingRow>()
  }

  const idColumn = columnSet.has("recording_id") ? "recording_id" : columnSet.has("id") ? "id" : null
  if (!idColumn) {
    return new Map<string, InterviewRecordingRow>()
  }

  const joinInterviewExpression = columnSet.has("interview_id") && columnSet.has("attempt_id")
    ? "coalesce(ir.interview_id, ia.interview_id)"
    : columnSet.has("interview_id")
      ? "ir.interview_id"
      : columnSet.has("attempt_id")
        ? "ia.interview_id"
        : null

  if (!joinInterviewExpression) {
    return new Map<string, InterviewRecordingRow>()
  }

  const attemptJoin = columnSet.has("attempt_id")
    ? "left join public.interview_attempts ia on ia.attempt_id = ir.attempt_id"
    : "left join public.interview_attempts ia on false"
  const mediaExpressions = [
    columnSet.has("video_url") ? "nullif(ir.video_url::text, '')" : null,
    columnSet.has("audio_url") ? "nullif(ir.audio_url::text, '')" : null,
    columnSet.has("recording_url") ? "nullif(ir.recording_url::text, '')" : null,
    columnSet.has("file_path") ? "nullif(ir.file_path::text, '')" : null,
  ].filter(Boolean)
  const mediaExpression = mediaExpressions.length > 0 ? `coalesce(${mediaExpressions.join(", ")})` : "null::text"
  const statusExpression = columnSet.has("status") ? "ir.status::text" : "null::text"
  const createdSortExpression = columnSet.has("created_at") ? "ir.created_at desc nulls last" : `ir.${quoteIdentifier(idColumn)} desc`
  const statusSortExpression = columnSet.has("status") ? "case when coalesce(ir.status, 'completed') = 'completed' then 0 else 1 end" : "0"
  const mediaSortExpression = columnSet.has("file_path")
    ? "case when ir.file_path ilike '%.mp4%' then 0 when ir.file_path is not null then 1 else 2 end"
    : "0"

  const query = `
    select distinct on (i.interview_id)
      i.interview_id::text as "interviewId",
      ir.${quoteIdentifier(idColumn)}::text as "recordingId",
      ${mediaExpression} as "mediaUrl",
      ${statusExpression} as "recordingStatus"
    from public.interview_recordings ir
    ${attemptJoin}
    inner join public.interviews i
      on i.interview_id = ${joinInterviewExpression}
    where i.organization_id = $1::uuid
      and i.interview_id::text = any($2::text[])
    order by i.interview_id, ${statusSortExpression}, ${mediaSortExpression}, ${createdSortExpression}
  `

  const rows = await prisma.$queryRawUnsafe<InterviewRecordingRow[]>(query, organizationId, interviewIds).catch(() => [])
  return new Map(rows.map((row) => [row.interviewId, row]))
}

type InterviewScreenOptions = {
  includeAnswers?: boolean
  limit?: number
  interviewId?: string | null
  finalizeStale?: boolean
}

function getInterviewActivityTime(interview: {
  endedAt?: Date | string | null
  startedAt?: Date | string | null
  startTime?: Date | string | null
  createdAt?: Date | string | null
}) {
  const value =
    interview.endedAt ??
    interview.startedAt ??
    interview.startTime ??
    interview.createdAt

  const time = value ? new Date(value).getTime() : 0
  return Number.isFinite(time) ? time : 0
}

async function getInterviewsScreenData(auth: RecruiterRequestContext, options: InterviewScreenOptions = {}) {
  if (options.finalizeStale !== false) {
    await finalizeStaleInterviewAttempts(auth.organizationId)
  }

  const interviews = await prisma.interview.findMany({
    where: {
      organizationId: auth.organizationId,
      ...(options.interviewId ? { interviewId: options.interviewId } : {}),
    },
    orderBy: {
      createdAt: "desc",
    },
    include: {
      candidate: {
        select: {
          fullName: true,
        },
      },
      job: {
        select: {
          jobTitle: true,
        },
      },
      interviewInvites: {
        orderBy: {
          createdAt: "desc",
        },
        select: {
          accessType: true,
          startTime: true,
          endTime: true,
          expiresAt: true,
          status: true,
          usedAt: true,
          token: true,
        },
      },
      attempts: {
        orderBy: {
          startedAt: "desc",
        },
        include: {
          evaluation: true,
        },
      },
    },
  })

  const attemptIds = interviews
    .map((interview) => interview.attempts[0]?.attemptId)
    .filter((attemptId): attemptId is string => Boolean(attemptId))
  const answerSummaryMap =
    options.includeAnswers !== false
      ? await fetchAnswerSummaries(attemptIds)
      : new Map<string, ReturnType<typeof mapAnswerSummaryRow>[]>()
  const attemptScoreSummaryMap =
    options.includeAnswers === false
      ? await fetchAttemptScoreSummaries(attemptIds)
      : new Map<string, { score: number | null; decision: string | null }>()
  const attemptExitMetadataMap = await fetchAttemptExitMetadata(attemptIds)
  const recruiterDecisionMap = await getRecruiterDecisionsForInterviews(
    auth.organizationId,
    interviews.map((interview) => interview.interviewId)
  )
  const recordingMap = await fetchLatestRecordingsForInterviews(
    auth.organizationId,
    interviews.map((interview) => interview.interviewId)
  )

  const rows = interviews.map((interview) => {
    const latestInvite = interview.interviewInvites[0] ?? null
    const latestAttempt = interview.attempts[0] ?? null
    const evaluation = latestAttempt?.evaluation ?? null
    const recruiterDecision = recruiterDecisionMap.get(interview.interviewId) ?? null
    const recording = recordingMap.get(interview.interviewId) ?? null
    const answerSummaries = latestAttempt?.attemptId ? answerSummaryMap.get(latestAttempt.attemptId) ?? [] : []
    const fallbackScoreSummary = latestAttempt?.attemptId ? attemptScoreSummaryMap.get(latestAttempt.attemptId) : null
    const exitMetadata = latestAttempt?.attemptId ? attemptExitMetadataMap.get(latestAttempt.attemptId) : null
    const calculatedResult = deriveResultFromAnswerSummaries(answerSummaries)
    const questionStatus = interview.questionStatus ?? null
    const emailStatus = interview.emailStatus ?? null
    const failureReason = interview.failureReason ?? null
    const lastError = interview.lastError ?? null
    const normalizedAttemptStatus = String(latestAttempt?.status ?? "").toUpperCase()
    const normalizedTerminationType = String(exitMetadata?.terminationType ?? "").toUpperCase()
    const isManualExit =
      ["MANUAL_EXIT", "EARLY_EXIT"].includes(normalizedAttemptStatus) || normalizedTerminationType === "MANUAL_EXIT"
    const status = deriveInterviewStatus({
      interviewStatus: interview.status,
      questionStatus,
      emailStatus,
      latestAttempt: latestAttempt ? { ...latestAttempt, earlyExit: isManualExit, terminationType: exitMetadata?.terminationType ?? null } : null,
      latestInvite,
    })

    return {
      interviewId: interview.interviewId,
      attemptId: latestAttempt?.attemptId ?? null,
      candidateId: interview.candidateId,
      candidateName: interview.candidate.fullName,
      jobTitle: interview.job.jobTitle,
      status,
      interviewStatus: interview.status ?? null,
      questionStatus,
      emailStatus,
      failureReason,
      lastError,
      questionsGeneratedAt: interview.questionsGeneratedAt ?? null,
      emailSentAt: interview.emailSentAt ?? null,
      inviteStatus: latestInvite?.status ?? null,
      inviteToken: latestInvite?.token ?? null,
      link: latestInvite?.token ? `${getInterviewAppUrl().replace(/\/$/, "")}/interview/${latestInvite.token}` : null,
      attemptStatus: latestAttempt?.status ?? null,
      earlyExit: isManualExit,
      earlyExitRecorded: exitMetadata?.earlyExit ?? false,
      terminationType: exitMetadata?.terminationType ?? null,
      terminationReason: exitMetadata?.terminationReason ?? null,
      disconnectReason: exitMetadata?.disconnectReason ?? null,
      terminationDetectedAt: exitMetadata?.terminationDetectedAt ?? null,
      completionPercentage: exitMetadata?.completionPercentage ?? null,
      accessType: latestInvite?.accessType ?? "FLEXIBLE",
      startTime: latestInvite?.startTime ?? null,
      endTime: latestInvite?.endTime ?? null,
      expiresAt: latestInvite?.expiresAt ?? null,
      startedAt: latestAttempt?.startedAt ?? null,
      endedAt: latestAttempt?.endedAt ?? null,
      score:
        evaluation?.finalScore === null || evaluation?.finalScore === undefined
          ? calculatedResult.score ?? fallbackScoreSummary?.score ?? null
          : Number(evaluation.finalScore),
      decision: evaluation?.decision ?? calculatedResult.decision ?? fallbackScoreSummary?.decision ?? null,
      recruiterDecisionStatus: recruiterDecision?.status ?? null,
      recruiterDecisionAt: recruiterDecision?.decidedAt ?? null,
      recruiterDecisionNotes: recruiterDecision?.notes ?? null,
      recordingId: recording?.recordingId ?? null,
      recordingUrl: recording?.recordingId ? `/recordings/${encodeURIComponent(recording.recordingId)}` : null,
      recordingStatus: recording?.recordingStatus ?? null,
      hasRecording: Boolean(recording?.recordingId && recording?.mediaUrl),
      aiSummary: evaluation?.aiSummary ?? buildAnswerFallbackSummary(answerSummaries),
      answerSummaries,
      detailsLoaded: options.includeAnswers !== false,
      createdAt: interview.createdAt,
    }
  })

  return rows
    .sort((left, right) => getInterviewActivityTime(right) - getInterviewActivityTime(left))
    .slice(0, options.limit)
}

export async function GET(request: Request) {
  try {
    const auth = await getRecruiterRequestContext(request)
    const { searchParams } = new URL(request.url)
    const rawLimit = Number.parseInt(searchParams.get("limit") ?? "0", 10)
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 200) : undefined
    const includeAnswers = searchParams.get("includeAnswers") !== "0"
    const interviewId = searchParams.get("interviewId")
    const finalizeStale = searchParams.get("finalizeStale") !== "0"
    const data = await getInterviewsScreenData(auth, {
      includeAnswers,
      limit,
      interviewId,
      finalizeStale,
    })

    const response = NextResponse.json({
      success: true,
      data,
    })
    response.headers.set("Cache-Control", includeAnswers ? "private, max-age=15" : "private, max-age=30, stale-while-revalidate=60")
    return response
  } catch (error) {
    return errorResponse(error)
  }
}
