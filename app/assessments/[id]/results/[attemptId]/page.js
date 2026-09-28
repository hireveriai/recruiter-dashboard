"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { useParams } from "next/navigation"
import { useAuthSearchParams } from "@/lib/client/use-auth-search-params"

import BackToDashboardLink from "@/components/BackToDashboardLink"
import Navbar from "@/components/Navbar"
import { buildAuthUrl } from "@/lib/client/auth-query"
import { formatDateTime } from "@/lib/client/date-format"

// The DB stores the raw enum (LOW | MODERATE | HIGH | REVIEW_RECOMMENDED,
// no "RISK" suffix) - format it for display rather than rendering verbatim.
function formatRiskLevel(riskLevel) {
  if (!riskLevel) return "-"
  if (riskLevel === "REVIEW_RECOMMENDED") return "REVIEW RECOMMENDED"
  if (riskLevel === "LOW") return "LOW RISK"
  if (riskLevel === "MODERATE") return "MODERATE RISK"
  if (riskLevel === "HIGH") return "HIGH RISK"
  return riskLevel.replace(/_/g, " ")
}

function riskTone(riskLevel) {
  if (riskLevel === "REVIEW_RECOMMENDED") return "border-rose-500/30 bg-rose-500/12 text-rose-200"
  if (riskLevel === "HIGH") return "border-amber-500/30 bg-amber-500/12 text-amber-200"
  if (riskLevel === "MODERATE") return "border-amber-400/20 bg-amber-400/8 text-amber-100"
  return "border-emerald-500/30 bg-emerald-500/12 text-emerald-200"
}

// "Potential AI Assistance" is heuristic evidence for a recruiter to review -
// never a claim that a specific tool was used. Same LOW/ELEVATED/REVIEW
// vocabulary discipline as the integrity risk badge above.
function formatAiAssistanceLevel(level) {
  if (!level) return "-"
  if (level === "REVIEW_RECOMMENDED") return "REVIEW RECOMMENDED"
  if (level === "ELEVATED") return "ELEVATED RISK"
  return "LOW RISK"
}

function aiAssistanceTone(level) {
  if (level === "REVIEW_RECOMMENDED") return "border-rose-500/30 bg-rose-500/12 text-rose-200"
  if (level === "ELEVATED") return "border-amber-500/30 bg-amber-500/12 text-amber-200"
  return "border-emerald-500/30 bg-emerald-500/12 text-emerald-200"
}

const SIGNAL_TYPE_LABELS = {
  tab_switch: "Tab switch",
  visibility_hidden: "Tab hidden",
  copy: "Copy",
  paste: "Paste",
  large_paste: "Large paste",
  paste_blocked: "Paste blocked",
  copy_blocked: "Copy blocked",
  inactivity: "Inactivity",
  fullscreen_exit: "Left full screen",
  face_present: "Face detected",
  face_absent: "Face not detected",
  multiple_faces: "Multiple faces detected",
  multiple_faces_ended: "Multiple faces no longer detected",
  camera_unavailable: "Camera unavailable",
  camera_restored: "Camera restored",
  ip_changed: "IP address changed",
  ai_assistance_risk: "Potential AI assistance signal",
  suspicious_activity: "Suspicious activity",
  code_similarity: "Potential code similarity",
}

// Same LOW/ELEVATED/REVIEW_RECOMMENDED vocabulary as "Potential AI Assistance"
// above — a review cue, never a verdict. Common algorithms or expected
// implementation patterns can naturally produce similar code.
function formatCodeSimilarityLevel(level) {
  return formatAiAssistanceLevel(level)
}

function codeSimilarityTone(level) {
  return aiAssistanceTone(level)
}

function formatSignalType(type) {
  return SIGNAL_TYPE_LABELS[type] ?? type.replace(/_/g, " ")
}

function formatSignalValue(value) {
  if (!value || typeof value !== "object") return null
  const entries = Object.entries(value).filter(([, v]) => v !== null && v !== undefined && v !== "")
  if (entries.length === 0) return null
  if (Array.isArray(value.evidence)) {
    return value.evidence.join("; ")
  }
  return entries.map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : v}`).join(" · ")
}

const QUESTION_TYPE_LABELS = {
  SINGLE_CHOICE: "Single Choice",
  MULTI_SELECT: "Multi Select",
  SHORT_ANSWER: "Short Answer",
  SCENARIO: "Scenario",
  CODING: "Coding",
}

function initialsOf(name) {
  const parts = String(name ?? "").trim().split(/\s+/).filter(Boolean)
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "VN"
}

/** Circular score gauge; empty when there is no score yet. */
function ScoreRing({ value }) {
  const radius = 26
  const circumference = 2 * Math.PI * radius
  const clamped = value == null ? 0 : Math.max(0, Math.min(100, Number(value)))
  return (
    <svg viewBox="0 0 64 64" className="h-16 w-16 flex-none -rotate-90" aria-hidden="true">
      <circle cx="32" cy="32" r={radius} fill="none" strokeWidth="7" className="stroke-slate-800" />
      <circle
        cx="32"
        cy="32"
        r={radius}
        fill="none"
        strokeWidth="7"
        strokeLinecap="round"
        className="stroke-cyan-400"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - clamped / 100)}
      />
    </svg>
  )
}

export default function AssessmentAttemptDetailPage() {
  const { id, attemptId } = useParams()
  const searchParams = useAuthSearchParams()
  const [detail, setDetail] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(buildAuthUrl(`/api/assessments/${id}/results/${attemptId}`, searchParams), { credentials: "include" })
      .then((res) => res.json())
      .then((data) => setDetail(data?.data ?? null))
      .catch(() => setDetail(null))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, attemptId])

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 text-white">
        <Navbar />
        <div className="p-10 text-center text-slate-400">Loading attempt...</div>
      </div>
    )
  }

  if (!detail) {
    return (
      <div className="min-h-screen bg-slate-950 text-white">
        <Navbar />
        <div className="p-10 text-center text-slate-400">Attempt not found.</div>
      </div>
    )
  }

  const candidateName = detail.candidate?.fullName ?? "Candidate"
  const percentage = detail.attempt.percentage != null ? Number(detail.attempt.percentage) : null
  const resultLabel = detail.attempt.passed === true ? "Passed" : detail.attempt.passed === false ? "Failed" : "Pending"
  const resultTone =
    detail.attempt.passed === true ? "text-emerald-300" : detail.attempt.passed === false ? "text-rose-300" : "text-slate-300"

  return (
    <div className="hv-page-enter min-h-screen bg-slate-950 text-white">
      <Navbar />

      <main className="mx-auto max-w-[1100px] space-y-5 px-4 py-6 sm:px-6 lg:px-8 lg:py-7">
        <Link href={buildAuthUrl(`/assessments/${id}/results`, searchParams)} className="text-sm text-slate-400 hover:text-white">
          &larr; Back to Results
        </Link>

        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-11 w-11 flex-none items-center justify-center rounded-full bg-cyan-400/15 text-sm font-semibold text-cyan-200">
              {initialsOf(candidateName)}
            </span>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-300">Assessment result</p>
              <h1 className="truncate text-2xl font-semibold tracking-tight text-white">{candidateName}</h1>
              <p className="truncate text-sm text-slate-400">
                {detail.assessmentTitle} &middot; {detail.jobTitle ?? "-"}
              </p>
            </div>
          </div>
          <BackToDashboardLink className="inline-flex w-fit items-center justify-center gap-2 rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-300 transition hover:border-slate-500 hover:text-white" />
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1.2fr_1fr_1fr_1fr]">
          <div className="flex items-center gap-4 rounded-xl border border-slate-800 bg-slate-900/80 p-4 sm:col-span-2 lg:col-span-1">
            <ScoreRing value={percentage} />
            <div>
              <p className="text-xs text-slate-400">Score</p>
              <p className="mt-0.5 text-2xl font-semibold tabular-nums text-white">{percentage != null ? `${percentage}%` : "-"}</p>
            </div>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-4">
            <p className="text-xs text-slate-400">Result</p>
            <p className={`mt-1.5 text-2xl font-semibold ${resultTone}`}>{resultLabel}</p>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-4">
            <p className="text-xs text-slate-400">Integrity Risk</p>
            <span className={`mt-2 inline-flex rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.12em] ${riskTone(detail.riskLevel)}`}>
              {formatRiskLevel(detail.riskLevel)}
            </span>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-4">
            <p className="text-xs text-slate-400">Completed</p>
            <p className="mt-1.5 text-base font-semibold text-white">
              {detail.invite?.completedAt ? formatDateTime(detail.invite.completedAt) : "-"}
            </p>
          </div>
        </div>

        {detail.aiAssistanceRisk || detail.codeSimilarity ? (
          <div className="grid gap-3 lg:grid-cols-2">
            {detail.aiAssistanceRisk ? (
              <section className="rounded-xl border border-slate-800 bg-slate-900/80 p-4 sm:p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="text-sm font-semibold text-white">Potential AI Assistance</h2>
                  <span
                    className={`inline-flex rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.12em] ${aiAssistanceTone(detail.aiAssistanceRisk.level)}`}
                  >
                    {formatAiAssistanceLevel(detail.aiAssistanceRisk.level)}
                  </span>
                </div>
                {detail.aiAssistanceRisk.evidence?.length ? (
                  <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-slate-300">
                    {detail.aiAssistanceRisk.evidence.map((item, i) => (
                      <li key={i}>{item}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-3 text-sm text-slate-500">No supporting evidence detected.</p>
                )}
                <p className="mt-3 text-xs text-slate-500">
                  Heuristic signal for review only - not proof that a specific tool was used.
                </p>
              </section>
            ) : null}

            {detail.codeSimilarity ? (
              <section className="rounded-xl border border-slate-800 bg-slate-900/80 p-4 sm:p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="text-sm font-semibold text-white">Code Similarity / Potential Reuse</h2>
                  <span
                    className={`inline-flex rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.12em] ${codeSimilarityTone(detail.codeSimilarity.level)}`}
                  >
                    {formatCodeSimilarityLevel(detail.codeSimilarity.level)}
                  </span>
                </div>
                <p className="mt-3 text-sm text-slate-300">
                  Highest similarity to another candidate&apos;s submission for the same question: {Number(detail.codeSimilarity.score)}%
                </p>
                <p className="mt-3 text-xs text-slate-500">
                  Similarity is a review signal, not proof of copying - common algorithms or expected implementation
                  patterns can naturally produce similar code. See the flagged question below for detail.
                </p>
              </section>
            ) : null}
          </div>
        ) : null}

        <section>
          <div className="flex items-end justify-between gap-3">
            <h2 className="text-lg font-semibold text-white">Question Breakdown</h2>
            <p className="text-xs text-slate-500">{detail.questions.length} question{detail.questions.length === 1 ? "" : "s"}</p>
          </div>
          <div className="mt-3 space-y-3">
            {detail.questions.map((question, index) => {
              const isObjective = question.questionType === "SINGLE_CHOICE" || question.questionType === "MULTI_SELECT"
              const selected = Array.isArray(question.candidateAnswer?.selectedOptionIds)
                ? question.candidateAnswer.selectedOptionIds
                : []

              return (
                <article key={question.questionId} className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 sm:p-5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="flex h-7 min-w-7 items-center justify-center rounded-full bg-cyan-400/15 px-2 text-xs font-semibold text-cyan-200">
                        Q{index + 1}
                      </span>
                      {question.questionType ? (
                        <span className="rounded-full border border-slate-700 px-2 py-0.5 text-[11px] text-slate-400">
                          {QUESTION_TYPE_LABELS[question.questionType] ?? question.questionType}
                        </span>
                      ) : null}
                      <span className="text-xs text-slate-500">{question.points} pt(s)</span>
                    </div>
                    {question.evaluation ? (
                      <span className="rounded-lg border border-cyan-300/25 bg-cyan-400/10 px-2.5 py-1 text-xs font-semibold tabular-nums text-cyan-100">
                        {Number(question.evaluation.score ?? 0)} / {Number(question.evaluation.maxScore ?? question.points)}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-2.5 text-sm font-medium leading-6 text-white sm:text-base">{question.questionText}</p>

                  {isObjective ? (
                    <ul className="mt-3 space-y-1.5 text-sm">
                      {question.options.map((option) => {
                        const wasSelected = selected.includes(option.id)
                        return (
                          <li
                            key={option.id}
                            className={`flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 ${
                              option.isCorrect
                                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                                : wasSelected
                                  ? "border-rose-500/30 bg-rose-500/10 text-rose-200"
                                  : "border-slate-800 bg-slate-950/40 text-slate-400"
                            }`}
                          >
                            <span aria-hidden="true" className="w-4 flex-none text-center font-semibold">
                              {option.isCorrect ? "✓" : wasSelected ? "✗" : ""}
                            </span>
                            <span className="min-w-0 flex-1">{option.optionText}</span>
                            {option.isCorrect ? (
                              <span className="rounded-full border border-emerald-400/30 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em]">
                                Correct
                              </span>
                            ) : null}
                            {wasSelected ? (
                              <span className="rounded-full border border-current/30 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em]">
                                Candidate&apos;s answer
                              </span>
                            ) : null}
                          </li>
                        )
                      })}
                    </ul>
                  ) : (
                    <div className="mt-3 space-y-2.5">
                      {question.questionType === "CODING" ? (
                        <>
                          {question.codeSimilarity ? (
                            <div
                              className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] ${codeSimilarityTone(question.codeSimilarity.level)}`}
                            >
                              <span>Code Similarity: {formatCodeSimilarityLevel(question.codeSimilarity.level)}</span>
                              <span>{Number(question.codeSimilarity.score)}% match</span>
                            </div>
                          ) : null}
                          <div className="overflow-hidden rounded-lg border border-slate-800 bg-slate-950/60">
                            <p className="border-b border-slate-800 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                              Candidate Code
                            </p>
                            <pre className="overflow-x-auto p-3 text-xs text-slate-300">
                              <code>{question.candidateAnswer?.code ?? "No code submitted"}</code>
                            </pre>
                          </div>
                        </>
                      ) : (
                        <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3.5 text-sm text-slate-300">
                          <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Candidate Answer</p>
                          <p className="whitespace-pre-wrap leading-6">{question.candidateAnswer?.text ?? "No answer submitted"}</p>
                        </div>
                      )}
                      {question.evaluation?.feedback ? (
                        <div className="rounded-lg border border-cyan-300/20 bg-cyan-400/[0.06] p-3.5 text-sm text-slate-200">
                          <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-cyan-300">AI Feedback</p>
                          <p className="leading-6">{question.evaluation.feedback}</p>
                        </div>
                      ) : null}
                      {question.rubric?.criteria?.length ? (
                        <div className="rounded-lg border border-slate-800 bg-slate-950/30 p-3.5 text-xs text-slate-400">
                          <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Grading Criteria</p>
                          <ul className="list-disc space-y-1 pl-5">
                            {question.rubric.criteria.map((c, i) => (
                              <li key={i}>{c}</li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                    </div>
                  )}
                </article>
              )
            })}
          </div>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-white">Integrity Signal Timeline</h2>
          {detail.signals.length === 0 ? (
            <p className="mt-3 rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-3 text-sm text-slate-500">
              No integrity signals recorded for this attempt.
            </p>
          ) : (
            <ol className="mt-3 space-y-0 border-l border-slate-800 pl-5">
              {detail.signals.map((signal) => {
                const detailText = formatSignalValue(signal.value)
                return (
                  <li key={signal.id} className="relative pb-3 last:pb-0">
                    <span aria-hidden="true" className="absolute -left-[1.6rem] top-3 h-2.5 w-2.5 rounded-full border-2 border-slate-950 bg-amber-300" />
                    <div className="rounded-lg border border-slate-800 bg-slate-900/60 px-4 py-2.5 text-sm text-slate-300">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium text-white">{formatSignalType(signal.type)}</span>
                        <span className="text-xs text-slate-500">{formatDateTime(signal.createdAt)}</span>
                      </div>
                      {detailText ? <p className="mt-1 text-xs text-slate-500">{detailText}</p> : null}
                    </div>
                  </li>
                )
              })}
            </ol>
          )}
        </section>
      </main>
    </div>
  )
}
