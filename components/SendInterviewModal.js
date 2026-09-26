"use client"

import Link from "next/link"
import { useEffect, useMemo, useRef, useState } from "react"
import { useAuthSearchParams } from "@/lib/client/use-auth-search-params"

import { showActionFeedback } from "@/lib/client/action-feedback"
import { buildAuthUrl } from "@/lib/client/auth-query"
import { copyText } from "@/lib/client/copy-to-clipboard"
import { formatDateTime } from "@/lib/client/date-format"
import UpgradeLimitDialog from "@/components/UpgradeLimitDialog"
import InterviewTypeChooser from "@/components/veris-live/InterviewTypeChooser"
import LiveInterviewModal from "@/components/veris-live/LiveInterviewModal"

const DASHBOARD_CACHE_KEY = "verisnova-overview"
const DASHBOARD_INVALIDATED_EVENT = "verisnova:dashboard-data-invalidated"
const DASHBOARD_INVALIDATED_KEY = "verisnova-overview-invalidated"
const SEND_INTERVIEW_JOBS_CACHE_PREFIX = "verisnova-send-interview-jobs"
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

function AccessFeatureIcon({ type }) {
  const paths = {
    single: (
      <>
        <path d="M12 3 5 6v5c0 4.1 2.7 7.9 7 9.5 4.3-1.6 7-5.4 7-9.5V6l-7-3Z" />
        <path d="m9.5 12 1.7 1.7 3.8-4" />
      </>
    ),
    expiry: (
      <>
        <circle cx="12" cy="13" r="7" />
        <path d="M12 9v4l2.5 1.5" />
        <path d="M9 2h6" />
      </>
    ),
    integrity: (
      <>
        <path d="M12 3a7 7 0 0 0-7 7v2c0 3.7 2.4 7 7 9 4.6-2 7-5.3 7-9v-2a7 7 0 0 0-7-7Z" />
        <path d="M9 12.5 11 14l4-5" />
      </>
    ),
  }

  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-4 w-4 text-cyan-200"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[type]}
    </svg>
  )
}

function FormStep({ number, title, hint, children }) {
  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4 shadow-sm sm:p-5">
      <div className="mb-3 flex items-start gap-3">
        <span className="hv-solid-action flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-cyan-500 to-indigo-600 text-sm font-semibold text-white shadow-sm">
          {number}
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-white">{title}</h3>
          {hint ? <p className="mt-0.5 text-xs text-slate-400">{hint}</p> : null}
        </div>
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  )
}

function SummaryItem({ label, value, muted }) {
  return (
    <div className="py-2.5">
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">{label}</p>
      <p className={`mt-0.5 text-sm ${muted ? "text-slate-500" : "font-medium text-white"}`}>{value}</p>
    </div>
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
          className="w-full rounded-xl border border-slate-700 bg-slate-950/80 px-10 py-2 text-sm text-white outline-none transition focus:border-cyan-400/60 focus:shadow-[0_0_0_3px_rgba(34,211,238,0.08)]"
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
    window.dispatchEvent(new CustomEvent("verisnova:trial-credits-updated", { detail: credits }))
  }
}

function normalizeActiveJobs(payload) {
  return (payload?.jobs || payload?.data?.jobs || []).filter(
    (job) => (job.isActive ?? job.is_active ?? true) !== false
  )
}

// VERIS Live entry point. With the feature flag off (or its status not yet
// known) this renders the VERIS AI Interview modal exactly as before.
let verisLiveStatusPromise = null

function loadVerisLiveEnabled(searchParams) {
  if (!verisLiveStatusPromise) {
    verisLiveStatusPromise = fetch(buildAuthUrl("/api/veris-live/status", searchParams), { credentials: "include" })
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => body?.data?.enabled === true)
      .catch(() => false)
  }
  return verisLiveStatusPromise
}

export default function SendInterviewModal(props) {
  const searchParams = useAuthSearchParams()
  const [liveEnabled, setLiveEnabled] = useState(false)
  const [interviewType, setInterviewType] = useState(null)

  useEffect(() => {
    let active = true
    loadVerisLiveEnabled(searchParams).then((enabled) => {
      if (active) setLiveEnabled(enabled)
    })
    return () => {
      active = false
    }
  }, [searchParams])

  // Reopening always starts from the type chooser.
  const [wasOpen, setWasOpen] = useState(props.isOpen)
  if (wasOpen !== props.isOpen) {
    setWasOpen(props.isOpen)
    if (!props.isOpen) setInterviewType(null)
  }

  if (!liveEnabled) return <AiSendInterviewModal {...props} />
  if (!props.isOpen) return null

  const close = () => {
    setInterviewType(null)
    props.onClose?.()
  }

  if (interviewType === null) {
    return <InterviewTypeChooser onCancel={close} onContinue={setInterviewType} />
  }
  if (interviewType === "LIVE") {
    return <LiveInterviewModal onClose={close} onBack={() => setInterviewType(null)} />
  }
  return <AiSendInterviewModal {...props} onClose={close} />
}

function AiSendInterviewModal({ isOpen, onClose, initialTrialCredits = null }) {
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
  const [duplicateResendEmails, setDuplicateResendEmails] = useState([])
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
    setDuplicateResendEmails([])
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

  const handleSubmit = async ({ confirmedDuplicate = false, confirmedCredit = false, skippedEmails = [] } = {}) => {
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

    const skippedEmailSet = new Set(skippedEmails)
    const candidates = collectCandidatesForSubmission().filter(
      (candidate) => !skippedEmailSet.has(candidate.email)
    )
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
            ? { name: candidate.name, email: candidate.email, lastSentAt: duplicateData.lastSentAt }
            : null
        }))
        const duplicateCandidates = duplicateChecks.filter(Boolean)

        if (duplicateCandidates.length > 0) {
          setDuplicateWarning({
            candidates: duplicateCandidates,
          })
          setDuplicateResendEmails([])
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
      window.dispatchEvent(new CustomEvent("verisnova:open-create-job"))
    }

    handleClose()
  }

  const hasSelectedDuplicate = Boolean(
    duplicateWarning?.candidates.some((candidate) => duplicateResendEmails.includes(candidate.email))
  )

  const selectedJob = jobs.find((job) => (job.jobId || job.job_id) === jobId)
  const selectedJobTitle = selectedJob ? selectedJob.jobTitle || selectedJob.job_title : null

  if (!isOpen) return null

  return (
    <div className="hv-theme-dialog-backdrop fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/80 px-4 py-4 backdrop-blur-md sm:py-6" role="dialog" aria-modal="true">
      {creditConfirmationOpen ? (
        <div className="hv-theme-dialog-backdrop fixed inset-0 z-[65] flex items-start justify-center overflow-y-auto bg-slate-950/70 px-4 py-4 backdrop-blur-sm sm:py-6" role="dialog" aria-modal="true">
          <div className="hv-theme-modal w-full max-w-md rounded-2xl border border-cyan-400/20 bg-[#0b1220] p-6 shadow-[0_24px_80px_rgba(2,6,23,0.55)]">
            <p className="text-xs font-semibold uppercase tracking-[0.26em] text-cyan-200/75">Credit Notice</p>
            <h3 className="mt-3 text-lg font-semibold text-white">
              You are about to use {pendingCandidateCount} AI/Live Interview {pendingCandidateCount === 1 ? "credit" : "credits"}.
            </h3>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              Remaining AI/Live Interview Credits after this batch: {Math.max(0, trialCredits.interviewCreditsRemaining - pendingCandidateCount)}
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
        <div className="hv-theme-dialog-backdrop fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-slate-950/80 px-4 py-4 backdrop-blur-sm sm:py-6" role="dialog" aria-modal="true">
          <div className="hv-theme-modal w-full max-w-md rounded-2xl border border-amber-400/25 bg-[#0b1220] p-6 shadow-[0_24px_80px_rgba(2,6,23,0.55)]">
            <h3 className="text-lg font-semibold text-white">Duplicate invite detected</h3>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              Previously invited candidates are skipped by default. Select any candidate who should receive another invite.
            </p>
            <div className="mt-4 max-h-48 space-y-2 overflow-y-auto">
              {duplicateWarning.candidates.map((candidate) => {
                const sentAt = candidate.lastSentAt ? new Date(candidate.lastSentAt) : null
                const sentAtLabel = sentAt && !Number.isNaN(sentAt.getTime())
                  ? formatDateTime(sentAt.toISOString())
                  : "an earlier date"

                return (
                  <label key={candidate.email} className="flex cursor-pointer items-center gap-3 rounded-xl border border-amber-300/15 bg-amber-500/[0.06] px-3 py-2">
                    <input
                      type="checkbox"
                      checked={duplicateResendEmails.includes(candidate.email)}
                      onChange={(event) => setDuplicateResendEmails((current) => event.target.checked
                        ? [...new Set([...current, candidate.email])]
                        : current.filter((emailAddress) => emailAddress !== candidate.email))}
                      className="h-4 w-4 shrink-0 accent-cyan-400"
                    />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-white">{candidate.name}</p>
                      <p className="truncate text-xs text-slate-400">{candidate.email}</p>
                      <p className="mt-1 text-xs text-amber-100/70">Last sent {sentAtLabel} · {duplicateResendEmails.includes(candidate.email) ? "Send again" : "Skip"}</p>
                    </div>
                  </label>
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
                disabled={!hasSelectedDuplicate}
                onClick={() => {
                  const skippedEmails = duplicateWarning.candidates
                    .map((candidate) => candidate.email)
                    .filter((candidateEmail) => !duplicateResendEmails.includes(candidateEmail))
                  setDuplicateWarning(null)
                  void handleSubmit({ confirmedDuplicate: true, skippedEmails })
                }}
                className={`rounded-xl border px-4 py-2 text-sm font-semibold transition ${
                  hasSelectedDuplicate
                    ? "hv-solid-action border-[#2563eb] bg-[#2563eb] text-white shadow-sm hover:border-[#1d4ed8] hover:bg-[#1d4ed8]"
                    : "cursor-not-allowed border-[#cbd5e1] bg-[#e2e8f0] text-[#64748b]"
                }`}
              >
                Continue with selected
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <div className="hv-send-interview-modal relative flex max-h-[calc(100dvh-2rem)] w-full max-w-5xl flex-col overflow-hidden rounded-[28px] border border-slate-800 bg-slate-900 text-white shadow-[0_24px_80px_rgba(15,23,42,0.35)]">
        {/* Header */}
        <div className="relative shrink-0 overflow-hidden border-b border-slate-800 px-5 py-5 sm:px-7">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_120%_at_0%_0%,rgba(34,211,238,0.14),transparent_60%),radial-gradient(50%_120%_at_100%_0%,rgba(99,102,241,0.12),transparent_60%)]"
          />
          <div className="relative flex items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              <span className="hv-solid-action flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-500 to-indigo-600 text-white shadow-lg shadow-cyan-500/20">
                <svg aria-hidden="true" viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="3" width="6" height="11" rx="3" />
                  <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
                  <path d="M19.5 3.5l.5 1.3 1.3.5-1.3.5-.5 1.3-.5-1.3-1.3-.5 1.3-.5z" />
                </svg>
              </span>
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-300">VERIS AI Interview</p>
                <h2 className="mt-1 text-2xl font-semibold tracking-tight text-white">Send Interview Link</h2>
                <p className="mt-1 max-w-xl text-sm text-slate-400">
                  Add one or several candidates, apply one access window, and send every secure interview invite in a single batch.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleClose}
              className="rounded-full border border-slate-700 bg-slate-900 px-3.5 py-1.5 text-sm text-slate-300 transition hover:text-white"
            >
              Close
            </button>
          </div>
        </div>

        {emptyJobsState ? (
          <div className="overflow-y-auto p-5 sm:p-7">
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
          </div>
        ) : (
          <>
            <div className="grid min-h-0 flex-1 overflow-y-auto lg:grid-cols-[minmax(0,1fr)_300px]">
              {/* Steps */}
              <div className="space-y-4 p-5 sm:p-6">
                <FormStep number={1} title="Job" hint="The role this interview evaluates.">
                  <select
                    className="w-full truncate rounded-xl border border-slate-700 bg-slate-900 px-3.5 py-2.5 text-sm text-white shadow-sm outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20"
                    value={jobId}
                    onChange={(e) => setJobId(e.target.value)}
                    disabled={jobsLoading}
                    aria-label="Select job"
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
                </FormStep>

                <FormStep
                  number={2}
                  title={queuedCandidates.length > 0 ? "Candidates" : "Candidate"}
                  hint={`Name, email and resume. Add up to ${MAX_BATCH_CANDIDATES} candidates to one batch.`}
                >
                  {queuedCandidates.length > 0 ? (
                    <div className="space-y-2">
                      {queuedCandidates.map((candidate, index) => (
                        <div key={candidate.id} className="flex items-center gap-3 rounded-xl border border-cyan-400/20 bg-cyan-400/[0.06] px-3 py-2.5">
                          <span className="hv-solid-action flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-cyan-500 to-blue-600 text-[11px] font-semibold text-white">
                            {index + 1}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-white">{candidate.name}</p>
                            <p className="truncate text-xs text-slate-400">
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
                      <p className="pt-1 text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Add another candidate</p>
                    </div>
                  ) : null}

                  <div className="grid gap-3 md:grid-cols-2">
                    <div>
                      <label className="text-sm text-slate-300">Full name *</label>
                      <input
                        className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-900 px-3.5 py-2.5 text-sm text-white shadow-sm outline-none transition placeholder:text-slate-500 focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20"
                        placeholder="Enter candidate name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="text-sm text-slate-300">Email *</label>
                      <input
                        type="email"
                        className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-900 px-3.5 py-2.5 text-sm text-white shadow-sm outline-none transition placeholder:text-slate-500 focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20"
                        placeholder="candidate@email.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm text-slate-300">Resume *</label>
                    {resumeFile ? (
                      <div className="mt-1.5 flex flex-wrap items-center gap-3 rounded-xl border border-cyan-400/30 bg-cyan-400/[0.06] px-3 py-2.5">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-cyan-400/10 text-cyan-300">
                          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M6 3h8l4 4v14H6z" />
                            <path d="M14 3v4h4" />
                          </svg>
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-white">{resumeFile.name}</p>
                          <p className="text-xs text-slate-400">{getResumeSourceLabel(resumeFile)}</p>
                        </div>
                        <label className="cursor-pointer rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:border-cyan-400/50 hover:text-white">
                          Change
                          <input ref={changeFileInputRef} type="file" className="hidden" onChange={handleResumeSelect} />
                        </label>
                        <button
                          type="button"
                          onClick={clearResumeFile}
                          className="rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-1.5 text-xs font-medium text-rose-200 transition hover:border-rose-300/50 hover:text-white"
                        >
                          Remove
                        </button>
                      </div>
                    ) : (
                      <label className="mt-1.5 flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-slate-700 bg-slate-950/40 px-4 py-3 transition hover:border-cyan-400/40">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-cyan-400/10 text-cyan-300">
                          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />
                          </svg>
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium text-white">Upload resume</span>
                          <span className="block text-xs text-slate-400">PDF or DOCX</span>
                        </span>
                        <input ref={primaryFileInputRef} type="file" className="hidden" onChange={handleResumeSelect} />
                      </label>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={addCandidateToBatch}
                    disabled={loading}
                    className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-cyan-400/40 px-3.5 py-1.5 text-sm font-medium text-cyan-200 transition hover:bg-cyan-400/10 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <span className="text-base leading-none">+</span> Add candidate to batch
                  </button>
                </FormStep>

                <FormStep number={3} title="Access window" hint="When candidates can open their interview link.">
                  <div className="grid gap-2 sm:grid-cols-2">
                    {[
                      ["FLEXIBLE", "Flexible", "Open for 24 hours from sending"],
                      ["SCHEDULED", "Scheduled window", "Only between a start and end time"],
                    ].map(([value, title, detail]) => {
                      const active = accessType === value
                      return (
                        <label
                          key={value}
                          className={`flex cursor-pointer items-start gap-3 rounded-xl border px-3.5 py-3 transition ${
                            active ? "border-cyan-400/40 bg-cyan-400/10" : "border-slate-800 hover:border-slate-600"
                          }`}
                        >
                          <input
                            type="radio"
                            value={value}
                            checked={active}
                            onChange={() => setAccessType(value)}
                            className="mt-0.5 h-4 w-4 accent-cyan-400"
                          />
                          <span>
                            <span className="block text-sm font-medium text-white">{title}</span>
                            <span className="block text-xs text-slate-400">{detail}</span>
                          </span>
                        </label>
                      )
                    })}
                  </div>

                  {accessType === "SCHEDULED" && (
                    <div className="rounded-xl border border-cyan-500/15 bg-slate-950/40 p-3">
                      <div className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.2em] text-cyan-200/75">
                        <CalendarIcon />
                        <span>Schedule Window</span>
                      </div>
                      <div className="grid gap-3 md:grid-cols-2">
                        <DateTimeField label="Start Time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
                        <DateTimeField label="End Time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
                      </div>
                    </div>
                  )}
                </FormStep>

                {batchResults.length > 1 || batchResults.some((result) => result.status === "failed") ? (
                  <div className="rounded-2xl border border-slate-700 bg-slate-950/55 p-4">
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
                  <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4">
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
                      className="w-full rounded-xl border border-slate-600 bg-slate-900/90 px-3.5 py-2 text-sm text-slate-100 transition hover:border-cyan-400/50 hover:bg-slate-800"
                    >
                      {copyStatus === "success" ? "Copied" : "Copy Link"}
                    </button>
                    <button
                      type="button"
                      onClick={startAnotherBatch}
                      className="mt-3 w-full rounded-xl border border-cyan-400/25 bg-cyan-400/[0.07] px-3.5 py-2 text-sm font-semibold text-cyan-100 transition hover:border-cyan-300/50 hover:bg-cyan-400/10"
                    >
                      Send another candidate
                    </button>
                  </div>
                )}
              </div>

              {/* Summary */}
              <aside className="border-t border-slate-800 bg-slate-950/40 p-5 sm:p-6 lg:border-l lg:border-t-0">
                <div className="lg:sticky lg:top-0">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Invite summary</p>
                  <div className="mt-2 divide-y divide-slate-800">
                    <SummaryItem label="Job" value={selectedJobTitle || "Select a job"} muted={!selectedJobTitle} />
                    <SummaryItem
                      label="Candidates"
                      value={pendingCandidateCount ? `${pendingCandidateCount} ready to invite` : "None added yet"}
                      muted={!pendingCandidateCount}
                    />
                    <SummaryItem
                      label="Access"
                      value={
                        accessType === "SCHEDULED"
                          ? startTime && endTime
                            ? `${formatDateTime(startTime)} – ${formatDateTime(endTime)}`
                            : "Scheduled window (set times)"
                          : "Flexible · 24 hours"
                      }
                      muted={accessType === "SCHEDULED" && !(startTime && endTime)}
                    />
                  </div>

                  <div
                    className={`mt-4 rounded-2xl border p-4 ${
                      trialCredits.interviewCreditsRemaining <= 0 ? "border-amber-400/25 bg-amber-500/10" : "border-cyan-400/20 bg-cyan-400/[0.06]"
                    }`}
                  >
                    {trialCredits.interviewCreditsRemaining <= 0 ? (
                      <>
                        <p className="text-sm text-amber-100">{trialCredits.upgradeMessage}</p>
                        <button
                          type="button"
                          onClick={() => setUpgradeLimitOpen(true)}
                          className="mt-3 w-full rounded-xl border border-amber-200/35 bg-amber-300/12 px-4 py-2 text-sm font-semibold text-amber-50 transition hover:border-amber-100/60"
                        >
                          View Subscription Plans
                        </button>
                      </>
                    ) : (
                      <>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">AI/Live interview credits</p>
                        <p className="mt-1 text-2xl font-semibold text-white">{trialCredits.interviewCreditsRemaining}</p>
                        <p className="text-xs text-slate-400">
                          remaining{pendingCandidateCount > 0 ? ` · this batch uses ${pendingCandidateCount}` : ""}
                        </p>
                      </>
                    )}
                  </div>

                  <div className="mt-4 space-y-2.5">
                    {[
                      ["single", "Single-use access", "Each invite works for one candidate only."],
                      ["expiry", "Auto expiry", "Links expire after the access window."],
                      ["integrity", "Integrity monitoring", "Sessions are watched for trust signals."],
                    ].map(([type, title, detail]) => (
                      <div key={title} className="flex items-start gap-2.5">
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-cyan-400/20 bg-cyan-400/[0.07]">
                          <AccessFeatureIcon type={type} />
                        </span>
                        <span>
                          <span className="block text-xs font-semibold text-white">{title}</span>
                          <span className="block text-xs text-slate-400">{detail}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </aside>
            </div>

            {/* Footer */}
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-slate-800 bg-slate-900 px-5 py-4 sm:px-7">
              <div className="min-w-0 flex-1">
                {error ? <p role="alert" className="text-sm text-rose-300">{error}</p> : (
                  <p className="text-xs text-slate-400">Each candidate gets a secure, single-use interview link by email.</p>
                )}
              </div>
              <button
                onClick={() => handleSubmit()}
                disabled={loading || jobsLoading || trialCredits.interviewCreditsRemaining <= 0}
                className="hv-solid-action inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 via-blue-500 to-indigo-500 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-blue-600/20 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading
                  ? `Preparing ${pendingCandidateCount || queuedCandidates.length} ${pendingCandidateCount === 1 ? "invite" : "invites"}...`
                  : pendingCandidateCount > 1
                    ? `Send ${pendingCandidateCount} Interview Invites`
                    : "Send Interview Invite"}
                {!loading ? (
                  <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 12h14M13 6l6 6-6 6" />
                  </svg>
                ) : null}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
