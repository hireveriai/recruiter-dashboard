import { evaluateCandidateResponse } from "@/lib/server/ai/interview-flow"
import { prisma } from "@/lib/server/prisma"
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

export type InterviewAnswerSummary = ReturnType<typeof mapAnswerSummaryRow>

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
): InterviewAnswerSummary {
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

function getAnswerMetricPercent(answer: InterviewAnswerSummary, metric: "skill" | "clarity" | "depth" | "confidence" | "fraud") {
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

export function deriveResultFromAnswerSummaries(answerSummaries: InterviewAnswerSummary[]) {
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

export function buildAnswerFallbackSummary(rows: InterviewAnswerSummary[]) {
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

export async function fetchAnswerSummaries(attemptIds: string[]) {
  if (attemptIds.length === 0) {
    return new Map<string, InterviewAnswerSummary[]>()
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
    }, new Map<string, InterviewAnswerSummary[]>())

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
    return new Map<string, InterviewAnswerSummary[]>()
  }
}

async function fetchSessionQuestionFallbackSummaries(
  attemptIds: string[],
  transcriptMap: Map<string, string>
) {
  if (attemptIds.length === 0) {
    return new Map<string, InterviewAnswerSummary[]>()
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
  }, new Map<string, InterviewAnswerSummary[]>())
}

async function fetchRecordingTranscriptsForAttempts(attemptIds: string[]) {
  if (attemptIds.length === 0) {
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
  ).catch(() => [] as AttemptTranscriptRow[])

  return new Map(rows.map((row) => [row.attempt_id, row.transcript ?? ""]))
}
