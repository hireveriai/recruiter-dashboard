"use client"

import { useEffect, useMemo, useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { BrainCircuit, Check, FileText, ShieldCheck, Sparkles, X } from "lucide-react"

import { buildAuthUrl } from "@/lib/client/auth-query"
import { formatDateTime } from "@/lib/client/date-format"
import { DecisionPill } from "@/components/dashboard/DecisionPill"
import { DecisionSelector, type RecruiterDecisionStatus } from "@/components/dashboard/DecisionSelector"

type CandidateReviewItem = {
  candidateId?: string | null
  interviewId?: string | null
  attemptId?: string | null
  candidateName?: string | null
  jobTitle?: string | null
  status?: string | null
  score?: number | null
  decision?: string | null
  recruiterDecisionStatus?: string | null
  recruiterDecisionNotes?: string | null
  aiSummary?: string | null
  aiSummaryFull?: string | null
  endedAt?: string | Date | null
  createdAt?: string | Date | null
  answerSummaries?: Array<{
    fraudScore?: number | null
    confidenceScore?: number | null
    clarityScore?: number | null
    depthScore?: number | null
    feedback?: string | null
    evaluation?: unknown
  }>
}

type CandidateActionModalProps = {
  candidate: CandidateReviewItem | null
  isOpen: boolean
  searchParams: URLSearchParams
  onClose: () => void
  onDecisionSaved: (decision: {
    status: RecruiterDecisionStatus
    decidedAt?: string | Date | null
    notes?: string | null
  }) => void
}

function normalizeDecision(status?: string | null): RecruiterDecisionStatus {
  const normalized = String(status ?? "").trim().toUpperCase()
  if (normalized === "PROCEED" || normalized === "HOLD" || normalized === "REJECT") {
    return normalized
  }

  return "REVIEW_REQUIRED"
}

function formatStatusLabel(status?: string | null) {
  return String(status ?? "PENDING")
    .toLowerCase()
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

function formatScore(score?: number | null) {
  return score === null || score === undefined || !Number.isFinite(Number(score)) ? "-" : `${Math.round(Number(score))}%`
}

function getSummary(candidate: CandidateReviewItem | null) {
  return (
    candidate?.aiSummaryFull ||
    candidate?.aiSummary ||
    "No VERIS narrative has been recorded yet. Review score, recommendation, and transcript evidence before finalizing the hiring workflow."
  )
}

function getRiskLevel(candidate: CandidateReviewItem | null) {
  const answerSummaries = Array.isArray(candidate?.answerSummaries) ? candidate.answerSummaries : []
  const fraudScores = answerSummaries
    .map((answer) => Number(answer.fraudScore))
    .filter((score) => Number.isFinite(score))
  const maxFraud = fraudScores.length > 0 ? Math.max(...fraudScores) : 0
  const decision = String(candidate?.decision ?? "").toUpperCase()
  const score = Number(candidate?.score)

  if (decision === "FLAGGED" || maxFraud >= 70) return "High"
  if (decision === "REVIEW" || maxFraud >= 40 || (Number.isFinite(score) && score < 60)) return "Moderate"
  return "Low"
}

function getCompletionStatus(candidate: CandidateReviewItem | null) {
  if (candidate?.endedAt) return `Completed ${formatDateTime(candidate.endedAt)}`
  if (String(candidate?.status ?? "").toUpperCase() === "COMPLETED") return "Completed"
  return "Completion pending"
}

function insightCards(candidate: CandidateReviewItem | null) {
  const answerSummaries = Array.isArray(candidate?.answerSummaries) ? candidate.answerSummaries : []
  const metricAverage = (key: "clarityScore" | "confidenceScore" | "depthScore") => {
    const scores = answerSummaries.map((answer) => Number(answer[key])).filter((score) => Number.isFinite(score))
    if (scores.length === 0) return null
    return Math.round(scores.reduce((total, score) => total + score, 0) / scores.length)
  }
  const clarity = metricAverage("clarityScore")
  const confidence = metricAverage("confidenceScore")
  const depth = metricAverage("depthScore")
  const risk = getRiskLevel(candidate)

  return [
    {
      title: "Communication clarity",
      value: clarity === null ? "Evidence review" : `${clarity}%`,
      body: clarity === null ? "Use transcript and summary signals for clarity assessment." : "VERIS detected structured answer clarity across recorded responses.",
    },
    {
      title: "Technical confidence",
      value: confidence === null ? formatScore(candidate?.score) : `${confidence}%`,
      body: depth === null ? "Score and recommendation provide the current confidence baseline." : `Depth signal averaged ${depth}% across evaluated answers.`,
    },
    {
      title: "Integrity observations",
      value: risk,
      body: risk === "High" ? "Review risk signals before advancing." : "No severe integrity escalation is visible from available scoring signals.",
    },
  ]
}

export function CandidateActionModal({
  candidate,
  isOpen,
  searchParams,
  onClose,
  onDecisionSaved,
}: CandidateActionModalProps) {
  return (
    <AnimatePresence>
      {isOpen && candidate ? (
        <CandidateActionDialog
          key={`${candidate.candidateId ?? "candidate"}:${candidate.interviewId ?? "interview"}`}
          candidate={candidate}
          searchParams={searchParams}
          onClose={onClose}
          onDecisionSaved={onDecisionSaved}
        />
      ) : null}
    </AnimatePresence>
  )
}

function CandidateActionDialog({
  candidate,
  searchParams,
  onClose,
  onDecisionSaved,
}: Omit<CandidateActionModalProps, "isOpen"> & { candidate: CandidateReviewItem }) {
  const [decision, setDecision] = useState<RecruiterDecisionStatus>(() => normalizeDecision(candidate.recruiterDecisionStatus))
  const [notes, setNotes] = useState(() => candidate.recruiterDecisionNotes ?? "")
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState("")
  const [saved, setSaved] = useState(false)
  const cards = useMemo(() => insightCards(candidate), [candidate])

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !isSaving) {
        onClose()
      }
    }

    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [isSaving, onClose])

  async function saveDecision() {
    if (!candidate.candidateId || isSaving) return

    setIsSaving(true)
    setError("")

    try {
      const response = await fetch(buildAuthUrl("/api/recruiter-decisions", searchParams), {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidateId: candidate.candidateId,
          interviewId: candidate.interviewId ?? null,
          attemptId: candidate.attemptId ?? null,
          status: decision,
          notes: notes.trim() || null,
        }),
      })
      const payload = await response.json().catch(() => null)

      if (!response.ok || !payload?.success) {
        throw new Error(payload?.error?.message || payload?.message || "Unable to save recruiter decision")
      }

      setSaved(true)
      onDecisionSaved(payload.data)
      window.setTimeout(onClose, 350)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save recruiter decision")
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <motion.div
      className="hv-theme-dialog-backdrop fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/78 px-4 py-6 backdrop-blur-xl"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="candidate-review-title"
    >
      <motion.div
        className="hv-candidate-review-modal hv-theme-modal relative max-h-[92vh] w-full max-w-5xl overflow-hidden rounded-[28px] border border-cyan-300/15 bg-[linear-gradient(180deg,rgba(15,23,42,0.96),rgba(5,12,24,0.98))] shadow-[0_30px_120px_rgba(8,145,178,0.16)]"
        initial={{ opacity: 0, y: 18, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 14, scale: 0.98 }}
        transition={{ duration: 0.18 }}
      >
        <div className="absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-cyan-300/70 to-transparent" />
        <div className="hv-candidate-review-header flex items-start justify-between gap-4 border-b border-white/10 px-6 py-5 sm:px-8">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-200/70">Hiring workflow</p>
            <h2 id="candidate-review-title" className="mt-2 text-2xl font-semibold tracking-tight text-white">
              Candidate Review
            </h2>
            <p className="mt-2 text-sm text-slate-400">Review interview outcome and finalize hiring workflow.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-700 bg-slate-950/50 text-slate-300 transition hover:border-slate-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Close candidate review"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="max-h-[calc(92vh-88px)] overflow-y-auto px-6 py-6 sm:px-8">
          <section className="grid gap-3 lg:grid-cols-6">
            {[
              ["Candidate", candidate.candidateName || "Candidate"],
              ["Applied role", candidate.jobTitle || "-"],
              ["Interview status", formatStatusLabel(candidate.status)],
              ["VERIS recommendation", candidate.decision || "Review Required"],
              ["Risk level", getRiskLevel(candidate)],
              ["Completion", getCompletionStatus(candidate)],
            ].map(([label, value]) => (
              <div key={label} className="hv-candidate-review-meta rounded-2xl border border-slate-800/90 bg-white/[0.035] p-4 lg:col-span-2">
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">{label}</p>
                <p className="mt-2 truncate text-sm font-semibold text-slate-100">{value}</p>
              </div>
            ))}
          </section>

          <section className="hv-candidate-review-section mt-5 rounded-2xl border border-slate-800/90 bg-slate-950/35 p-5">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-cyan-300/15 bg-cyan-400/10 text-cyan-100">
                <BrainCircuit className="h-4 w-4" aria-hidden="true" />
              </span>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">VERIS Insight</p>
                <h3 className="mt-1 text-base font-semibold text-white">AI-assisted outcome summary</h3>
              </div>
            </div>
            <p className="mt-4 whitespace-pre-wrap text-sm leading-7 text-slate-300">{getSummary(candidate)}</p>
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              {cards.map((card) => (
                <div key={card.title} className="hv-candidate-review-insight-card rounded-2xl border border-slate-800 bg-[#07111f]/80 p-4">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">{card.title}</p>
                  <p className="mt-2 text-lg font-semibold text-white">{card.value}</p>
                  <p className="mt-2 text-xs leading-5 text-slate-400">{card.body}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="hv-candidate-review-section mt-5 rounded-2xl border border-slate-800/90 bg-slate-950/30 p-5">
            <div className="mb-4 flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Recruiter decision</p>
                <h3 className="mt-1 text-base font-semibold text-white">Finalize hiring action</h3>
              </div>
              <DecisionPill status={decision} />
            </div>
            <DecisionSelector value={decision} onChange={setDecision} disabled={isSaving} />
          </section>

          <section className="hv-candidate-review-section mt-5 rounded-2xl border border-slate-800/90 bg-slate-950/30 p-5">
            <div className="flex items-center gap-3">
              <FileText className="h-4 w-4 text-slate-400" aria-hidden="true" />
              <label htmlFor="candidate-review-notes" className="text-sm font-semibold text-white">
                Internal notes
              </label>
            </div>
            <textarea
              id="candidate-review-notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              disabled={isSaving}
              placeholder="Add recruiter notes... Example: validate salary range, align with hiring manager, or request one more technical review."
              className="hv-candidate-review-notes mt-3 min-h-28 w-full resize-y rounded-2xl border border-slate-700 bg-[#07111f]/90 px-4 py-3 text-sm leading-6 text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-cyan-300/50 focus:ring-2 focus:ring-cyan-300/10 disabled:cursor-not-allowed disabled:opacity-60"
            />
          </section>

          {error ? (
            <div className="mt-5 rounded-2xl border border-rose-300/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
              {error}
            </div>
          ) : null}

          <div className="mt-6 flex flex-col-reverse gap-3 border-t border-white/10 pt-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-h-6 text-sm text-slate-400">
              {saved ? (
                <span className="inline-flex items-center gap-2 text-emerald-200">
                  <Check className="h-4 w-4" aria-hidden="true" />
                  Decision saved
                </span>
              ) : (
                <span className="inline-flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-cyan-200/80" aria-hidden="true" />
                  Table will update after save.
                </span>
              )}
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={onClose}
                disabled={isSaving}
                className="inline-flex h-11 items-center justify-center rounded-xl border border-slate-700 px-5 text-sm font-semibold text-slate-300 transition hover:border-slate-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveDecision}
                disabled={isSaving}
                className="inline-flex h-11 items-center justify-center rounded-xl border border-cyan-300/25 bg-cyan-400/15 px-5 text-sm font-semibold text-cyan-50 shadow-[0_0_24px_rgba(34,211,238,0.10)] transition hover:border-cyan-200/45 hover:bg-cyan-400/20 disabled:cursor-not-allowed disabled:opacity-55"
              >
                {isSaving ? "Saving..." : "Save Decision"}
              </button>
            </div>
          </div>
        </div>
      </motion.div>
    </motion.div>
  )
}
