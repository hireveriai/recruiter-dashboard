"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { useParams } from "next/navigation"
import { useAuthSearchParams } from "@/lib/client/use-auth-search-params"

import BackToDashboardLink from "@/components/BackToDashboardLink"
import Navbar from "@/components/Navbar"
import { buildAuthUrl } from "@/lib/client/auth-query"
import { showActionFeedback } from "@/lib/client/action-feedback"

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

  return (
    <div className="hv-page-enter min-h-screen bg-slate-950 text-white">
      <Navbar />

      <main className="mx-auto max-w-[1000px] px-4 py-7 sm:px-6 lg:px-8">
        <Link href={buildAuthUrl(`/assessments/${id}/results`, searchParams)} className="text-sm text-slate-400 hover:text-white">
          &larr; Back to Results
        </Link>

        <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.34em] text-violet-300/75">Manager Review</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">{participant?.fullName ?? "Employee"}</h1>
            <p className="mt-1 text-sm text-slate-400">
              {detail.assessmentTitle} &middot; {detail.activityType}
            </p>
          </div>
          <BackToDashboardLink className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-300 transition hover:border-slate-500 hover:text-white" />
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          <div className="rounded-2xl border border-slate-800 bg-slate-950/35 p-5">
            <p className="text-sm text-slate-500">AI Overall Score</p>
            <p className="mt-2 text-2xl font-semibold text-white">
              {detail.attempt.percentage != null ? `${Number(detail.attempt.percentage)}%` : "Pending"}
            </p>
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-950/35 p-5">
            <p className="text-sm text-slate-500">Status</p>
            <p className="mt-2 text-2xl font-semibold text-white">{detail.attempt.status}</p>
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-950/35 p-5">
            <p className="text-sm text-slate-500">Result</p>
            <p className="mt-2 text-2xl font-semibold text-white">
              {detail.activityType === "ASSESSMENT"
                ? detail.attempt.passed === true
                  ? "Passed"
                  : detail.attempt.passed === false
                    ? "Failed"
                    : "Pending"
                : "N/A"}
            </p>
          </div>
        </div>

        <h2 className="mt-8 text-lg font-semibold text-white">Submission &amp; Review</h2>
        <div className="mt-3 space-y-5">
          {detail.questions.map((question, index) => {
            const draft = drafts[question.answerId] ?? { score: "", feedback: "" }
            return (
              <div key={question.questionId} className="rounded-[20px] border border-slate-800 bg-slate-900/40 p-5">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-300">Q{index + 1}</p>
                <p className="mt-2 text-base text-white">{question.questionText}</p>

                <div className="mt-3 rounded-xl border border-slate-800 bg-slate-950/40 p-3 text-sm text-slate-300">
                  <p className="mb-1 text-xs uppercase tracking-[0.18em] text-slate-500">Submission</p>
                  <p className="whitespace-pre-wrap">
                    {question.candidateAnswer?.text ?? question.candidateAnswer?.code ?? "No submission"}
                  </p>
                </div>

                {question.evaluation ? (
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <div className="rounded-xl border border-violet-500/20 bg-violet-500/10 p-3 text-sm text-violet-100">
                      <p className="mb-1 text-xs uppercase tracking-[0.18em] text-violet-300">
                        AI Evaluation &middot; {Number(question.evaluation.score ?? 0)} / {Number(question.evaluation.maxScore ?? question.points)}
                      </p>
                      <p>{question.evaluation.feedback || "No AI feedback."}</p>
                    </div>
                    <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-100">
                      <p className="mb-1 text-xs uppercase tracking-[0.18em] text-emerald-300">Manager Evaluation</p>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          min={0}
                          max={Number(question.evaluation.maxScore ?? question.points)}
                          value={draft.score}
                          onChange={(e) =>
                            setDrafts((d) => ({ ...d, [question.answerId]: { ...draft, score: e.target.value } }))
                          }
                          className="w-24 rounded-lg border border-slate-700 bg-slate-950/70 px-2 py-1 text-sm text-white outline-none focus:border-emerald-400/60"
                        />
                        <span className="text-xs text-emerald-200/80">/ {Number(question.evaluation.maxScore ?? question.points)}</span>
                      </div>
                      <textarea
                        value={draft.feedback}
                        onChange={(e) =>
                          setDrafts((d) => ({ ...d, [question.answerId]: { ...draft, feedback: e.target.value } }))
                        }
                        placeholder="Manager feedback"
                        rows={2}
                        className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950/70 px-2 py-1.5 text-sm text-white outline-none placeholder:text-slate-500 focus:border-emerald-400/60"
                      />
                      <button
                        onClick={() => submitReview(question.answerId)}
                        disabled={savingId === question.answerId}
                        className="mt-2 rounded-full bg-emerald-500/90 px-3.5 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {savingId === question.answerId ? "Saving..." : question.evaluation.evaluatorType === "MANAGER" ? "Update Review" : "Save Review"}
                      </button>
                      {question.evaluation.managerEvaluatedAt ? (
                        <p className="mt-2 text-[11px] text-emerald-200/70">Last reviewed {new Date(question.evaluation.managerEvaluatedAt).toLocaleString()}</p>
                      ) : null}
                    </div>
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-slate-500">Not yet evaluated.</p>
                )}
              </div>
            )
          })}
        </div>
      </main>
    </div>
  )
}
