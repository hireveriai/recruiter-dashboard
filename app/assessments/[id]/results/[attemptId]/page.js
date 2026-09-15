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

  return (
    <div className="hv-page-enter min-h-screen bg-slate-950 text-white">
      <Navbar />

      <main className="mx-auto max-w-[1100px] px-4 py-7 sm:px-6 lg:px-8">
        <Link href={buildAuthUrl(`/assessments/${id}/results`, searchParams)} className="text-sm text-slate-400 hover:text-white">
          &larr; Back to Results
        </Link>

        <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-white">{detail.candidate?.fullName ?? "Candidate"}</h1>
            <p className="mt-1 text-sm text-slate-400">
              {detail.assessmentTitle} &middot; {detail.jobTitle ?? "-"}
            </p>
          </div>
          <BackToDashboardLink className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-300 transition hover:border-slate-500 hover:text-white" />
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-2xl border border-slate-800 bg-slate-950/35 p-5">
            <p className="text-sm text-slate-500">Score</p>
            <p className="mt-2 text-2xl font-semibold text-white">
              {detail.attempt.percentage != null ? `${Number(detail.attempt.percentage)}%` : "-"}
            </p>
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-950/35 p-5">
            <p className="text-sm text-slate-500">Result</p>
            <p className="mt-2 text-2xl font-semibold text-white">
              {detail.attempt.passed === true ? "Passed" : detail.attempt.passed === false ? "Failed" : "Pending"}
            </p>
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-950/35 p-5">
            <p className="text-sm text-slate-500">Integrity Risk</p>
            <span className={`mt-2 inline-flex rounded-full border px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] ${riskTone(detail.riskLevel)}`}>
              {formatRiskLevel(detail.riskLevel)}
            </span>
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-950/35 p-5">
            <p className="text-sm text-slate-500">Completed</p>
            <p className="mt-2 text-lg font-semibold text-white">
              {detail.invite?.completedAt ? formatDateTime(detail.invite.completedAt) : "-"}
            </p>
          </div>
        </div>

        <h2 className="mt-8 text-lg font-semibold text-white">Question Breakdown</h2>
        <div className="mt-3 space-y-4">
          {detail.questions.map((question, index) => {
            const isObjective = question.questionType === "SINGLE_CHOICE" || question.questionType === "MULTI_SELECT"
            const selected = Array.isArray(question.candidateAnswer?.optionIds)
              ? question.candidateAnswer.optionIds
              : []

            return (
              <div key={question.questionId} className="rounded-[20px] border border-slate-800 bg-slate-900/40 p-5">
                <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-[0.18em] text-violet-300">
                  <span>Q{index + 1} &middot; {question.points} pt(s)</span>
                  {question.evaluation ? <span className="text-slate-400">{Number(question.evaluation.score ?? 0)} / {Number(question.evaluation.maxScore ?? question.points)}</span> : null}
                </div>
                <p className="mt-2 text-base text-white">{question.questionText}</p>

                {isObjective ? (
                  <ul className="mt-3 space-y-1.5 text-sm">
                    {question.options.map((option) => {
                      const wasSelected = selected.includes(option.id)
                      return (
                        <li
                          key={option.id}
                          className={`rounded-lg border px-3 py-2 ${
                            option.isCorrect
                              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                              : wasSelected
                                ? "border-rose-500/30 bg-rose-500/10 text-rose-200"
                                : "border-slate-800 bg-slate-950/40 text-slate-400"
                          }`}
                        >
                          {option.optionText}
                          {option.isCorrect ? " (correct)" : ""}
                          {wasSelected ? " - candidate's answer" : ""}
                        </li>
                      )
                    })}
                  </ul>
                ) : (
                  <div className="mt-3 space-y-2">
                    <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3 text-sm text-slate-300">
                      <p className="mb-1 text-xs uppercase tracking-[0.18em] text-slate-500">Candidate Answer</p>
                      <p>{question.candidateAnswer?.text ?? "No answer submitted"}</p>
                    </div>
                    {question.evaluation?.feedback ? (
                      <div className="rounded-xl border border-violet-500/20 bg-violet-500/10 p-3 text-sm text-violet-100">
                        <p className="mb-1 text-xs uppercase tracking-[0.18em] text-violet-300">AI Feedback</p>
                        <p>{question.evaluation.feedback}</p>
                      </div>
                    ) : null}
                    {question.rubric?.criteria?.length ? (
                      <div className="rounded-xl border border-slate-800 bg-slate-950/30 p-3 text-xs text-slate-500">
                        <p className="mb-1 uppercase tracking-[0.18em]">Grading Criteria</p>
                        <ul className="list-disc space-y-1 pl-5">
                          {question.rubric.criteria.map((c, i) => (
                            <li key={i}>{c}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        <h2 className="mt-8 text-lg font-semibold text-white">Integrity Signal Timeline</h2>
        <div className="mt-3 space-y-2">
          {detail.signals.length === 0 ? (
            <p className="text-sm text-slate-500">No integrity signals recorded for this attempt.</p>
          ) : (
            detail.signals.map((signal) => (
              <div key={signal.id} className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950/35 px-4 py-2.5 text-sm text-slate-300">
                <span>{signal.type}</span>
                <span className="text-xs text-slate-500">{formatDateTime(signal.createdAt)}</span>
              </div>
            ))
          )}
        </div>
      </main>
    </div>
  )
}
