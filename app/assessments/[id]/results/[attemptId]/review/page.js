"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { useParams } from "next/navigation"
import { useAuthSearchParams } from "@/lib/client/use-auth-search-params"

import BackToDashboardLink from "@/components/BackToDashboardLink"
import Navbar from "@/components/Navbar"
import { buildAuthUrl } from "@/lib/client/auth-query"
import { showActionFeedback } from "@/lib/client/action-feedback"

// The review API accepts a manager score from 0 to 1000
// (manageReviewSchema); a score above the question's own maximum is allowed
// by the API but flagged here so it is a deliberate choice.
const MAX_REVIEW_SCORE = 1000

function reviewScoreProblem(value) {
  if (value === "" || value === null || value === undefined) return null
  const score = Number(value)
  if (!Number.isFinite(score)) return "Enter a number."
  if (score < 0) return "The score can't be negative."
  if (score > MAX_REVIEW_SCORE) return `The score can't be above ${MAX_REVIEW_SCORE}.`
  return null
}

function initialsOf(name) {
  const parts = String(name ?? "").trim().split(/\s+/).filter(Boolean)
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "VN"
}

/**
 * Manager / HR review screen for one Employee Assessment/Challenge/Task
 * attempt. Shows the AI evaluation for each answer next to an editable
 * manager score/feedback — submitting never overwrites the AI evaluation,
 * it's stored separately (see POST .../evaluations/[answerId]/review).
 */
export default function ManagerReviewPage() {
  const { id, attemptId } = useParams()
  const searchParams = useAuthSearchParams()
  const [detail, setDetail] = useState(null)
  const [loading, setLoading] = useState(true)
  const [drafts, setDrafts] = useState({})
  const [savingId, setSavingId] = useState(null)

  const load = () => {
    setLoading(true)
    fetch(buildAuthUrl(`/api/assessments/${id}/results/${attemptId}`, searchParams), { credentials: "include" })
      .then((res) => res.json())
      .then((data) => {
        const value = data?.data ?? null
        setDetail(value)
        const nextDrafts = {}
        for (const question of value?.questions ?? []) {
          if (!question.answerId) continue
          nextDrafts[question.answerId] = {
            score: question.evaluation?.managerScore ?? question.evaluation?.score ?? "",
            feedback: question.evaluation?.managerFeedback ?? "",
          }
        }
        setDrafts(nextDrafts)
      })
      .catch(() => setDetail(null))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, attemptId])

  const submitReview = async (answerId) => {
    const draft = drafts[answerId]
    if (!draft || draft.score === "") {
      showActionFeedback({ tone: "error", title: "Score required", message: "Enter a manager score before saving." })
      return
    }
    const problem = reviewScoreProblem(draft.score)
    if (problem) {
      showActionFeedback({ tone: "error", title: "Check the score", message: problem })
      return
    }
    try {
      setSavingId(answerId)
      const res = await fetch(
        buildAuthUrl(`/api/assessments/${id}/results/${attemptId}/evaluations/${answerId}/review`, searchParams),
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ score: Number(draft.score), feedback: draft.feedback || null }),
        },
      )
      const data = await res.json()
      if (!res.ok) {
        showActionFeedback({ tone: "error", title: "Save failed", message: data?.error?.message || "Failed to save review" })
        return
      }
      showActionFeedback({ tone: "success", title: "Review saved" })
      load()
    } catch (err) {
      showActionFeedback({ tone: "error", title: "Save failed", message: err instanceof Error ? err.message : "Something went wrong" })
    } finally {
      setSavingId(null)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 text-white">
        <Navbar />
        <div className="p-10 text-center text-slate-400">Loading...</div>
      </div>
    )
  }

  if (!detail) {
    return (
      <div className="min-h-screen bg-slate-950 text-white">
        <Navbar />
        <div className="p-10 text-center text-slate-400">Attempt not found, or you don&apos;t have access to review it.</div>
      </div>
    )
  }

  const participant = detail.employee ?? detail.candidate
  const participantName = participant?.fullName ?? "Employee"
  const resultLabel =
    detail.activityType === "ASSESSMENT"
      ? detail.attempt.passed === true
        ? "Passed"
        : detail.attempt.passed === false
          ? "Failed"
          : "Pending"
      : "N/A"
  const reviewable = detail.questions.filter(
    (question) =>
      question.questionType !== "SINGLE_CHOICE" && question.questionType !== "MULTI_SELECT" && question.evaluation
  )
  const reviewedCount = reviewable.filter((question) => question.evaluation?.managerEvaluatedAt).length

  return (
    <div className="hv-page-enter min-h-screen bg-slate-950 text-white">
      <Navbar />

      <main className="mx-auto max-w-[1000px] space-y-5 px-4 py-6 sm:px-6 lg:px-8 lg:py-7">
        <Link href={buildAuthUrl(`/assessments/${id}/results`, searchParams)} className="text-sm text-slate-400 hover:text-white">
          &larr; Back to Results
        </Link>

        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-11 w-11 flex-none items-center justify-center rounded-full bg-cyan-400/15 text-sm font-semibold text-cyan-200">
              {initialsOf(participantName)}
            </span>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-300">Manager Review</p>
              <h1 className="truncate text-2xl font-semibold tracking-tight text-white">{participantName}</h1>
              <p className="truncate text-sm text-slate-400">
                {detail.assessmentTitle} &middot; {detail.activityType}
              </p>
            </div>
          </div>
          <BackToDashboardLink className="inline-flex w-fit items-center justify-center gap-2 rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-300 transition hover:border-slate-500 hover:text-white" />
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-4">
            <p className="text-xs text-slate-400">AI Overall Score</p>
            <p className="mt-1.5 text-2xl font-semibold tabular-nums text-white">
              {detail.attempt.percentage != null ? `${Number(detail.attempt.percentage)}%` : "Pending"}
            </p>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-4">
            <p className="text-xs text-slate-400">Status</p>
            <p className="mt-1.5 text-lg font-semibold text-white">{detail.attempt.status}</p>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-4">
            <p className="text-xs text-slate-400">Result</p>
            <p className="mt-1.5 text-lg font-semibold text-white">{resultLabel}</p>
          </div>
          <div className="rounded-xl border border-cyan-300/25 bg-cyan-400/[0.06] p-4">
            <p className="text-xs text-slate-400">Reviewed</p>
            <p className="mt-1.5 text-2xl font-semibold tabular-nums text-cyan-100">
              {reviewedCount}
              <span className="text-base text-slate-400"> / {reviewable.length}</span>
            </p>
          </div>
        </div>

        <section>
          <h2 className="text-lg font-semibold text-white">Submission &amp; Review</h2>
          <div className="mt-3 space-y-3">
            {detail.questions.map((question, index) => {
              const draft = drafts[question.answerId] ?? { score: "", feedback: "" }
              const isObjective = question.questionType === "SINGLE_CHOICE" || question.questionType === "MULTI_SELECT"
              const selectedOptionIds = Array.isArray(question.candidateAnswer?.selectedOptionIds)
                ? question.candidateAnswer.selectedOptionIds
                : []
              const maxScore = question.evaluation ? Number(question.evaluation.maxScore ?? question.points) : null
              const scoreProblem = reviewScoreProblem(draft.score)
              const aboveMax = !scoreProblem && maxScore !== null && draft.score !== "" && Number(draft.score) > maxScore

              return (
                <article key={question.questionId} className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 sm:p-5">
                  <div className="flex items-center gap-2">
                    <span className="flex h-7 min-w-7 items-center justify-center rounded-full bg-cyan-400/15 px-2 text-xs font-semibold text-cyan-200">
                      Q{index + 1}
                    </span>
                    {question.evaluation?.managerEvaluatedAt ? (
                      <span className="rounded-full border border-emerald-400/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-emerald-300">
                        Reviewed
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-2.5 text-sm font-medium leading-6 text-white sm:text-base">{question.questionText}</p>

                  {isObjective ? (
                    // SINGLE_CHOICE/MULTI_SELECT are auto-scored by exact option
                    // match, never AI- or manager-evaluated (no evaluation row
                    // is ever created for them - see assessment/lib/server/
                    // scoring.ts's OBJECTIVE_TYPES/DEFERRED_TYPES split), so
                    // this shows the employee's selection against the correct
                    // answer(s) directly instead of a Submission/Evaluation panel.
                    <ul className="mt-3 space-y-1.5 text-sm">
                      {question.options.map((option) => {
                        const wasSelected = selectedOptionIds.includes(option.id)
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
                                Employee&apos;s answer
                              </span>
                            ) : null}
                          </li>
                        )
                      })}
                    </ul>
                  ) : (
                    <div className="mt-3 rounded-lg border border-slate-800 bg-slate-950/40 p-3.5 text-sm text-slate-300">
                      <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Submission</p>
                      <p className="whitespace-pre-wrap leading-6">
                        {question.candidateAnswer?.text ?? question.candidateAnswer?.code ?? "No submission"}
                      </p>
                    </div>
                  )}

                  {!isObjective && question.evaluation ? (
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <div className="rounded-lg border border-cyan-300/20 bg-cyan-400/[0.06] p-3.5 text-sm text-slate-200">
                        <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-cyan-300">
                          AI Evaluation &middot; {Number(question.evaluation.score ?? 0)} / {Number(question.evaluation.maxScore ?? question.points)}
                        </p>
                        <p className="leading-6">{question.evaluation.feedback || "No AI feedback."}</p>
                      </div>
                      <div className="rounded-lg border border-emerald-400/20 bg-emerald-500/[0.06] p-3.5 text-sm text-slate-200">
                        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-300">Manager Evaluation</p>
                        <div className="flex items-center gap-2">
                          <label className="sr-only" htmlFor={`manager-score-${question.answerId}`}>
                            Manager score for question {index + 1}
                          </label>
                          <input
                            id={`manager-score-${question.answerId}`}
                            type="number"
                            min={0}
                            max={Number(question.evaluation.maxScore ?? question.points)}
                            value={draft.score}
                            onChange={(e) =>
                              setDrafts((d) => ({ ...d, [question.answerId]: { ...draft, score: e.target.value } }))
                            }
                            aria-invalid={Boolean(scoreProblem)}
                            className={`w-24 rounded-lg border bg-slate-950/70 px-2.5 py-1.5 text-sm text-white outline-none focus:border-cyan-300/70 ${
                              scoreProblem ? "border-rose-400/70" : "border-slate-700"
                            }`}
                          />
                          <span className="text-xs text-slate-400">/ {Number(question.evaluation.maxScore ?? question.points)}</span>
                        </div>
                        {scoreProblem ? (
                          <p className="mt-1.5 text-xs text-rose-300">{scoreProblem}</p>
                        ) : aboveMax ? (
                          <p className="mt-1.5 text-xs text-amber-300">Above this question&apos;s maximum of {maxScore}.</p>
                        ) : null}
                        <label className="sr-only" htmlFor={`manager-feedback-${question.answerId}`}>
                          Manager feedback for question {index + 1}
                        </label>
                        <textarea
                          id={`manager-feedback-${question.answerId}`}
                          value={draft.feedback}
                          onChange={(e) =>
                            setDrafts((d) => ({ ...d, [question.answerId]: { ...draft, feedback: e.target.value } }))
                          }
                          placeholder="Manager feedback"
                          rows={2}
                          className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950/70 px-2.5 py-1.5 text-sm text-white outline-none placeholder:text-slate-500 focus:border-cyan-300/70"
                        />
                        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                          <button
                            type="button"
                            onClick={() => submitReview(question.answerId)}
                            disabled={savingId === question.answerId}
                            className="hv-solid-action rounded-lg bg-cyan-600 px-3.5 py-1.5 text-xs font-semibold text-white transition hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {savingId === question.answerId ? "Saving..." : question.evaluation.evaluatorType === "MANAGER" ? "Update Review" : "Save Review"}
                          </button>
                          {question.evaluation.managerEvaluatedAt ? (
                            <p className="text-[11px] text-slate-400">Last reviewed {new Date(question.evaluation.managerEvaluatedAt).toLocaleString()}</p>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  ) : !isObjective ? (
                    <p className="mt-3 text-sm text-slate-500">Not yet evaluated.</p>
                  ) : null}
                </article>
              )
            })}
          </div>
        </section>
      </main>
    </div>
  )
}
