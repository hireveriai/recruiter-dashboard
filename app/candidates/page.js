"use client"

import Link from "next/link"
import { Fragment, useEffect, useMemo, useState } from "react"
import { Pencil } from "lucide-react"
import BackToDashboardLink from "@/components/BackToDashboardLink"
import { useAuthSearchParams } from "@/lib/client/use-auth-search-params"

import { buildAuthUrl } from "@/lib/client/auth-query"
import { formatDateTime } from "@/lib/client/date-format"
import { isSessionJsonCacheFresh, readSessionJsonCache, writeSessionJsonCache } from "@/lib/client/session-json-cache"

import Navbar from "../../components/Navbar"
import SendInterviewModal from "../../components/SendInterviewModal"
import { CandidateActionModal } from "../../components/dashboard/CandidateActionModal"
import { DecisionPill } from "../../components/dashboard/DecisionPill"
import { VerisGlobeLoader } from "../../components/system/loaders"

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
    <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-11 min-w-0 rounded-xl border border-slate-700 bg-slate-950/70 px-3 text-sm font-medium normal-case tracking-normal text-slate-200 outline-none transition focus:border-cyan-300/60 focus:ring-2 focus:ring-cyan-300/10"
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

function CompletedCandidateDetails({ candidate, onClose }) {
  if (!candidate) {
    return null
  }

  const answerSummaries = Array.isArray(candidate.answerSummaries) ? candidate.answerSummaries : []

  return (
    <div className="relative overflow-hidden rounded-[28px] border border-emerald-400/20 bg-[radial-gradient(circle_at_top,_rgba(16,185,129,0.13),_transparent_34%),linear-gradient(180deg,rgba(15,23,42,0.98),rgba(9,14,28,0.98))] shadow-[0_0_80px_rgba(16,185,129,0.12)]">
        <div className="absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-emerald-300/70 to-transparent" />

        <div className="flex flex-col gap-4 border-b border-white/10 px-6 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <div>
            <h3 className="text-2xl font-semibold text-white">Completed Interview Summary</h3>
            <p className="mt-2 text-sm text-slate-400">
              {candidate.candidateName || "Candidate"} · {candidate.jobTitle || "Role"}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="self-start rounded-full border border-emerald-400/25 bg-emerald-400/10 px-4 py-2 text-sm text-emerald-100 transition hover:bg-emerald-400/20 sm:self-auto"
          >
            Close
          </button>
        </div>

        <div className="max-h-[74vh] overflow-auto px-6 py-6 sm:px-8">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-slate-800 bg-slate-950/35 p-4">
              <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Score</p>
              <p className="mt-3 text-2xl font-semibold text-white">{formatScore(candidate.score)}</p>
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-950/35 p-4">
              <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Decision</p>
              <p className="mt-3 text-2xl font-semibold text-white">{candidate.decision || "-"}</p>
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-950/35 p-4">
              <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Completed</p>
              <p className="mt-3 text-lg font-semibold text-white">{formatDateTime(candidate.endedAt || candidate.createdAt)}</p>
            </div>
          </div>

          <div className="mt-5">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Transcript + Result</p>
                <h4 className="mt-2 text-lg font-semibold text-white">Question, Answer and VERIS Evaluation</h4>
              </div>
              <p className="text-sm text-slate-500">{answerSummaries.length} recorded answer{answerSummaries.length === 1 ? "" : "s"}</p>
            </div>

            {answerSummaries.length === 0 ? (
              <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-950/35 p-5 text-sm leading-7 text-slate-400">
                No answer transcript has been recorded for this completed interview yet.
              </div>
            ) : (
              <div className="mt-4 space-y-4">
                {answerSummaries.map((answer, index) => {
                  const evaluationText = formatEvaluationText(answer.evaluation)
                  const metrics = [
                    ["Score", answer.score],
                    ["Skill", answer.skillScore],
                    ["Clarity", answer.clarityScore],
                    ["Depth", answer.depthScore],
                    ["Confidence", answer.confidenceScore],
                    ["Review Flag", answer.fraudScore],
                  ].filter(([, value]) => value !== null && value !== undefined)
                  const duration = answer.answerPayload?.duration

                  return (
                    <article key={answer.answerId || `${answer.question}-${index}`} className="rounded-2xl border border-slate-800 bg-slate-950/35 p-5">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-300/80">
                            Question {answer.questionOrder ?? index + 1}
                          </p>
                          <p className="mt-2 text-base font-medium leading-7 text-white">{answer.question}</p>
                          <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500">
                            {answer.skill ? <span>{answer.skill}</span> : null}
                            {answer.questionType ? <span>{answer.questionType}</span> : null}
                            {answer.questionSource ? <span>{answer.questionSource}</span> : null}
                          </div>
                        </div>
                        <div className="shrink-0 rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2 text-sm font-semibold text-white">
                          {formatAnswerScore(answer.score)}
                        </div>
                      </div>

                      <div className="mt-4 rounded-xl border border-slate-800/80 bg-[#08111f]/70 p-4">
                        <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Candidate Transcript</p>
                        <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-slate-300">{answer.answerText || "No response provided."}</p>
                        {duration !== null && duration !== undefined ? (
                          <p className="mt-3 text-xs text-slate-500">Duration: {duration}s</p>
                        ) : null}
                      </div>

                      <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_1.4fr]">
                        <div className="rounded-xl border border-slate-800/80 bg-[#08111f]/70 p-4">
                          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Result</p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            {metrics.length === 0 ? (
                              <span className="text-sm text-slate-500">No answer-level score recorded.</span>
                            ) : (
                              metrics.map(([label, value]) => (
                                <span key={label} className="rounded-full border border-slate-700 bg-slate-900/70 px-3 py-1 text-xs text-slate-300">
                                  {label}: {formatAnswerScore(value)}
                                </span>
                              ))
                            )}
                          </div>
                        </div>

                        <div className="rounded-xl border border-slate-800/80 bg-[#08111f]/70 p-4">
                          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">VERIS Feedback</p>
                          <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-slate-300">
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

          <div className="mt-6 rounded-2xl border border-emerald-400/20 bg-emerald-400/5 p-5">
            <p className="text-xs uppercase tracking-[0.24em] text-emerald-200/80">Overall Interview Summary</p>
            <p className="mt-2 text-sm text-slate-400">Final VERIS assessment across all recorded answers.</p>
            <div className="mt-4 whitespace-pre-wrap text-sm leading-7 text-slate-200">
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
  const initialCandidates = readSessionJsonCache(cacheKey)
  const [candidates, setCandidates] = useState(() => initialCandidates ?? [])
  const [loading, setLoading] = useState(() => !initialCandidates)
  const [loadError, setLoadError] = useState("")
  const [expandedCandidateId, setExpandedCandidateId] = useState("")
  const [reviewCandidate, setReviewCandidate] = useState(null)
  const [openSendInterview, setOpenSendInterview] = useState(false)
  const [searchTerm, setSearchTerm] = useState("")
  const [statusFilter, setStatusFilter] = useState("ALL")
  const [jobFilter, setJobFilter] = useState("ALL")
  const [decisionFilter, setDecisionFilter] = useState("ALL")
  const [scoreFilter, setScoreFilter] = useState("ALL")

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

  return (
    <>
      <div className="hv-page-enter min-h-screen bg-slate-950 text-white">
        <Navbar onSendInterviewClick={() => setOpenSendInterview(true)} />

        <main className="mx-auto max-w-[1600px] px-4 py-8 sm:px-6 lg:px-8">
          <section className="rounded-2xl border border-slate-800 bg-slate-900/80 p-8 shadow-[0_14px_44px_rgba(2,6,23,0.22)]">
            <div className="flex flex-col gap-8 xl:flex-row xl:items-end xl:justify-between">
              <div className="max-w-3xl">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Candidate Registry</p>
                <h1 className="mt-4 text-4xl font-semibold tracking-tight text-white">All Candidates</h1>
                <p className="mt-4 text-base leading-7 text-slate-400">
                  Unified candidate view across pending and completed interview journeys, with evaluation signals and recruiter-facing insight.
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-3 xl:min-w-[520px]">
                <div className="rounded-xl border border-slate-700 bg-slate-950/35 p-4">
                  <p className="text-sm text-slate-500">Total Candidates</p>
                  <p className="mt-3 text-3xl font-semibold text-white">{stats.total}</p>
                </div>
                <div className="rounded-xl border border-slate-700 bg-slate-950/35 p-4">
                  <p className="text-sm text-slate-500">Completed</p>
                  <p className="mt-3 text-3xl font-semibold text-white">{stats.completed}</p>
                </div>
                <div className="rounded-xl border border-slate-700 bg-slate-950/35 p-4">
                  <p className="text-sm text-slate-500">Pending</p>
                  <p className="mt-3 text-3xl font-semibold text-white">{stats.pending}</p>
                </div>
              </div>
            </div>
          </section>

          <section className="mt-8 overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/80 shadow-[0_14px_44px_rgba(2,6,23,0.2)]">
            <div className="flex flex-col gap-4 border-b border-slate-800 px-6 py-5 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-white">Candidate Pipeline View</h2>
                <p className="mt-1 text-sm text-slate-400">
                  Showing {filteredCandidates.length} of {candidates.length} candidates visible to the current recruiter organization.
                </p>
              </div>

              <BackToDashboardLink className="inline-flex w-fit items-center justify-center gap-2 rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-300 transition hover:border-slate-500 hover:text-white" />
            </div>

            <div className="grid gap-4 border-b border-slate-800 bg-slate-950/20 px-6 py-5 xl:grid-cols-[minmax(220px,1.2fr)_repeat(4,minmax(150px,0.7fr))_auto]">
              <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                Search
                <input
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="Search candidate, job, hiring action"
                  className="h-11 min-w-0 rounded-xl border border-slate-700 bg-slate-950/70 px-3 text-sm font-medium normal-case tracking-normal text-slate-200 outline-none transition placeholder:text-slate-600 focus:border-cyan-300/60 focus:ring-2 focus:ring-cyan-300/10"
                />
              </label>
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
                className="h-11 self-end rounded-xl border border-slate-700 px-4 text-sm font-semibold text-slate-300 transition hover:border-slate-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-45"
              >
                Clear
              </button>
            </div>

            <div className="overflow-hidden">
              <table className="w-full table-fixed text-sm">
                <colgroup>
                  <col className="w-[18%]" />
                  <col className="w-[30%]" />
                  <col className="w-[15%]" />
                  <col className="w-[14%]" />
                  <col className="w-[23%]" />
                </colgroup>
                <thead className="bg-slate-950/20 text-slate-400">
                  <tr>
                    <th className="p-5 text-left font-medium">Candidate</th>
                    <th className="p-5 text-left font-medium">Job</th>
                    <th className="p-5 text-left font-medium">Status</th>
                    <th className="whitespace-nowrap p-5 text-left font-medium">VERIS Screening Score</th>
                    <th className="p-5 text-left font-medium">Hiring Action</th>
                  </tr>
                </thead>

                  <tbody>
                    {loadError ? (
                    <tr>
                      <td colSpan={5} className="p-10 text-center text-amber-200">
                        {loadError}
                      </td>
                    </tr>
                  ) : candidates.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="p-10 text-center text-slate-400">
                        No candidates available
                      </td>
                    </tr>
                  ) : filteredCandidates.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="p-10 text-center text-slate-400">
                        No candidates match the current filters
                      </td>
                    </tr>
                  ) : (
                    filteredCandidates.map((candidate, index) => {
                      const rowKey = candidate.interviewId || candidate.candidateId || `${candidate.candidateName}-${index}`

                      return (
                      <Fragment key={rowKey}>
                      <tr className="border-t border-slate-800/80 align-top">
                        <td className="p-5 font-medium text-white">
                          <span className="block truncate" title={candidate.candidateName || "Candidate"}>
                            {candidate.candidateName}
                          </span>
                          {candidate.aiSummaryFull && isCompletedCandidate(candidate) ? (
                            <button
                              type="button"
                              onClick={() => setExpandedCandidateId((current) => current === rowKey ? "" : rowKey)}
                              className="mt-2 inline-flex text-xs font-semibold text-cyan-300/85 transition hover:text-cyan-100"
                              aria-label={`View VERIS insight for ${candidate.candidateName}`}
                            >
                              {expandedCandidateId === rowKey ? "Hide insight" : "View insight"}
                            </button>
                          ) : null}
                        </td>
                        <td className="p-5 text-slate-300"><span className="block truncate">{candidate.jobTitle || "-"}</span></td>
                        <td className="p-5">
                          <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-medium tracking-[0.12em] ${getStatusBadge(candidate.status)}`}>
                            {formatStatusText(candidate.status)}
                          </span>
                        </td>
                        <td className={`p-5 font-medium ${getScoreColor(candidate.verisScreeningScore)}`}>{formatScore(candidate.verisScreeningScore)}</td>
                        <td className="p-5">
                          <div className="flex flex-wrap items-center gap-2">
                            {isDecisionReady(candidate) ? (
                              candidate.recruiterDecisionStatus ? (
                                <DecisionPill status={candidate.recruiterDecisionStatus} />
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => setReviewCandidate(candidate)}
                                  className="inline-flex h-10 items-center justify-center whitespace-nowrap rounded-xl border border-cyan-300/20 bg-cyan-400/10 px-4 text-sm font-semibold text-cyan-100 transition hover:border-cyan-200/45 hover:bg-cyan-400/15 hover:text-white"
                                  aria-label={`Take hiring action for ${candidate.candidateName}`}
                                >
                                  Take Action
                                </button>
                              )
                            ) : (
                              <span className="inline-flex max-w-full rounded-full border border-slate-600/70 bg-slate-950/30 px-3 py-1 text-xs font-medium leading-5 text-slate-400">
                                After completion
                              </span>
                            )}
                            {isCompletedCandidate(candidate) && candidate.recruiterDecisionStatus ? (
                              <button
                                type="button"
                                onClick={() => setReviewCandidate(candidate)}
                                className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-cyan-300/20 bg-cyan-400/10 text-cyan-100 transition hover:border-cyan-200/45 hover:bg-cyan-400/15 hover:text-white"
                                aria-label={`Edit hiring action for ${candidate.candidateName}`}
                                title="Edit hiring action"
                              >
                                <Pencil className="h-4 w-4" aria-hidden="true" />
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                      {expandedCandidateId === rowKey ? (
                        <tr className="border-t border-emerald-400/10">
                          <td colSpan={5} className="bg-slate-950/30 p-5">
                            <CompletedCandidateDetails candidate={candidate} onClose={() => setExpandedCandidateId("")} />
                          </td>
                        </tr>
                      ) : null}
                      </Fragment>
                      )
                    })
                  )}
                  </tbody>
              </table>
            </div>
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
    </>
  )
}

