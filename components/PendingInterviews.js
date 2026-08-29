"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useAuthSearchParams } from "@/lib/client/use-auth-search-params"

import { buildAuthUrl, hasAuthQuery } from "@/lib/client/auth-query"
import { copyText } from "@/lib/client/copy-to-clipboard"
import {
  convertOrgTimeToUtc,
  formatDateTime,
  toOrgDateTimeInputValue,
} from "@/lib/client/date-format"
import { canAccessFeature } from "@/lib/client/permissions"
import { useOrgTimezone } from "@/components/OrgTimezoneProvider"
import { TableSkeleton } from "@/components/system/skeletons"

const DASHBOARD_INVALIDATED_EVENT = "verisnova:dashboard-data-invalidated"

function getInterviewActivityTime(interview) {
  const value = interview?.endedAt || interview?.startedAt || interview?.startTime || interview?.createdAt
  const time = value ? new Date(value).getTime() : 0
  return Number.isFinite(time) ? time : 0
}

function getExpiryLabel(expiresAt, nowTick) {
  if (!expiresAt) {
    return "No expiry"
  }

  const expiresAtDate = new Date(expiresAt)
  const diffMs = expiresAtDate.getTime() - nowTick

  if (Number.isNaN(expiresAtDate.getTime()) || diffMs <= 0) {
    return "Expired"
  }

  const totalHours = Math.ceil(diffMs / (1000 * 60 * 60))
  return `Expires in ${totalHours}h`
}

function getInterviewTypeLabel(item) {
  const accessType = String(item.accessType ?? "FLEXIBLE").toUpperCase()

  if (accessType === "SCHEDULED") {
    return item.startTime ? `Scheduled: ${formatDateTime(item.startTime)}` : "Scheduled"
  }

  return "Flexible"
}

function getWorkflowStatus(item) {
  const status = String(item.status ?? "").toUpperCase()
  if (status === "INTERRUPTED") return "Interrupted"
  if (status === "PREPARATION_FAILED") return "Preparation Failed"
  if (status === "EMAIL_FAILED") return "Email Failed"
  if (status === "SENDING_EMAIL") return "Sending Email"
  if (status === "PREPARING_INTERVIEW" || String(item.questionStatus ?? "").toUpperCase() === "GENERATING") return "Preparing Interview"
  return "Ready"
}

function getWorkflowStatusClass(item) {
  const status = String(item.status ?? "").toUpperCase()
  if (status === "INTERRUPTED") return "border-amber-300/30 bg-amber-500/10 text-amber-100"
  if (status === "PREPARATION_FAILED") return "border-rose-400/25 bg-rose-500/10 text-rose-200"
  if (status === "EMAIL_FAILED") return "border-amber-400/25 bg-amber-500/10 text-amber-200"
  if (status === "SENDING_EMAIL" || status === "PREPARING_INTERVIEW") return "border-blue-400/25 bg-blue-500/10 text-blue-200"
  return "border-emerald-400/25 bg-emerald-500/10 text-emerald-200"
}

function BaseModalShell({ title, subtitle, children, onClose, width = "max-w-2xl" }) {
  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-slate-950/80 px-4 py-4 backdrop-blur-md sm:py-6" role="dialog" aria-modal="true">
      <div className={`w-full ${width} rounded-2xl border border-slate-800 bg-slate-900/95 p-6 shadow-[0_18px_60px_rgba(2,6,23,0.28)]`}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-2xl font-semibold text-white">{title}</h3>
            {subtitle ? <p className="mt-2 text-sm text-slate-400">{subtitle}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-cyan-400/25 bg-cyan-400/10 px-4 py-2 text-sm text-cyan-100 transition hover:bg-cyan-400/20"
          >
            Close
          </button>
        </div>
        <div className="mt-6">{children}</div>
      </div>
    </div>
  )
}

function NoticeModal({ open, title, message, onClose, tone = "error" }) {
  if (!open) {
    return null
  }

  const toneClass = tone === "success"
    ? "border-emerald-400/25 bg-emerald-500/10 text-emerald-100"
    : "border-rose-400/25 bg-rose-500/10 text-rose-100"

  return (
    <BaseModalShell title={title} subtitle={null} onClose={onClose} width="max-w-xl">
      <div className={`whitespace-pre-line rounded-2xl border p-4 text-sm ${toneClass}`}>
        {message}
      </div>
      <div className="mt-5 flex justify-end">
        <button
          type="button"
          onClick={onClose}
          className="rounded-2xl bg-white px-5 py-2.5 text-sm font-medium text-slate-900 transition hover:bg-slate-100"
        >
          OK
        </button>
      </div>
    </BaseModalShell>
  )
}

function DateTimeField({ label, value, onChange }) {
  return (
    <div>
      <label className="mb-2 block text-sm text-gray-400">{label}</label>
      <input
        type="datetime-local"
        className="w-full rounded-2xl border border-slate-700 bg-slate-950/80 px-4 py-3 text-white outline-none transition focus:border-cyan-400/60"
        value={value}
        onChange={onChange}
      />
    </div>
  )
}

function EditInterviewModal({ isOpen, item, form, onChange, onClose, onSave, saving }) {
  if (!isOpen || !item) {
    return null
  }

  return (
    <BaseModalShell
      title="Edit Interview Invite"
      subtitle="Update access type or reschedule the current pending interview link."
      onClose={onClose}
    >
      <div className="grid gap-5">
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-slate-300">
          <p className="font-medium text-white">{item.candidateName}</p>
          <p className="mt-1 text-slate-400">{item.jobTitle}</p>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/55 p-4">
          <p className="mb-3 text-sm font-medium text-slate-300">Interview Access Type</p>

          <label className="mb-2 flex items-center gap-3 rounded-xl border border-transparent px-3 py-2 text-sm text-slate-200 transition hover:border-cyan-500/20 hover:bg-slate-800/60">
            <input
              type="radio"
              value="FLEXIBLE"
              checked={form.accessType === "FLEXIBLE"}
              onChange={() => onChange({ accessType: "FLEXIBLE" })}
              className="h-4 w-4 accent-cyan-400"
            />
            <span>Flexible (24h access)</span>
          </label>

          <label className="flex items-center gap-3 rounded-xl border border-transparent px-3 py-2 text-sm text-slate-200 transition hover:border-cyan-500/20 hover:bg-slate-800/60">
            <input
              type="radio"
              value="SCHEDULED"
              checked={form.accessType === "SCHEDULED"}
              onChange={() => onChange({ accessType: "SCHEDULED" })}
              className="h-4 w-4 accent-cyan-400"
            />
            <span>Scheduled (specific time window)</span>
          </label>
        </div>

        {form.accessType === "SCHEDULED" ? (
          <div className="grid gap-4 md:grid-cols-2">
            <DateTimeField label="Start Time" value={form.startTime} onChange={(e) => onChange({ startTime: e.target.value })} />
            <DateTimeField label="End Time" value={form.endTime} onChange={(e) => onChange({ endTime: e.target.value })} />
          </div>
        ) : null}

        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-2xl border border-slate-700 bg-slate-900/70 px-4 py-2.5 text-sm text-slate-200 transition hover:border-slate-500 hover:text-white"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className="rounded-2xl bg-gradient-to-r from-cyan-500 via-blue-500 to-indigo-500 px-5 py-2.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </div>
    </BaseModalShell>
  )
}

function DeleteInterviewModal({ isOpen, item, reason, onReasonChange, onClose, onConfirm, deleting }) {
  if (!isOpen || !item) {
    return null
  }

  return (
    <BaseModalShell
      title="Delete Interview Invite"
      subtitle="This will revoke the interview link so it can no longer be used by the candidate."
      onClose={onClose}
    >
      <div className="grid gap-5">
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-slate-300">
          <p className="font-medium text-white">{item.candidateName}</p>
          <p className="mt-1 text-slate-400">{item.jobTitle}</p>
          <p className="mt-2 text-xs uppercase tracking-[0.18em] text-amber-300/80">
            {getInterviewTypeLabel(item)}
          </p>
        </div>

        <div>
          <label className="mb-2 block text-sm text-slate-300">Reason for cancellation</label>
          <textarea
            value={reason}
            onChange={(e) => onReasonChange(e.target.value)}
            rows={4}
            placeholder="Candidate not available"
            className="w-full rounded-2xl border border-slate-700 bg-slate-950/80 px-4 py-3 text-white outline-none transition placeholder:text-slate-500 focus:border-rose-400/60"
          />
        </div>

        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-2xl border border-slate-700 bg-slate-900/70 px-4 py-2.5 text-sm text-slate-200 transition hover:border-slate-500 hover:text-white"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={deleting}
            className="rounded-2xl border border-rose-400/30 bg-rose-500/10 px-5 py-2.5 text-sm font-medium text-rose-100 transition hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {deleting ? "Deleting..." : "Delete Invite"}
          </button>
        </div>
      </div>
    </BaseModalShell>
  )
}

function RecoverySummary({ recovery }) {
  if (!recovery) {
    return null
  }

  return (
    <div className="mt-2 grid gap-1 text-xs text-slate-400">
      <div>Reason: <span className="text-amber-200">{recovery.reason || "Technical interruption detected"}</span></div>
      <div>Completion: <span className="text-cyan-200">{recovery.completionPercentage}%</span></div>
      <div>Recovery Available: <span className={recovery.available ? "text-emerald-300" : "text-rose-300"}>{recovery.available ? "YES" : "NO"}</span></div>
    </div>
  )
}

function openDashboardAction(action) {
  if (typeof window === "undefined") {
    return
  }

  window.dispatchEvent(new CustomEvent(action))
}

function GuidedInterviewEmptyState({ compact = false, profile = null }) {
  const canCreateJob = canAccessFeature(profile, "createJob")
  const canSendInterview = canAccessFeature(profile, "sendInterview")

  return (
    <div className={`hv-invited-empty-state rounded-2xl border border-cyan-300/15 bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.12),transparent_34%),linear-gradient(135deg,rgba(15,23,42,0.82),rgba(2,6,23,0.72))] text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] ${compact ? "px-4 py-6" : "px-6 py-8"}`}>
      <p className="hv-invited-empty-title text-base font-semibold text-white">Start by creating a job and inviting candidates.</p>
      <p className="hv-invited-empty-copy mx-auto mt-2 max-w-md text-sm leading-6 text-slate-400">
        Create a job and begin candidate evaluation.
      </p>
      {canCreateJob || canSendInterview ? (
      <div className="mt-4 flex flex-wrap justify-center gap-3">
        {canCreateJob ? (
        <button
          type="button"
          onClick={() => openDashboardAction("verisnova:open-create-job")}
          className="hv-invited-empty-primary rounded-xl border border-blue-300/25 bg-blue-500/10 px-4 py-2 text-sm font-semibold text-blue-100 transition hover:border-blue-300/45 hover:bg-blue-500/20"
        >
          Create Job
        </button>
        ) : null}
        {canSendInterview ? (
        <button
          type="button"
          onClick={() => openDashboardAction("verisnova:open-send-interview")}
          className="hv-invited-empty-secondary rounded-xl border border-cyan-300/25 bg-cyan-500/10 px-4 py-2 text-sm font-semibold text-cyan-100 transition hover:border-cyan-300/45 hover:bg-cyan-500/20"
        >
          Send Interview Link
        </button>
        ) : null}
      </div>
      ) : null}
    </div>
  )
}

function PendingInterviewsModal({ isOpen, onClose, interviews, onCopy, onEdit, onDelete, onRetryPreparation, onRetryEmail, onRecoveryAction, onViewRecoveryAudit, nowTick, copiedLink, busyInviteId, profile }) {
  const canEditInterview = canAccessFeature(profile, "editInterview")
  const canDeleteInterview = canAccessFeature(profile, "deleteInterview")
  const canRetryInterview = canAccessFeature(profile, "retryInterview")
  const canViewWarRoom = canAccessFeature(profile, "warRoom")

  if (!isOpen) {
    return null
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[#020817]/80 px-4 py-4 backdrop-blur-md sm:py-6" role="dialog" aria-modal="true">
      <div className="relative w-full max-w-6xl overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/95 shadow-[0_18px_60px_rgba(2,6,23,0.28)]">
        <div className="absolute inset-x-0 top-0 h-px bg-slate-700/70" />

        <div className="flex items-center justify-between border-b border-white/10 px-8 py-6">
          <div>
            <h3 className="text-2xl font-semibold text-white">All Invited Interviews</h3>
            <p className="mt-2 text-sm text-slate-400">
              Live invite queue sorted by newest invite first.
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-cyan-400/25 bg-cyan-400/10 px-4 py-2 text-sm text-cyan-100 transition hover:bg-cyan-400/20"
          >
            Close
          </button>
        </div>

        <div className="max-h-[75vh] overflow-auto px-8 py-6">
          <div className="grid grid-cols-[1.1fr_1fr_1.1fr_1.25fr_0.9fr_0.9fr_minmax(260px,1.45fr)] gap-4 border-b border-white/10 pb-3 text-xs uppercase tracking-[0.24em] text-slate-500">
            <div>Candidate</div>
            <div>Job</div>
            <div>Status</div>
            <div>Interview Type</div>
            <div>Created</div>
            <div>Expiry</div>
            <div>Action</div>
          </div>

          <div className="mt-4 space-y-3">
            {interviews.length === 0 ? (
              <GuidedInterviewEmptyState profile={profile} />
            ) : (
              interviews.map((item) => (
                <div
                  key={item.inviteId}
                  className="grid grid-cols-[1.1fr_1fr_1.1fr_1.25fr_0.9fr_0.9fr_minmax(260px,1.45fr)] gap-4 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-4 text-sm text-slate-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
                >
                  <div className="font-medium text-white">{item.candidateName}</div>
                  <div className="text-slate-300">{item.jobTitle}</div>
                  <div>
                    <span className={`inline-flex min-w-[96px] items-center justify-center whitespace-nowrap rounded-full border px-3 py-1 text-center text-xs font-medium leading-5 ${getWorkflowStatusClass(item)}`}>
                      {getWorkflowStatus(item)}
                    </span>
                    <RecoverySummary recovery={item.recovery} />
                  </div>
                  <div className="text-cyan-200">{getInterviewTypeLabel(item)}</div>
                  <div className="whitespace-nowrap text-slate-400">{formatDateTime(item.createdAt)}</div>
                  <div className="text-amber-300">{getExpiryLabel(item.expiresAt, nowTick)}</div>
                  <div className="flex flex-nowrap items-center gap-2 whitespace-nowrap">
                    {canRetryInterview && String(item.status).toUpperCase() === "PREPARATION_FAILED" ? (
                      <button type="button" disabled={busyInviteId === item.inviteId} onClick={() => onRetryPreparation(item)} className="shrink-0 rounded-full border border-rose-400/30 bg-rose-500/10 px-3 py-1.5 text-rose-100 transition hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-60">
                        {busyInviteId === item.inviteId ? "Retrying..." : "Retry Prep"}
                      </button>
                    ) : null}
                    {String(item.status).toUpperCase() === "INTERRUPTED" && (canRetryInterview || canViewWarRoom) ? (
                      <>
                        {canRetryInterview ? (
                        <button type="button" disabled={busyInviteId === item.inviteId || !item.recovery?.available} onClick={() => onRecoveryAction(item, "approve")} className="shrink-0 rounded-full border border-emerald-400/30 bg-emerald-500/10 px-3 py-1.5 text-emerald-100 transition hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50">
                          {busyInviteId === item.inviteId ? "Issuing..." : "Send Recovery Link"}
                        </button>
                        ) : null}
                        {canViewWarRoom ? (
                        <button type="button" onClick={() => onViewRecoveryAudit(item)} className="shrink-0 rounded-full border border-fuchsia-400/30 bg-fuchsia-500/10 px-3 py-1.5 text-fuchsia-100 transition hover:bg-fuchsia-500/20">
                          Evidence Logs
                        </button>
                        ) : null}
                      </>
                    ) : null}
                    <button type="button" disabled={!item.link} onClick={() => onCopy(item.link)} className="shrink-0 rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1.5 text-cyan-100 transition hover:bg-cyan-400/20 disabled:cursor-not-allowed disabled:opacity-50">
                      {copiedLink === item.link ? "Copied" : "Copy"}
                    </button>
                    {canRetryInterview && String(item.status).toUpperCase() === "EMAIL_FAILED" ? (
                      <button type="button" disabled={busyInviteId === item.inviteId} onClick={() => onRetryEmail(item)} className="shrink-0 rounded-full border border-amber-400/30 bg-amber-500/10 px-3 py-1.5 text-amber-100 transition hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-60">
                        {busyInviteId === item.inviteId ? "Sending..." : "Retry Email"}
                      </button>
                    ) : null}
                    {canEditInterview ? (
                    <button type="button" disabled={String(item.status).toUpperCase() === "PREPARATION_FAILED"} onClick={() => onEdit(item)} className="shrink-0 rounded-full border border-indigo-400/30 bg-indigo-400/10 px-3 py-1.5 text-indigo-100 transition hover:bg-indigo-400/20 disabled:cursor-not-allowed disabled:opacity-50">
                      Edit
                    </button>
                    ) : null}
                    {canDeleteInterview ? (
                    <button type="button" disabled={busyInviteId === item.inviteId} onClick={() => onDelete(item)} className="shrink-0 rounded-full border border-rose-400/30 bg-rose-500/10 px-3 py-1.5 text-rose-100 transition hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-60">
                      {busyInviteId === item.inviteId ? "Deleting..." : "Delete"}
                    </button>
                    ) : null}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default function PendingInterviews({ initialPendingInterviews, initialPendingTotal, profile = null, isLoading = false }) {
  const searchParams = useAuthSearchParams()
  const { timezone } = useOrgTimezone()
  const [interviews, setInterviews] = useState(() => initialPendingInterviews ?? [])
  const [pendingTotal, setPendingTotal] = useState(() => initialPendingTotal ?? initialPendingInterviews?.length ?? 0)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isLoadingAll, setIsLoadingAll] = useState(false)
  const [editItem, setEditItem] = useState(null)
  const [editForm, setEditForm] = useState({ accessType: "FLEXIBLE", startTime: "", endTime: "" })
  const [savingEdit, setSavingEdit] = useState(false)
  const [deleteItem, setDeleteItem] = useState(null)
  const [deleteReason, setDeleteReason] = useState("Candidate not available")
  const [busyInviteId, setBusyInviteId] = useState("")
  const [notice, setNotice] = useState({ open: false, title: "", message: "", tone: "error" })
  const [nowTick, setNowTick] = useState(() => Date.now())
  const [copiedLink, setCopiedLink] = useState("")
  const hasInitial = initialPendingInterviews !== undefined
  const canEditInterview = canAccessFeature(profile, "editInterview")
  const canDeleteInterview = canAccessFeature(profile, "deleteInterview")
  const canRetryInterview = canAccessFeature(profile, "retryInterview")
  const canViewWarRoom = canAccessFeature(profile, "warRoom")

  useEffect(() => {
    if (!hasInitial) {
      return undefined
    }

    let active = true
    window.queueMicrotask(() => {
      if (!active) {
        return
      }

      setInterviews(initialPendingInterviews ?? [])
      setPendingTotal(initialPendingTotal ?? initialPendingInterviews?.length ?? 0)
    })

    return () => {
      active = false
    }
  }, [hasInitial, initialPendingInterviews, initialPendingTotal])

  const loadPendingInterviews = useCallback(async ({ limit = 5 } = {}) => {
    if (!hasAuthQuery(searchParams)) {
      return
    }

    const path = limit === "all" ? "/api/dashboard/pipeline?limit=all" : `/api/dashboard/pipeline?limit=${limit}`
    const response = await fetch(buildAuthUrl(path, searchParams), {
      credentials: "include",
      cache: "no-store",
    })

    const data = await response.json()

    if (!response.ok) {
      throw new Error(data?.error?.message || data?.message || "Failed to fetch pending interviews")
    }

    setInterviews(data.data?.pendingInterviews ?? [])
    setPendingTotal(data.data?.pendingTotal ?? data.data?.pendingInterviews?.length ?? 0)
  }, [searchParams])

  useEffect(() => {
    if (hasInitial) {
      return
    }

    let isMounted = true

    loadPendingInterviews({ limit: 5 }).catch((error) => {
      if (isMounted) {
        console.error("Failed to fetch pending interviews", error)
      }
    })

    return () => {
      isMounted = false
    }
  }, [hasInitial, loadPendingInterviews])

  useEffect(() => {
    if (!hasInitial || typeof window === "undefined") {
      return undefined
    }

    let isMounted = true
    const timeoutId = window.setTimeout(() => {
      loadPendingInterviews({ limit: 5 }).catch((error) => {
        if (isMounted) {
          console.error("Failed to refresh initial pending interviews", error)
        }
      })
    }, 150)

    return () => {
      isMounted = false
      window.clearTimeout(timeoutId)
    }
  }, [hasInitial, loadPendingInterviews])

  useEffect(() => {
    if (!hasAuthQuery(searchParams) || typeof window === "undefined") {
      return undefined
    }

    let refreshTimer = null

    function handleDashboardInvalidated() {
      if (refreshTimer) {
        window.clearTimeout(refreshTimer)
      }

      refreshTimer = window.setTimeout(() => {
        loadPendingInterviews({ limit: isModalOpen ? "all" : 5 }).catch((error) => {
          console.error("Failed to refresh pending interviews", error)
        })
      }, 125)
    }

    window.addEventListener(DASHBOARD_INVALIDATED_EVENT, handleDashboardInvalidated)

    return () => {
      if (refreshTimer) {
        window.clearTimeout(refreshTimer)
      }
      window.removeEventListener(DASHBOARD_INVALIDATED_EVENT, handleDashboardInvalidated)
    }
  }, [isModalOpen, loadPendingInterviews, searchParams])

  useEffect(() => {
    const timer = setInterval(() => {
      setNowTick(Date.now())
    }, 60000)

    return () => {
      clearInterval(timer)
    }
  }, [])

  useEffect(() => {
    if (!copiedLink) {
      return
    }

    const timer = setTimeout(() => setCopiedLink(""), 1800)
    return () => clearTimeout(timer)
  }, [copiedLink])

  const sortedInterviews = useMemo(
    () =>
      [...interviews].sort(
        (a, b) => getInterviewActivityTime(b) - getInterviewActivityTime(a)
      ),
    [interviews]
  )

  const previewInterviews = sortedInterviews.slice(0, 5)
  const hasMoreInterviews = pendingTotal > previewInterviews.length

  async function handleOpenAllInterviews() {
    setIsModalOpen(true)

    if (!hasMoreInterviews || isLoadingAll) {
      return
    }

    try {
      setIsLoadingAll(true)
      await loadPendingInterviews({ limit: "all" })
    } catch (error) {
      console.error("Failed to fetch all pending interviews", error)
    } finally {
      setIsLoadingAll(false)
    }
  }

  async function handleCopy(link) {
    const copied = await copyText(link)

    if (copied) {
      setCopiedLink(link)
      return
    }

    console.error("Failed to copy interview link")
  }

  async function handleRetryPreparation(item) {
    try {
      setBusyInviteId(item.inviteId)
      const response = await fetch(buildAuthUrl(`/api/interview/${item.interviewId}/retry-preparation`, searchParams), {
        method: "POST",
        credentials: "include",
      })
      const data = await response.json()
      if (!response.ok || !data.success) {
        throw new Error(data?.error?.message || data?.message || "Failed to retry preparation")
      }
      await loadPendingInterviews({ limit: 5 })
    } catch (error) {
      setNotice({
        open: true,
        title: "Unable to retry preparation",
        message: error instanceof Error ? error.message : "Failed to retry preparation",
        tone: "error",
      })
    } finally {
      setBusyInviteId("")
    }
  }

  async function handleRetryEmail(item) {
    try {
      setBusyInviteId(item.inviteId)
      const response = await fetch(buildAuthUrl(`/api/interview/${item.interviewId}/retry-email`, searchParams), {
        method: "POST",
        credentials: "include",
      })
      const data = await response.json()
      if (!response.ok || !data.success) {
        throw new Error(data?.error?.message || data?.message || "Failed to retry email")
      }
      await loadPendingInterviews({ limit: 5 })
    } catch (error) {
      setNotice({
        open: true,
        title: "Unable to retry email",
        message: error instanceof Error ? error.message : "Failed to retry email",
        tone: "error",
      })
    } finally {
      setBusyInviteId("")
    }
  }

  async function handleRecoveryAction(item, action) {
    try {
      setBusyInviteId(item.inviteId)
      const response = await fetch(buildAuthUrl(`/api/interview/${item.interviewId}/recovery`, searchParams), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({
          action,
          idempotencyKey: `${action}:${item.recovery?.attemptId || item.interviewId}`,
        }),
      })
      const data = await response.json()
      if (!response.ok || !data.success) {
        throw new Error(data?.error?.message || data?.message || "Failed to update recovery workflow")
      }
      const recoveryLink = data.data?.recoveryLink
      if (recoveryLink) {
        await copyText(recoveryLink)
      }
      await loadPendingInterviews({ limit: 5 })
      setNotice({
        open: true,
        title: action === "approve" ? "Recovery link issued" : "Recovery updated",
        message: recoveryLink
          ? `A single-use recovery link was created and copied: ${recoveryLink}`
          : `Recovery status: ${data.data?.status || action}`,
        tone: "success",
      })
    } catch (error) {
      setNotice({
        open: true,
        title: "Unable to process recovery",
        message: error instanceof Error ? error.message : "Failed to process recovery",
        tone: "error",
      })
    } finally {
      setBusyInviteId("")
    }
  }

  async function handleViewRecoveryAudit(item) {
    try {
      const response = await fetch(buildAuthUrl(`/api/interview/${item.interviewId}/recovery`, searchParams), {
        credentials: "include",
        cache: "no-store",
      })
      const data = await response.json()
      if (!response.ok || !data.success) {
        throw new Error(data?.error?.message || data?.message || "Failed to load recovery audit")
      }
      const events = data.data?.events ?? []
      setNotice({
        open: true,
        title: "Interruption Timeline",
        message: events.length
          ? events.map((event) => `${formatDateTime(event.occurredAt)} - ${event.eventType}: ${event.reason || event.classifier || "Review event"}`).join("\n")
          : "No recovery events recorded yet.",
        tone: "success",
      })
    } catch (error) {
      setNotice({
        open: true,
        title: "Unable to load evidence logs",
        message: error instanceof Error ? error.message : "Failed to load evidence logs",
        tone: "error",
      })
    }
  }

  function handleEditOpen(item) {
    setEditItem(item)
    setEditForm({
      accessType: String(item.accessType ?? "FLEXIBLE").toUpperCase(),
      startTime: item.startTime ? toOrgDateTimeInputValue(item.startTime, timezone) : "",
      endTime: item.endTime ? toOrgDateTimeInputValue(item.endTime, timezone) : "",
    })
  }

  function handleDeleteOpen(item) {
    setDeleteItem(item)
    setDeleteReason("Candidate not available")
  }

  async function handleEditSave() {
    if (!editItem) {
      return
    }

    if (editForm.accessType === "SCHEDULED" && (!editForm.startTime || !editForm.endTime)) {
      setNotice({
        open: true,
        title: "Update Required",
        message: "Start time and end time are required for scheduled interviews.",
        tone: "error",
      })
      return
    }

    try {
      setSavingEdit(true)

      const response = await fetch(buildAuthUrl(`/api/interview/manage/${editItem.inviteId}`, searchParams), {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({
          accessType: editForm.accessType,
          startTime:
            editForm.accessType === "SCHEDULED"
              ? convertOrgTimeToUtc(editForm.startTime, timezone)
              : null,
          endTime:
            editForm.accessType === "SCHEDULED"
              ? convertOrgTimeToUtc(editForm.endTime, timezone)
              : null,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data?.error?.message || data?.message || "Failed to update interview invite")
      }

      setEditItem(null)
      await loadPendingInterviews({ limit: 5 })
    } catch (error) {
      setNotice({
        open: true,
        title: "Unable to update invite",
        message: error instanceof Error ? error.message : "Failed to update interview invite",
        tone: "error",
      })
    } finally {
      setSavingEdit(false)
    }
  }

  async function handleDeleteConfirm() {
    if (!deleteItem) {
      return
    }

    try {
      setBusyInviteId(deleteItem.inviteId)

      const response = await fetch(buildAuthUrl(`/api/interview/manage/${deleteItem.inviteId}`, searchParams), {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({ reason: deleteReason.trim() || null }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data?.error?.message || data?.message || "Failed to revoke interview invite")
      }

      setDeleteItem(null)
      setDeleteReason("Candidate not available")
      await loadPendingInterviews({ limit: 5 })
      setNotice({
        open: true,
        title: "Interview invite deleted",
        message: "The interview link was revoked successfully.",
        tone: "success",
      })
    } catch (error) {
      setNotice({
        open: true,
        title: "Unable to delete invite",
        message: error instanceof Error ? error.message : "Failed to revoke interview invite",
        tone: "error",
      })
    } finally {
      setBusyInviteId("")
    }
  }

  return (
    <>
      <div className="mt-10">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="hv-invited-section-heading flex flex-wrap items-center gap-2 text-xl font-semibold">
            Invited Interviews
            <span className="hv-recent-chip">
              Recent
            </span>
          </h2>

          {hasMoreInterviews ? (
            <button
              type="button"
              className="text-sm text-blue-400"
              onClick={handleOpenAllInterviews}
            >
              {isLoadingAll ? "Loading..." : "View More"}
            </button>
          ) : null}
        </div>

        <div className="hv-theme-panel hv-table-scroll hv-invited-table rounded-lg bg-[#111a2e]">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="border-b border-gray-700 text-gray-400">
              <tr>
                <th className="p-4 text-left">Candidate</th>
                <th className="p-4 text-left">Job</th>
                <th className="p-4 text-left">Status</th>
                <th className="p-4 text-left">Interview Type</th>
                <th className="p-4 text-left">Link Expiry</th>
                <th className="p-4 text-left">Action</th>
              </tr>
            </thead>

            {isLoading ? (
              <TableSkeleton rows={5} columns={6} showAvatar />
            ) : (
              <tbody>
                {previewInterviews.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-4">
                    <GuidedInterviewEmptyState compact profile={profile} />
                  </td>
                </tr>
              ) : (
                previewInterviews.map((item) => (
                  <tr key={item.inviteId} className="border-b border-gray-800">
                    <td className="p-4">{item.candidateName}</td>
                    <td className="p-4 text-gray-300">{item.jobTitle}</td>
                    <td className="p-4">
                      <span className={`inline-flex min-w-[96px] items-center justify-center whitespace-nowrap rounded-full border px-3 py-1 text-center text-xs font-medium leading-5 ${getWorkflowStatusClass(item)}`}>
                        {getWorkflowStatus(item)}
                      </span>
                      <RecoverySummary recovery={item.recovery} />
                    </td>
                    <td className="p-4 text-cyan-200">{getInterviewTypeLabel(item)}</td>
                    <td className="p-4 text-yellow-400">{getExpiryLabel(item.expiresAt, nowTick)}</td>
                    <td className="p-4">
                      <div className="flex flex-nowrap items-center gap-3 whitespace-nowrap text-xs sm:text-sm">
                        {canRetryInterview && String(item.status).toUpperCase() === "PREPARATION_FAILED" ? (
                          <button className="shrink-0 text-rose-300" disabled={busyInviteId === item.inviteId} onClick={() => handleRetryPreparation(item)}>
                            {busyInviteId === item.inviteId ? "Retrying..." : "Retry Prep"}
                          </button>
                        ) : null}
                        <button className="shrink-0 text-blue-400 disabled:text-slate-600" disabled={!item.link} onClick={() => handleCopy(item.link)}>
                          {copiedLink === item.link ? "Copied" : "Copy"}
                        </button>
                        {canRetryInterview && String(item.status).toUpperCase() === "EMAIL_FAILED" ? (
                          <button className="shrink-0 text-amber-300" disabled={busyInviteId === item.inviteId} onClick={() => handleRetryEmail(item)}>
                            {busyInviteId === item.inviteId ? "Sending..." : "Retry Email"}
                          </button>
                        ) : null}
                        {String(item.status).toUpperCase() === "INTERRUPTED" && (canRetryInterview || canViewWarRoom) ? (
                          <>
                            {canRetryInterview ? (
                            <button className="shrink-0 text-emerald-300 disabled:text-slate-600" disabled={busyInviteId === item.inviteId || !item.recovery?.available} onClick={() => handleRecoveryAction(item, "approve")}>
                              {busyInviteId === item.inviteId ? "Issuing..." : "Send Recovery Link"}
                            </button>
                            ) : null}
                            {canViewWarRoom ? (
                            <button className="shrink-0 text-fuchsia-300" onClick={() => handleViewRecoveryAudit(item)}>
                              Evidence Logs
                            </button>
                            ) : null}
                          </>
                        ) : null}
                        {canEditInterview ? (
                        <button className="shrink-0 text-indigo-300 disabled:text-slate-600" disabled={String(item.status).toUpperCase() === "PREPARATION_FAILED"} onClick={() => handleEditOpen(item)}>
                          Edit
                        </button>
                        ) : null}
                        {canDeleteInterview ? (
                        <button className="shrink-0 text-rose-300" onClick={() => handleDeleteOpen(item)}>
                          {busyInviteId === item.inviteId ? "Deleting..." : "Delete"}
                        </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))
              )}
              </tbody>
            )}
          </table>
        </div>
      </div>

      <PendingInterviewsModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        interviews={sortedInterviews}
        onCopy={handleCopy}
        onEdit={handleEditOpen}
        onDelete={handleDeleteOpen}
        onRetryPreparation={handleRetryPreparation}
        onRetryEmail={handleRetryEmail}
        onRecoveryAction={handleRecoveryAction}
        onViewRecoveryAudit={handleViewRecoveryAudit}
        nowTick={nowTick}
        copiedLink={copiedLink}
        busyInviteId={busyInviteId}
        profile={profile}
      />

      <EditInterviewModal
        isOpen={Boolean(editItem)}
        item={editItem}
        form={editForm}
        onChange={(patch) => setEditForm((current) => ({ ...current, ...patch }))}
        onClose={() => setEditItem(null)}
        onSave={handleEditSave}
        saving={savingEdit}
      />

      <DeleteInterviewModal
        isOpen={Boolean(deleteItem)}
        item={deleteItem}
        reason={deleteReason}
        onReasonChange={setDeleteReason}
        onClose={() => setDeleteItem(null)}
        onConfirm={handleDeleteConfirm}
        deleting={Boolean(deleteItem) && busyInviteId === deleteItem?.inviteId}
      />

      <NoticeModal
        open={notice.open}
        title={notice.title}
        message={notice.message}
        tone={notice.tone}
        onClose={() => setNotice((current) => ({ ...current, open: false }))}
      />
    </>
  )
}
