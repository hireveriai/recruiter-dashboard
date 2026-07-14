"use client"

import Link from "next/link"
import { Fragment, useEffect, useMemo, useState } from "react"
import { Download, FileText, Link2, RotateCw, Video } from "lucide-react"
import { useAuthSearchParams } from "@/lib/client/use-auth-search-params"

import { buildAuthUrl } from "@/lib/client/auth-query"
import { copyText } from "@/lib/client/copy-to-clipboard"
import { formatDateTime } from "@/lib/client/date-format"
import { isSessionJsonCacheFresh, readSessionJsonCache, writeSessionJsonCache } from "@/lib/client/session-json-cache"

import BackToDashboardLink from "../../components/BackToDashboardLink"
import Navbar from "../../components/Navbar"
import SendInterviewModal from "../../components/SendInterviewModal"
import { CandidateActionModal } from "../../components/dashboard/CandidateActionModal"
import { DecisionPill } from "../../components/dashboard/DecisionPill"
import { VerisGlobeLoader } from "../../components/system/loaders"

const RECRUITER_STATUS_DEFINITIONS = {
  COMPLETED: {
    label: "Completed",
    description: "Candidate completed the full interview and the result is ready for review.",
  },
  INTERRUPTED: {
    label: "Interrupted",
    description: "Interview was disrupted by a technical, network, camera, or timeout issue.",
  },
  INCOMPLETE: {
    label: "Incomplete",
    description: "Candidate left or stopped before the interview finished normally.",
  },
  EXITED_EARLY: {
    label: "Exited Early",
    description: "Candidate intentionally ended the interview before finishing.",
  },
  IN_PROGRESS: {
    label: "In Progress",
    description: "Candidate has started and the interview is still active.",
  },
  READY: {
    label: "Ready",
    description: "Interview link is ready and waiting for the candidate.",
  },
  PREPARING_INTERVIEW: {
    label: "Preparing",
    description: "Questions or delivery are still being prepared.",
  },
  SENDING_EMAIL: {
    label: "Sending Email",
    description: "Invite email is being sent to the candidate.",
  },
  EMAIL_FAILED: {
    label: "Email Failed",
    description: "Interview is ready, but the invite email could not be delivered.",
  },
  PREPARATION_FAILED: {
    label: "Preparation Failed",
    description: "Interview setup failed before the candidate could start.",
  },
  EXPIRED: {
    label: "Expired",
    description: "The invite window expired before the candidate used it.",
  },
  REVOKED: {
    label: "Revoked",
    description: "Recruiter access to this interview was revoked.",
  },
  USED: {
    label: "Used",
    description: "The interview invite has already been used.",
  },
  PENDING: {
    label: "Pending",
    description: "Interview is not ready yet.",
  },
}

const STATUS_GUIDE_KEYS = ["COMPLETED", "INTERRUPTED", "INCOMPLETE", "EXITED_EARLY", "IN_PROGRESS", "READY"]

function normalizeStatusKey(status) {
  return String(status ?? "").trim().toUpperCase()
}

function getRecruiterStatusKey(interview) {
  const status = normalizeStatusKey(interview?.status)
  const interviewStatus = normalizeStatusKey(interview?.interviewStatus)
  const finalStatus = normalizeStatusKey(interview?.finalStatus)
  const attemptStatus = normalizeStatusKey(interview?.attemptStatus)
  const terminationType = normalizeStatusKey(interview?.terminationType)
  const disconnectReason = normalizeStatusKey(interview?.disconnectReason)
  const terminationReason = normalizeStatusKey(interview?.terminationReason)
  const isFinalized = status === "COMPLETED" || interviewStatus === "COMPLETED"
  const requiredQuestionCount = Number(interview?.requiredQuestionCount ?? 0)
  const answeredQuestionCount = Number(interview?.answeredQuestionCount ?? 0)
  const completedAllQuestions =
    requiredQuestionCount > 0 && answeredQuestionCount >= requiredQuestionCount

  if (
    ["COMPLETED", "SUBMITTED", "EVALUATED"].includes(attemptStatus) ||
    ["FINALIZED", "COMPLETED", "SUBMITTED", "EVALUATED"].includes(finalStatus) ||
    terminationType === "COMPLETED" ||
    completedAllQuestions
  ) {
    return "COMPLETED"
  }

  if (
    Boolean(interview?.earlyExit) ||
    ["MANUAL_EXIT", "EARLY_EXIT"].includes(attemptStatus) ||
    ["MANUAL_EXIT", "EARLY_EXIT"].includes(terminationType) ||
    ["MANUAL_EXIT", "EARLY_EXIT"].includes(finalStatus)
  ) {
    return "EXITED_EARLY"
  }

  if (
    finalStatus === "INTERRUPTED" ||
    ["INTERRUPTED", "TIME_EXPIRED", "NETWORK_DISCONNECT_TIMEOUT", "CAMERA_STREAM"].includes(terminationType) ||
    disconnectReason ||
    terminationReason.includes("INTERRUPT")
  ) {
    return "INTERRUPTED"
  }

  if (
    attemptStatus === "ABANDONED" ||
    finalStatus === "ABANDONED" ||
    status === "ABANDONED"
  ) {
    return isFinalized ? "INCOMPLETE" : "INCOMPLETE"
  }

  if (isFinalized) {
    return "COMPLETED"
  }

  if (status === "EARLY_EXIT") {
    return "EXITED_EARLY"
  }

  if (status === "FLAGGED") {
    return "INTERRUPTED"
  }

  return status || "PENDING"
}

function getRecruiterStatus(interview) {
  const key = getRecruiterStatusKey(interview)
  const fallback = RECRUITER_STATUS_DEFINITIONS.PENDING

  return {
    key,
    ...(RECRUITER_STATUS_DEFINITIONS[key] ?? {
      ...fallback,
      label: formatStatusText(key),
    }),
  }
}

function getStatusBadge(status) {
  const normalized = String(status ?? "PENDING").toUpperCase()
  if (normalized === "COMPLETED") return "border-emerald-500/20 bg-emerald-500/10 text-emerald-300"
  if (normalized === "EXITED_EARLY" || normalized === "EARLY_EXIT") return "border-amber-400/25 bg-amber-400/10 text-amber-200"
  if (normalized === "INCOMPLETE" || normalized === "ABANDONED") return "border-orange-400/25 bg-orange-400/10 text-orange-200"
  if (normalized === "INTERRUPTED") return "border-sky-400/25 bg-sky-400/10 text-sky-200"
  if (normalized === "READY") return "border-emerald-500/20 bg-emerald-500/10 text-emerald-300"
  if (normalized === "EMAIL_FAILED") return "border-amber-500/20 bg-amber-500/10 text-amber-300"
  if (normalized === "PREPARATION_FAILED") return "border-rose-500/20 bg-rose-500/10 text-rose-300"
  if (normalized === "PREPARING_INTERVIEW" || normalized === "SENDING_EMAIL") return "border-blue-500/20 bg-blue-500/10 text-blue-300"
  if (normalized === "IN_PROGRESS") return "border-blue-500/20 bg-blue-500/10 text-blue-300"
  if (normalized === "FLAGGED") return "border-rose-500/20 bg-rose-500/10 text-rose-300"
  if (["EXPIRED", "REVOKED", "USED"].includes(normalized)) return "border-slate-600 bg-slate-800/60 text-slate-300"
  return "border-amber-500/20 bg-amber-500/10 text-amber-300"
}

function formatStatusText(status) {
  return String(status ?? "PENDING")
    .toLowerCase()
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

function formatScore(score) {
  return score === null || score === undefined ? "-" : `${Math.round(score)}%`
}

function normalizeSearch(value) {
  return String(value ?? "").trim().toLowerCase()
}

function uniqueSorted(values) {
  return Array.from(new Set(values.filter((value) => value !== null && value !== undefined && String(value).trim() !== "")))
    .map(String)
    .sort((a, b) => a.localeCompare(b))
}

function getInterviewActivityTime(interview) {
  const value = getInterviewActivityValue(interview)
  const time = value ? new Date(value).getTime() : 0
  return Number.isFinite(time) ? time : 0
}

function getInterviewActivityValue(interview) {
  return interview?.endedAt || interview?.startedAt || interview?.startTime || interview?.createdAt
}

function getEvaluationState(interview) {
  if (isCompletedInterview(interview)) {
    return "COMPLETED"
  }

  if (interview.score !== null && interview.score !== undefined) {
    return "SCORED"
  }

  return "PENDING"
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

function isCompletedInterview(interview) {
  return getRecruiterStatusKey(interview) === "COMPLETED"
}

function isEarlyExitInterview(interview) {
  const status = String(interview?.status ?? interview?.attemptStatus ?? "").toUpperCase()
  return Boolean(interview?.earlyExit) || ["EARLY_EXIT", "MANUAL_EXIT"].includes(status)
}

function getEarlyExitText(interview) {
  const reason = String(interview?.terminationReason ?? interview?.disconnectReason ?? "").trim()
  if (!reason) {
    return "Exited early"
  }

  return reason
    .toLowerCase()
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

function getAccessLabel(item) {
  if (String(item.accessType ?? "FLEXIBLE").toUpperCase() === "SCHEDULED") {
    return item.startTime ? `Scheduled · ${formatDateTime(item.startTime)}` : "Scheduled"
  }

  return "Flexible"
}

const tableActionBase =
  "inline-flex min-h-9 max-w-full items-center justify-center gap-1.5 rounded-lg px-1.5 py-1 text-sm font-semibold leading-tight transition disabled:cursor-not-allowed disabled:opacity-55"
const tableActionNeutral =
  `${tableActionBase} text-slate-200 hover:bg-slate-800/55 hover:text-white`
const tableActionCyan =
  `${tableActionBase} text-cyan-100 hover:bg-cyan-400/10 hover:text-white`
const tableActionEmerald =
  `${tableActionBase} text-emerald-100 hover:bg-emerald-400/10 hover:text-white`
const tableActionAmber =
  `${tableActionBase} text-amber-100 hover:bg-amber-400/10 hover:text-white`
const tableActionRose =
  `${tableActionBase} text-rose-100 hover:bg-rose-400/10 hover:text-white`
const tableMutedChip =
  "inline-flex max-w-full items-center justify-center rounded-lg px-1.5 py-1 text-xs font-medium leading-none text-slate-500"
const tableProcessingChip =
  "inline-flex max-w-full items-center justify-center rounded-lg px-1.5 py-1 text-xs font-medium leading-none text-amber-100"
const recordingAction =
  "inline-flex max-w-full items-center justify-center gap-1.5 rounded-lg px-1.5 py-1 text-sm font-semibold leading-tight text-cyan-100 transition hover:bg-cyan-400/10 hover:text-white"

function CompletedInterviewDetails({ interview, onClose, onDownload, isDownloading = false, isLoadingDetails = false }) {
  if (!interview) {
    return null
  }

  const answerSummaries = Array.isArray(interview.answerSummaries) ? interview.answerSummaries : []

  return (
    <div className="relative max-h-[88vh] overflow-hidden rounded-[28px] border border-emerald-400/20 bg-[radial-gradient(circle_at_top,_rgba(16,185,129,0.13),_transparent_34%),linear-gradient(180deg,rgba(15,23,42,0.98),rgba(9,14,28,0.98))] shadow-[0_0_80px_rgba(16,185,129,0.12)]">
        <div className="absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-emerald-300/70 to-transparent" />

        <div className="flex flex-col gap-4 border-b border-white/10 px-6 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <div>
            <h3 className="text-2xl font-semibold text-white">Completed Interview Summary</h3>
            <p className="mt-2 text-sm text-slate-400">
              {interview.candidateName || "Candidate"} · {interview.jobTitle || "Role"}
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={onDownload}
              disabled={isDownloading}
              className="self-start rounded-full border border-cyan-400/25 bg-cyan-400/10 px-4 py-2 text-sm text-cyan-100 transition hover:bg-cyan-400/20 disabled:cursor-not-allowed disabled:opacity-60 sm:self-auto"
            >
              <span className="inline-flex items-center gap-2">
                <Download className="h-4 w-4" aria-hidden="true" />
                {isDownloading ? "Generating PDF..." : "Download Report"}
              </span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="self-start rounded-full border border-emerald-400/25 bg-emerald-400/10 px-4 py-2 text-sm text-emerald-100 transition hover:bg-emerald-400/20 sm:self-auto"
            >
              Close
            </button>
          </div>
        </div>

        <div className="max-h-[74vh] overflow-auto px-6 py-6 sm:px-8">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-slate-800 bg-slate-950/35 p-4">
              <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Score</p>
              <p className="mt-3 text-2xl font-semibold text-white">{formatScore(interview.score)}</p>
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-950/35 p-4">
              <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Decision</p>
              <p className="mt-3 text-2xl font-semibold text-white">{interview.decision || "-"}</p>
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-950/35 p-4">
              <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Completed</p>
              <p className="mt-3 text-lg font-semibold text-white">{formatDateTime(interview.endedAt || interview.createdAt)}</p>
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

            {isLoadingDetails ? (
              <div className="mt-4 rounded-2xl border border-cyan-400/15 bg-cyan-400/5 p-5 text-sm leading-7 text-cyan-100">
                Loading transcript and answer-level VERIS feedback...
              </div>
            ) : answerSummaries.length === 0 ? (
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
              {interview.aiSummary || "No overall VERIS summary has been recorded for this completed interview yet. Review the question-by-question transcript and evaluations above."}
            </div>
          </div>
        </div>
    </div>
  )
}

export default function InterviewsPage() {
  const searchParams = useAuthSearchParams()
  const cacheKey = `interviews:${searchParams.toString()}`
  const initialInterviews = readSessionJsonCache(cacheKey)
  const [interviews, setInterviews] = useState(() => initialInterviews ?? [])
  const [loading, setLoading] = useState(() => !initialInterviews)
  const [summaryInterviewId, setSummaryInterviewId] = useState("")
  const [openSendInterview, setOpenSendInterview] = useState(false)
  const [actionBusyId, setActionBusyId] = useState("")
  const [copiedInterviewId, setCopiedInterviewId] = useState("")
  const [reviewInterview, setReviewInterview] = useState(null)
  const [detailLoadingId, setDetailLoadingId] = useState("")
  const [reportDownloadId, setReportDownloadId] = useState("")
  const [searchTerm, setSearchTerm] = useState("")
  const [statusFilter, setStatusFilter] = useState("ALL")
  const [jobFilter, setJobFilter] = useState("ALL")
  const [accessFilter, setAccessFilter] = useState("ALL")
  const [evaluationFilter, setEvaluationFilter] = useState("ALL")

  async function loadInterviews() {
    const response = await fetch(buildAuthUrl("/api/dashboard/interviews?includeAnswers=0", searchParams), {
      credentials: "include",
      cache: "no-store",
    })
    const data = await response.json()
    if (data.success) {
      setInterviews(data.data ?? [])
      writeSessionJsonCache(cacheKey, data.data ?? [])
    }
    setLoading(false)
  }

  useEffect(() => {
    let isMounted = true
    const cached = readSessionJsonCache(cacheKey)

    if (cached) {
      window.queueMicrotask(() => {
        if (isMounted) {
          setInterviews(cached)
          setLoading(false)
        }
      })
    } else {
      setLoading(true)
    }

    if (cached && isSessionJsonCacheFresh(cacheKey)) {
      return () => {
        isMounted = false
      }
    }

    fetch(buildAuthUrl("/api/dashboard/interviews?includeAnswers=0", searchParams), {
      credentials: "include",
      cache: "no-store",
    })
      .then((res) => res.json())
      .then((data) => {
        if (isMounted && data.success) {
          setInterviews(data.data ?? [])
          writeSessionJsonCache(cacheKey, data.data ?? [])
        }
      })
      .catch((error) => {
        console.error("Failed to fetch interviews page data", error)
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

  async function openInterviewSummary(interview) {
    setSummaryInterviewId(interview.interviewId)
    if (interview.detailsLoaded) {
      return
    }

    try {
      setDetailLoadingId(interview.interviewId)
      const response = await fetch(buildAuthUrl(
        `/api/dashboard/interviews?interviewId=${encodeURIComponent(interview.interviewId)}&includeAnswers=1&finalizeStale=0`,
        searchParams
      ), {
        credentials: "include",
        cache: "no-store",
      })
      const data = await response.json()
      const detailedInterview = data?.success && Array.isArray(data.data) ? data.data[0] : null
      if (!response.ok || !detailedInterview) {
        return
      }

      setInterviews((current) => {
        const nextRows = current.map((item) => item.interviewId === detailedInterview.interviewId ? detailedInterview : item)
        writeSessionJsonCache(cacheKey, nextRows)
        return nextRows
      })
    } catch (error) {
      console.error("Failed to load interview details", error)
    } finally {
      setDetailLoadingId("")
    }
  }

  async function downloadInterviewReport(interview) {
    if (!interview?.interviewId || reportDownloadId) {
      return
    }

    try {
      setReportDownloadId(interview.interviewId)
      const response = await fetch(buildAuthUrl(
        `/api/interviews/${encodeURIComponent(interview.interviewId)}/report`,
        searchParams
      ), {
        credentials: "include",
        cache: "no-store",
      })

      if (!response.ok) {
        const payload = await response.json().catch(() => null)
        throw new Error(payload?.error?.message || payload?.message || "Unable to generate report")
      }

      const blob = await response.blob()
      const disposition = response.headers.get("content-disposition") || ""
      const filenameMatch = disposition.match(/filename="([^"]+)"/i)
      const filename = filenameMatch?.[1] || `${interview.candidateName || "candidate"}-report.pdf`
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = url
      link.download = filename
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(url)
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Unable to generate report")
    } finally {
      setReportDownloadId("")
    }
  }

  useEffect(() => {
    function handleEscape(event) {
      if (event.key === "Escape") {
        setSummaryInterviewId("")
      }
    }

    document.addEventListener("keydown", handleEscape)

    return () => {
      document.removeEventListener("keydown", handleEscape)
    }
  }, [])

  const stats = useMemo(() => {
    const total = interviews.length
    const active = interviews.filter((item) => ["PENDING", "READY", "EMAIL_FAILED", "IN_PROGRESS", "SENDING_EMAIL", "PREPARING_INTERVIEW"].includes(getRecruiterStatus(item).key)).length
    const completed = interviews.filter((item) => getRecruiterStatus(item).key === "COMPLETED").length
    const pendingReview = interviews.filter((item) => isCompletedInterview(item) && !item.recruiterDecisionStatus).length

    return { total, active, completed, pendingReview }
  }, [interviews])

  function handleDecisionSaved(interview, decision) {
    setInterviews((current) => {
      const nextRows = current.map((item) => (
        item.interviewId === interview.interviewId
          ? {
              ...item,
              recruiterDecisionStatus: decision.status,
              recruiterDecisionAt: decision.decidedAt,
              recruiterDecisionNotes: decision.notes ?? item.recruiterDecisionNotes ?? null,
            }
          : item
      ))
      writeSessionJsonCache(cacheKey, nextRows)
      return nextRows
    })
  }

  const filterOptions = useMemo(() => {
    return {
      statuses: uniqueSorted(interviews.map((interview) => getRecruiterStatus(interview).key)),
      jobs: uniqueSorted(interviews.map((interview) => interview.jobTitle)),
    }
  }, [interviews])

  const filteredInterviews = useMemo(() => {
    const query = normalizeSearch(searchTerm)

    return interviews.filter((interview) => {
      const recruiterStatus = getRecruiterStatus(interview)
      const jobTitle = String(interview.jobTitle ?? "")
      const accessType = String(interview.accessType ?? "FLEXIBLE").toUpperCase()
      const evaluationState = getEvaluationState(interview)
      const searchable = [
        interview.candidateName,
        interview.jobTitle,
        interview.status,
        recruiterStatus.label,
        recruiterStatus.description,
        interview.decision,
        interview.interviewType,
        getAccessLabel(interview),
      ]
        .map((value) => String(value ?? "").toLowerCase())
        .join(" ")

      const matchesSearch = !query || searchable.includes(query)
      const matchesStatus = statusFilter === "ALL" || recruiterStatus.key === statusFilter
      const matchesJob = jobFilter === "ALL" || jobTitle === jobFilter
      const matchesAccess = accessFilter === "ALL" || accessType === accessFilter
      const matchesEvaluation = evaluationFilter === "ALL" || evaluationState === evaluationFilter

      return matchesSearch && matchesStatus && matchesJob && matchesAccess && matchesEvaluation
    }).sort((left, right) => getInterviewActivityTime(right) - getInterviewActivityTime(left))
  }, [interviews, searchTerm, statusFilter, jobFilter, accessFilter, evaluationFilter])

  const hasActiveFilters =
    searchTerm || statusFilter !== "ALL" || jobFilter !== "ALL" || accessFilter !== "ALL" || evaluationFilter !== "ALL"
  const summaryInterview = summaryInterviewId
    ? interviews.find((interview) => interview.interviewId === summaryInterviewId) ?? null
    : null

  function clearFilters() {
    setSearchTerm("")
    setStatusFilter("ALL")
    setJobFilter("ALL")
    setAccessFilter("ALL")
    setEvaluationFilter("ALL")
  }

  async function retryPreparation(interview) {
    try {
      setActionBusyId(interview.interviewId)
      const response = await fetch(buildAuthUrl(`/api/interview/${interview.interviewId}/retry-preparation`, searchParams), {
        method: "POST",
        credentials: "include",
      })
      const data = await response.json()
      if (!response.ok || !data.success) {
        throw new Error(data?.error?.message || data?.message || "Failed to retry preparation")
      }
      await loadInterviews()
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Failed to retry preparation")
    } finally {
      setActionBusyId("")
    }
  }

  async function retryEmail(interview) {
    try {
      setActionBusyId(interview.interviewId)
      const response = await fetch(buildAuthUrl(`/api/interview/${interview.interviewId}/retry-email`, searchParams), {
        method: "POST",
        credentials: "include",
      })
      const data = await response.json()
      if (!response.ok || !data.success) {
        throw new Error(data?.error?.message || data?.message || "Failed to retry email")
      }
      await loadInterviews()
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Failed to retry email")
    } finally {
      setActionBusyId("")
    }
  }

  async function copyLink(interview) {
    if (!interview.link) {
      return
    }

    const copied = await copyText(interview.link)
    if (copied) {
      setCopiedInterviewId(interview.interviewId)
      setTimeout(() => setCopiedInterviewId(""), 1600)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 text-white">
        <Navbar onSendInterviewClick={() => setOpenSendInterview(true)} />
        <VerisGlobeLoader
          eyebrow="Interviews"
          viewportOffset="navbar"
          steps={[
            { label: "Loading interviews", detail: "Fetching active, scheduled, and completed interviews." },
            { label: "Syncing telemetry", detail: "Preparing scorecards, recovery status, and recruiter actions." },
            { label: "Building register", detail: "Organizing interview operations for review." },
            { label: "Interviews ready", detail: "Interview data is ready for review." },
          ]}
          activeIndex={1}
        />
      </div>
    )
  }

  return (
    <div className="hv-page-enter min-h-screen bg-slate-950 text-white">
      <Navbar onSendInterviewClick={() => setOpenSendInterview(true)} />

      <main className="mx-auto max-w-[1600px] px-4 py-8 sm:px-6 lg:px-8">
        <section className="rounded-2xl border border-slate-800 bg-slate-900/80 p-8 shadow-[0_14px_44px_rgba(2,6,23,0.22)]">
          <div className="flex flex-col gap-8 xl:flex-row xl:items-end xl:justify-between">
            <div className="max-w-3xl">
              <p className="text-xs font-semibold uppercase tracking-[0.32em] text-slate-500">Interview Registry</p>
              <h1 className="mt-4 text-4xl font-semibold tracking-tight text-white">All Interviews</h1>
              <p className="mt-4 text-base leading-7 text-slate-400">
                Current interview operations across flexible and scheduled access windows, with score and decision visibility where evaluation is complete.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-4 xl:min-w-[680px]">
              <div className="rounded-2xl border border-slate-800 bg-slate-950/35 p-4">
                <p className="text-sm text-slate-500">Total Interviews</p>
                <p className="mt-3 text-3xl font-semibold text-white">{stats.total}</p>
              </div>
              <div className="rounded-2xl border border-slate-800 bg-slate-950/35 p-4">
                <p className="text-sm text-slate-500">Active Queue</p>
                <p className="mt-3 text-3xl font-semibold text-white">{stats.active}</p>
              </div>
              <div className="rounded-2xl border border-slate-800 bg-slate-950/35 p-4">
                <p className="text-sm text-slate-500">Completed</p>
                <p className="mt-3 text-3xl font-semibold text-white">{stats.completed}</p>
              </div>
              <div className="rounded-2xl border border-cyan-400/15 bg-cyan-400/5 p-4">
                <p className="text-sm text-slate-500">Pending Review</p>
                <p className="mt-3 text-3xl font-semibold text-cyan-100">{stats.pendingReview}</p>
              </div>
            </div>
          </div>
        </section>

        <section className="mt-8 overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/80 shadow-[0_14px_44px_rgba(2,6,23,0.2)]">
          <div className="flex flex-col gap-4 border-b border-slate-800 px-6 py-5 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-white">Interview Register</h2>
              <p className="mt-1 text-sm text-slate-400">
                Showing {filteredInterviews.length} of {interviews.length} interviews under the current recruiter organization.
              </p>
            </div>

            <BackToDashboardLink className="inline-flex w-fit items-center justify-center gap-2 rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-300 transition hover:border-slate-500 hover:text-white" />
          </div>

          <div className="border-b border-slate-800 bg-slate-950/30 px-6 py-5">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Status Guide</p>
                <p className="mt-1 text-sm text-slate-400">Recruiter-facing labels describe what happened in the candidate session.</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {STATUS_GUIDE_KEYS.map((key) => {
                  const item = RECRUITER_STATUS_DEFINITIONS[key]

                  return (
                    <div key={key} className="rounded-xl border border-slate-800 bg-slate-950/40 px-4 py-3">
                      <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold tracking-[0.12em] ${getStatusBadge(key)}`}>
                        {item.label}
                      </span>
                      <p className="mt-2 text-xs leading-5 text-slate-400">{item.description}</p>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

          <div className="grid gap-4 border-b border-slate-800 bg-slate-950/20 px-6 py-5 xl:grid-cols-[minmax(220px,1.2fr)_repeat(4,minmax(150px,0.7fr))_auto]">
            <label className="grid gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
              Search
              <input
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Search candidate, job, status"
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
              label="Access"
              value={accessFilter}
              onChange={setAccessFilter}
              options={[
                { value: "ALL", label: "All Access" },
                { value: "FLEXIBLE", label: "Flexible" },
                { value: "SCHEDULED", label: "Scheduled" },
              ]}
            />
            <FilterSelect
              label="Evaluation"
              value={evaluationFilter}
              onChange={setEvaluationFilter}
              options={[
                { value: "ALL", label: "All Evaluations" },
                { value: "COMPLETED", label: "Completed" },
                { value: "SCORED", label: "Scored" },
                { value: "PENDING", label: "Pending" },
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

          <div className="max-h-[calc(100vh-320px)] min-h-[380px] overflow-y-auto overflow-x-hidden overscroll-contain">
            <table className="w-full table-fixed text-sm">
              <colgroup>
                <col className="w-[9%]" />
                <col className="w-[11%]" />
                <col className="w-[15%]" />
                <col className="w-[10%]" />
                <col className="w-[10%]" />
                <col className="w-[6%]" />
                <col className="w-[7%]" />
                <col className="w-[12%]" />
                <col className="w-[11%]" />
                <col className="w-[9%]" />
              </colgroup>
              <thead className="sticky top-0 z-10 bg-slate-950 text-slate-400 shadow-[0_1px_0_rgba(30,41,59,0.9)]">
                <tr>
                  <th className="px-4 py-5 text-left font-medium">Candidate</th>
                  <th className="px-4 py-5 text-center font-medium">Recording</th>
                  <th className="px-4 py-5 text-left font-medium">Job</th>
                  <th className="px-4 py-5 text-left font-medium">Status</th>
                  <th className="px-4 py-5 text-left font-medium">Interview Type</th>
                  <th className="px-4 py-5 text-left font-medium">Score</th>
                  <th className="px-4 py-5 text-left font-medium">Decision</th>
                  <th className="px-4 py-5 text-left font-medium">Latest Activity</th>
                  <th className="px-4 py-5 text-left font-medium">Hiring Action</th>
                  <th className="px-4 py-5 text-center font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                  {interviews.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="p-10 text-center text-slate-400">No interviews available</td>
                  </tr>
                ) : filteredInterviews.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="p-10 text-center text-slate-400">No interviews match the current filters</td>
                  </tr>
                ) : (
                  filteredInterviews.map((interview) => {
                    const recruiterStatus = getRecruiterStatus(interview)

                    return (
                    <Fragment key={interview.interviewId}>
                    <tr className="border-t border-slate-800/80 text-slate-200">
                      <td className="px-4 py-5 font-medium text-white">
                        <span className="block truncate" title={interview.candidateName || "Candidate"}>
                          {interview.candidateName}
                        </span>
                      </td>
                      <td className="px-4 py-5 text-center">
                        {interview.hasRecording && interview.recordingUrl ? (
                          <Link
                            href={interview.recordingUrl}
                            target="_blank"
                            rel="noreferrer"
                            className={recordingAction}
                            aria-label={`View recording for ${interview.candidateName}`}
                          >
                            <Video className="h-4 w-4 shrink-0" aria-hidden="true" />
                            <span className="truncate">View Recording</span>
                          </Link>
                        ) : interview.recordingId ? (
                          <span className={tableProcessingChip}>
                            Processing
                          </span>
                        ) : (
                          <span className={tableMutedChip}>
                            Not available
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-5 text-slate-300"><span className="block truncate">{interview.jobTitle}</span></td>
                      <td className="px-4 py-5">
                        <span
                          className={`inline-flex rounded-full border px-3 py-1 text-xs font-medium tracking-[0.12em] ${getStatusBadge(recruiterStatus.key)}`}
                          title={recruiterStatus.description}
                        >
                          {recruiterStatus.label}
                        </span>
                      </td>
                      <td className="px-4 py-5 text-slate-300"><span className="block truncate">{getAccessLabel(interview)}</span></td>
                      <td className="px-4 py-5 text-slate-300">{formatScore(interview.score)}</td>
                      <td className="px-4 py-5 text-slate-300"><span className="block truncate">{interview.decision ?? "-"}</span></td>
                      <td className="px-4 py-5 text-slate-400"><span className="block truncate">{formatDateTime(getInterviewActivityValue(interview))}</span></td>
                      <td className="px-4 py-5 align-middle">
                        {isEarlyExitInterview(interview) ? (
                          <span className="text-amber-200/80">{getEarlyExitText(interview)}</span>
                        ) : isCompletedInterview(interview) ? (
                          interview.recruiterDecisionStatus ? (
                            <DecisionPill status={interview.recruiterDecisionStatus} />
                          ) : (
                            <button
                              type="button"
                              onClick={() => setReviewInterview(interview)}
                              className={tableActionCyan}
                              aria-label={`Take hiring action for ${interview.candidateName}`}
                            >
                              <FileText className="h-4 w-4 shrink-0" aria-hidden="true" />
                              Take Action
                            </button>
                          )
                        ) : (
                          <span className="text-slate-600">After completion</span>
                        )}
                      </td>
                      <td className="px-4 py-5 text-center">
                        {isEarlyExitInterview(interview) ? (
                          <span className="inline-flex max-w-full items-center justify-center rounded-lg px-1.5 py-1 text-xs font-semibold leading-tight text-amber-100">
                            Exited Early
                          </span>
                        ) : isCompletedInterview(interview) ? (
                          <div className="flex flex-col items-start gap-1.5">
                            <button
                              type="button"
                              onClick={() => openInterviewSummary(interview)}
                              className={tableActionEmerald}
                              aria-label={`View completed summary for ${interview.candidateName}`}
                            >
                              <FileText className="h-4 w-4 shrink-0" aria-hidden="true" />
                              View Summary
                            </button>
                          </div>
                        ) : String(interview.status).toUpperCase() === "PREPARATION_FAILED" ? (
                          <button
                            type="button"
                            onClick={() => retryPreparation(interview)}
                            disabled={actionBusyId === interview.interviewId}
                            className={tableActionRose}
                          >
                            <RotateCw className="h-4 w-4 shrink-0" aria-hidden="true" />
                            {actionBusyId === interview.interviewId ? "Retrying..." : "Retry Prep"}
                          </button>
                        ) : String(interview.status).toUpperCase() === "EMAIL_FAILED" ? (
                          <div className="flex flex-col items-center gap-2">
                            <button
                              type="button"
                              onClick={() => copyLink(interview)}
                              disabled={!interview.link}
                              className={tableActionNeutral}
                            >
                              <Link2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                              {copiedInterviewId === interview.interviewId ? "Copied" : "Copy Link"}
                            </button>
                            <button
                              type="button"
                              onClick={() => retryEmail(interview)}
                              disabled={actionBusyId === interview.interviewId}
                              className={tableActionAmber}
                            >
                              <RotateCw className="h-4 w-4 shrink-0" aria-hidden="true" />
                              {actionBusyId === interview.interviewId ? "Sending..." : "Retry Email"}
                            </button>
                          </div>
                        ) : String(interview.status).toUpperCase() === "READY" ? (
                          <button
                            type="button"
                            onClick={() => copyLink(interview)}
                            disabled={!interview.link}
                            className={tableActionNeutral}
                          >
                            <Link2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                            {copiedInterviewId === interview.interviewId ? "Copied" : "Copy Link"}
                          </button>
                        ) : (
                          <span className="text-slate-600">-</span>
                        )}
                      </td>
                    </tr>
                    </Fragment>
                    )
                  })
                )}
                </tbody>
            </table>
          </div>
        </section>
      </main>

      <CandidateActionModal
        isOpen={Boolean(reviewInterview)}
        candidate={reviewInterview}
        searchParams={searchParams}
        onClose={() => setReviewInterview(null)}
        onDecisionSaved={(decision) => {
          if (reviewInterview) {
            handleDecisionSaved(reviewInterview, decision)
          }
        }}
      />
      {summaryInterview ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 px-4 py-6 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label={`Completed interview summary for ${summaryInterview.candidateName || "candidate"}`}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setSummaryInterviewId("")
            }
          }}
        >
          <div className="w-full max-w-6xl">
            <CompletedInterviewDetails
              interview={summaryInterview}
              onClose={() => setSummaryInterviewId("")}
              onDownload={() => downloadInterviewReport(summaryInterview)}
              isDownloading={reportDownloadId === summaryInterview.interviewId}
              isLoadingDetails={detailLoadingId === summaryInterview.interviewId}
            />
          </div>
        </div>
      ) : null}
      <SendInterviewModal isOpen={openSendInterview} onClose={() => setOpenSendInterview(false)} />
    </div>
  )
}

