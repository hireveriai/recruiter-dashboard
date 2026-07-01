"use client"

import Link from "next/link"
import { useEffect, useMemo, useRef, useState } from "react"
import { useAuthSearchParams } from "@/lib/client/use-auth-search-params"

import { showActionFeedback } from "@/lib/client/action-feedback"
import { buildAuthUrl } from "@/lib/client/auth-query"
import { copyText } from "@/lib/client/copy-to-clipboard"
import { formatDateTime } from "@/lib/client/date-format"
import UpgradeLimitDialog from "@/components/UpgradeLimitDialog"

const DASHBOARD_CACHE_KEY = "hireveri-overview"
const DASHBOARD_INVALIDATED_EVENT = "hireveri:dashboard-data-invalidated"
const DASHBOARD_INVALIDATED_KEY = "hireveri-overview-invalidated"
const SEND_INTERVIEW_JOBS_CACHE_PREFIX = "hireveri-send-interview-jobs"
const SEND_INTERVIEW_JOBS_CACHE_TTL_MS = 5 * 60 * 1000
const MAX_BATCH_CANDIDATES = 25

function invalidateDashboardOverviewCache() {
  if (typeof window === "undefined") {
    return
  }

  window.sessionStorage.removeItem(DASHBOARD_CACHE_KEY)
  window.sessionStorage.setItem(DASHBOARD_INVALIDATED_KEY, "1")
  window.dispatchEvent(new CustomEvent(DASHBOARD_INVALIDATED_EVENT))
}

function CalendarIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-4 w-4 text-cyan-300/80"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M16 3v4" />
      <path d="M8 3v4" />
      <path d="M3 10h18" />
    </svg>
  )
}

function DateTimeField({ label, value, onChange }) {
  return (
    <div>
      <label className="mb-2 block text-sm text-gray-400">{label}</label>
      <div className="relative">
        <div className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2">
          <CalendarIcon />
        </div>
        <input
          type="datetime-local"
          className="w-full rounded-2xl border border-slate-700 bg-slate-950/80 px-11 py-3 text-white outline-none transition focus:border-cyan-400/60 focus:shadow-[0_0_0_3px_rgba(34,211,238,0.08)]"
          value={value}
          onChange={onChange}
        />
        <div className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[11px] font-medium uppercase tracking-[0.18em] text-cyan-200/70">
          Pick
        </div>
      </div>
    </div>
  )
}

function formatFileSize(size) {
  if (!Number.isFinite(size) || size <= 0) {
    return ""
  }

  if (size < 1024 * 1024) {
    return `${Math.round(size / 102.4) / 10} KB`
  }

  return `${Math.round(size / (1024 * 102.4)) / 10} MB`
}

function getFileExtension(fileName) {
  const normalized = String(fileName ?? "").trim()
  const parts = normalized.split(".")
  if (parts.length < 2) {
    return null
  }

  return parts.pop()?.toUpperCase() ?? null
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value ?? "").trim())
}

function createClientId() {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function getResumeSourceLabel(file) {
  if (!file) {
    return "Uploaded from device"
  }

  const extension = getFileExtension(file.name)
  const typeLabel = extension || (file.type ? file.type.split("/").pop()?.toUpperCase() : null) || "FILE"
  const sizeLabel = file.size ? formatFileSize(file.size) : null

  return ["Uploaded from device", typeLabel, sizeLabel].filter(Boolean).join(" · ")
}

const UPGRADE_MESSAGE =
  "You’ve reached your free trial limit. Upgrade your workspace to continue conducting interviews and screenings."

function normalizeTrialCredits(credits) {
  return {
    interviewCreditsRemaining: Math.max(0, Number(credits?.interviewCreditsRemaining ?? 5)),
    screeningCreditsRemaining: Math.max(0, Number(credits?.screeningCreditsRemaining ?? 15)),
    upgradeMessage: credits?.upgradeMessage || UPGRADE_MESSAGE,
    source: credits?.source || "trial",
    subscriptionId: credits?.subscriptionId || null,
    planId: credits?.planId || null,
    subscriptionStatus: credits?.subscriptionStatus || null,
    subscriptionExpiresAt: credits?.subscriptionExpiresAt || null,
  }
}

function notifyTrialCreditsUpdated(credits) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("hireveri:trial-credits-updated", { detail: credits }))
  }
}

function normalizeActiveJobs(payload) {
  return (payload?.jobs || payload?.data?.jobs || []).filter(
    (job) => (job.isActive ?? job.is_active ?? true) !== false
  )
}

export default function SendInterviewModal({ isOpen, onClose, initialTrialCredits = null }) {
  const searchParams = useAuthSearchParams()
  const primaryFileInputRef = useRef(null)
  const changeFileInputRef = useRef(null)
  const [jobs, setJobs] = useState([])
  const [jobsLoading, setJobsLoading] = useState(false)
  const [jobId, setJobId] = useState("")
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [resumeFile, setResumeFile] = useState(null)
  const [queuedCandidates, setQueuedCandidates] = useState([])
  const [accessType, setAccessType] = useState("FLEXIBLE")
  const [startTime, setStartTime] = useState("")
  const [endTime, setEndTime] = useState("")
  const [loading, setLoading] = useState(false)
  const [link, setLink] = useState("")
  const [batchResults, setBatchResults] = useState([])
  const [error, setError] = useState("")
  const [emailStatus, setEmailStatus] = useState(null)
  const [emailError, setEmailError] = useState("")
  const [copyStatus, setCopyStatus] = useState("idle")
  const [duplicateWarning, setDuplicateWarning] = useState(null)
  const [trialCredits, setTrialCredits] = useState(() => normalizeTrialCredits(initialTrialCredits))
  const [creditConfirmationOpen, setCreditConfirmationOpen] = useState(false)
  const [confirmedCreditNotice, setConfirmedCreditNotice] = useState(false)
  const [upgradeLimitOpen, setUpgradeLimitOpen] = useState(false)

  const resetModalState = () => {
    setJobId("")
    setName("")
    setEmail("")
    setResumeFile(null)
    setQueuedCandidates([])
    setAccessType("FLEXIBLE")
    setStartTime("")
    setEndTime("")
    setLoading(false)
    setLink("")
    setBatchResults([])
    setError("")
    setEmailStatus(null)
    setEmailError("")
    setCopyStatus("idle")
    setDuplicateWarning(null)
    setCreditConfirmationOpen(false)
    setConfirmedCreditNotice(false)
    setUpgradeLimitOpen(false)
    resetFileInputs()
  }

  useEffect(() => {
    if (!isOpen) {
      resetModalState()
      return
    }

    const jobsController = new AbortController()
    const creditsController = new AbortController()
    const cacheKey = `${SEND_INTERVIEW_JOBS_CACHE_PREFIX}:${searchParams.toString()}`
    let hasFreshCachedJobs = false

    try {
      const cachedJobs = window.sessionStorage.getItem(cacheKey)
      if (cachedJobs) {
        const parsed = JSON.parse(cachedJobs)
        if (Array.isArray(parsed?.jobs) && Date.now() - Number(parsed.cachedAt) < SEND_INTERVIEW_JOBS_CACHE_TTL_MS) {
          hasFreshCachedJobs = true
          setJobs(parsed.jobs)
          setJobId((currentJobId) =>
            currentJobId && !parsed.jobs.some((job) => (job.jobId || job.job_id) === currentJobId)
              ? ""
              : currentJobId
          )
        }
      }
    } catch (cacheError) {
      console.warn("Failed to read cached interview jobs", cacheError)
    }

    setJobsLoading(!hasFreshCachedJobs)

    fetch(buildAuthUrl("/api/jobs?view=selector", searchParams), {
      credentials: "include",
      cache: "no-store",
      signal: jobsController.signal,
    })
      .then((jobsResponse) => jobsResponse.json())
      .then((data) => {
        const nextJobs = normalizeActiveJobs(data)
        setJobs(nextJobs)
        if (typeof window !== "undefined") {
          window.sessionStorage.setItem(
            cacheKey,
            JSON.stringify({
              cachedAt: Date.now(),
              jobs: nextJobs,
            })
          )
        }
        setJobId((currentJobId) =>
          currentJobId && !nextJobs.some((job) => (job.jobId || job.job_id) === currentJobId)
            ? ""
            : currentJobId
        )
      })
      .catch((fetchError) => {
        if (fetchError?.name === "AbortError") {
          return
        }
        console.error(fetchError)
        if (!hasFreshCachedJobs) {
          setJobs([])
        }
      })
      .finally(() => setJobsLoading(false))

    fetch(buildAuthUrl("/api/trial-credits", searchParams), {
      credentials: "include",
      cache: "no-store",
      signal: creditsController.signal,
    })
      .then((creditsResponse) => creditsResponse.json().catch(() => null))
      .then((creditsPayload) => {
        if (creditsPayload?.success) {
          setTrialCredits(normalizeTrialCredits(creditsPayload.data))
        }
      })
      .catch((fetchError) => {
        if (fetchError?.name !== "AbortError") {
          console.error(fetchError)
        }
      })

    return () => {
      jobsController.abort()
      creditsController.abort()
    }
  }, [isOpen, searchParams])

  useEffect(() => {
    setTrialCredits(normalizeTrialCredits(initialTrialCredits))
  }, [initialTrialCredits])

  useEffect(() => {
    if (copyStatus !== "success") {
      return
    }

    const timer = setTimeout(() => setCopyStatus("idle"), 1800)
    return () => clearTimeout(timer)
  }, [copyStatus])

  const hasJobs = jobs.length > 0
  const emptyJobsState = useMemo(() => !jobsLoading && !hasJobs, [jobsLoading, hasJobs])
  const hasCurrentCandidateInput = Boolean(name.trim() || email.trim() || resumeFile)
  const pendingCandidateCount = queuedCandidates.length + (hasCurrentCandidateInput ? 1 : 0)

  const showFormError = (message) => {
    setError(message)
    showActionFeedback({
      tone: "error",
      title: "Action required",
      message,
    })
  }

  const resetFileInputs = () => {
    if (primaryFileInputRef.current) {
      primaryFileInputRef.current.value = ""
    }

    if (changeFileInputRef.current) {
      changeFileInputRef.current.value = ""
    }
  }

  const handleResumeSelect = (event) => {
    const nextFile = event.target.files?.[0] || null
    setResumeFile(nextFile)

    if (!nextFile && event.target) {
      event.target.value = ""
    }
  }

  const getCurrentCandidate = () => ({
    id: createClientId(),
    name: name.trim(),
    email: email.trim().toLowerCase(),
    resumeFile,
  })

  const validateCandidate = (candidate, positionLabel = "Candidate") => {
    if (!candidate.name || !candidate.email || !candidate.resumeFile) {
      return `${positionLabel}: name, email, and resume are required`
    }

    if (!isValidEmail(candidate.email)) {
      return `${positionLabel}: enter a valid email address`
    }

    return ""
  }

  const clearCurrentCandidate = () => {
    setName("")
    setEmail("")
    setResumeFile(null)
    resetFileInputs()
  }

  const addCandidateToBatch = () => {
    if (queuedCandidates.length >= MAX_BATCH_CANDIDATES) {
      showFormError(`A batch can include up to ${MAX_BATCH_CANDIDATES} candidates`)
      return
    }

    const candidate = getCurrentCandidate()
    const validationError = validateCandidate(candidate)

    if (validationError) {
      showFormError(validationError)
      return
    }

    const duplicateEmail = queuedCandidates.some((item) => item.email === candidate.email)
    if (duplicateEmail) {
      showFormError("This candidate email is already in the batch")
      return
    }

    setQueuedCandidates((current) => [...current, candidate])
    clearCurrentCandidate()
    setError("")
    showActionFeedback({
      tone: "success",
      title: "Candidate added",
      message: "Add another candidate or send the batch when ready.",
    })
  }

  const removeQueuedCandidate = (candidateId) => {
    setQueuedCandidates((current) => current.filter((candidate) => candidate.id !== candidateId))
  }

  const collectCandidatesForSubmission = () => {
    const hasCurrentCandidateInput = Boolean(name.trim() || email.trim() || resumeFile)
    return hasCurrentCandidateInput
      ? [...queuedCandidates, getCurrentCandidate()]
      : queuedCandidates
  }

  const sendCandidateInterview = async (candidate, confirmedDuplicate) => {
    const candidateFormData = new FormData()
    candidateFormData.append("fullName", candidate.name)
    candidateFormData.append("email", candidate.email)
    candidateFormData.append("jobId", jobId)
    candidateFormData.append("resume", candidate.resumeFile)
    candidateFormData.append("includeResumeText", "false")

    const candidateResponse = await fetch(buildAuthUrl("/api/candidate", searchParams), {
      method: "POST",
      credentials: "include",
      body: candidateFormData,
    })

    const candidateText = await candidateResponse.text()
    const candidateData = candidateText ? JSON.parse(candidateText) : {}

    if (!candidateResponse.ok) {
      throw new Error(candidateData.message || candidateData.error?.message || "Failed to create candidate")
    }

    const candidateId =
      candidateData.candidateId ||
      candidateData.candidate_id ||
      candidateData.data?.candidateId ||
      candidateData.data?.candidate_id

    if (!candidateId) {
      throw new Error("Candidate ID was not returned by the API")
    }

    const extractedResumeSkills =
      candidateData.parsedData?.extractedSkills ||
      candidateData.data?.parsedData?.extractedSkills ||
      []
    const interviewResponse = await fetch(buildAuthUrl("/api/interview/create-link", searchParams), {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jobId,
        candidateId,
        resume_skills: Array.isArray(extractedResumeSkills) ? extractedResumeSkills : [],
        accessType,
        startTime: accessType === "SCHEDULED" ? startTime : undefined,
        endTime: accessType === "SCHEDULED" ? endTime : undefined,
        confirmDuplicateInvite: confirmedDuplicate,
        idempotencyKey: createClientId(),
      }),
    })

    const interviewText = await interviewResponse.text()
    const interviewData = interviewText ? JSON.parse(interviewText) : {}

    if (!interviewResponse.ok) {
      throw new Error(interviewData.message || interviewData.error?.message || "Failed to generate link")
    }

    return interviewData.data || interviewData
  }

  const handleSubmit = async ({ confirmedDuplicate = false, confirmedCredit = false } = {}) => {
    setError("")
    setLink("")
    setBatchResults([])
    setEmailStatus(null)
    setEmailError("")
    setCopyStatus("idle")

    if (!hasJobs) {
      showFormError("Create a job first to send your interview link")
      return
    }

    if (!jobId) {
      showFormError("Please select a job")
      return
    }

    const candidates = collectCandidatesForSubmission()
    if (candidates.length === 0) {
      showFormError("Add at least one candidate")
      return
    }

    if (candidates.length > MAX_BATCH_CANDIDATES) {
      showFormError(`A batch can include up to ${MAX_BATCH_CANDIDATES} candidates`)
      return
    }

    for (let index = 0; index < candidates.length; index += 1) {
      const validationError = validateCandidate(candidates[index], `Candidate ${index + 1}`)
      if (validationError) {
        showFormError(validationError)
        return
      }
    }

    const uniqueEmails = new Set(candidates.map((candidate) => candidate.email))
    if (uniqueEmails.size !== candidates.length) {
      showFormError("Each candidate in the batch must have a unique email address")
      return
    }

    if (trialCredits.interviewCreditsRemaining < candidates.length) {
      setUpgradeLimitOpen(true)
      return
    }

    if (!confirmedCreditNotice && !confirmedCredit) {
      setCreditConfirmationOpen(true)
      return
    }

    if (accessType === "SCHEDULED" && (!startTime || !endTime)) {
      showFormError("Start time and end time are required")
      return
    }

    try {
      setLoading(true)

      if (!confirmedDuplicate) {
        const duplicateChecks = await Promise.all(candidates.map(async (candidate) => {
          const duplicateResponse = await fetch(buildAuthUrl("/api/interview/invite-duplicate", searchParams), {
            method: "POST",
            credentials: "include",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ email: candidate.email }),
          })
          const duplicateData = await duplicateResponse.json().catch(() => null)
          return duplicateResponse.ok && duplicateData?.warning
            ? { email: candidate.email, lastSentAt: duplicateData.lastSentAt }
            : null
        }))
        const duplicateCandidates = duplicateChecks.filter(Boolean)

        if (duplicateCandidates.length > 0) {
          setDuplicateWarning({
            candidates: duplicateCandidates,
          })
          return
        }
      }

      const results = []
      let latestCredits = trialCredits

      for (const candidate of candidates) {
        try {
          const responseData = await sendCandidateInterview(candidate, confirmedDuplicate)
          if (responseData.trialCredits) {
            latestCredits = normalizeTrialCredits(responseData.trialCredits)
          } else {
            latestCredits = {
              ...latestCredits,
              interviewCreditsRemaining: Math.max(0, latestCredits.interviewCreditsRemaining - 1),
            }
          }

          results.push({
            id: candidate.id,
            candidate,
            name: candidate.name,
            email: candidate.email,
            status: "success",
            link: responseData.link || "",
            emailStatus: responseData.emailSent === true
              ? "sent"
              : responseData.emailQueued === true || responseData.preparationQueued === true
                ? "queued"
                : "failed",
            emailError: responseData.emailError || "",
          })
        } catch (candidateError) {
          results.push({
            id: candidate.id,
            candidate,
            name: candidate.name,
            email: candidate.email,
            status: "failed",
            error: candidateError instanceof Error ? candidateError.message : "Failed to send interview link",
          })
        }
      }

      setTrialCredits(latestCredits)
      notifyTrialCreditsUpdated(latestCredits)
      invalidateDashboardOverviewCache()
      setBatchResults(results)
      const successfulResults = results.filter((result) => result.status === "success")
      const failedResults = results.filter((result) => result.status === "failed")
      if (successfulResults.length === 1 && results.length === 1) {
        setLink(successfulResults[0].link)
        setEmailStatus(successfulResults[0].emailStatus)
        setEmailError(successfulResults[0].emailError)
      }
      setQueuedCandidates(failedResults.map((result) => result.candidate))
      clearCurrentCandidate()
      setConfirmedCreditNotice(false)

      showActionFeedback({
        tone: failedResults.length === 0 ? "success" : successfulResults.length > 0 ? "warning" : "error",
        title: failedResults.length === 0
          ? `${successfulResults.length} interview ${successfulResults.length === 1 ? "invite" : "invites"} prepared`
          : `${successfulResults.length} sent, ${failedResults.length} failed`,
        message: failedResults.length === 0
          ? "Interview preparation is running and each candidate will receive their email automatically."
          : "Failed candidates remain in the batch. Retry them, or remove and re-add corrected details.",
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to send interview link"
      if (message === UPGRADE_MESSAGE || message.toLowerCase().includes("free trial limit")) {
        setUpgradeLimitOpen(true)
        setError("")
        return
      }
      setError(message)
      showActionFeedback({
        tone: "error",
        title: "Interview link failed",
        message,
      })
    } finally {
      setLoading(false)
    }
  }

  const copy = async () => {
    const copied = await copyText(link)
    setCopyStatus(copied ? "success" : "failed")
    showActionFeedback({
      tone: copied ? "success" : "error",
      title: copied ? "Link copied" : "Copy failed",
      message: copied
        ? "The interview link is ready to share."
        : "Select the link manually and copy it from the field.",
    })
  }

  const copyResultLink = async (result) => {
    const copied = await copyText(result.link)
    showActionFeedback({
      tone: copied ? "success" : "error",
      title: copied ? `Link copied for ${result.name}` : "Copy failed",
      message: copied ? "The interview link is ready to share." : "Please select and copy the link manually.",
    })
  }

  const clearResumeFile = () => {
    setResumeFile(null)
    resetFileInputs()
  }

  const startAnotherBatch = () => {
    setLink("")
    setBatchResults([])
    setEmailStatus(null)
    setEmailError("")
    setCopyStatus("idle")
    setError("")
  }

  const handleClose = () => {
    resetModalState()
    onClose?.()
  }

  const openCreateJobFlow = () => {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("hireveri:open-create-job"))
    }

    handleClose()
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/80 px-4 py-4 backdrop-blur-md sm:py-6" role="dialog" aria-modal="true">
      {creditConfirmationOpen ? (
        <div className="fixed inset-0 z-[65] flex items-start justify-center overflow-y-auto bg-slate-950/70 px-4 py-4 backdrop-blur-sm sm:py-6" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-2xl border border-cyan-400/20 bg-[#0b1220] p-6 shadow-[0_24px_80px_rgba(2,6,23,0.55)]">
            <p className="text-xs font-semibold uppercase tracking-[0.26em] text-cyan-200/75">Credit Notice</p>
            <h3 className="mt-3 text-lg font-semibold text-white">
              You are about to use {pendingCandidateCount} AI Interview {pendingCandidateCount === 1 ? "credit" : "credits"}.
            </h3>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              Remaining Interview Credits after this batch: {Math.max(0, trialCredits.interviewCreditsRemaining - pendingCandidateCount)}
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setCreditConfirmationOpen(false)}
                className="rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-300 transition hover:border-slate-500 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setCreditConfirmationOpen(false)
                  setConfirmedCreditNotice(true)
                  void handleSubmit({ confirmedCredit: true })
                }}
                className="rounded-xl border border-cyan-400/30 bg-cyan-400/10 px-4 py-2 text-sm font-semibold text-cyan-100 transition hover:border-cyan-300/50"
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <UpgradeLimitDialog
        isOpen={upgradeLimitOpen}
        onClose={() => setUpgradeLimitOpen(false)}
        credits={trialCredits}
        message={trialCredits.upgradeMessage}
      />
      {duplicateWarning ? (
        <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-slate-950/80 px-4 py-4 backdrop-blur-sm sm:py-6" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-2xl border border-amber-400/25 bg-[#0b1220] p-6 shadow-[0_24px_80px_rgba(2,6,23,0.55)]">
            <h3 className="text-lg font-semibold text-white">Duplicate invite detected</h3>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              {duplicateWarning.candidates.length === 1
                ? "This candidate has already received an interview invite. Send another invite?"
                : `${duplicateWarning.candidates.length} candidates have already received interview invites. Send those invites again?`}
            </p>
            <div className="mt-4 max-h-48 space-y-2 overflow-y-auto">
              {duplicateWarning.candidates.map((candidate) => {
                const sentAt = candidate.lastSentAt ? new Date(candidate.lastSentAt) : null
                const sentAtLabel = sentAt && !Number.isNaN(sentAt.getTime())
                  ? formatDateTime(sentAt.toISOString())
                  : "an earlier date"

                return (
                  <div key={candidate.email} className="rounded-xl border border-amber-300/15 bg-amber-500/[0.06] px-3 py-2">
                    <p className="text-sm font-medium text-white">{candidate.email}</p>
                    <p className="mt-1 text-xs text-amber-100/70">Last sent {sentAtLabel}</p>
                  </div>
                )
              })}
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setDuplicateWarning(null)}
                className="rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-300 transition hover:border-slate-500 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setDuplicateWarning(null)
                  void handleSubmit({ confirmedDuplicate: true })
                }}
                className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-slate-900 transition hover:bg-slate-100"
              >
                Send Again
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <div className="relative w-full max-w-5xl overflow-hidden rounded-[28px] border border-cyan-500/20 bg-[#06101f]/95 text-white shadow-[0_0_60px_rgba(37,99,235,0.18)]">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.16),transparent_30%),radial-gradient(circle_at_bottom_right,rgba(59,130,246,0.14),transparent_30%)]" />
        <div className="relative max-h-[calc(100dvh-1.5rem)] overflow-y-auto p-4 sm:max-h-[calc(100dvh-2rem)] sm:p-5 md:p-6">
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.35em] text-cyan-300/80">Interview Access</p>
              <h2 className="mt-2 text-2xl font-semibold text-white sm:text-3xl">Send Interview Link</h2>
              <p className="mt-2 max-w-lg text-sm text-slate-300">
                Add one or several candidates, apply one access window, and send every
                secure interview invite in a single batch.
              </p>
            </div>
            <button
              onClick={handleClose}
              className="rounded-full border border-slate-700/80 bg-slate-900/80 px-3 py-1 text-sm text-slate-300 transition hover:border-cyan-400/60 hover:text-white"
            >
              Close
            </button>
          </div>

          {emptyJobsState ? (
            <div className="rounded-3xl border border-amber-400/20 bg-amber-500/10 p-5">
              <p className="text-xs font-medium uppercase tracking-[0.28em] text-amber-200/80">Job Required</p>
              <h3 className="mt-3 text-xl font-semibold text-white">Create a job first to send your interview link</h3>
              <p className="mt-3 text-sm text-amber-100/85">
                Interview links can only be generated against an existing job in your recruiter workspace.
              </p>
              <div className="mt-5 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={openCreateJobFlow}
                  className="rounded-2xl bg-white px-4 py-2.5 text-sm font-semibold text-slate-900 transition hover:bg-slate-100"
                >
                  Create Job First
                </button>
                <Link
                  href="/jobs"
                  className="rounded-2xl border border-slate-700 bg-slate-900/70 px-4 py-2.5 text-sm text-slate-200 transition hover:border-slate-500 hover:text-white"
                  onClick={handleClose}
                >
                  Go to Jobs Page
                </Link>
                <button
                  type="button"
                  onClick={handleClose}
                  className="rounded-2xl border border-slate-700 bg-slate-900/70 px-4 py-2.5 text-sm text-slate-200 transition hover:border-slate-500 hover:text-white"
                >
                  Close
                </button>
              </div>
            </div>
          ) : (
            <>
              {queuedCandidates.length > 0 ? (
                <div className="mb-5 rounded-2xl border border-cyan-400/15 bg-cyan-400/[0.045] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-white">Candidates in this batch</p>
                      <p className="mt-1 text-xs text-slate-400">
                        {queuedCandidates.length} {queuedCandidates.length === 1 ? "candidate" : "candidates"} ready · max {MAX_BATCH_CANDIDATES}
                      </p>
                    </div>
                    <span className="rounded-full border border-cyan-300/20 bg-cyan-400/10 px-3 py-1 text-xs font-semibold text-cyan-100">
                      {queuedCandidates.length}
                    </span>
                  </div>
                  <div className="mt-3 space-y-2">
                    {queuedCandidates.map((candidate, index) => (
                      <div key={candidate.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-700/80 bg-slate-950/45 px-3 py-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-white">
                            {index + 1}. {candidate.name}
                          </p>
                          <p className="mt-1 truncate text-xs text-slate-400">
                            {candidate.email} · {candidate.resumeFile.name}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeQueuedCandidate(candidate.id)}
                          disabled={loading}
                          className="shrink-0 rounded-lg border border-rose-400/25 bg-rose-500/10 px-2.5 py-1.5 text-xs font-medium text-rose-200 transition hover:border-rose-300/50 hover:text-white disabled:opacity-50"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="grid gap-5 md:grid-cols-[minmax(0,1.12fr)_minmax(320px,0.88fr)] md:items-start">
                <div className="min-w-0">
                  <div>
                    <label className="text-sm text-gray-400">Select Job *</label>
                    <select
                      className="mt-1.5 w-full rounded-2xl border border-slate-700 bg-slate-900/80 px-4 py-3 text-white outline-none transition focus:border-cyan-400/60 focus:shadow-[0_0_0_3px_rgba(34,211,238,0.08)]"
                      value={jobId}
                      onChange={(e) => setJobId(e.target.value)}
                      disabled={jobsLoading}
                    >
                      <option value="">{jobsLoading ? "Loading jobs..." : "Select Job"}</option>
                      {jobs.map((job) => {
                        const optionId = job.jobId || job.job_id
                        const optionTitle = job.jobTitle || job.job_title

                        return (
                          <option key={optionId} value={optionId}>
                            {optionTitle}
                          </option>
                        )
                      })}
                    </select>
                  </div>

                  <div className="mb-3 mt-4 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-white">
                        {queuedCandidates.length > 0 ? "Add another candidate" : "Candidate details"}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        Name, email, and resume for this invite.
                      </p>
                    </div>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    <div>
                      <label className="text-sm text-gray-400">Candidate Full Name *</label>
                      <input
                        className="mt-1.5 w-full rounded-2xl border border-slate-700 bg-slate-900/80 px-4 py-3 text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-400/60 focus:shadow-[0_0_0_3px_rgba(34,211,238,0.08)]"
                        placeholder="Enter candidate name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                      />
                    </div>

                    <div>
                      <label className="text-sm text-gray-400">Candidate Email *</label>
                      <input
                        type="email"
                        className="mt-1.5 w-full rounded-2xl border border-slate-700 bg-slate-900/80 px-4 py-3 text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-400/60 focus:shadow-[0_0_0_3px_rgba(34,211,238,0.08)]"
                        placeholder="Enter email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                      />
                    </div>
                  </div>

                  <label className="mt-3 block text-sm text-gray-400">Resume *</label>
                  <div className="mt-1.5 rounded-2xl border border-dashed border-slate-600 bg-slate-900/70 p-3">
                    <input
                      ref={primaryFileInputRef}
                      type="file"
                      className="w-full text-sm text-slate-300 file:mr-4 file:rounded-full file:border-0 file:bg-cyan-500/15 file:px-4 file:py-2 file:text-sm file:font-medium file:text-cyan-200 hover:file:bg-cyan-500/25"
                      onChange={handleResumeSelect}
                    />

                    {resumeFile ? (
                      <div className="mt-3 rounded-2xl border border-cyan-500/15 bg-slate-950/60 p-3">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-white">{resumeFile.name}</p>
                            <p className="mt-1 text-xs text-slate-400">
                              {getResumeSourceLabel(resumeFile)}
                            </p>
                          </div>

                          <div className="flex shrink-0 items-center gap-2">
                            <label className="cursor-pointer rounded-xl border border-slate-700 bg-slate-900/80 px-3 py-2 text-xs font-medium text-slate-200 transition hover:border-cyan-400/50 hover:text-white">
                              Change
                              <input
                                ref={changeFileInputRef}
                                type="file"
                                className="hidden"
                                onChange={handleResumeSelect}
                              />
                            </label>
                            <button
                              type="button"
                              onClick={clearResumeFile}
                              className="rounded-xl border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-xs font-medium text-rose-200 transition hover:border-rose-300/50 hover:bg-rose-500/15 hover:text-white"
                            >
                              Remove
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </div>

                  <button
                    type="button"
                    onClick={addCandidateToBatch}
                    disabled={loading}
                    className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl border border-cyan-400/25 bg-cyan-400/[0.07] px-4 py-3 text-sm font-semibold text-cyan-100 transition hover:border-cyan-300/50 hover:bg-cyan-400/10 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <span className="text-lg leading-none">+</span>
                    Add candidate to batch
                  </button>
                </div>

                <div className="min-w-0 space-y-3">
                  <div className="rounded-2xl border border-slate-800 bg-slate-900/55 p-4">
                    <p className="mb-3 text-sm font-medium text-slate-300">Interview Access Type</p>

                    <div className="grid gap-2">
                      <label className="flex items-center gap-3 rounded-xl border border-cyan-400/15 bg-cyan-400/[0.04] px-3 py-2 text-sm text-slate-200 transition hover:border-cyan-500/25 hover:bg-slate-800/60">
                        <input
                          type="radio"
                          value="FLEXIBLE"
                          checked={accessType === "FLEXIBLE"}
                          onChange={() => setAccessType("FLEXIBLE")}
                          className="h-4 w-4 accent-cyan-400"
                        />
                        <span>Flexible (24h access)</span>
                      </label>

                      <label className="flex items-center gap-3 rounded-xl border border-transparent px-3 py-2 text-sm text-slate-200 transition hover:border-cyan-500/20 hover:bg-slate-800/60">
                        <input
                          type="radio"
                          value="SCHEDULED"
                          checked={accessType === "SCHEDULED"}
                          onChange={() => setAccessType("SCHEDULED")}
                          className="h-4 w-4 accent-cyan-400"
                        />
                        <span>Scheduled window</span>
                      </label>
                    </div>
                  </div>

                  {accessType === "SCHEDULED" && (
                    <div className="rounded-2xl border border-cyan-500/15 bg-slate-900/55 p-4">
                      <div className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.28em] text-cyan-200/75">
                        <CalendarIcon />
                        <span>Schedule Window</span>
                      </div>
                      <div className="grid gap-3">
                        <DateTimeField label="Start Time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
                        <DateTimeField label="End Time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
                      </div>
                    </div>
                  )}

                  <div className="grid gap-2 rounded-2xl border border-slate-800 bg-slate-900/70 p-4 text-sm text-slate-300 sm:grid-cols-3 md:grid-cols-1 xl:grid-cols-3">
                    <div className="rounded-xl bg-slate-950/35 px-3 py-2">Single-use access</div>
                    <div className="rounded-xl bg-slate-950/35 px-3 py-2">Expires automatically</div>
                    <div className="rounded-xl bg-slate-950/35 px-3 py-2">Monitored integrity</div>
                  </div>

                  <div className={`rounded-2xl border p-4 text-sm ${trialCredits.interviewCreditsRemaining <= 0 ? "border-amber-400/25 bg-amber-500/10 text-amber-100" : "border-cyan-400/15 bg-cyan-400/[0.06] text-cyan-100"}`}>
                    {trialCredits.interviewCreditsRemaining <= 0
                      ? (
                        <div className="flex flex-col gap-3">
                          <span>{trialCredits.upgradeMessage}</span>
                          <button
                            type="button"
                            onClick={() => setUpgradeLimitOpen(true)}
                            className="rounded-xl border border-amber-200/35 bg-amber-300/12 px-4 py-2 text-sm font-semibold text-amber-50 transition hover:border-amber-100/60"
                          >
                            View Subscription Plans
                          </button>
                        </div>
                      )
                      : (
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span>AI Interviews Left: {trialCredits.interviewCreditsRemaining}</span>
                          {pendingCandidateCount > 0 ? (
                            <span className="rounded-full border border-cyan-300/20 bg-cyan-400/10 px-3 py-1 text-xs font-semibold">
                              This batch uses {pendingCandidateCount}
                            </span>
                          ) : null}
                        </div>
                      )}
                  </div>

                  {error && <p className="text-sm text-red-400">{error}</p>}
                  <button
                    onClick={() => handleSubmit()}
                    disabled={loading || jobsLoading || trialCredits.interviewCreditsRemaining <= 0}
                    className="w-full rounded-2xl bg-gradient-to-r from-cyan-500 via-blue-500 to-indigo-500 px-4 py-3 text-base font-medium text-white shadow-[0_18px_30px_rgba(37,99,235,0.3)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {loading
                      ? `Preparing ${pendingCandidateCount || queuedCandidates.length} ${pendingCandidateCount === 1 ? "invite" : "invites"}...`
                      : pendingCandidateCount > 1
                        ? `Send ${pendingCandidateCount} Interview Invites`
                        : "Send Interview Invite"}
                  </button>
                </div>
              </div>

              {batchResults.length > 1 || batchResults.some((result) => result.status === "failed") ? (
                <div className="mt-5 rounded-2xl border border-slate-700 bg-slate-950/55 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-white">Batch results</p>
                      <p className="mt-1 text-xs text-slate-400">
                        {batchResults.filter((result) => result.status === "success").length} successful ·{" "}
                        {batchResults.filter((result) => result.status === "failed").length} failed
                      </p>
                    </div>
                  </div>
                  <div className="mt-4 space-y-3">
                    {batchResults.map((result) => (
                      <article
                        key={result.id}
                        className={`rounded-xl border p-3 ${
                          result.status === "success"
                            ? "border-emerald-400/20 bg-emerald-500/[0.07]"
                            : "border-rose-400/20 bg-rose-500/[0.07]"
                        }`}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-white">{result.name}</p>
                            <p className="mt-1 truncate text-xs text-slate-400">{result.email}</p>
                            <p className={`mt-2 text-xs ${result.status === "success" ? "text-emerald-200" : "text-rose-200"}`}>
                              {result.status === "success"
                                ? result.emailStatus === "sent"
                                  ? "Invite emailed successfully"
                                  : result.emailStatus === "queued"
                                    ? "Invite queued for email delivery"
                                    : "Link created; manual delivery may be needed"
                                : result.error}
                            </p>
                          </div>
                          {result.status === "success" && result.link ? (
                            <button
                              type="button"
                              onClick={() => copyResultLink(result)}
                              className="shrink-0 rounded-lg border border-emerald-300/25 bg-emerald-400/10 px-3 py-2 text-xs font-semibold text-emerald-100 transition hover:border-emerald-200/50"
                            >
                              Copy link
                            </button>
                          ) : null}
                        </div>
                      </article>
                    ))}
                  </div>
                  {batchResults.every((result) => result.status === "success") ? (
                    <button
                      type="button"
                      onClick={startAnotherBatch}
                      className="mt-4 w-full rounded-xl border border-cyan-400/25 bg-cyan-400/[0.07] px-4 py-2.5 text-sm font-semibold text-cyan-100 transition hover:border-cyan-300/50"
                    >
                      Send another batch
                    </button>
                  ) : null}
                </div>
              ) : null}

              {link && (
                <div className="mt-5 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4">
                  <p className="mb-2 text-sm text-emerald-300">
                    {emailStatus === "sent"
                      ? "Link generated and email sent successfully"
                      : emailStatus === "queued"
                        ? "Link generated. Email delivery is in progress."
                        : "Link generated successfully. Email delivery needs attention."}
                  </p>
                  {emailStatus === "failed" ? (
                    <p className="mb-3 text-xs text-amber-200">
                      The interview link is ready, but the email could not be delivered from the server. You can still copy and send it manually.
                      {emailError ? <><br />Reason: {emailError}</> : null}
                    </p>
                  ) : null}
                  {copyStatus === "failed" ? (
                    <p className="mb-3 text-xs text-rose-200">
                      Copy failed on this browser session. Please select the link manually.
                    </p>
                  ) : null}
                  <input
                    className="mb-3 w-full rounded-2xl border border-slate-700 bg-slate-950/80 p-3 text-sm text-white"
                    value={link}
                    readOnly
                  />
                  <button
                    onClick={copy}
                    className="w-full rounded-2xl border border-slate-600 bg-slate-900/90 px-4 py-3 text-sm text-slate-100 transition hover:border-cyan-400/50 hover:bg-slate-800"
                  >
                    {copyStatus === "success" ? "Copied" : "Copy Link"}
                  </button>
                  <button
                    type="button"
                    onClick={startAnotherBatch}
                    className="mt-3 w-full rounded-2xl border border-cyan-400/25 bg-cyan-400/[0.07] px-4 py-3 text-sm font-semibold text-cyan-100 transition hover:border-cyan-300/50 hover:bg-cyan-400/10"
                  >
                    Send another candidate
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
