"use client"

import Link from "next/link"
import { useCallback, useEffect, useState } from "react"

import { showActionFeedback } from "@/lib/client/action-feedback"
import { buildAuthUrl } from "@/lib/client/auth-query"
import { useAuthSearchParams } from "@/lib/client/use-auth-search-params"

const TABS = [
  { key: "upcoming", label: "Upcoming" },
  { key: "in_progress", label: "In Progress" },
  { key: "completed", label: "Completed" },
]
const STATUS_LABELS = {
  SCHEDULED: "Scheduled",
  INVITATIONS_SENT: "Invitations sent",
  IN_PROGRESS: "In progress",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  EXPIRED: "Expired",
}

async function readJson(response) {
  const text = await response.text()
  const body = text ? JSON.parse(text) : {}
  if (!response.ok) {
    const error = new Error(body.message || body.error?.message || "Request failed")
    error.status = response.status
    throw error
  }
  return body.data ?? body
}

function formatWhen(iso) {
  if (!iso) return "-"
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
}

/**
 * VERIS Live Interview sessions (Upcoming / In Progress / Completed). Renders
 * nothing when the feature is off for this organization (the API 404s).
 */
export default function LiveInterviewsPanel() {
  const searchParams = useAuthSearchParams()
  const [enabled, setEnabled] = useState(null)
  const [tab, setTab] = useState("upcoming")
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState(null)
  const [detail, setDetail] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await readJson(
        await fetch(buildAuthUrl(`/api/live-interviews?bucket=${tab}`, searchParams), { credentials: "include" })
      )
      setEnabled(true)
      setRows(data.interviews || [])
    } catch (error) {
      if (error.status === 404 || error.status === 403) setEnabled(false)
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [tab, searchParams])

  useEffect(() => {
    load()
    const refresh = () => load()
    window.addEventListener("verisnova:live-interviews-changed", refresh)
    return () => window.removeEventListener("verisnova:live-interviews-changed", refresh)
  }, [load])

  const openDetail = async (interviewId) => {
    if (expanded === interviewId) {
      setExpanded(null)
      return
    }
    setExpanded(interviewId)
    setDetail(null)
    try {
      setDetail(
        await readJson(await fetch(buildAuthUrl(`/api/live-interviews/${interviewId}`, searchParams), { credentials: "include" }))
      )
    } catch {
      setDetail({ error: true })
    }
  }

  const act = async (path, init, successTitle) => {
    try {
      await readJson(
        await fetch(buildAuthUrl(path, searchParams), {
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          ...init,
        })
      )
      showActionFeedback({ title: successTitle })
      setExpanded(null)
      load()
    } catch (error) {
      showActionFeedback({ title: "Action failed", message: error.message, tone: "error" })
    }
  }

  if (enabled === false) return null

  return (
    <section className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm 2xl:mt-8">
      <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">VERIS Live Interviews</h2>
          <p className="mt-1 text-sm text-slate-500">Live video interviews with your interviewer or panel.</p>
        </div>
        <div role="tablist" className="flex gap-1 rounded-xl border border-slate-200 bg-slate-100 p-1">
          {TABS.map((item) => (
            <button
              key={item.key}
              role="tab"
              aria-selected={tab === item.key}
              onClick={() => setTab(item.key)}
              className={`rounded-lg px-3 py-1.5 text-sm ${tab === item.key ? "bg-cyan-50 text-cyan-700" : "text-slate-500 hover:text-slate-900"}`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="divide-y divide-slate-200">
        {loading && rows.length === 0 ? <p className="px-5 py-6 text-sm text-slate-500">Loading…</p> : null}
        {!loading && rows.length === 0 ? <p className="px-5 py-6 text-sm text-slate-500">No live interviews here yet.</p> : null}
        {rows.map((row) => (
          <div key={row.interviewId} className="px-5 py-4">
            <button type="button" onClick={() => openDetail(row.interviewId)} className="flex w-full flex-wrap items-center gap-x-6 gap-y-1 text-left">
              <span className="min-w-[180px] font-medium text-slate-900">{row.candidateName || "Candidate"}</span>
              <span className="text-sm text-slate-500">{row.jobTitle || "-"}</span>
              <span className="text-sm text-slate-500">{formatWhen(row.scheduledStartAt)}</span>
              <span className="text-sm text-slate-500">{row.durationMinutes ? `${row.durationMinutes} min` : ""}</span>
              <span className="text-sm text-slate-500">{row.interviewerCount} interviewer(s)</span>
              <span className="ml-auto rounded-full border border-slate-300 px-2.5 py-0.5 text-xs text-slate-700">
                {STATUS_LABELS[row.liveStatus] || row.liveStatus}
              </span>
            </button>

            {expanded === row.interviewId ? (
              <div className="mt-3 rounded-xl border border-slate-200 bg-slate-100 p-4 text-sm">
                {!detail ? <p className="text-slate-500">Loading…</p> : null}
                {detail?.error ? <p className="text-rose-700">Could not load details.</p> : null}
                {detail && !detail.error ? (
                  <>
                    <ul className="space-y-2">
                      {detail.participants.map((p) => (
                        <li key={p.participantId} className="flex flex-wrap items-center gap-3">
                          <span className="w-28 text-xs uppercase tracking-wide text-slate-500">
                            {p.role === "CANDIDATE" ? "Candidate" : (p.panelRole || "Interviewer").replace("_", " ").toLowerCase()}
                          </span>
                          <span className="text-slate-900">{p.displayName}</span>
                          <span className="text-slate-500">{p.email}</span>
                          <span className="text-xs text-slate-500">
                            {p.inviteStatus.toLowerCase()} · {p.joinStatus.replace("_", " ").toLowerCase()}
                          </span>
                          {["SCHEDULED", "INVITATIONS_SENT"].includes(detail.liveStatus) ? (
                            <span className="ml-auto flex gap-2">
                              <button
                                type="button"
                                className="rounded-lg border border-slate-300 px-2 py-1 text-xs text-slate-800"
                                onClick={() =>
                                  act(`/api/live-interviews/${row.interviewId}/invitations`, {
                                    method: "POST",
                                    body: JSON.stringify({ participantIds: [p.participantId] }),
                                  }, "Invitation resent")
                                }
                              >
                                Resend
                              </button>
                              {p.inviteStatus !== "REVOKED" ? (
                                <button
                                  type="button"
                                  className="rounded-lg border border-rose-300 px-2 py-1 text-xs text-rose-700"
                                  onClick={() =>
                                    act(`/api/live-interviews/${row.interviewId}/invitations`, {
                                      method: "DELETE",
                                      body: JSON.stringify({ participantId: p.participantId }),
                                    }, "Link revoked")
                                  }
                                >
                                  Revoke link
                                </button>
                              ) : null}
                            </span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                    {["IN_PROGRESS", "COMPLETED"].includes(detail.liveStatus) ? (
                      <div className="mt-4 flex justify-end">
                        <Link
                          href={buildAuthUrl(`/live-interviews/${row.interviewId}`, searchParams)}
                          className="rounded-lg border border-cyan-300 px-3 py-1.5 text-xs text-cyan-700"
                        >
                          View report
                        </Link>
                      </div>
                    ) : null}
                    {["SCHEDULED", "INVITATIONS_SENT"].includes(detail.liveStatus) ? (
                      <div className="mt-4 flex justify-end">
                        <button
                          type="button"
                          className="rounded-lg border border-rose-300 px-3 py-1.5 text-xs text-rose-700"
                          onClick={() => {
                            if (window.confirm("Cancel this live interview? All invitation links will stop working.")) {
                              act(`/api/live-interviews/${row.interviewId}/cancel`, { method: "POST" }, "Interview cancelled")
                            }
                          }}
                        >
                          Cancel interview
                        </button>
                      </div>
                    ) : null}
                  </>
                ) : null}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  )
}
