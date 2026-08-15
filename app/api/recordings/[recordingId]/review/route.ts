import { NextResponse } from "next/server"

import { getRecruiterRequestContext } from "@/lib/server/auth-context"
import { ApiError } from "@/lib/server/errors"
import { prisma } from "@/lib/server/prisma"
import { errorResponse } from "@/lib/server/response"
import { fillMissingAnswersFromTranscript } from "@/lib/server/services/transcript-fallback"
import {
  inferSessionBaselineMs,
  placeMarkerInRecording,
} from "@/lib/server/services/recording-timeline"

type RecordingRow = {
  recording_id: string
  attempt_id: string | null
  candidate_name: string | null
  job_title: string | null
  status: string | null
  started_at: string | null
  ended_at: string | null
  created_at: string | null
  transcript: string | null
  transcript_status: string | null
}

type TimelineRow = {
  session_question_id: string
  question_order: number | null
  question_text: string | null
  question_source: string | null
  asked_at: string | null
  answer_id: string | null
  answer_text: string | null
  code_text: string | null
  language: string | null
  answered_at: string | null
  skill_score: unknown | null
  clarity_score: unknown | null
  depth_score: unknown | null
  confidence_score: unknown | null
  fraud_score: unknown | null
  feedback: string | null
}

type SignalRow = {
  signal_id: string
  type: string
  value: unknown | null
  created_at: string | null
}

type ReviewSignal = {
  id: string
  type: string
  label: string
  description: string
  severity: "low" | "medium" | "high"
  occurredAt: string | null
  offsetMs: number
  value: unknown | null
}

function toNumber(value: unknown) {
  const numeric = typeof value === "number" ? value : Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function toPercent(value: unknown) {
  const numeric = toNumber(value)
  if (numeric === null) {
    return null
  }

  return numeric <= 1 ? Math.round(numeric * 100) : Math.round(numeric)
}

function getTime(value: string | null) {
  return value ? new Date(value).getTime() : null
}

function offsetMs(startedAt: string | null, value: string | null) {
  const start = getTime(startedAt)
  const current = getTime(value)

  if (start === null || current === null) {
    return null
  }

  return Math.max(0, current - start)
}

function readSignalOffset(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null
  }

  const offset = (value as { recordingOffsetMs?: unknown }).recordingOffsetMs
  return typeof offset === "number" && Number.isFinite(offset) ? Math.max(0, Math.round(offset)) : null
}

function readObjectNumber(value: unknown, key: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null
  }

  return toNumber((value as Record<string, unknown>)[key])
}

function readObjectString(value: unknown, key: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null
  }

  const result = (value as Record<string, unknown>)[key]
  return typeof result === "string" && result.trim() ? result.trim() : null
}

function isActionableSignal(type: string, value: unknown) {
  const normalizedType = type.trim().toLowerCase()
  return new Set([
    "no_face",
    "attention_loss",
    "external_device_suspected",
    "clarification_requested",
    "background_noise_detected",
    "audio_intermittently_unavailable",
  ]).has(normalizedType)
}

function getSignalSeverity(type: string, value: unknown): "low" | "medium" | "high" {
  if (
    type === "low_microphone_volume" ||
    type === "audio_intermittently_unavailable" ||
    type === "background_noise_detected" ||
    type === "transcript_recovered_from_recording"
  ) {
    return "low"
  }

  if (value && typeof value === "object" && !Array.isArray(value)) {
    const severity = (value as { severity?: unknown }).severity
    if (severity === "low" || severity === "medium" || severity === "high") {
      return severity
    }
  }

  if (/\b(multi_face|tab_switch|no_face|screen_share|window_blur|copy_paste|devtools|external_device)\b/i.test(type)) {
    return "high"
  }

  if (type === "focus_metrics") {
    const focusRatio = readObjectNumber(value, "focusRatio")
    const maxLookAwayDuration = readObjectNumber(value, "maxLookAwayDuration") ?? 0

    if ((focusRatio !== null && focusRatio < 0.35 && maxLookAwayDuration >= 8_000) || maxLookAwayDuration >= 15_000) {
      return "high"
    }

    return "low"
  }

  if (/\b(long_gaze_away|attention_loss|focus_lost|audio_anomaly|network_reconnect)\b/i.test(type)) {
    return "medium"
  }

  return "low"
}

function getSignalLabel(type: string, value: unknown) {
  const labels: Record<string, string> = {
    no_face: "No face detected",
    multi_face: "Multiple faces detected",
    tab_switch: "Tab switch detected",
    long_gaze_away: "Long gaze away",
    attention_loss: "Attention lost",
    focus_lost: "Focus lost",
    focus_metrics: "Attention review window",
    screen_share: "Screen sharing detected",
    window_blur: "Window focus lost",
    copy_paste: "Copy/paste activity",
    devtools: "Developer tools opened",
    external_device: "External device signal",
    audio_anomaly: "Audio anomaly",
    low_microphone_volume: "Low microphone volume",
    audio_intermittently_unavailable: "Audio intermittently unavailable",
    background_noise_detected: "Background noise detected",
    transcript_recovered_from_recording: "Transcript recovered from recording",
    external_device_suspected: "Might be using External Device",
    clarification_requested: "Clarification requested",
    network_reconnect: "Network reconnect",
    coding_start: "Coding started",
    coding_end: "Coding ended",
    war_room_action: "Manual review action",
  }

  if (type === "focus_metrics") {
    const focusRatio = readObjectNumber(value, "focusRatio")
    return focusRatio !== null
      ? `Attention review window (${Math.round(focusRatio * 100)}% camera focus)`
      : labels.focus_metrics
  }

  return (labels[type] ?? type)
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

function getSignalDescription(type: string) {
  const descriptions: Record<string, string> = {
    no_face:
      "No face was reliably detected for a sustained period. Lighting, camera angle, or leaving the frame may cause this.",
    attention_loss:
      "Sustained head or gaze direction away from the interview was detected. Brief natural glances are excluded.",
    external_device_suspected:
      "A sustained same-direction gaze may indicate another screen or device. This is a review cue, not proof.",
    clarification_requested:
      "The candidate asked VERIS to explain the same question differently. This is neutral and does not affect scoring.",
    background_noise_detected:
      "Sustained background sound may have affected audio or transcript quality.",
    audio_intermittently_unavailable:
      "The microphone stream became unavailable during part of the interview, so some spoken content may be missing from the transcript.",
  }

  return descriptions[type] ?? ""
}

export async function GET(request: Request, context: { params: Promise<{ recordingId: string }> }) {
  try {
    const auth = await getRecruiterRequestContext(request)
    const { recordingId } = await context.params

    const recordings = await prisma.$queryRaw<RecordingRow[]>`
      select
        ir.recording_id::text,
        ir.attempt_id::text,
        coalesce(c.full_name, 'Unknown Candidate') as candidate_name,
        coalesce(jp.job_title, '-') as job_title,
        ir.status,
        ir.started_at::text,
        ir.ended_at::text,
        ir.created_at::text,
        ir.transcript,
        ia.transcript_status
      from public.interview_recordings ir
      left join public.interview_attempts ia
        on ia.attempt_id = ir.attempt_id
      left join public.interviews i
        on i.interview_id = ia.interview_id
      left join public.candidates c
        on c.candidate_id = i.candidate_id
      left join public.job_positions jp
        on jp.job_id = i.job_id
      where ir.recording_id::text = ${recordingId}
        and i.organization_id = ${auth.organizationId}::uuid
      limit 1
    `

    const recording = recordings[0]
    if (!recording?.attempt_id) {
      throw new ApiError(404, "RECORDING_NOT_FOUND", "Recording was not found")
    }

    const [timelineRows, signalRows] = await Promise.all([
      prisma.$queryRaw<TimelineRow[]>`
        select
          sq.session_question_id::text,
          sq.question_order,
          sq.content as question_text,
          sq.source as question_source,
          sq.asked_at::text,
          ia.answer_id::text,
          ia.answer_text,
          cs.code_text,
          cs.language,
          ia.answered_at::text,
          iae.skill_score,
          iae.clarity_score,
          iae.depth_score,
          iae.confidence_score,
          iae.fraud_score,
          iae.feedback
        from public.session_questions sq
        left join public.interview_answers ia
          on ia.session_question_id = sq.session_question_id
        left join public.interview_answer_evaluations iae
          on iae.answer_id = ia.answer_id
        left join public.interview_code_submissions cs
          on cs.answer_id = ia.answer_id
        where sq.attempt_id = ${recording.attempt_id}::uuid
        order by sq.asked_at asc nulls last, sq.question_order asc nulls last
      `,
      prisma.$queryRaw<SignalRow[]>`
        select
          signal_id::text,
          type,
          value,
          created_at::text
        from public.interview_signals
        where attempt_id = ${recording.attempt_id}::uuid
          and lower(coalesce(type, '')) not in ('vocal_pressure', 'acoustic_activity')
        order by created_at asc nulls last
      `.catch(() => [] as SignalRow[]),
    ])

    const timeline = fillMissingAnswersFromTranscript(timelineRows.map((row, index) => {
      const questionOffset = offsetMs(recording.started_at, row.asked_at)
      const answerOffset = offsetMs(recording.started_at, row.answered_at)
      const fraudScore = toPercent(row.fraud_score)

      return {
        id: row.session_question_id,
        index: row.question_order ?? index + 1,
        question: row.question_text ?? "",
        source: row.question_source ?? "",
        answer: row.code_text
          ? `[Coding submission in ${row.language || "code"}]\n${row.code_text}`
          : row.answer_text ?? "",
        askedAt: row.asked_at,
        answeredAt: row.answered_at,
        offsetMs: questionOffset ?? answerOffset ?? 0,
        answerOffsetMs: answerOffset,
        scores: {
          skill: toPercent(row.skill_score),
          clarity: toPercent(row.clarity_score),
          depth: toPercent(row.depth_score),
          confidence: toPercent(row.confidence_score),
          fraud: fraudScore,
        },
        feedback: row.feedback,
        riskLevel: fraudScore !== null && fraudScore >= 70 ? "high" : fraudScore !== null && fraudScore >= 45 ? "medium" : "low",
      }
    }), recording.transcript)

    // `recordingOffsetMs` is measured from one session-wide baseline, but an
    // attempt owns many recordings (a full LiveKit egress plus rolling browser
    // segments). Rebase every marker onto the recording actually being viewed,
    // and drop the ones belonging to a different stretch of the interview,
    // instead of drawing a 30-minute interview's markers onto a 2-minute clip.
    const sessionBaselineMs = inferSessionBaselineMs(
      signalRows.map((row) => ({
        occurredAt: row.created_at,
        recordingOffsetMs: readSignalOffset(row.value),
      }))
    )

    const signals = signalRows.reduce<ReviewSignal[]>((items, row) => {
      if (!isActionableSignal(row.type, row.value)) {
        return items
      }

      const sessionQuestionId = readObjectString(row.value, "sessionQuestionId")
      const matchingQuestion = sessionQuestionId
        ? timeline.find((item) => item.id === sessionQuestionId)
        : null

      const placedOffsetMs = placeMarkerInRecording(
        {
          occurredAt: row.created_at,
          recordingOffsetMs: readSignalOffset(row.value),
          questionOffsetMs: matchingQuestion?.answerOffsetMs ?? matchingQuestion?.offsetMs ?? null,
        },
        { startedAt: recording.started_at, endedAt: recording.ended_at },
        { sessionBaselineMs }
      )

      if (placedOffsetMs === null) {
        return items
      }

      items.push({
        id: row.signal_id,
        type: row.type,
        label: getSignalLabel(row.type, row.value),
        description: getSignalDescription(row.type),
        severity: getSignalSeverity(row.type, row.value),
        occurredAt: row.created_at,
        offsetMs: placedOffsetMs,
        value: row.value,
      })

      return items
    }, [])

    return NextResponse.json({
      recording: {
        id: recording.recording_id,
        attemptId: recording.attempt_id,
        candidateName: recording.candidate_name,
        jobTitle: recording.job_title,
        status: recording.status,
        startedAt: recording.started_at,
        endedAt: recording.ended_at,
        createdAt: recording.created_at,
        transcript: recording.transcript,
        transcriptStatus: recording.transcript_status,
        mediaUrl: `/api/recordings/${encodeURIComponent(recording.recording_id)}`,
        durationMs: (() => {
          const startedAt = recording.started_at ? new Date(recording.started_at).getTime() : Number.NaN
          const endedAt = recording.ended_at ? new Date(recording.ended_at).getTime() : Number.NaN
          return Number.isFinite(startedAt) && Number.isFinite(endedAt) && endedAt > startedAt
            ? endedAt - startedAt
            : null
        })(),
      },
      timeline,
      signals,
      summary: {
        questionCount: timeline.length,
        signalCount: signals.length,
        highRiskCount: signals.filter((signal) => signal.severity === "high").length + timeline.filter((item) => item.riskLevel === "high").length,
        maxFraudScore: Math.max(0, ...timeline.map((item) => item.scores.fraud ?? 0)),
      },
    })
  } catch (error) {
    return errorResponse(error)
  }
}
