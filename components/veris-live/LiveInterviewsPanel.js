"use client"

import Link from "next/link"
import { useCallback, useEffect, useState } from "react"

import { showActionFeedback } from "@/lib/client/action-feedback"
import { buildAuthUrl } from "@/lib/client/auth-query"
import { useAuthSearchParams } from "@/lib/client/use-auth-search-params"

// Colors use the dashboard's dark-scale classes; its light theme remaps them.
// White text on colored fills carries hv-solid-action.

const TABS = [
  { key: "upcoming", label: "Upcoming" },
  { key: "in_progress", label: "In Progress" },
  { key: "completed", label: "Completed" },
]
const STATUS = {
  SCHEDULED: { label: "Scheduled", tone: "border-slate-700 bg-slate-800/60 text-slate-300" },
  INVITATIONS_SENT: { label: "Invitations sent", tone: "border-cyan-400/40 bg-cyan-400/10 text-cyan-200" },
  IN_PROGRESS: { label: "In progress", tone: "border-emerald-400/40 bg-emerald-500/10 text-emerald-300", live: true },
  COMPLETED: { label: "Completed", tone: "border-slate-700 bg-slate-800/60 text-slate-300" },
  CANCELLED: { label: "Cancelled", tone: "border-rose-400/40 bg-rose-500/10 text-rose-300" },
  EXPIRED: { label: "Expired", tone: "border-amber-400/40 bg-amber-500/10 text-amber-300" },
}
const INVITE_TONE = {
  SENT: "bg-cyan-400/10 text-cyan-200",
  PENDING: "bg-slate-800/60 text-slate-300",
  FAILED: "bg-rose-500/10 text-rose-300",
  REVOKED: "bg-rose-500/10 text-rose-300",
}
const JOIN_TONE = {
  JOINED: "bg-emerald-500/10 text-emerald-300",
  LEFT: "bg-slate-800/60 text-slate-300",
  NOT_JOINED: "bg-slate-800/60 text-slate-400",
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

function label(value) {
  return String(value || "").replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase())
}

function initials(value) {
  const parts = String(value || "?").split(/\s+/).filter(Boolean)
  return ((parts[0]?.[0] ?? "?") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase()
}

function DateBlock({ iso }) {
  if (!iso) return <div className="h-14 w-14 shrink-0 rounded-2xl border border-slate-800 bg-slate-800/60" />
  const date = new Date(iso)
  return (
    <div className="flex w-14 shrink-0 flex-col items-center justify-center overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 text-center shadow-sm">
      <span className="hv-solid-action w-full bg-gradient-to-r from-cyan-500 to-blue-600 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
        {date.toLocaleString(undefined, { month: "short" })}
      </span>
      <span className="pt-0.5 text-lg font-semibold leading-6 text-white">{date.getDate()}</span>
      <span className="pb-1 text-[10px] font-medium text-slate-400">{date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</span>
    </div>
  )
}

function Avatar({ name, candidate }) {
  return (
    <span
      aria-hidden="true"
      className={`hv-solid-action flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br text-[11px] font-semibold text-white ${
        candidate ? "from-cyan-500 to-blue-600" : "from-slate-500 to-slate-600"
      }`}
    >
      {initials(name)}
    </span>
  )
}

const Chevron = ({ open }) => (
  <svg aria-hidden="true" viewBox="0 0 24 24" className={`h-4 w-4 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m6 9 6 6 6-6" />
  </svg>
)

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
    <section className="mt-6 overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/80 shadow-sm 2xl:mt-8">
      <div className="relative flex flex-col gap-4 overflow-hidden border-b border-slate-800 px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(50%_120%_at_0%_0%,rgba(34,211,238,0.10),transparent_60%)]" />
        <div className="relative flex items-center gap-3">
          <span className="hv-solid-action flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-500 to-blue-600 text-white shadow-lg shadow-cyan-500/20">
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="6" width="12" height="12" rx="2.5" />
              <path d="M15 10.5 21 7v10l-6-3.5" />
            </svg>
          </span>
          <div>
            <h2 className="text-lg font-semibold text-white">VERIS Live Interviews</h2>
            <p className="text-sm text-slate-400">Human-led video interviews with your interviewer or panel.</p>
          </div>
        </div>
        <div role="tablist" aria-label="Live interview status" className="relative flex gap-1 rounded-xl border border-slate-800 bg-slate-800/60 p-1">
          {TABS.map((item) => (
            <button
              key={item.key}
              role="tab"
              aria-selected={tab === item.key}
              onClick={() => setTab(item.key)}
              className={`rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors ${
                tab === item.key ? "bg-slate-900 text-cyan-300 shadow-sm" : "text-slate-400 hover:text-white"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2.5 p-4 sm:p-5">
        {loading && rows.length === 0
          ? [0, 1].map((i) => (
              <div key={i} className="flex animate-pulse items-center gap-4 rounded-2xl border border-slate-800 p-4">
                <div className="h-14 w-14 rounded-2xl bg-slate-800/60" />
                <div className="flex-1 space-y-2">
                  <div className="h-3.5 w-1/3 rounded bg-slate-800/60" />
                  <div className="h-3 w-1/2 rounded bg-slate-800/60" />
                </div>
              </div>
            ))
          : null}

        {!loading && rows.length === 0 ? (
          <div className="flex flex-col items-center rounded-2xl border border-dashed border-slate-700 px-6 py-10 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-cyan-400/10 text-cyan-300">
              <svg aria-hidden="true" viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3.5" y="5" width="17" height="15" rx="2" />
                <path d="M8 3v4M16 3v4M3.5 10h17" />
              </svg>
            </span>
            <p className="mt-3 text-sm font-semibold text-white">
              {tab === "upcoming" ? "No upcoming live interviews" : tab === "in_progress" ? "Nothing live right now" : "No completed live interviews yet"}
            </p>
            <p className="mt-1 max-w-sm text-xs text-slate-400">
              Use Send Interview Link and choose VERIS Live Interview to schedule one with your interviewer or panel.
            </p>
          </div>
        ) : null}

        {rows.map((row) => {
          const status = STATUS[row.liveStatus] ?? { label: row.liveStatus, tone: "border-slate-700 text-slate-300" }
          const open = expanded === row.interviewId
          return (
            <div
              key={row.interviewId}
              className={`overflow-hidden rounded-2xl border transition-colors ${open ? "border-cyan-400/40 bg-slate-900" : "border-slate-800 bg-slate-900/60 hover:border-slate-700"}`}
            >
              <button
                type="button"
                onClick={() => openDetail(row.interviewId)}
                aria-expanded={open}
                className="flex w-full items-center gap-4 p-3.5 text-left sm:p-4"
              >
                <DateBlock iso={row.scheduledStartAt} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-[15px] font-semibold text-white">{row.candidateName || "Candidate"}</span>
                    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${status.tone}`}>
                      {status.live ? <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" aria-hidden="true" /> : null}
                      {status.label}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-sm text-slate-400">{row.jobTitle || "—"}</p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5 text-[11px] text-slate-400">
                    {row.durationMinutes ? <span className="rounded-md bg-slate-800/60 px-1.5 py-0.5">{row.durationMinutes} min</span> : null}
                    <span className="rounded-md bg-slate-800/60 px-1.5 py-0.5">
                      {row.interviewerCount} interviewer{row.interviewerCount === 1 ? "" : "s"}
                    </span>
                    {row.questionCount ? <span className="rounded-md bg-slate-800/60 px-1.5 py-0.5">{row.questionCount} questions</span> : null}
                  </div>
                </div>
                <Chevron open={open} />
              </button>

              {open ? (
                <div className="border-t border-slate-800 bg-slate-950/40 p-4 text-sm">
                  {!detail ? <p className="text-slate-400">Loading…</p> : null}
                  {detail?.error ? <p className="text-rose-300">Could not load details.</p> : null}
                  {detail && !detail.error ? (
                    <>
                      <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Participants</p>
                      <ul className="space-y-2">
                        {detail.participants.map((p) => {
                          const isCandidate = p.role === "CANDIDATE"
                          return (
                            <li key={p.participantId} className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-800 bg-slate-900 px-3 py-2.5">
                              <Avatar name={p.displayName} candidate={isCandidate} />
                              <div className="min-w-0 flex-1">
                                <p className="flex flex-wrap items-center gap-2">
                                  <span className="font-medium text-white">{p.displayName}</span>
                                  <span className={`rounded-full px-1.5 py-px text-[10px] font-semibold ${isCandidate ? "bg-cyan-400/10 text-cyan-200" : "bg-slate-800/60 text-slate-300"}`}>
                                    {isCandidate ? "Candidate" : label(p.panelRole || "Interviewer")}
                                  </span>
                                </p>
                                <p className="truncate text-xs text-slate-400">{p.email}</p>
                              </div>
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${INVITE_TONE[p.inviteStatus] ?? INVITE_TONE.PENDING}`}>
                                  Invite {label(p.inviteStatus)}
                                </span>
                                <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${JOIN_TONE[p.joinStatus] ?? JOIN_TONE.NOT_JOINED}`}>{label(p.joinStatus)}</span>
                              </div>
                              {["SCHEDULED", "INVITATIONS_SENT", "IN_PROGRESS"].includes(detail.liveStatus) ? (
                                <span className="flex gap-2">
                                  {detail.liveStatus !== "IN_PROGRESS" ? (
                                    <button
                                      type="button"
                                      className="rounded-lg border border-slate-700 px-2.5 py-1 text-xs font-medium text-slate-200 transition hover:border-cyan-400/40"
                                      onClick={() =>
                                        act(
                                          `/api/live-interviews/${row.interviewId}/invitations`,
                                          { method: "POST", body: JSON.stringify({ participantIds: [p.participantId] }) },
                                          "Invitation resent"
                                        )
                                      }
                                    >
                                      Resend
                                    </button>
                                  ) : null}
                                  {p.inviteStatus !== "REVOKED" ? (
                                    <button
                                      type="button"
                                      className="rounded-lg border border-rose-400/40 px-2.5 py-1 text-xs font-medium text-rose-300 transition hover:bg-rose-500/10"
                                      onClick={() => {
                                        if (detail.liveStatus === "IN_PROGRESS" && !window.confirm(`Remove ${p.displayName} from the live interview now?`)) return
                                        act(
                                          `/api/live-interviews/${row.interviewId}/invitations`,
                                          { method: "DELETE", body: JSON.stringify({ participantId: p.participantId }) },
                                          detail.liveStatus === "IN_PROGRESS" ? "Removed from the interview" : "Link revoked"
                                        )
                                      }}
                                    >
                                      {detail.liveStatus === "IN_PROGRESS" ? "Remove" : "Revoke link"}
                                    </button>
                                  ) : null}
                                </span>
                              ) : null}
                            </li>
                          )
                        })}
                      </ul>
                      <div className="mt-4 flex flex-wrap justify-end gap-2">
                        {["SCHEDULED", "INVITATIONS_SENT"].includes(detail.liveStatus) ? (
                          <button
                            type="button"
                            className="rounded-xl border border-rose-400/40 px-3.5 py-2 text-xs font-semibold text-rose-300 transition hover:bg-rose-500/10"
                            onClick={() => {
                              if (window.confirm("Cancel this live interview? All invitation links will stop working.")) {
                                act(`/api/live-interviews/${row.interviewId}/cancel`, { method: "POST" }, "Interview cancelled")
                              }
                            }}
                          >
                            Cancel interview
                          </button>
                        ) : null}
                        {["IN_PROGRESS", "COMPLETED"].includes(detail.liveStatus) ? (
                          <Link
                            href={buildAuthUrl(`/live-interviews/${row.interviewId}`, searchParams)}
                            className="hv-solid-action inline-flex items-center gap-1.5 rounded-xl bg-[#2563eb] px-3.5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-[#1d4ed8]"
                          >
                            View report
                            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M5 12h14M13 6l6 6-6 6" />
                            </svg>
                          </Link>
                        ) : null}
                      </div>
                    </>
                  ) : null}
                </div>
              ) : null}
            </div>
          )
        })}
      </div>
    </section>
  )
}
