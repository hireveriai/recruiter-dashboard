"use client"

import Link from "next/link"
import { useEffect, useMemo, useRef, useState } from "react"
import { ChevronLeft, ChevronRight, Pencil } from "lucide-react"
import BackToDashboardLink from "@/components/BackToDashboardLink"
import { useAuthSearchParams } from "@/lib/client/use-auth-search-params"

import { buildAuthUrl } from "@/lib/client/auth-query"
import { formatDateTime } from "@/lib/client/date-format"
import { isSessionJsonCacheFresh, readSessionJsonCache, writeSessionJsonCache } from "@/lib/client/session-json-cache"

import Navbar from "../../components/Navbar"
import SendInterviewModal from "../../components/SendInterviewModal"
import SendAssessmentModal from "../../components/SendAssessmentModal"
import { formatLabel } from "@/lib/client/format-label"
import { CandidateActionModal } from "../../components/dashboard/CandidateActionModal"
import { DecisionPill } from "../../components/dashboard/DecisionPill"
import { VerisGlobeLoader } from "../../components/system/loaders"

// Candidate register columns from lg up: candidate (with role), status,
// VERIS Screening score, VERIS Assessment, hiring action. Below lg each row
// is a stacked card.
const CANDIDATE_COLUMNS =
  "lg:grid-cols-[minmax(0,1.7fr)_8.5rem_9.5rem_11rem_minmax(0,1.1fr)]"

const PAGE_SIZE_OPTIONS = [50, 100, 200, 500]
const PAGE_SIZE_STORAGE_KEY = "verisnova-candidates-page-size"

// Per-viewer convenience only: the register renders fine without it.
function readStoredPageSize() {
  try {
    const stored = Number(window.localStorage.getItem(PAGE_SIZE_STORAGE_KEY))
    return PAGE_SIZE_OPTIONS.includes(stored) ? stored : PAGE_SIZE_OPTIONS[0]
  } catch {
    return PAGE_SIZE_OPTIONS[0]
  }
}

// First, last, and the pages either side of the current one; gaps between.
function getPageItems(page, pageCount) {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, index) => index + 1)
  const start = Math.max(2, page - 1)
  const end = Math.min(pageCount - 1, page + 1)
  const items = [1]
  if (start > 2) items.push("gap-start")
  for (let item = start; item <= end; item += 1) items.push(item)
  if (end < pageCount - 1) items.push("gap-end")
  items.push(pageCount)
  return items
}

// Display is set by each use: the page numbers hide on phones.
const pagerButton =
  "h-8 min-w-8 items-center justify-center rounded-lg border px-2 text-xs font-semibold tabular-nums transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60 disabled:cursor-not-allowed disabled:opacity-40"

// Names typed entirely in capitals (or lowercase) show in title case;
// mixed-case names stay as entered.
function displayCandidateName(name) {
  const value = String(name ?? "").trim()
  if (!value) return "Candidate"
  if (value !== value.toUpperCase() && value !== value.toLowerCase()) return value
  return value.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_, lead, letter) => lead + letter.toUpperCase())
}

// Bar colour, matching the score text colours below.
function getScoreBar(score) {
  if (score > 80) return "bg-emerald-400"
  if (score >= 60) return "bg-amber-400"
  return "bg-rose-400"
}

function candidateInitials(name) {
  const parts = String(name ?? "").trim().split(/\s+/).filter(Boolean)
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "VN"
}

function getStatusBadge(status) {
  const normalized = String(status ?? "PENDING").toUpperCase()

  if (normalized === "COMPLETED") {
    return "border-emerald-500/20 bg-emerald-500/10 text-emerald-300"
  }

  if (normalized === "IN_PROGRESS") {
    return "border-blue-500/20 bg-blue-500/10 text-blue-300"
  }

  if (normalized === "EXPIRED") {
    return "border-rose-500/20 bg-rose-500/10 text-rose-300"
  }

  return "border-amber-500/20 bg-amber-500/10 text-amber-300"
}

function getScoreColor(score) {
  if (score === null || score === undefined) {
    return "text-slate-400"
  }

  if (score > 80) {
    return "text-emerald-300"
  }

  if (score >= 60) {
    return "text-amber-300"
  }

  return "text-rose-300"
}

function formatScore(score) {
  if (score === null || score === undefined) {
    return "-"
  }

  return `${Math.round(score)}%`
}

function formatStatusText(status) {
  return String(status ?? "PENDING")
    .toLowerCase()
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

function normalizeSearch(value) {
  return String(value ?? "").trim().toLowerCase()
}

function uniqueSorted(values) {
  return Array.from(new Set(values.filter((value) => value !== null && value !== undefined && String(value).trim() !== "")))
    .map(String)
    .sort((a, b) => a.localeCompare(b))
}

function getScoreBand(score) {
  const numeric = Number(score)

  if (!Number.isFinite(numeric)) {
    return "UNSCORED"
  }

  if (numeric >= 80) {
    return "HIGH"
  }

  if (numeric >= 60) {
    return "MEDIUM"
  }

  return "LOW"
}

function FilterSelect({ label, value, onChange, options }) {
  return (
    <label className="grid gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 min-w-0 rounded-xl border border-slate-700 bg-slate-950/70 px-3 text-sm font-medium normal-case tracking-normal text-slate-200 outline-none transition focus:border-cyan-300/60 focus:ring-2 focus:ring-cyan-300/10"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}

function formatAnswerScore(score) {
  if (score === null || score === undefined) {
    return "-"
  }

  const numeric = Number(score)
  if (!Number.isFinite(numeric)) {
    return "-"
  }

  if (numeric >= 0 && numeric <= 1) {
    return `${Math.round(numeric * 100)}%`
  }

  if (numeric > 1 && numeric <= 5) {
    return `${numeric.toFixed(1).replace(/\.0$/, "")}/5`
  }

  return `${Math.round(numeric)}%`
}

// "Code Similarity" is a heuristic review cue (candidate's coding-interview
// answer resembles another candidate's answer to the same question, within
// the same organization) - never a plagiarism verdict.
function formatCodeSimilarityLevel(level) {
  if (level === "REVIEW_RECOMMENDED") return "REVIEW RECOMMENDED"
  if (level === "ELEVATED") return "ELEVATED"
  return "LOW"
}

function codeSimilarityTone(level) {
  if (level === "REVIEW_RECOMMENDED") return "border-rose-500/40 bg-rose-500/10 text-rose-200"
  if (level === "ELEVATED") return "border-amber-500/40 bg-amber-500/10 text-amber-200"
  return "border-slate-700 bg-slate-900/70 text-slate-300"
}

function formatEvaluationText(evaluation) {
  if (!evaluation) {
    return null
  }

  if (typeof evaluation === "string") {
    return evaluation
  }

  if (typeof evaluation !== "object") {
    return null
  }

  const preferredKeys = ["feedback", "summary", "result", "analysis", "rationale", "reason", "strengths", "weaknesses"]
  const lines = preferredKeys.flatMap((key) => {
    const value = evaluation[key]
    if (value === null || value === undefined) {
      return []
    }

    if (Array.isArray(value)) {
      return [`${key}: ${value.join(", ")}`]
    }

    if (typeof value === "object") {
      return [`${key}: ${JSON.stringify(value)}`]
    }

    return [`${key}: ${value}`]
  })

  return lines.length > 0 ? lines.join("\n") : JSON.stringify(evaluation, null, 2)
}

function isCompletedCandidate(candidate) {
  return String(candidate?.status ?? "").toUpperCase() === "COMPLETED"
}

function isDecisionReady(candidate) {
  const status = String(candidate?.status ?? "").toUpperCase()
  return Boolean(
    candidate?.endedAt ||
    (candidate?.score !== null && candidate?.score !== undefined) ||
    candidate?.decision ||
    ["COMPLETED", "SUBMITTED", "EVALUATED"].includes(status)
  )
}

function getHiringActionValue(candidate) {
  if (candidate?.recruiterDecisionStatus) {
    return candidate.recruiterDecisionStatus
  }

  return isDecisionReady(candidate) ? "PENDING_REVIEW" : "AFTER_COMPLETION"
}

function formatHiringActionText(value) {
  if (value === "PENDING_REVIEW") {
    return "Pending Review"
  }

  if (value === "AFTER_COMPLETION") {
    return "After Completion"
  }

  return formatStatusText(value)
}

// Independent of the Screening/Interview score above - reads from the
// VERIS Assessment results API and is never combined into candidate.score.
function VerisAssessmentSummaryCard({ candidateId, searchParams }) {
  const [summary, setSummary] = useState(undefined)

  useEffect(() => {
    if (!candidateId) {
      setSummary(null)
      return
    }

    let active = true
    fetch(buildAuthUrl(`/api/assessments/lookup/candidate-summary?candidateId=${candidateId}`, searchParams), {
      credentials: "include",
    })
      .then((res) => (res.ok ? res.json() : { data: { result: null } }))
      .then((data) => {
        if (active) setSummary(data?.data?.result ?? null)
      })
      .catch(() => {
        if (active) setSummary(null)
      })

    return () => {
      active = false
    }
  }, [candidateId, searchParams])

  if (!summary) {
    return null
  }

  return (
    <div className="rounded-xl border border-cyan-300/20 bg-cyan-400/[0.05] p-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-cyan-300">VERIS Assessment</p>
      <p className="mt-2 text-2xl font-semibold tabular-nums text-white">
        {summary.percentage != null ? `${Number(summary.percentage)}%` : "-"}
      </p>
      <p className="mt-0.5 truncate text-xs text-slate-400">
        {summary.assessmentTitle} &middot; {summary.passed === true ? "Passed" : summary.passed === false ? "Failed" : "Pending"}
      </p>
    </div>
  )
}

function CompletedCandidateDetails({ candidate, onClose }) {
  const searchParams = useAuthSearchParams()

  if (!candidate) {
    return null
  }

  const answerSummaries = Array.isArray(candidate.answerSummaries) ? candidate.answerSummaries : []

  return (
    <div className="hv-completed-summary-modal hv-theme-modal relative overflow-hidden rounded-2xl border border-slate-700/70 bg-[#0a1020]/95 shadow-[0_24px_60px_rgba(2,6,23,0.35)]">
        <div className="flex flex-col gap-3 border-b border-slate-800 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-300">VERIS Insight</p>
            <h3 className="mt-1 text-lg font-semibold text-white sm:text-xl">Completed Interview Summary</h3>
            <p className="mt-0.5 truncate text-sm text-slate-400">
              {candidate.candidateName || "Candidate"} · {candidate.jobTitle || "Role"}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="self-start rounded-full border border-slate-700 bg-slate-900/80 px-3.5 py-1.5 text-sm text-slate-300 transition hover:border-cyan-300/60 hover:text-white sm:self-auto"
          >
            Close
          </button>
        </div>

        <div className="max-h-[74vh] overflow-auto px-5 py-5 sm:px-6">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-slate-800 bg-slate-950/35 p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Score</p>
              <p className="mt-2 text-2xl font-semibold tabular-nums text-white">{formatScore(candidate.score)}</p>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-950/35 p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Decision</p>
              <p className="mt-2 text-2xl font-semibold text-white">{candidate.decision || "-"}</p>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-950/35 p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Completed</p>
              <p className="mt-2 text-base font-semibold text-white">{formatDateTime(candidate.endedAt || candidate.createdAt)}</p>
            </div>
            <VerisAssessmentSummaryCard candidateId={candidate.candidateId} searchParams={searchParams} />
          </div>

          <div className="mt-6">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Transcript + Result</p>
                <h4 className="mt-1 text-base font-semibold text-white">Question, Answer and VERIS Evaluation</h4>
              </div>
              <p className="text-xs text-slate-500">{answerSummaries.length} recorded answer{answerSummaries.length === 1 ? "" : "s"}</p>
            </div>

            {answerSummaries.length === 0 ? (
              <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950/35 p-5 text-sm leading-7 text-slate-400">
                No answer transcript has been recorded for this completed interview yet.
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                {answerSummaries.map((answer, index) => {
                  const evaluationText = formatEvaluationText(answer.evaluation)
                  const metrics = [
                    ["Score", answer.score],
                    ["Skill", answer.skillScore],
                    ["Clarity", answer.clarityScore],
                    ["Depth", answer.depthScore],
                    ["Confidence", answer.confidenceScore],
                    ["Integrity Risk", answer.fraudScore],
                  ].filter(([, value]) => value !== null && value !== undefined)
                  const duration = answer.answerPayload?.duration

                  return (
                    <article key={answer.answerId || `${answer.question}-${index}`} className="rounded-xl border border-slate-800 bg-slate-950/35 p-4 sm:p-5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-300">
                            Question {answer.questionOrder ?? index + 1}
                          </p>
                          <p className="mt-1.5 text-sm font-medium leading-6 text-white sm:text-base">{answer.question}</p>
                          <div className="mt-1.5 flex flex-wrap gap-1.5 text-xs text-slate-500">
                            {answer.skill ? <span className="rounded-full border border-slate-700 px-2 py-0.5">{answer.skill}</span> : null}
                            {answer.questionType ? <span className="rounded-full border border-slate-700 px-2 py-0.5">{formatLabel(answer.questionType)}</span> : null}
                            {answer.questionSource ? <span className="rounded-full border border-slate-700 px-2 py-0.5">{answer.questionSource}</span> : null}
                          </div>
                        </div>
                        <div className="shrink-0 rounded-lg border border-cyan-300/25 bg-cyan-400/10 px-3 py-1.5 text-sm font-semibold tabular-nums text-cyan-100">
                          {formatAnswerScore(answer.score)}
                        </div>
                      </div>

                      <div className="mt-3 rounded-lg border border-slate-800/80 bg-slate-900/50 p-3.5">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Candidate Transcript</p>
                        <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-slate-300">{answer.answerText || "No response provided."}</p>
                        {duration !== null && duration !== undefined ? (
                          <p className="mt-2 text-xs text-slate-500">Duration: {duration}s</p>
                        ) : null}
                      </div>

                      <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_1.4fr]">
                        <div className="rounded-lg border border-slate-800/80 bg-slate-900/50 p-3.5">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Result</p>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {metrics.length === 0 ? (
                              <span className="text-sm text-slate-500">No answer-level score recorded.</span>
                            ) : (
                              metrics.map(([label, value]) => (
                                <span key={label} className="rounded-full border border-slate-700 bg-slate-900/70 px-2.5 py-0.5 text-xs text-slate-300">
                                  {label}: {formatAnswerScore(value)}
                                </span>
                              ))
                            )}
                            {answer.codeSimilarity ? (
                              <span
                                className={`rounded-full border px-2.5 py-0.5 text-xs ${codeSimilarityTone(answer.codeSimilarity.level)}`}
                              >
                                Code Similarity: {formatCodeSimilarityLevel(answer.codeSimilarity.level)}
                                {answer.codeSimilarity.score !== null ? ` (${Math.round(answer.codeSimilarity.score)}%)` : ""}
                              </span>
                            ) : null}
                          </div>
                        </div>

                        <div className="rounded-lg border border-cyan-300/15 bg-cyan-400/[0.05] p-3.5">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-cyan-300/90">VERIS Feedback</p>
                          <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-slate-300">
                            {answer.feedback || evaluationText || "No VERIS feedback has been recorded for this answer."}
                          </p>
                        </div>
                      </div>
                    </article>
                  )
                })}
              </div>
            )}
          </div>

          <div className="mt-5 rounded-xl border border-cyan-300/20 bg-cyan-400/[0.05] p-4 sm:p-5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-300">Overall Interview Summary</p>
            <p className="mt-1 text-xs text-slate-400">Final VERIS assessment across all recorded answers. The hiring decision stays with your team.</p>
            <div className="mt-3 whitespace-pre-wrap text-sm leading-7 text-slate-200">
              {candidate.aiSummaryFull || "No overall VERIS summary has been recorded for this completed interview yet. Review the question-by-question transcript and evaluations above."}
            </div>
          </div>
        </div>
    </div>
  )
}

export default function CandidatesPage() {
  const searchParams = useAuthSearchParams()
  const cacheKey = `candidates:${searchParams.toString()}`
  const [candidates, setCandidates] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")
  const [expandedCandidateId, setExpandedCandidateId] = useState("")
  const [reviewCandidate, setReviewCandidate] = useState(null)
  const [openSendInterview, setOpenSendInterview] = useState(false)
  const [assessmentTarget, setAssessmentTarget] = useState(null)
  const [assessmentSummaries, setAssessmentSummaries] = useState({})
  const [searchTerm, setSearchTerm] = useState("")
  const [statusFilter, setStatusFilter] = useState("ALL")
  const [jobFilter, setJobFilter] = useState("ALL")
  const [decisionFilter, setDecisionFilter] = useState("ALL")
  const [scoreFilter, setScoreFilter] = useState("ALL")
  // Phones only: the four filters fold away behind a toggle.
  const [showFilters, setShowFilters] = useState(false)
  // The register renders only after loading, so reading storage here cannot
  // change the server-rendered markup.
  const [pageSize, setPageSize] = useState(() => (typeof window === "undefined" ? PAGE_SIZE_OPTIONS[0] : readStoredPageSize()))
  // The page belongs to one search/filter/page-size combination.
  const [pageState, setPageState] = useState({ key: "", page: 1 })
  const registerRef = useRef(null)

  useEffect(() => {
    let isMounted = true
    const cached = readSessionJsonCache(cacheKey)
    const hasCachedRows = Boolean(cached)

    if (cached) {
      window.queueMicrotask(() => {
        if (isMounted) {
          setCandidates(cached)
          setLoading(false)
        }
      })
    } else {
      window.queueMicrotask(() => {
        if (isMounted) {
          setLoading(true)
        }
      })
    }

    window.queueMicrotask(() => {
      if (isMounted) {
        setLoadError("")
      }
    })

    if (cached && isSessionJsonCacheFresh(cacheKey)) {
      return () => {
        isMounted = false
      }
    }

    fetch(buildAuthUrl("/api/dashboard/candidates?limit=all", searchParams), {
      credentials: "include",
      cache: "no-store",
    })
      .then((res) => res.json())
      .then((data) => {
        if (isMounted && data.success) {
          const rows = Array.isArray(data.data) ? data.data : data.data?.candidates
          const nextRows = Array.isArray(rows) ? rows : []
          setCandidates(nextRows)
          writeSessionJsonCache(cacheKey, nextRows)
          return
        }

        if (isMounted && !hasCachedRows) {
          setCandidates([])
          setLoadError(data?.error?.message || data?.message || "Candidate data could not be loaded.")
        }
      })
      .catch((error) => {
        console.error("Failed to fetch candidates page data", error)
        if (isMounted && !hasCachedRows) {
          setCandidates([])
          setLoadError("Candidate data could not be loaded.")
        }
      })
      .finally(() => {
        if (isMounted) {
          setLoading(false)
        }
      })

    return () => {
      isMounted = false
    }
  }, [cacheKey, searchParams])

  // Independent of the Screening/Interview data above - a single bulk lookup
  // against VERIS Assessment results so the table can show a score column
  // without one fetch per row.
  useEffect(() => {
    const candidateIds = Array.from(
      new Set(candidates.map((candidate) => candidate.candidateId).filter(Boolean))
    )

    if (candidateIds.length === 0) {
      setAssessmentSummaries({})
      return
    }

    let active = true
    fetch(buildAuthUrl(`/api/assessments/lookup/candidate-summary?candidateIds=${candidateIds.join(",")}`, searchParams), {
      credentials: "include",
    })
      .then((res) => (res.ok ? res.json() : { data: { results: {} } }))
      .then((data) => {
        if (active) setAssessmentSummaries(data?.data?.results ?? {})
      })
      .catch(() => {
        if (active) setAssessmentSummaries({})
      })

    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidates, searchParams])

  const stats = useMemo(() => {
    const total = candidates.length
    const completed = candidates.filter((candidate) => String(candidate.status).toUpperCase() === "COMPLETED").length
    const pending = candidates.filter((candidate) => String(candidate.status).toUpperCase() === "PENDING").length

    return { total, completed, pending }
  }, [candidates])

  const filterOptions = useMemo(() => {
    return {
      statuses: uniqueSorted(candidates.map((candidate) => candidate.status)),
      jobs: uniqueSorted(candidates.map((candidate) => candidate.jobTitle)),
      decisions: uniqueSorted(candidates.map(getHiringActionValue)),
    }
  }, [candidates])

  const filteredCandidates = useMemo(() => {
    const query = normalizeSearch(searchTerm)

    return candidates.filter((candidate) => {
      const status = String(candidate.status ?? "").toUpperCase()
      const jobTitle = String(candidate.jobTitle ?? "")
      const hiringAction = getHiringActionValue(candidate)
      const scoreBand = getScoreBand(candidate.verisScreeningScore)
      const searchable = [
        candidate.candidateName,
        candidate.jobTitle,
        candidate.status,
        candidate.decision,
        formatHiringActionText(hiringAction),
        candidate.recruiterDecisionStatus,
        candidate.aiSummaryShort,
        candidate.aiSummaryFull,
      ]
        .map((value) => String(value ?? "").toLowerCase())
        .join(" ")

      const matchesSearch = !query || searchable.includes(query)
      const matchesStatus = statusFilter === "ALL" || status === statusFilter
      const matchesJob = jobFilter === "ALL" || jobTitle === jobFilter
      const matchesDecision = decisionFilter === "ALL" || hiringAction === decisionFilter
      const matchesScore = scoreFilter === "ALL" || scoreBand === scoreFilter

      return matchesSearch && matchesStatus && matchesJob && matchesDecision && matchesScore
    })
  }, [candidates, searchTerm, statusFilter, jobFilter, decisionFilter, scoreFilter])

  const hasActiveFilters =
    searchTerm || statusFilter !== "ALL" || jobFilter !== "ALL" || decisionFilter !== "ALL" || scoreFilter !== "ALL"

  function clearFilters() {
    setSearchTerm("")
    setStatusFilter("ALL")
    setJobFilter("ALL")
    setDecisionFilter("ALL")
    setScoreFilter("ALL")
  }

  function handleDecisionSaved(candidate, decision) {
    const key = candidate.interviewId || candidate.candidateId
    const nextRows = candidates.map((item) => {
      const itemKey = item.interviewId || item.candidateId
      return itemKey === key
        ? {
            ...item,
            recruiterDecisionStatus: decision.status,
            recruiterDecisionAt: decision.decidedAt,
            recruiterDecisionNotes: decision.notes ?? item.recruiterDecisionNotes ?? null,
          }
        : item
    })

    setCandidates(nextRows)
    writeSessionJsonCache(`candidates:${searchParams.toString()}`, nextRows)
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 text-white">
        <Navbar onSendInterviewClick={() => setOpenSendInterview(true)} />
        <VerisGlobeLoader
          eyebrow="Candidates"
          viewportOffset="navbar"
          steps={[
            { label: "Loading candidates", detail: "Fetching candidate profiles and screening history." },
            { label: "Syncing scores", detail: "Preparing VERIS scores and status." },
            { label: "Building registry", detail: "Organizing the candidate pipeline view." },
            { label: "Candidates ready", detail: "Candidate data is ready for review." },
          ]}
          activeIndex={1}
        />
      </div>
    )
  }

  const awaitingDecision = candidates.filter(
    (candidate) => isDecisionReady(candidate) && !candidate.recruiterDecisionStatus
  ).length
  const activeFilterCount = [statusFilter, jobFilter, decisionFilter, scoreFilter].filter((value) => value !== "ALL").length
  const statCards = [
    ["Total Candidates", stats.total, false],
    ["Completed", stats.completed, false],
    ["Pending", stats.pending, false],
    ["Awaiting your decision", awaitingDecision, true],
  ]

  const pagingKey = [searchTerm, statusFilter, jobFilter, decisionFilter, scoreFilter, pageSize].join("|")
  const pageCount = Math.max(1, Math.ceil(filteredCandidates.length / pageSize))
  const currentPage = Math.min(pageState.key === pagingKey ? pageState.page : 1, pageCount)
  const pageStart = (currentPage - 1) * pageSize
  const pageEnd = Math.min(pageStart + pageSize, filteredCandidates.length)
  const pagedCandidates = filteredCandidates.slice(pageStart, pageEnd)

  const goToPage = (page) => {
    setPageState({ key: pagingKey, page: Math.min(Math.max(1, page), pageCount) })
    const top = registerRef.current?.getBoundingClientRect().top
    if (top !== undefined && top < 0) {
      registerRef.current.scrollIntoView({ block: "start" })
    }
  }

  const changePageSize = (value) => {
    const next = Number(value)
    if (!PAGE_SIZE_OPTIONS.includes(next)) return
    setPageSize(next)
    try {
      window.localStorage.setItem(PAGE_SIZE_STORAGE_KEY, String(next))
    } catch {
      // Storage unavailable: keep it for this visit only.
    }
  }

  return (
    <>
      <div className="hv-page-enter min-h-screen bg-slate-950 text-white">
        <Navbar onSendInterviewClick={() => setOpenSendInterview(true)} />

        <main className="mx-auto max-w-[1600px] space-y-5 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <header className="max-w-3xl">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-300">Candidate Registry</p>
              <h1 className="mt-1.5 text-2xl font-semibold tracking-tight text-white sm:text-[1.75rem]">All Candidates</h1>
              <p className="mt-1 text-sm leading-6 text-slate-400">
                Unified candidate view across pending and completed interview journeys, with evaluation signals and recruiter-facing insight.
              </p>
            </header>
            <BackToDashboardLink className="inline-flex w-fit items-center justify-center gap-2 rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-300 transition hover:border-slate-500 hover:text-white" />
          </div>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {statCards.map(([label, value, accent]) => (
              <div
                key={label}
                className={`hv-elevated-section rounded-xl border px-4 py-3.5 shadow-[0_14px_44px_rgba(2,6,23,0.18)] ${
                  accent ? "border-cyan-300/25 bg-cyan-400/[0.06]" : "border-slate-800 bg-slate-900/80"
                }`}
              >
                <p className="text-xs text-slate-400">{label}</p>
                <p className={`mt-1.5 text-2xl font-semibold tabular-nums ${accent ? "text-cyan-100" : "text-white"}`}>{value}</p>
              </div>
            ))}
          </div>

          <section
            ref={registerRef}
            className="hv-elevated-section scroll-mt-24 overflow-clip rounded-xl border border-slate-800 bg-slate-900/80 shadow-[0_14px_44px_rgba(2,6,23,0.2)]"
            aria-label="Candidate Pipeline View"
          >
            <div className="flex flex-col gap-1 border-b border-slate-800 px-4 py-4 sm:flex-row sm:items-center sm:justify-between lg:px-5">
              <h2 className="text-base font-semibold text-white">Candidate Pipeline View</h2>
              <p className="text-xs text-slate-400">
                Showing {filteredCandidates.length} of {candidates.length} candidates visible to the current recruiter organization.
              </p>
            </div>

            <div className="grid gap-3 border-b border-slate-800 bg-slate-950/20 px-4 py-4 sm:grid-cols-2 lg:grid-cols-4 lg:px-5 xl:grid-cols-[minmax(220px,1.3fr)_repeat(4,minmax(140px,0.7fr))_auto]">
              <label className="grid gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500 sm:col-span-2 xl:col-span-1">
                Search
                <input
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="Search candidate, job, hiring action"
                  className="h-10 min-w-0 rounded-xl border border-slate-700 bg-slate-950/70 px-3 text-sm font-medium normal-case tracking-normal text-slate-200 outline-none transition placeholder:text-slate-600 focus:border-cyan-300/60 focus:ring-2 focus:ring-cyan-300/10"
                />
              </label>
              <button
                type="button"
                onClick={() => setShowFilters((current) => !current)}
                aria-expanded={showFilters}
                className="h-10 rounded-xl border border-slate-700 px-4 text-sm font-semibold text-slate-300 transition hover:border-slate-500 sm:hidden"
              >
                {showFilters ? "Hide filters" : "Filters"}
                {activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
              </button>
              <div className={`${showFilters ? "grid" : "hidden"} gap-3 sm:contents`}>
              <FilterSelect
                label="Status"
                value={statusFilter}
                onChange={setStatusFilter}
                options={[{ value: "ALL", label: "All Statuses" }, ...filterOptions.statuses.map((value) => ({ value: value.toUpperCase(), label: formatStatusText(value) }))]}
              />
              <FilterSelect
                label="Job"
                value={jobFilter}
                onChange={setJobFilter}
                options={[{ value: "ALL", label: "All Jobs" }, ...filterOptions.jobs.map((value) => ({ value, label: value }))]}
              />
              <FilterSelect
                label="Hiring Action"
                value={decisionFilter}
                onChange={setDecisionFilter}
                options={[{ value: "ALL", label: "All Actions" }, ...filterOptions.decisions.map((value) => ({ value, label: formatHiringActionText(value) }))]}
              />
              <FilterSelect
                label="VERIS Screening Score"
                value={scoreFilter}
                onChange={setScoreFilter}
                options={[
                  { value: "ALL", label: "All VERIS Screening Scores" },
                  { value: "HIGH", label: "80%+" },
                  { value: "MEDIUM", label: "60-79%" },
                  { value: "LOW", label: "Below 60%" },
                  { value: "UNSCORED", label: "Unscored" },
                ]}
              />
              <button
                type="button"
                onClick={clearFilters}
                disabled={!hasActiveFilters}
                className="h-10 self-end rounded-xl border border-slate-700 px-4 text-sm font-semibold text-slate-300 transition hover:border-slate-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-45 lg:w-24 xl:w-auto"
              >
                Clear
              </button>
              </div>
            </div>

            {/* Column headings (lg and up), pinned under the navbar while the
                page scrolls. Below lg each candidate is a stacked card. */}
            <div
              className={`sticky top-[77px] z-10 hidden gap-4 bg-slate-950 px-5 py-2.5 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-slate-500 shadow-[0_1px_0_var(--color-slate-800)] lg:grid ${CANDIDATE_COLUMNS}`}
            >
              <span>Candidate</span>
              <span>Status</span>
              <span>VERIS Screening</span>
              <span>VERIS Assessment</span>
              <span>Hiring Action</span>
            </div>

            {loadError ? (
              <p className="px-5 py-10 text-center text-sm text-amber-200">{loadError}</p>
            ) : candidates.length === 0 ? (
              <p className="px-5 py-10 text-center text-sm text-slate-400">No candidates available</p>
            ) : filteredCandidates.length === 0 ? (
              <p className="px-5 py-10 text-center text-sm text-slate-400">No candidates match the current filters</p>
            ) : (
              <ul aria-label="Candidates">
                {pagedCandidates.map((candidate, index) => {
                  const rowKey = candidate.interviewId || candidate.candidateId || `${candidate.candidateName}-${pageStart + index}`
                  const assessment = assessmentSummaries[candidate.candidateId]
                  const expanded = expandedCandidateId === rowKey
                  const awaiting = isDecisionReady(candidate) && !candidate.recruiterDecisionStatus
                  const score = candidate.verisScreeningScore
                  const hasScore = score !== null && score !== undefined && Number.isFinite(Number(score))

                  return (
                    <li key={rowKey} className="relative border-b border-slate-800/80 last:border-b-0">
                      {awaiting ? (
                        <span aria-hidden="true" className="absolute inset-y-3 left-0 w-[3px] rounded-r-full bg-cyan-400" />
                      ) : null}
                      <div
                        className={`grid grid-cols-2 items-center gap-x-4 gap-y-3 px-4 py-3.5 transition-colors hover:bg-slate-800/25 lg:gap-4 lg:px-5 ${CANDIDATE_COLUMNS}`}
                      >
                        <div className="col-span-2 flex min-w-0 items-center gap-3 lg:col-span-1">
                          <span
                            aria-hidden="true"
                            className={`flex h-9 w-9 flex-none items-center justify-center rounded-full text-xs font-semibold ${
                              awaiting ? "bg-cyan-400/15 text-cyan-200" : "bg-slate-800 text-slate-300"
                            }`}
                          >
                            {candidateInitials(candidate.candidateName)}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold text-white" title={candidate.candidateName || "Candidate"}>
                              {displayCandidateName(candidate.candidateName)}
                            </p>
                            <p className="truncate text-xs text-slate-400" title={candidate.jobTitle || ""}>
                              {candidate.jobTitle || "No role"}
                              {candidate.aiSummaryFull && isCompletedCandidate(candidate) ? (
                                <>
                                  <span className="mx-1.5 text-slate-600" aria-hidden="true">&middot;</span>
                                  <button
                                    type="button"
                                    onClick={() => setExpandedCandidateId((current) => (current === rowKey ? "" : rowKey))}
                                    className="font-semibold text-cyan-300 transition hover:text-cyan-100"
                                    aria-expanded={expanded}
                                    aria-label={`View VERIS insight for ${candidate.candidateName}`}
                                  >
                                    {expanded ? "Hide insight" : "View insight"}
                                  </button>
                                </>
                              ) : null}
                            </p>
                          </div>
                          <span className={`inline-flex flex-none whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11px] font-medium lg:hidden ${getStatusBadge(candidate.status)}`}>
                            {formatStatusText(candidate.status)}
                          </span>
                        </div>

                        <div className="hidden lg:block">
                          <span className={`inline-flex whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${getStatusBadge(candidate.status)}`}>
                            {formatStatusText(candidate.status)}
                          </span>
                        </div>

                        <div>
                          <p className="text-[10px] uppercase tracking-[0.12em] text-slate-500 lg:hidden">VERIS Screening</p>
                          {hasScore ? (
                            <div className="mt-1 w-full max-w-[84px] lg:mt-0">
                              <p className={`text-sm font-semibold tabular-nums leading-none ${getScoreColor(score)}`}>{formatScore(score)}</p>
                              <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-slate-800" aria-hidden="true">
                                <div className={`h-full rounded-full ${getScoreBar(score)}`} style={{ width: `${Math.max(3, Math.min(100, Math.round(score)))}%` }} />
                              </div>
                            </div>
                          ) : (
                            <p className="mt-0.5 text-sm text-slate-600 lg:mt-0" title="Not scored yet">&ndash;</p>
                          )}
                        </div>

                        <div className="justify-self-end text-right lg:justify-self-start lg:text-left">
                          <p className="text-[10px] uppercase tracking-[0.12em] text-slate-500 lg:hidden">VERIS Assessment</p>
                          {assessment ? (
                            <p className="mt-0.5 flex items-center justify-end gap-2 text-sm lg:mt-0 lg:justify-start">
                              <span className="font-semibold tabular-nums text-white">{formatScore(assessment.percentage)}</span>
                              <span
                                className={`rounded-full border px-2 py-px text-[10.5px] font-semibold ${
                                  assessment.passed === true
                                    ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-300"
                                    : assessment.passed === false
                                      ? "border-rose-400/30 bg-rose-500/10 text-rose-300"
                                      : "border-slate-700 text-slate-400"
                                }`}
                              >
                                {assessment.passed === true ? "Passed" : assessment.passed === false ? "Failed" : "Pending"}
                              </span>
                            </p>
                          ) : (
                            <button
                              type="button"
                              onClick={() =>
                                setAssessmentTarget({
                                  candidateId: candidate.candidateId,
                                  candidateName: candidate.candidateName,
                                  candidateEmail: candidate.candidateEmail || "",
                                })
                              }
                              className="mt-1 inline-flex h-8 items-center justify-center whitespace-nowrap rounded-lg border border-slate-700 bg-slate-900/60 px-3 text-xs font-semibold text-slate-200 transition hover:border-cyan-400/40 hover:text-cyan-100 lg:mt-0"
                              aria-label={`Send VERIS Assessment to ${candidate.candidateName}`}
                            >
                              Send Assessment
                            </button>
                          )}
                        </div>

                        <div className="col-span-2 lg:col-span-1">
                          <div className="flex flex-wrap items-center gap-2">
                            {isDecisionReady(candidate) ? (
                              candidate.recruiterDecisionStatus ? (
                                <DecisionPill status={candidate.recruiterDecisionStatus} />
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => setReviewCandidate(candidate)}
                                  className="hv-solid-action inline-flex h-8 items-center justify-center whitespace-nowrap rounded-lg bg-cyan-600 px-3.5 text-xs font-semibold text-white transition hover:bg-cyan-500"
                                  aria-label={`Take hiring action for ${candidate.candidateName}`}
                                >
                                  Take Action
                                </button>
                              )
                            ) : (
                              <span className="inline-flex max-w-full rounded-full border border-dashed border-slate-700 px-2.5 py-0.5 text-[11px] font-medium text-slate-500">
                                After completion
                              </span>
                            )}
                            {isCompletedCandidate(candidate) && candidate.recruiterDecisionStatus ? (
                              <button
                                type="button"
                                onClick={() => setReviewCandidate(candidate)}
                                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-700 bg-slate-900/60 text-slate-300 transition hover:border-cyan-400/40 hover:text-cyan-100"
                                aria-label={`Edit hiring action for ${candidate.candidateName}`}
                                title="Edit hiring action"
                              >
                                <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                              </button>
                            ) : null}
                          </div>
                        </div>
                      </div>

                      {expanded ? (
                        <div className="border-t border-slate-800 bg-slate-950/30 p-3 sm:p-5">
                          <CompletedCandidateDetails candidate={candidate} onClose={() => setExpandedCandidateId("")} />
                        </div>
                      ) : null}
                    </li>
                  )
                })}
              </ul>
            )}

            {filteredCandidates.length > 0 ? (
              <div className="flex flex-col gap-3 border-t border-slate-800 bg-slate-950/20 px-4 py-3 text-xs text-slate-400 sm:flex-row sm:items-center sm:justify-between lg:px-5">
                <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                  <p aria-live="polite">
                    Showing{" "}
                    <span className="font-semibold tabular-nums text-slate-200">
                      {pageStart + 1}&ndash;{pageEnd}
                    </span>{" "}
                    of <span className="font-semibold tabular-nums text-slate-200">{filteredCandidates.length}</span>
                  </p>
                  <label className="inline-flex items-center gap-2">
                    Rows per page
                    <select
                      value={pageSize}
                      onChange={(event) => changePageSize(event.target.value)}
                      className="h-8 rounded-lg border border-slate-700 bg-slate-950/70 px-2 text-xs font-semibold text-slate-200 outline-none transition focus:border-cyan-300/60 focus:ring-2 focus:ring-cyan-300/10"
                    >
                      {PAGE_SIZE_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                {pageCount > 1 ? (
                  <nav aria-label="Candidate pages" className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => goToPage(currentPage - 1)}
                      disabled={currentPage === 1}
                      aria-label="Previous page"
                      className={`${pagerButton} inline-flex border-slate-700 text-slate-300 hover:border-slate-500 hover:text-white`}
                    >
                      <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                    </button>
                    {getPageItems(currentPage, pageCount).map((item) =>
                      typeof item === "number" ? (
                        <button
                          key={item}
                          type="button"
                          onClick={() => goToPage(item)}
                          aria-label={`Page ${item}`}
                          aria-current={item === currentPage ? "page" : undefined}
                          className={`${pagerButton} hidden sm:inline-flex ${
                            item === currentPage
                              ? "hv-solid-action border-cyan-600 bg-cyan-600 text-white"
                              : "border-transparent text-slate-300 hover:border-slate-700 hover:text-white"
                          }`}
                        >
                          {item}
                        </button>
                      ) : (
                        <span key={item} aria-hidden="true" className="hidden px-1 text-slate-500 sm:inline">
                          &hellip;
                        </span>
                      )
                    )}
                    <span className="px-2 tabular-nums text-slate-300 sm:hidden">
                      Page {currentPage} of {pageCount}
                    </span>
                    <button
                      type="button"
                      onClick={() => goToPage(currentPage + 1)}
                      disabled={currentPage === pageCount}
                      aria-label="Next page"
                      className={`${pagerButton} inline-flex border-slate-700 text-slate-300 hover:border-slate-500 hover:text-white`}
                    >
                      <ChevronRight className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </nav>
                ) : null}
              </div>
            ) : null}
          </section>
        </main>
      </div>
      <CandidateActionModal
        isOpen={Boolean(reviewCandidate)}
        candidate={reviewCandidate}
        searchParams={searchParams}
        onClose={() => setReviewCandidate(null)}
        onDecisionSaved={(decision) => {
          if (reviewCandidate) {
            handleDecisionSaved(reviewCandidate, decision)
          }
        }}
      />
      <SendInterviewModal isOpen={openSendInterview} onClose={() => setOpenSendInterview(false)} />
      <SendAssessmentModal
        isOpen={Boolean(assessmentTarget)}
        onClose={() => setAssessmentTarget(null)}
        defaultCandidateId={assessmentTarget?.candidateId}
        defaultCandidateName={assessmentTarget?.candidateName}
        defaultCandidateEmail={assessmentTarget?.candidateEmail}
      />
    </>
  )
}
