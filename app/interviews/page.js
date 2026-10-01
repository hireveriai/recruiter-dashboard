"use client"

import Link from "next/link"
import { useEffect, useMemo, useRef, useState } from "react"
import { ChevronLeft, ChevronRight, CircleCheck, Download, Ellipsis, FileText, FileWarning, Info, Link2, MessageSquare, RotateCw, TriangleAlert, Video } from "lucide-react"
import { useAuthSearchParams } from "@/lib/client/use-auth-search-params"

import { buildAuthUrl } from "@/lib/client/auth-query"
import { copyText } from "@/lib/client/copy-to-clipboard"
import { formatDate, formatDateTime, formatTime } from "@/lib/client/date-format"
import { formatLabel } from "@/lib/client/format-label"
import { isSessionJsonCacheFresh, readSessionJsonCache, writeSessionJsonCache } from "@/lib/client/session-json-cache"

import BackToDashboardLink from "../../components/BackToDashboardLink"
import FeatureLockedNotice from "@/components/FeatureLockedNotice"
import Navbar from "../../components/Navbar"
import SendInterviewModal from "../../components/SendInterviewModal"
import LiveInterviewsPanel from "../../components/veris-live/LiveInterviewsPanel"
import { CandidateActionModal } from "../../components/dashboard/CandidateActionModal"
import { CandidateFeedbackModal } from "../../components/dashboard/CandidateFeedbackModal"
import { DecisionPill } from "../../components/dashboard/DecisionPill"
import { VerisGlobeLoader } from "../../components/system/loaders"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu"

const RECRUITER_STATUS_DEFINITIONS = {
  COMPLETED: {
    label: "Completed",
    description: "Candidate completed the full interview and the result is ready for review.",
  },
  NEEDS_REVIEW: {
    label: "Needs Review",
    description: "The session did not finish cleanly, so any score shown is partial. Open the session and check what was captured before making a decision.",
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

const STATUS_GUIDE_KEYS = ["COMPLETED", "NEEDS_REVIEW", "INTERRUPTED", "INCOMPLETE", "EXITED_EARLY", "IN_PROGRESS", "READY", "EXPIRED"]
// Shorter wording for the compact guide cards; row tooltips keep the full text.
const STATUS_GUIDE_TEXT = {
  NEEDS_REVIEW: "Session did not finish cleanly, so any score is partial. Check what was captured before deciding.",
}

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
  const interruptionReason = normalizeStatusKey(interview?.interruptionReason)
  const isFinalized = status === "COMPLETED" || interviewStatus === "COMPLETED"
  const requiredQuestionCount = Number(interview?.requiredQuestionCount ?? 0)
  const answeredQuestionCount = Number(interview?.answeredQuestionCount ?? 0)
  const completedAllQuestions =
    requiredQuestionCount > 0 && answeredQuestionCount >= requiredQuestionCount

  // Ahead of every completion check below, including isFinalized: a session the
  // platform failed to capture must never present as a finished interview.
  if (
    status === "NEEDS_REVIEW" ||
    interviewStatus === "NEEDS_REVIEW" ||
    finalStatus === "TRANSCRIPT_REVIEW_REQUIRED"
  ) {
    return "NEEDS_REVIEW"
  }

  if (isFinalized) {
    return "COMPLETED"
  }

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
    interruptionReason ||
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

// Every message states who/what caused the interruption up front, so a
// recruiter can immediately tell a candidate-side problem (their network,
// device, browser) apart from a VerisNova platform problem (our video/camera
// service) without needing to guess or ask engineering.
const INTERRUPTION_REASON_LABELS = {
  NETWORK_DISCONNECT_TIMEOUT: "Candidate-side network issue: their internet connection dropped and did not reconnect in time.",
  HEARTBEAT_TIMEOUT: "Candidate-side connectivity issue: their device stopped responding, most likely due to a weak or unstable internet connection. Answers submitted before the drop were preserved for evaluation.",
  HEARTBEAT_FAILURE: "Candidate-side connectivity issue: their device stopped responding, most likely due to a weak or unstable internet connection. Answers submitted before the drop were preserved for evaluation.",
  "HEARTBEAT TIMED OUT": "Candidate-side connectivity issue: their device stopped responding, most likely due to a weak or unstable internet connection. Answers submitted before the drop were preserved for evaluation.",
  WATCHDOG_TIMEOUT: "Candidate-side connectivity issue: their connection kept failing to recover, so VerisNova automatically closed the session after repeated reconnect attempts.",
  EXCESSIVE_RECONNECTS: "Candidate-side connectivity issue: their connection repeatedly dropped and reconnected throughout the session (usually unstable WiFi or mobile data), so VerisNova automatically closed it rather than let it continue indefinitely.",
  SESSION_TIME_EXPIRED: "Candidate did not finish within the scheduled interview time window.",
  TIMEOUT: "Candidate did not finish before the allotted interview time ran out.",
  TIME_EXPIRED: "Candidate did not finish before the allotted interview time ran out.",
  CAMERA_STREAM: "VerisNova platform issue: an internal camera-service restart interrupted the session. Not caused by the candidate.",
  "CAMERA STREAM INTERRUPTED.": "VerisNova platform issue: an internal camera-service restart interrupted the session. Not caused by the candidate.",
  CAMERA_TRACK_ENDED: "Candidate-side device issue: their browser reported the camera feed ending unexpectedly (often the OS or browser revoking camera access mid-interview).",
  CAMERA_ACQUISITION_FAILED: "Candidate-side device issue: their browser could not access the camera (often a permissions or device issue on their end).",
  LIVEKIT_ROOM: "VerisNova platform issue: an internal realtime video-service restart interrupted the session. Not caused by the candidate.",
  "REALTIME INTERVIEW LINK WAS INTERRUPTED.": "VerisNova platform issue: an internal realtime video-service restart interrupted the session. Not caused by the candidate.",
  LIVEKIT_DISCONNECTED: "Connection issue (candidate network or a temporary platform issue): the realtime video connection was lost and did not recover even after automatic reconnect attempts.",
  CAMERA_FAILURE: "Candidate-side device issue: their camera became unavailable during the interview.",
  MICROPHONE_FAILURE: "Candidate-side device issue: their microphone became unavailable during the interview.",
  BROWSER_CLOSE: "Candidate closed the browser or interview tab before finishing.",
  TAB_CLOSE: "Candidate closed the interview tab before finishing.",
  DISCONNECT: "Candidate-side network issue: they lost their internet connection during the interview.",
}

function getInterruptionReason(interview) {
  // Deliberately not gated on status any more: the caller decides when to show
  // this, and gating here hid recorded causes on every session whose status was
  // wrong. Returns null only when nothing was actually recorded.
  const rawReason = [
    interview?.interruptionReason,
    interview?.disconnectReason,
    interview?.terminationReason,
    interview?.terminationType,
  ].find((value) => String(value ?? "").trim())

  if (!rawReason) {
    return null
  }

  const normalized = normalizeStatusKey(rawReason)
  if (INTERRUPTION_REASON_LABELS[normalized]) {
    return INTERRUPTION_REASON_LABELS[normalized]
  }

  const reason = String(rawReason).trim()
  return reason.includes("_") || reason === reason.toUpperCase()
    ? formatStatusText(reason)
    : reason
}

// The info icon used to appear only when the status happened to be INTERRUPTED,
// so on every session that was mislabelled COMPLETED the recruiter saw nothing
// at all -- no icon, no reason -- even though the cause had been recorded. It
// now shows for any session that did not finish cleanly, and leads with who was
// responsible so a recruiter can answer "the candidate says it glitched"
// without guessing.
const FAULT_NOTE_STATUSES = new Set([
  "NEEDS_REVIEW",
  "INTERRUPTED",
  "INCOMPLETE",
  "EXITED_EARLY",
])

function pluralResponses(count) {
  return `${count} ${count === 1 ? "response" : "responses"}`
}

/**
 * Recruiter-facing account of what went wrong. When the cause was ours it says
 * so plainly and clears the candidate, because a recruiter reading a partial
 * score must never be left thinking the candidate skipped an answer.
 */
function getFaultNote(interview, statusKey) {
  if (!FAULT_NOTE_STATUSES.has(statusKey)) {
    return null
  }

  const attribution = interview?.faultAttribution
  const legacyReason = getInterruptionReason(interview)

  if (!attribution) {
    return legacyReason
      ? { party: "INDETERMINATE", heading: "Session issue", tooltip: legacyReason }
      : null
  }

  const isPlatformFault = attribution.party === "VERISNOVA"
  const reconstructed = Number(interview?.reconstructedResponses ?? 0)
  const unrecovered = Number(interview?.unrecoveredResponses ?? 0)

  if (!isPlatformFault) {
    const evidence = Array.isArray(attribution.evidence) ? attribution.evidence : []
    return {
      party: attribution.party,
      heading: attribution.title,
      tooltip: [attribution.detail, ...(evidence.length > 0 ? ["", ...evidence.map((line) => `• ${line}`)] : [])].join("\n"),
    }
  }

  const recovered = []
  if (reconstructed > 0) recovered.push(`• ${pluralResponses(reconstructed)} reconstructed`)
  if (unrecovered > 0) recovered.push(`• ${pluralResponses(unrecovered)} unavailable`)

  const lines = [
    "PLATFORM RECORDING ISSUE",
    "",
    "VerisNova was unable to record one or more candidate responses.",
    "",
    "The candidate is not at fault. Some interview evidence is incomplete, so the score and VERIS decision should be reviewed before making a hiring decision.",
  ]

  if (recovered.length > 0) {
    lines.push("", "What we recovered:", ...recovered)
  }

  if (interview?.creditRefunded) {
    lines.push("", "Interview credit:", "✓ Refunded")
  }

  return {
    party: attribution.party,
    heading: "Platform recording issue",
    tooltip: lines.join("\n"),
  }
}

/**
 * True when the platform lost evidence this interview was scored on. The score
 * is still shown -- the backend already calculated it -- but it must never read
 * as a complete, final assessment.
 */
function hasIncompleteEvidence(interview, statusKey) {
  if (!FAULT_NOTE_STATUSES.has(statusKey)) return false
  if (interview?.faultAttribution?.party !== "VERISNOVA") return false
  return Number(interview?.unrecoveredResponses ?? 0) > 0
}

function getEvidenceCompleteness(interview) {
  const completeness = interview?.evidenceCompleteness
  if (!completeness) return null
  const total = Number(completeness.total ?? 0)
  const available = Number(completeness.available ?? 0)
  if (!Number.isFinite(total) || total <= 0) return null
  if (available >= total) return null
  return { available, total }
}

// The fault note used to ride on the native title attribute, which Chrome
// paints as browser chrome: a black box regardless of the page theme. It is
// a real element now so it can follow light mode. Positioned fixed rather
// than absolute because the status cell clips its overflow and the table
// body scrolls -- an absolute panel would be cut off at the cell edge.
const FAULT_TOOLTIP_WIDTH = 380

function FaultNote({ note }) {
  const anchorRef = useRef(null)
  const [position, setPosition] = useState(null)

  const show = () => {
    const rect = anchorRef.current?.getBoundingClientRect()

    if (!rect) {
      return
    }

    const left = Math.max(12, Math.min(rect.left, window.innerWidth - FAULT_TOOLTIP_WIDTH - 12))
    // Flip above the icon when the panel would run past the bottom of the
    // viewport, which it does for the last rows of a full table.
    const opensUpward = rect.bottom + 260 > window.innerHeight && rect.top > 260

    setPosition({
      left,
      top: opensUpward ? undefined : rect.bottom + 8,
      bottom: opensUpward ? window.innerHeight - rect.top + 8 : undefined,
    })
  }

  const hide = () => setPosition(null)

  // A fixed panel does not travel with the row, so anything that moves the
  // anchor underneath it has to close it rather than leave it stranded.
  useEffect(() => {
    if (!position) {
      return undefined
    }

    const close = () => setPosition(null)

    window.addEventListener("scroll", close, true)
    window.addEventListener("resize", close)

    return () => {
      window.removeEventListener("scroll", close, true)
      window.removeEventListener("resize", close)
    }
  }, [position])

  return (
    <span className="inline-flex shrink-0">
      <span
        ref={anchorRef}
        tabIndex={0}
        role="button"
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        aria-label={note.tooltip}
        className={`inline-flex h-5 w-5 shrink-0 cursor-help items-center justify-center rounded-full outline-none transition focus-visible:ring-2 ${
          note.party === "VERISNOVA"
            ? "text-rose-200/80 hover:bg-rose-400/10 hover:text-rose-100 focus-visible:bg-rose-400/10 focus-visible:text-rose-100 focus-visible:ring-rose-300/60"
            : "text-sky-200/75 hover:bg-sky-400/10 hover:text-sky-100 focus-visible:bg-sky-400/10 focus-visible:text-sky-100 focus-visible:ring-sky-300/60"
        }`}
      >
        <Info className="h-4 w-4" aria-hidden="true" />
      </span>

      {position ? (
        <span
          role="tooltip"
          style={{ left: position.left, top: position.top, bottom: position.bottom, width: FAULT_TOOLTIP_WIDTH }}
          className="hv-fault-tooltip pointer-events-none fixed z-50 max-w-[86vw] whitespace-pre-wrap rounded-xl border px-4 py-3 text-left text-xs font-normal leading-5"
        >
          {note.tooltip}
        </span>
      ) : null}
    </span>
  )
}

function getStatusBadge(status) {
  const normalized = String(status ?? "PENDING").toUpperCase()
  if (normalized === "COMPLETED") return "border-emerald-500/20 bg-emerald-500/10 text-emerald-300"
  if (normalized === "NEEDS_REVIEW") return "border-amber-400/25 bg-amber-400/10 text-amber-200"
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

// Names typed entirely in capitals (or lowercase) read as shouting in a long
// list, so they are shown in title case. Mixed-case names stay as entered.
function displayCandidateName(name) {
  const value = String(name ?? "").trim()
  if (!value) return "Candidate"
  if (value !== value.toUpperCase() && value !== value.toLowerCase()) return value
  return value.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_, lead, letter) => lead + letter.toUpperCase())
}

function candidateInitials(name) {
  const parts = String(name ?? "").trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "?"
  const first = parts[0].charAt(0)
  const last = parts.length > 1 ? parts[parts.length - 1].charAt(0) : ""
  return (first + last).toUpperCase()
}

// Colour for the score bar only; the hiring decision stays with the recruiter.
function scoreTone(score) {
  if (score === null || score === undefined || !Number.isFinite(Number(score))) return null
  if (score >= 70) return { text: "text-emerald-300", bar: "bg-emerald-400" }
  if (score >= 40) return { text: "text-amber-300", bar: "bg-amber-400" }
  return { text: "text-rose-300", bar: "bg-rose-400" }
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
    <label className="grid gap-1.5 text-[11px] font-semibold uppercase leading-none tracking-[0.12em] text-slate-500">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 min-w-0 rounded-xl border border-slate-700 bg-slate-950/70 px-3 text-[13px] font-medium normal-case tracking-normal text-slate-200 outline-none transition focus:border-cyan-300/60 focus:ring-2 focus:ring-cyan-300/10"
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

function isCompletedInterview(interview) {
  return getRecruiterStatusKey(interview) === "COMPLETED"
}

function isEarlyExitInterview(interview) {
  const status = String(interview?.status ?? interview?.attemptStatus ?? "").toUpperCase()
  return Boolean(interview?.earlyExit) || ["EARLY_EXIT", "MANUAL_EXIT"].includes(status)
}

function getAccessLabel(item) {
  if (String(item.accessType ?? "FLEXIBLE").toUpperCase() === "SCHEDULED") {
    return item.startTime ? `Scheduled · ${formatDateTime(item.startTime)}` : "Scheduled"
  }

  return "Flexible"
}

function normalizeRecruiterDecision(status) {
  const normalized = String(status ?? "").trim().toUpperCase()
  if (normalized === "REVIEWED") {
    return "REVIEW_REQUIRED"
  }

  return normalized || "PENDING"
}

function formatLatestActivity(value) {
  const time = formatTime(value, undefined, { withTimezone: false })
    .replace(/\bAM\b/, "A.M.")
    .replace(/\bPM\b/, "P.M.")

  return {
    date: formatDate(value),
    time,
  }
}

const tableMutedChip =
  "inline-flex max-w-full items-center rounded-lg py-1 text-xs font-medium leading-none text-slate-600"
const tableProcessingChip =
  "inline-flex max-w-full items-center rounded-lg py-1 text-xs font-medium leading-none text-amber-100"
const recordingAction =
  "hv-recording-action inline-flex h-7 max-w-full items-center gap-1.5 whitespace-nowrap rounded-lg border border-cyan-400/25 bg-cyan-400/[0.06] px-2.5 text-xs font-semibold leading-none transition"
const rowNoteChip =
  "inline-flex max-w-full items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-medium leading-4"
const PAGE_SIZE_OPTIONS = [50, 100, 200, 500]
const PAGE_SIZE_STORAGE_KEY = "verisnova-interviews-page-size"

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

const ROW_NOTE_TONES = {
  rose: "border-rose-500/25 bg-rose-500/10 text-rose-300",
  emerald: "border-emerald-500/25 bg-emerald-500/10 text-emerald-300",
  amber: "border-amber-500/25 bg-amber-500/10 text-amber-300",
}

function CompletedInterviewDetails({ interview, onClose, onDownload, isDownloading = false, isLoadingDetails = false }) {
  if (!interview) {
    return null
  }

  const answerSummaries = Array.isArray(interview.answerSummaries) ? interview.answerSummaries : []

  return (
    <div className="hv-completed-summary-modal hv-theme-modal relative flex max-h-[88vh] flex-col overflow-hidden rounded-[24px] border border-slate-700/70 bg-[#0a1020]/95 shadow-[0_30px_80px_rgba(2,6,23,0.55)]">
        <div className="flex shrink-0 flex-col gap-3 border-b border-slate-800 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-7 sm:py-5">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-300">VERIS Insight</p>
            <h3 className="mt-1 text-xl font-semibold text-white sm:text-2xl">Completed Interview Summary</h3>
            <p className="mt-0.5 truncate text-sm text-slate-400">
              {interview.candidateName || "Candidate"} · {interview.jobTitle || "Role"}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onDownload}
              disabled={isDownloading}
              className="hv-solid-action self-start rounded-xl bg-cyan-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-60 sm:self-auto"
            >
              <span className="inline-flex items-center gap-2">
                <Download className="h-4 w-4" aria-hidden="true" />
                {isDownloading ? "Generating PDF..." : "Download Report"}
              </span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="self-start rounded-xl border border-slate-700 bg-slate-900/80 px-4 py-2 text-sm text-slate-300 transition hover:border-cyan-300/60 hover:text-white sm:self-auto"
            >
              Close
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-5 py-5 sm:px-7 sm:py-6">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="hv-completed-summary-card rounded-xl border border-slate-800 bg-slate-950/35 p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Score</p>
              <p className="mt-2 text-2xl font-semibold tabular-nums text-white">{formatScore(interview.score)}</p>
            </div>
            <div className="hv-completed-summary-card rounded-xl border border-slate-800 bg-slate-950/35 p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Decision</p>
              <p className="mt-2 text-2xl font-semibold text-white">{interview.decision || "-"}</p>
            </div>
            <div className="hv-completed-summary-card rounded-xl border border-slate-800 bg-slate-950/35 p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Completed</p>
              <p className="mt-2 text-base font-semibold text-white">{formatDateTime(interview.endedAt || interview.createdAt)}</p>
            </div>
          </div>

          <div className="mt-6">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Transcript + Result</p>
                <h4 className="mt-1 text-base font-semibold text-white">Question, Answer and VERIS Evaluation</h4>
              </div>
              <p className="text-xs text-slate-500">{answerSummaries.length} recorded answer{answerSummaries.length === 1 ? "" : "s"}</p>
            </div>

            {isLoadingDetails ? (
              <div className="mt-4 rounded-xl border border-cyan-400/15 bg-cyan-400/5 p-5 text-sm leading-7 text-cyan-100">
                Loading transcript and answer-level VERIS feedback...
              </div>
            ) : answerSummaries.length === 0 ? (
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
                    <article key={answer.answerId || `${answer.question}-${index}`} className="hv-completed-summary-card rounded-xl border border-slate-800 bg-slate-950/35 p-4 sm:p-5">
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

                      <div className="hv-completed-summary-subcard mt-3 rounded-lg border border-slate-800/80 bg-slate-900/50 p-3.5">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Candidate Transcript</p>
                        <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-slate-300">{answer.answerText || "No response provided."}</p>
                        {duration !== null && duration !== undefined ? (
                          <p className="mt-2 text-xs text-slate-500">Duration: {duration}s</p>
                        ) : null}
                      </div>

                      <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_1.4fr]">
                        <div className="hv-completed-summary-subcard rounded-lg border border-slate-800/80 bg-slate-900/50 p-3.5">
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

                        <div className="hv-completed-summary-subcard rounded-lg border border-cyan-300/15 bg-cyan-400/[0.05] p-3.5">
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
  // AI Interviews / VERIS Live Interviews switch (only when VERIS Live is enabled).
  // ?view=live opens straight on the Live list (linked from the dashboard card).
  const [interviewView, setInterviewView] = useState(() => (searchParams.get("view") === "live" ? "live" : "ai"))
  const [liveEnabled, setLiveEnabled] = useState(false)

  useEffect(() => {
    let active = true
    fetch(buildAuthUrl("/api/veris-live/status", searchParams), { credentials: "include" })
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => {
        if (active) setLiveEnabled(body?.data?.enabled === true)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [searchParams])
  const [interviews, setInterviews] = useState([])
  const [loading, setLoading] = useState(true)
  const [summaryInterviewId, setSummaryInterviewId] = useState("")
  const [feedbackInterviewId, setFeedbackInterviewId] = useState("")
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
  const [recruiterDecisionFilter, setRecruiterDecisionFilter] = useState("ALL")
  const [lockedFeature, setLockedFeature] = useState(null)
  const [showStatusGuide, setShowStatusGuide] = useState(false)
  // Phones only: the five filters fold away behind a toggle.
  const [showFilters, setShowFilters] = useState(false)
  // The register is rendered only after loading, so reading storage here
  // cannot change the server-rendered markup.
  const [pageSize, setPageSize] = useState(() => (typeof window === "undefined" ? PAGE_SIZE_OPTIONS[0] : readStoredPageSize()))
  // The page belongs to one search/filter/page-size combination; changing any
  // of them starts again from page 1.
  const [pageState, setPageState] = useState({ key: "", page: 1 })
  const registerRef = useRef(null)

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
        if (!isMounted) {
          return
        }

        if (data?.error?.code === "FEATURE_NOT_IN_PLAN") {
          setLockedFeature(data.error.entitlement || "AI_INTERVIEW")
          return
        }

        if (data.success) {
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
      const recruiterDecision = normalizeRecruiterDecision(interview.recruiterDecisionStatus)
      const searchable = [
        interview.candidateName,
        interview.jobTitle,
        interview.status,
        recruiterStatus.label,
        recruiterStatus.description,
        interview.decision,
        recruiterDecision,
        interview.interviewType,
        getInterruptionReason(interview),
        // Lets a recruiter search "verisnova" to pull up every session our own
        // platform broke, or "candidate-side" for the converse.
        interview.faultAttribution?.party,
        interview.faultAttribution?.title,
        getAccessLabel(interview),
      ]
        .map((value) => String(value ?? "").toLowerCase())
        .join(" ")

      const matchesSearch = !query || searchable.includes(query)
      const matchesStatus = statusFilter === "ALL" || recruiterStatus.key === statusFilter
      const matchesJob = jobFilter === "ALL" || jobTitle === jobFilter
      const matchesAccess = accessFilter === "ALL" || accessType === accessFilter
      const matchesEvaluation = evaluationFilter === "ALL" || evaluationState === evaluationFilter
      const matchesRecruiterDecision = recruiterDecisionFilter === "ALL" || recruiterDecision === recruiterDecisionFilter

      return matchesSearch && matchesStatus && matchesJob && matchesAccess && matchesEvaluation && matchesRecruiterDecision
    }).sort((left, right) => getInterviewActivityTime(right) - getInterviewActivityTime(left))
  }, [interviews, searchTerm, statusFilter, jobFilter, accessFilter, evaluationFilter, recruiterDecisionFilter])

  const hasActiveFilters =
    searchTerm || statusFilter !== "ALL" || jobFilter !== "ALL" || accessFilter !== "ALL" || evaluationFilter !== "ALL" || recruiterDecisionFilter !== "ALL"
  const summaryInterview = summaryInterviewId
    ? interviews.find((interview) => interview.interviewId === summaryInterviewId) ?? null
    : null
  const feedbackInterview = feedbackInterviewId
    ? interviews.find((interview) => interview.interviewId === feedbackInterviewId) ?? null
    : null

  function handleCandidateFeedbackSent(interview, result) {
    setInterviews((current) =>
      current.map((item) =>
        item.interviewId === interview.interviewId
          ? {
              ...item,
              candidateFeedbackText: result.text,
              candidateFeedbackStatus: "sent",
              candidateFeedbackSentAt: result.sentAt,
              candidateFeedbackHiringDecision: result.hiringDecision,
            }
          : item
      )
    )
  }

  function clearFilters() {
    setSearchTerm("")
    setStatusFilter("ALL")
    setJobFilter("ALL")
    setAccessFilter("ALL")
    setEvaluationFilter("ALL")
    setRecruiterDecisionFilter("ALL")
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

  if (lockedFeature) {
    return <FeatureLockedNotice feature={lockedFeature} />
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

  // Everything a row needs, computed once and shared by the table (lg+) and
  // the stacked cards (below lg), so both show identical states and actions.
  const buildRowModel = (interview) => {
    const recruiterStatus = getRecruiterStatus(interview)
    const faultNote = getFaultNote(interview, recruiterStatus.key)
    const evidenceIncomplete = hasIncompleteEvidence(interview, recruiterStatus.key)
    const evidenceCompleteness = evidenceIncomplete ? getEvidenceCompleteness(interview) : null
    const incompleteEvidenceNote = evidenceIncomplete
      ? `Incomplete evidence — ${pluralResponses(Number(interview.unrecoveredResponses ?? 0))} could not be recovered. Review manually before making a hiring decision.`
      : ""
    const interviewStatus = normalizeStatusKey(interview.status)
    const isEarlyExit = isEarlyExitInterview(interview)
    const isCompleted = isCompletedInterview(interview)
    const canTakeAction = isCompleted && !isEarlyExit && !interview.recruiterDecisionStatus
    const canChangeDecision = isCompleted && !isEarlyExit && Boolean(interview.recruiterDecisionStatus)
    const canViewSummary = isCompleted && !isEarlyExit
    const canSendCandidateFeedback = isCompleted && !isEarlyExit
    const candidateFeedbackActionLabel = interview.candidateFeedbackText
      ? "Send Candidate Feedback"
      : "Generate Candidate Feedback"
    const canCopyLink =
      !isCompleted &&
      !isEarlyExit &&
      ["READY", "EMAIL_FAILED"].includes(interviewStatus) &&
      Boolean(interview.link)
    const canRetryPreparation = interviewStatus === "PREPARATION_FAILED"
    const canRetryEmail = interviewStatus === "EMAIL_FAILED"
    const hasHiringActions =
      canTakeAction || canChangeDecision || canViewSummary || canSendCandidateFeedback || canCopyLink || canRetryPreparation || canRetryEmail
    const latestActivity = formatLatestActivity(getInterviewActivityValue(interview))

    // Row-level notes sit in one strip under the row instead of
    // wrapping inside narrow columns.
    const rowNotes = [
      faultNote?.party === "VERISNOVA"
        ? { key: "fault", tone: "rose", icon: TriangleAlert, text: "Platform recording issue" }
        : null,
      interview.creditRefunded
        ? {
            key: "refund",
            tone: "emerald",
            icon: CircleCheck,
            text: "Interview credit refunded",
            title: "This interview was affected by a VerisNova recording issue. 1 interview credit has been returned to your account.",
          }
        : null,
      evidenceIncomplete
        ? {
            key: "evidence",
            tone: "amber",
            icon: FileWarning,
            text: evidenceCompleteness
              ? `Evidence ${evidenceCompleteness.available}/${evidenceCompleteness.total} recovered · review manually before deciding`
              : "Review manually before deciding",
            title: incompleteEvidenceNote,
          }
        : null,
    ].filter(Boolean)

    return {
      interview,
      recruiterStatus,
      faultNote,
      evidenceIncomplete,
      incompleteEvidenceNote,
      isEarlyExit,
      isCompleted,
      canTakeAction,
      canChangeDecision,
      canViewSummary,
      canSendCandidateFeedback,
      candidateFeedbackActionLabel,
      canCopyLink,
      canRetryPreparation,
      canRetryEmail,
      hasHiringActions,
      latestActivity,
      rowNotes,
      hasRowNotes: rowNotes.length > 0,
    }
  }

  const renderRecording = (interview) =>
    interview.hasRecording && interview.recordingUrl ? (
      <Link
        href={interview.recordingUrl}
        target="_blank"
        rel="noreferrer"
        className={recordingAction}
        aria-label={`View recording for ${interview.candidateName}`}
      >
        <Video className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>Watch</span>
      </Link>
    ) : interview.recordingId ? (
      <span className={tableProcessingChip}>
        Processing
      </span>
    ) : (
      <span className={tableMutedChip} title="Recording not available">
        <span aria-hidden="true">&ndash;</span>
        <span className="sr-only">Not available</span>
      </span>
    )

  // The candidate name opens the recording (same link and new tab as Watch);
  // without a recording it stays plain text.
  const renderCandidateName = (interview) => {
    const name = displayCandidateName(interview.candidateName)
    return interview.hasRecording && interview.recordingUrl ? (
      <Link
        href={interview.recordingUrl}
        target="_blank"
        rel="noreferrer"
        title={`Open recording for ${interview.candidateName || "candidate"}`}
        className="block truncate text-sm font-semibold text-white underline-offset-4 transition hover:text-cyan-200 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/50"
      >
        {name}
      </Link>
    ) : (
      <p className="truncate text-sm font-semibold text-white" title={interview.candidateName || "Candidate"}>
        {name}
      </p>
    )
  }

  const renderRecruiterDecision = (model) =>
    model.interview.recruiterDecisionStatus ? (
      <DecisionPill status={model.interview.recruiterDecisionStatus} />
    ) : model.isCompleted && !model.isEarlyExit ? (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-dashed border-cyan-400/40 px-2.5 py-0.5 text-[11px] font-semibold text-cyan-200">
        <span className="h-1.5 w-1.5 rounded-full bg-cyan-400" aria-hidden="true" />
        Awaiting decision
      </span>
    ) : null

  const renderRowNotes = (model) =>
    model.hasRowNotes ? (
      <div className="flex flex-wrap items-center gap-1.5">
        {model.rowNotes.map(({ key, tone, icon: NoteIcon, text, title }) => (
          <span key={key} className={`${rowNoteChip} ${ROW_NOTE_TONES[tone]}`} title={title}>
            <NoteIcon className="h-3 w-3 shrink-0" aria-hidden="true" />
            {text}
          </span>
        ))}
      </div>
    ) : null

  const renderActions = (model) => {
    const { interview } = model
    if (!model.hasHiringActions) {
      return null
    }

    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="hv-interview-actions-trigger inline-flex h-8 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-700 bg-slate-900/70 text-slate-300 transition hover:border-cyan-400/40 hover:bg-cyan-400/10 hover:text-cyan-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60"
            aria-label={`Open hiring actions for ${interview.candidateName || "candidate"}`}
          >
            <Ellipsis className="h-4 w-4" aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          sideOffset={6}
          className="hv-interview-actions-menu hv-theme-popover min-w-48 border border-slate-700 bg-slate-900 p-1.5 text-slate-200 shadow-[0_18px_48px_rgba(2,6,23,0.55)] ring-0"
        >
          {model.canTakeAction || model.canChangeDecision ? (
            <DropdownMenuItem
              onSelect={() => setReviewInterview(interview)}
              className="hv-interview-action-item cursor-pointer gap-2.5 px-3 py-2.5 text-cyan-100 focus:bg-cyan-400/10 focus:text-cyan-50"
              data-tone="primary"
            >
              <FileText className="h-4 w-4 text-cyan-300" aria-hidden="true" />
              {model.canChangeDecision ? "Change Decision" : "Take Action"}
            </DropdownMenuItem>
          ) : null}
          {model.canViewSummary ? (
            <DropdownMenuItem
              onSelect={() => openInterviewSummary(interview)}
              className="hv-interview-action-item cursor-pointer gap-2.5 px-3 py-2.5 text-emerald-100 focus:bg-emerald-400/10 focus:text-emerald-50"
              data-tone="success"
            >
              <FileText className="h-4 w-4 text-emerald-300" aria-hidden="true" />
              View Summary
            </DropdownMenuItem>
          ) : null}
          {model.canSendCandidateFeedback ? (
            <DropdownMenuItem
              onSelect={() => setFeedbackInterviewId(interview.interviewId)}
              className="hv-interview-action-item cursor-pointer gap-2.5 px-3 py-2.5 text-sky-100 focus:bg-sky-400/10 focus:text-sky-50"
            >
              <MessageSquare className="h-4 w-4 text-sky-300" aria-hidden="true" />
              {model.candidateFeedbackActionLabel}
            </DropdownMenuItem>
          ) : null}
          {model.canCopyLink ? (
            <DropdownMenuItem
              onSelect={() => copyLink(interview)}
              className="cursor-pointer gap-2.5 px-3 py-2.5 text-slate-100 focus:bg-slate-800 focus:text-white"
            >
              <Link2 className="h-4 w-4 text-slate-300" aria-hidden="true" />
              {copiedInterviewId === interview.interviewId ? "Copied" : "Copy Link"}
            </DropdownMenuItem>
          ) : null}
          {model.canRetryPreparation ? (
            <DropdownMenuItem
              onSelect={() => retryPreparation(interview)}
              disabled={actionBusyId === interview.interviewId}
              className="cursor-pointer gap-2.5 px-3 py-2.5 text-rose-100 focus:bg-rose-400/10 focus:text-rose-50"
            >
              <RotateCw className="h-4 w-4 text-rose-300" aria-hidden="true" />
              {actionBusyId === interview.interviewId ? "Retrying..." : "Retry Preparation"}
            </DropdownMenuItem>
          ) : null}
          {model.canRetryEmail ? (
            <DropdownMenuItem
              onSelect={() => retryEmail(interview)}
              disabled={actionBusyId === interview.interviewId}
              className="cursor-pointer gap-2.5 px-3 py-2.5 text-amber-100 focus:bg-amber-400/10 focus:text-amber-50"
            >
              <RotateCw className="h-4 w-4 text-amber-300" aria-hidden="true" />
              {actionBusyId === interview.interviewId ? "Sending..." : "Retry Email"}
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  const renderPrimaryAction = (model, visibility = "inline-flex") => {
    const { interview } = model
    const name = interview.candidateName || "candidate"
    const busy = actionBusyId === interview.interviewId
    const base = `${visibility} h-8 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60 disabled:cursor-not-allowed disabled:opacity-60`
    const outline = `${base} border border-slate-700 bg-slate-900/60 text-slate-200 hover:border-cyan-400/40 hover:text-cyan-100`

    if (model.canTakeAction) {
      return (
        <button type="button" onClick={() => setReviewInterview(interview)} className={`${base} hv-solid-action bg-cyan-600 text-white hover:bg-cyan-500`}>
          Take Action
        </button>
      )
    }
    if (model.canViewSummary) {
      return (
        <button type="button" onClick={() => openInterviewSummary(interview)} className={outline}>
          Summary
        </button>
      )
    }
    if (model.canRetryEmail) {
      return (
        <button type="button" onClick={() => retryEmail(interview)} disabled={busy} aria-label={`Retry email for ${name}`} className={outline}>
          <RotateCw className="h-3.5 w-3.5" aria-hidden="true" />
          {busy ? "Sending..." : "Retry"}
        </button>
      )
    }
    if (model.canRetryPreparation) {
      return (
        <button type="button" onClick={() => retryPreparation(interview)} disabled={busy} aria-label={`Retry preparation for ${name}`} className={outline}>
          <RotateCw className="h-3.5 w-3.5" aria-hidden="true" />
          {busy ? "Retrying..." : "Retry"}
        </button>
      )
    }
    if (model.canCopyLink) {
      return (
        <button type="button" onClick={() => copyLink(interview)} aria-label={`Copy interview link for ${name}`} className={outline}>
          <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
          {copiedInterviewId === interview.interviewId ? "Copied" : "Copy Link"}
        </button>
      )
    }
    return null
  }

  const renderScore = (model) => {
    const { interview } = model
    const tone = scoreTone(interview.score)
    if (!tone) {
      return (
        <span className="text-slate-600" title="Not scored yet">
          <span aria-hidden="true">&ndash;</span>
          <span className="sr-only">Not scored</span>
        </span>
      )
    }
    return (
      <div className="w-full max-w-[76px]">
        <p className={`text-sm font-semibold tabular-nums leading-none ${tone.text}`}>
          {formatScore(interview.score)}
          {model.evidenceIncomplete ? (
            <span className="text-amber-300" title={model.incompleteEvidenceNote}>*</span>
          ) : null}
        </p>
        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-slate-800" aria-hidden="true">
          <div className={`h-full rounded-full ${tone.bar}`} style={{ width: `${Math.max(3, Math.min(100, Math.round(interview.score)))}%` }} />
        </div>
      </div>
    )
  }

  const renderVerisDecision = (model) =>
    model.interview.decision ? (
      <span className="block max-w-full truncate text-[11px] text-slate-500">
        VERIS: <span className="font-medium text-slate-300">{formatStatusText(model.interview.decision)}</span>
        {model.evidenceIncomplete ? (
          <span className="text-amber-300" title={model.incompleteEvidenceNote}>*</span>
        ) : null}
      </span>
    ) : null

  const renderAvatar = (model, size = "h-9 w-9") => (
    <span
      aria-hidden="true"
      className={`flex ${size} shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
        model.canTakeAction ? "bg-cyan-400/15 text-cyan-200" : "bg-slate-800 text-slate-300"
      }`}
    >
      {candidateInitials(model.interview.candidateName)}
    </span>
  )

  const pagingKey = [searchTerm, statusFilter, jobFilter, accessFilter, evaluationFilter, recruiterDecisionFilter, pageSize].join("|")
  const pageCount = Math.max(1, Math.ceil(filteredInterviews.length / pageSize))
  const currentPage = Math.min(pageState.key === pagingKey ? pageState.page : 1, pageCount)
  const pageStart = (currentPage - 1) * pageSize
  const pageEnd = Math.min(pageStart + pageSize, filteredInterviews.length)

  const goToPage = (page) => {
    setPageState({ key: pagingKey, page: Math.min(Math.max(1, page), pageCount) })
    // Bring the first row of the new page into view.
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
      // Storage unavailable (private window, blocked site data): keep it for this visit only.
    }
  }

  const rowModels = filteredInterviews.slice(pageStart, pageEnd).map(buildRowModel)
  const activeFilterCount = [statusFilter, jobFilter, accessFilter, evaluationFilter, recruiterDecisionFilter].filter(
    (value) => value !== "ALL"
  ).length
  const emptyMessage =
    interviews.length === 0
      ? "No interviews available"
      : filteredInterviews.length === 0
        ? "No interviews match the current filters"
        : null

  return (
    <div className="hv-page-enter min-h-screen bg-slate-950 text-white">
      <Navbar onSendInterviewClick={() => setOpenSendInterview(true)} />

      <main className="mx-auto max-w-[1600px] space-y-5 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <header className="max-w-3xl">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-300">Interview Registry</p>
            <h1 className="mt-1.5 text-2xl font-semibold tracking-tight text-white sm:text-[1.75rem]">All Interviews</h1>
            <p className="mt-1 text-sm leading-6 text-slate-400">
              Current interview operations across flexible and scheduled access windows, with score and decision visibility where evaluation is complete.
            </p>
          </header>
          <BackToDashboardLink className="inline-flex w-fit items-center justify-center gap-2 rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-300 transition hover:border-slate-500 hover:text-white" />
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            ["Total Interviews", stats.total, false],
            ["Active Queue", stats.active, false],
            ["Completed", stats.completed, false],
            ["Pending Review", stats.pendingReview, true],
          ].map(([label, value, accent]) => (
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

        {liveEnabled ? (
          <div role="tablist" aria-label="Interview type" className="inline-flex rounded-xl border border-slate-800 bg-slate-900/80 p-1 shadow-sm">
            {[
              ["ai", "VERIS AI Interviews", "AI-led"],
              ["live", "VERIS Live Interviews", "Human-led"],
            ].map(([key, title, hint]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={interviewView === key}
                onClick={() => setInterviewView(key)}
                className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
                  interviewView === key ? "hv-solid-action bg-cyan-600 text-white shadow-sm" : "text-slate-400 hover:text-white"
                }`}
              >
                {title}
                <span className={`hidden rounded-full px-2 py-0.5 text-[10px] font-semibold sm:inline ${interviewView === key ? "bg-white/20" : "bg-slate-800/60"}`}>{hint}</span>
              </button>
            ))}
          </div>
        ) : null}

        <section
          ref={registerRef}
          aria-label="Interview Register"
          className={`hv-elevated-section scroll-mt-24 overflow-clip rounded-xl border border-slate-800 bg-slate-900/80 shadow-[0_14px_44px_rgba(2,6,23,0.2)] ${liveEnabled && interviewView === "live" ? "hidden" : ""}`}
        >
          <div className="flex flex-col gap-3 border-b border-slate-800 px-4 py-4 sm:flex-row sm:items-center sm:justify-between lg:px-5">
            <div>
              <h2 className="text-base font-semibold text-white">Interview Register</h2>
              <p className="mt-0.5 text-xs text-slate-400">
                Showing {filteredInterviews.length} of {interviews.length} interviews under the current recruiter organization.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowStatusGuide((current) => !current)}
              aria-expanded={showStatusGuide}
              className="inline-flex w-fit items-center gap-2 rounded-xl border border-slate-700 px-3.5 py-2 text-sm text-slate-300 transition hover:border-slate-500 hover:text-white"
            >
              <Info className="h-4 w-4" aria-hidden="true" />
              {showStatusGuide ? "Hide status guide" : "Status guide"}
            </button>
          </div>

          {showStatusGuide ? (
            <div className="border-b border-slate-800 bg-slate-950/30 px-4 py-4 lg:px-5">
              <dl className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                {STATUS_GUIDE_KEYS.map((key) => (
                  <div key={key} className="rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2">
                    <dt>
                      <span className={`inline-flex whitespace-nowrap rounded-md border px-1.5 py-px text-[10.5px] font-semibold ${getStatusBadge(key)}`}>
                        {RECRUITER_STATUS_DEFINITIONS[key].label}
                      </span>
                    </dt>
                    <dd className="mt-1.5 text-[11px] leading-4 text-slate-400">
                      {STATUS_GUIDE_TEXT[key] ?? RECRUITER_STATUS_DEFINITIONS[key].description}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : null}

          <div className="grid gap-x-3 gap-y-2.5 border-b border-slate-800 bg-slate-950/20 px-4 py-3.5 sm:grid-cols-2 lg:grid-cols-4 lg:px-5 xl:grid-cols-[minmax(180px,1.15fr)_repeat(5,minmax(112px,0.7fr))_auto]">
            <label className="grid gap-1.5 text-[11px] font-semibold uppercase leading-none tracking-[0.12em] text-slate-500 sm:col-span-2 xl:col-span-1">
              Search
              <input
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Search candidate, job, status"
                className="h-10 min-w-0 rounded-xl border border-slate-700 bg-slate-950/70 px-3 text-[13px] font-medium normal-case tracking-normal text-slate-200 outline-none transition placeholder:text-slate-600 focus:border-cyan-300/60 focus:ring-2 focus:ring-cyan-300/10"
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
            <div className={`${showFilters ? "grid" : "hidden"} gap-x-3 gap-y-2.5 sm:contents`}>
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
              <FilterSelect
                label="Recruiter Decision"
                value={recruiterDecisionFilter}
                onChange={setRecruiterDecisionFilter}
                options={[
                  { value: "ALL", label: "All Decisions" },
                  { value: "PROCEED", label: "Proceed" },
                  { value: "HOLD", label: "Hold" },
                  { value: "REJECT", label: "Reject" },
                  { value: "REVIEW_REQUIRED", label: "Escalate Review" },
                  { value: "PENDING", label: "Awaiting Decision" },
                ]}
              />
              <button
                type="button"
                onClick={clearFilters}
                disabled={!hasActiveFilters}
                className="h-10 self-end rounded-xl border border-slate-700 px-4 text-[13px] font-semibold lg:w-24 xl:w-auto text-slate-300 transition hover:border-slate-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-45"
              >
                Clear
              </button>
            </div>
          </div>

          {/* Register from lg up: seven columns, notes tucked under the row.
              It scrolls with the page (paged below), and the column headings
              stay pinned under the navbar (77px tall). */}
          <div className="relative hidden lg:block">
            <table className="w-full table-fixed text-[13px]">
              <colgroup>
                <col className="w-[25%]" />
                <col className="w-[15%]" />
                <col className="w-[10%]" />
                <col className="w-[15%]" />
                <col className="w-[9%]" />
                <col className="w-[11%]" />
                <col className="w-[15%]" />
              </colgroup>
              <thead className="sticky top-[77px] z-10 bg-slate-950 text-slate-500 shadow-[0_1px_0_var(--color-slate-800)]">
                <tr className="[&>th]:whitespace-nowrap [&>th]:py-2.5 [&>th]:text-[10.5px] [&>th]:font-semibold [&>th]:uppercase [&>th]:tracking-[0.14em]">
                  <th className="pl-5 pr-3 text-left">Candidate</th>
                  <th className="px-3 text-left">Status</th>
                  <th className="px-3 text-left">Score</th>
                  <th className="px-3 text-left">Decision</th>
                  <th className="px-3 text-left">Recording</th>
                  <th className="px-3 text-left">Last activity</th>
                  <th className="pl-3 pr-5 text-right">Actions</th>
                </tr>
              </thead>
              {emptyMessage ? (
                <tbody><tr>
                  <td colSpan={7} className="p-10 text-center text-slate-400">{emptyMessage}</td>
                </tr></tbody>
              ) : (
                rowModels.map((model) => {
                  const { interview } = model
                  const accessLabel = getAccessLabel(interview)
                  return (
                    <tbody key={interview.interviewId} className="border-t border-slate-800/80 text-slate-200 transition-colors first:border-t-0 hover:bg-slate-800/25">
                      <tr className="align-middle">
                        <td className={`relative pl-5 pr-3 ${model.hasRowNotes ? "pb-1.5 pt-3" : "py-3"}`}>
                          {model.canTakeAction ? (
                            <span aria-hidden="true" className="absolute inset-y-2 left-0 w-[3px] rounded-r-full bg-cyan-400" />
                          ) : null}
                          <div className="flex min-w-0 items-center gap-3">
                            {renderAvatar(model)}
                            <div className="min-w-0">
                              {renderCandidateName(interview)}
                              <p className="truncate text-xs text-slate-400" title={interview.jobTitle || ""}>
                                {interview.jobTitle || "No role"}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className={`overflow-hidden px-3 ${model.hasRowNotes ? "pb-1.5 pt-3" : "py-3"}`}>
                          <div className="flex flex-wrap items-center gap-x-1 gap-y-1">
                            <span
                              className={`inline-flex max-w-full rounded-md border px-2 py-0.5 text-[11px] font-medium leading-4 ${getStatusBadge(model.recruiterStatus.key)}`}
                              title={model.recruiterStatus.description}
                            >
                              {model.recruiterStatus.label}
                            </span>
                            {model.faultNote ? <FaultNote note={model.faultNote} /> : null}
                          </div>
                          <p className="mt-1 truncate text-[11px] text-slate-500" title={accessLabel}>{accessLabel}</p>
                        </td>
                        <td className={`px-3 ${model.hasRowNotes ? "pb-1.5 pt-3" : "py-3"}`}>{renderScore(model)}</td>
                        <td className={`px-3 ${model.hasRowNotes ? "pb-1.5 pt-3" : "py-3"}`}>
                          <div className="flex min-w-0 flex-col items-start gap-1">
                            {renderRecruiterDecision(model)}
                            {renderVerisDecision(model)}
                          </div>
                        </td>
                        <td className={`px-3 ${model.hasRowNotes ? "pb-1.5 pt-3" : "py-3"}`}>{renderRecording(interview)}</td>
                        <td className={`px-3 text-xs leading-snug ${model.hasRowNotes ? "pb-1.5 pt-3" : "py-3"}`}>
                          <span className="block whitespace-nowrap text-slate-300">{model.latestActivity.date}</span>
                          <span className="block whitespace-nowrap text-slate-500">{model.latestActivity.time}</span>
                        </td>
                        <td className={`pl-3 pr-5 ${model.hasRowNotes ? "pb-1.5 pt-3" : "py-3"}`}>
                          <div className="flex items-center justify-end gap-2">
                            {renderPrimaryAction(model, "hidden min-[1200px]:inline-flex")}
                            {renderActions(model)}
                          </div>
                        </td>
                      </tr>
                      {model.hasRowNotes ? (
                        <tr>
                          <td colSpan={7} className="pb-3 pl-[68px] pr-5 pt-0">
                            {renderRowNotes(model)}
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  )
                })
              )}
            </table>
          </div>

          {/* Stacked cards below lg: the same fields, labelled inline. */}
          {emptyMessage ? (
            <p className="px-4 py-10 text-center text-sm text-slate-400 lg:hidden">{emptyMessage}</p>
          ) : (
            <ul className="lg:hidden" aria-label="Interviews">
              {rowModels.map((model) => {
                const { interview } = model
                return (
                  <li key={interview.interviewId} className="relative border-t border-slate-800/80 px-4 py-4 first:border-t-0">
                    {model.canTakeAction ? (
                      <span aria-hidden="true" className="absolute inset-y-3 left-0 w-[3px] rounded-r-full bg-cyan-400" />
                    ) : null}
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-3">
                        {renderAvatar(model)}
                        <div className="min-w-0">
                          {renderCandidateName(interview)}
                          <p className="truncate text-xs text-slate-400">{interview.jobTitle}</p>
                        </div>
                      </div>
                      <div className="flex flex-none items-center gap-1">
                        <span
                          className={`inline-flex rounded-md border px-2 py-0.5 text-[11px] font-medium leading-4 ${getStatusBadge(model.recruiterStatus.key)}`}
                          title={model.recruiterStatus.description}
                        >
                          {model.recruiterStatus.label}
                        </span>
                        {model.faultNote ? <FaultNote note={model.faultNote} /> : null}
                      </div>
                    </div>
                    <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2.5 text-xs">
                      <div>
                        <dt className="text-[10px] uppercase tracking-[0.12em] text-slate-500">Score</dt>
                        <dd className="mt-1">{renderScore(model)}</dd>
                      </div>
                      <div>
                        <dt className="text-[10px] uppercase tracking-[0.12em] text-slate-500">VERIS decision</dt>
                        <dd className="mt-0.5 text-slate-300">{interview.decision ? formatStatusText(interview.decision) : "-"}</dd>
                      </div>
                      <div>
                        <dt className="text-[10px] uppercase tracking-[0.12em] text-slate-500">Recruiter decision</dt>
                        <dd className="mt-0.5">{renderRecruiterDecision(model) ?? <span className="text-slate-600">-</span>}</dd>
                      </div>
                      <div>
                        <dt className="text-[10px] uppercase tracking-[0.12em] text-slate-500">Access</dt>
                        <dd className="mt-0.5 text-slate-300">{getAccessLabel(interview)}</dd>
                      </div>
                      <div>
                        <dt className="text-[10px] uppercase tracking-[0.12em] text-slate-500">Last activity</dt>
                        <dd className="mt-0.5 text-slate-300">
                          {model.latestActivity.date} · {model.latestActivity.time}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-[10px] uppercase tracking-[0.12em] text-slate-500">Recording</dt>
                        <dd className="mt-0.5">{renderRecording(interview)}</dd>
                      </div>
                    </dl>
                    {model.hasRowNotes ? <div className="mt-3">{renderRowNotes(model)}</div> : null}
                    {model.hasHiringActions ? (
                      <div className="mt-3 flex items-center justify-end gap-2 border-t border-slate-800/80 pt-3">
                        {renderPrimaryAction(model)}
                        {renderActions(model)}
                      </div>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          )}

          {filteredInterviews.length > 0 ? (
            <div className="flex flex-col gap-3 border-t border-slate-800 bg-slate-950/20 px-4 py-3 text-xs text-slate-400 sm:flex-row sm:items-center sm:justify-between lg:px-5">
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                <p aria-live="polite">
                  Showing{" "}
                  <span className="font-semibold tabular-nums text-slate-200">
                    {pageStart + 1}&ndash;{pageEnd}
                  </span>{" "}
                  of <span className="font-semibold tabular-nums text-slate-200">{filteredInterviews.length}</span>
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
                <nav aria-label="Interview pages" className="flex items-center gap-1">
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

        {!liveEnabled || interviewView === "live" ? <LiveInterviewsPanel /> : null}
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
      <CandidateFeedbackModal
        interview={feedbackInterview}
        searchParams={searchParams}
        onClose={() => setFeedbackInterviewId("")}
        onSent={handleCandidateFeedbackSent}
      />
      {summaryInterview ? (
        <div
          className="hv-theme-dialog-backdrop fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/75 px-4 py-6 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label={`Completed interview summary for ${summaryInterview.candidateName || "candidate"}`}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setSummaryInterviewId("")
            }
          }}
        >
          <div className="my-auto w-full max-w-6xl">
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

