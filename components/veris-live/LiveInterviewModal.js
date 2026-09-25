"use client"

import { useEffect, useRef, useState } from "react"

import { showActionFeedback } from "@/lib/client/action-feedback"
import { buildAuthUrl } from "@/lib/client/auth-query"
import { useAuthSearchParams } from "@/lib/client/use-auth-search-params"

// Colors use the dashboard's dark-scale classes; its light theme remaps them.
// Anything that must keep white text on a colored fill carries hv-solid-action.
const PANEL_ROLE_LABELS = { HIRING_MANAGER: "Hiring manager", INTERVIEWER: "Interviewer", PANEL_MEMBER: "Panel member" }
const FIELD =
  "mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-900 px-3.5 py-2.5 text-sm text-white shadow-sm transition focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-400/20"
const SMALL_FIELD =
  "rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-2 text-sm text-white transition focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-400/20"
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const DURATION_PRESETS = [30, 45, 60, 90]

let nextRowId = 1
const newEmailRow = () => ({ id: nextRowId++, email: "", name: "", panelRole: "INTERVIEWER" })

function defaultStart() {
  const date = new Date(Date.now() + 24 * 60 * 60 * 1000)
  date.setMinutes(0, 0, 0)
  const pad = (n) => String(n).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:00`
}

async function readJson(response) {
  const text = await response.text()
  const body = text ? JSON.parse(text) : {}
  if (!response.ok) throw new Error(body.message || body.error?.message || "Request failed")
  return body.data ?? body
}

function initials(value) {
  const parts = String(value || "?").replace(/@.*/, "").split(/[\s._+-]+/).filter(Boolean)
  return ((parts[0]?.[0] ?? "?") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase()
}

// --- small presentational pieces --------------------------------------------

const svg = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round", viewBox: "0 0 24 24", "aria-hidden": true }
const Icons = {
  video: <svg {...svg} className="h-5 w-5"><rect x="3" y="6" width="12" height="12" rx="2.5" /><path d="M15 10.5 21 7v10l-6-3.5" /></svg>,
  user: <svg {...svg} className="h-4 w-4"><circle cx="12" cy="8" r="3.5" /><path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5" /></svg>,
  calendar: <svg {...svg} className="h-4 w-4"><rect x="3.5" y="5" width="17" height="15" rx="2" /><path d="M8 3v4M16 3v4M3.5 10h17" /></svg>,
  users: <svg {...svg} className="h-4 w-4"><circle cx="9" cy="8" r="3.2" /><path d="M3 20c.5-3.4 3-5.5 6-5.5s5.5 2.1 6 5.5M16 5.2a3 3 0 0 1 0 5.6M18 14.8c1.7.7 2.8 2.5 3 5.2" /></svg>,
  upload: <svg {...svg} className="h-4 w-4"><path d="M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" /></svg>,
  file: <svg {...svg} className="h-4 w-4"><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v4h4" /></svg>,
  check: <svg {...svg} className="h-3.5 w-3.5" strokeWidth={2.4}><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>,
  mail: <svg {...svg} className="h-4 w-4"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3.5 6 8.5 7 8.5-7" /></svg>,
  shield: <svg {...svg} className="h-4 w-4"><path d="M12 3 4.5 6v5.5c0 4.5 3.2 8.2 7.5 9.5 4.3-1.3 7.5-5 7.5-9.5V6z" /></svg>,
  clock: <svg {...svg} className="h-4 w-4"><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></svg>,
  plus: <svg {...svg} className="h-4 w-4" strokeWidth={2.2}><path d="M12 5v14M5 12h14" /></svg>,
  arrow: <svg {...svg} className="h-4 w-4" strokeWidth={2.2}><path d="M5 12h14M13 6l6 6-6 6" /></svg>,
}

function Step({ number, title, hint, icon, children }) {
  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4 shadow-sm sm:p-5">
      <div className="mb-3 flex items-start gap-3">
        <span className="hv-solid-action flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-cyan-500 to-blue-600 text-sm font-semibold text-white shadow-sm">
          {number}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
            <span className="text-cyan-300">{icon}</span>
            {title}
          </h3>
          {hint ? <p className="mt-0.5 text-xs text-slate-400">{hint}</p> : null}
        </div>
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  )
}

function RoleSelect({ value, onChange, label }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} className={SMALL_FIELD}>
      {Object.entries(PANEL_ROLE_LABELS).map(([role, text]) => (
        <option key={role} value={role}>
          {text}
        </option>
      ))}
    </select>
  )
}

function Avatar({ label, tone = "cyan" }) {
  const tones = {
    cyan: "from-cyan-500 to-blue-600",
    slate: "from-slate-500 to-slate-600",
  }
  return (
    <span
      className={`hv-solid-action flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br ${tones[tone]} text-[11px] font-semibold text-white ring-2 ring-slate-900`}
      aria-hidden="true"
    >
      {initials(label)}
    </span>
  )
}

function SummaryRow({ icon, label, value, muted }) {
  return (
    <div className="flex items-start gap-3 py-2">
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-cyan-400/10 text-cyan-300">{icon}</span>
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">{label}</p>
        <p className={`truncate text-sm ${muted ? "text-slate-500" : "font-medium text-white"}`}>{value}</p>
      </div>
    </div>
  )
}

// --- modal ----------------------------------------------------------------

export default function LiveInterviewModal({ onClose, onBack }) {
  const searchParams = useAuthSearchParams()
  const fileInputRef = useRef(null)
  const [jobs, setJobs] = useState([])
  const [team, setTeam] = useState([])
  const [jobId, setJobId] = useState("")
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [resumeFile, setResumeFile] = useState(null)
  const [start, setStart] = useState(defaultStart)
  const [duration, setDuration] = useState(45)
  const [emailRows, setEmailRows] = useState(() => [newEmailRow()])
  const [teamPanel, setTeamPanel] = useState([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")
  const [done, setDone] = useState(null)
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone

  useEffect(() => {
    fetch(buildAuthUrl("/api/jobs?view=selector", searchParams), { credentials: "include" })
      .then(readJson)
      .then((data) => setJobs((data.jobs || []).filter((job) => (job.isActive ?? job.is_active ?? true) !== false)))
      .catch(() => setJobs([]))
    fetch(buildAuthUrl("/api/live-interviews/interviewers", searchParams), { credentials: "include" })
      .then(readJson)
      .then((data) => setTeam(data.interviewers || []))
      .catch(() => setTeam([]))
  }, [searchParams])

  const updateEmailRow = (id, patch) => setEmailRows((rows) => rows.map((row) => (row.id === id ? { ...row, ...patch } : row)))
  const removeEmailRow = (id) => setEmailRows((rows) => (rows.length === 1 ? [newEmailRow()] : rows.filter((row) => row.id !== id)))

  const toggleTeamMember = (userId) => {
    setTeamPanel((current) =>
      current.some((entry) => entry.userId === userId)
        ? current.filter((entry) => entry.userId !== userId)
        : [...current, { userId, panelRole: "INTERVIEWER" }]
    )
  }

  const buildPanel = () => {
    const filled = emailRows.filter((row) => row.email.trim())
    const invalid = filled.find((row) => !EMAIL_PATTERN.test(row.email.trim()))
    if (invalid) return { error: `"${invalid.email}" is not a valid email address.` }
    const entries = [
      ...filled.map((row) => ({ email: row.email.trim().toLowerCase(), name: row.name.trim() || undefined, panelRole: row.panelRole })),
      ...teamPanel,
    ]
    if (entries.length === 0) return { error: "Add at least one panel member by email or from your team." }

    // The same person can't be added twice (typed email + ticked team member).
    const emails = new Set()
    for (const entry of entries) {
      const key = entry.email || team.find((m) => m.userId === entry.userId)?.email?.toLowerCase()
      if (key && emails.has(key)) return { error: `${key} is on the panel twice.` }
      if (key) emails.add(key)
    }
    if (emails.has(email.trim().toLowerCase())) return { error: "The candidate cannot also be on the interview panel." }
    return { entries }
  }

  const submit = async (event) => {
    event.preventDefault()
    setError("")
    if (!jobId || !name.trim() || !email.trim() || !resumeFile) {
      setError("Job, candidate name, email and resume are required.")
      return
    }
    const panel = buildPanel()
    if (panel.error) {
      setError(panel.error)
      return
    }

    setSubmitting(true)
    try {
      const form = new FormData()
      form.append("fullName", name.trim())
      form.append("email", email.trim())
      form.append("jobId", jobId)
      form.append("resume", resumeFile)
      form.append("includeResumeText", "false")
      const candidate = await readJson(
        await fetch(buildAuthUrl("/api/candidate", searchParams), { method: "POST", credentials: "include", body: form })
      )
      const candidateId = candidate.candidateId || candidate.candidate_id
      if (!candidateId) throw new Error("Candidate ID was not returned by the API")

      const result = await readJson(
        await fetch(buildAuthUrl("/api/live-interviews", searchParams), {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jobId,
            candidateId,
            scheduledStartAt: new Date(start).toISOString(),
            scheduledTimezone: timezone,
            durationMinutes: Number(duration),
            interviewers: panel.entries,
            sendInvitations: true,
          }),
        })
      )
      setDone(result)
      window.dispatchEvent(new CustomEvent("verisnova:live-interviews-changed"))
      showActionFeedback({ title: "VERIS Live Interview scheduled" })
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not schedule the interview.")
    } finally {
      setSubmitting(false)
    }
  }

  // Live summary (display only).
  const job = jobs.find((j) => (j.jobId || j.job_id || j.id) === jobId)
  const jobTitle = job ? job.jobTitle || job.job_title || job.title : null
  const startDate = start ? new Date(start) : null
  const whenLabel = startDate && !Number.isNaN(startDate.getTime())
    ? startDate.toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
    : null
  const panelPeople = [
    ...emailRows.filter((row) => row.email.trim()).map((row) => ({ key: `e${row.id}`, label: row.name.trim() || row.email.trim() })),
    ...teamPanel.map((entry) => {
      const member = team.find((m) => m.userId === entry.userId)
      return { key: `t${entry.userId}`, label: member?.name || member?.email || "Team member" }
    }),
  ]

  return (
    <div
      className="hv-theme-dialog-backdrop fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/80 px-4 py-4 backdrop-blur-md sm:py-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="live-interview-title"
    >
      {/* The dashboard caps dialogs at the viewport height, so the card scrolls internally. */}
      <div className="relative flex max-h-[calc(100dvh-2rem)] w-full max-w-5xl flex-col overflow-hidden rounded-[28px] border border-slate-800 bg-slate-900 text-white shadow-[0_24px_80px_rgba(15,23,42,0.35)]">
        {/* Header */}
        <div className="relative shrink-0 overflow-hidden border-b border-slate-800 px-5 py-5 sm:px-7">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_120%_at_0%_0%,rgba(34,211,238,0.14),transparent_60%),radial-gradient(50%_120%_at_100%_0%,rgba(37,99,235,0.12),transparent_60%)]"
          />
          <div className="relative flex items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              <span className="hv-solid-action flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-500 to-blue-600 text-white shadow-lg shadow-cyan-500/20">
                {Icons.video}
              </span>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-300">VERIS Live Interview</p>
                <h2 id="live-interview-title" className="mt-1 text-2xl font-semibold tracking-tight">
                  Schedule a live interview
                </h2>
                <p className="mt-1 text-sm text-slate-400">Human-led video interview with your interviewer or panel, with an AI Copilot for interviewers.</p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-slate-700 bg-slate-900 px-3.5 py-1.5 text-sm text-slate-300 transition hover:text-white"
            >
              Close
            </button>
          </div>
        </div>

        {done ? (
          <div className="overflow-y-auto px-5 py-10 text-center sm:px-7">
            <span className="hv-solid-action mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500 text-white shadow-lg">
              <svg {...svg} className="h-7 w-7" strokeWidth={2.4}>
                <path d="m5 12.5 4.5 4.5L19 7.5" />
              </svg>
            </span>
            <p className="mt-4 text-xl font-semibold">Interview scheduled</p>
            <p className="mx-auto mt-2 max-w-md text-sm text-slate-300">
              {done.invitations
                ? `${done.invitations.sent} invitation(s) sent${
                    done.invitations.failed ? `, ${done.invitations.failed} failed. Resend them from the Interviews page.` : ". Everyone has their own secure link."
                  }`
                : "Invitations were not sent yet."}
            </p>
            <button type="button" onClick={onClose} className="hv-solid-action mt-6 rounded-xl bg-[#2563eb] px-6 py-2.5 text-sm font-semibold text-white">
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
            <div className="grid min-h-0 flex-1 overflow-y-auto lg:grid-cols-[minmax(0,1fr)_300px]">
              {/* Steps */}
              <div className="space-y-4 p-5 sm:p-6">
                <Step number={1} title="Role & candidate" hint="Who is interviewing, and for which role." icon={Icons.user}>
                  <label className="block text-sm">
                    <span className="text-slate-300">Job</span>
                    <select value={jobId} onChange={(e) => setJobId(e.target.value)} className={FIELD}>
                      <option value="">Select a job</option>
                      {jobs.map((j) => {
                        const id = j.jobId || j.job_id || j.id
                        return (
                          <option key={id} value={id}>
                            {j.jobTitle || j.job_title || j.title}
                          </option>
                        )
                      })}
                    </select>
                  </label>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block text-sm">
                      <span className="text-slate-300">Candidate name</span>
                      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" className={FIELD} />
                    </label>
                    <label className="block text-sm">
                      <span className="text-slate-300">Candidate email</span>
                      <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="candidate@email.com" className={FIELD} />
                    </label>
                  </div>
                  <div className="text-sm">
                    <span className="text-slate-300">Resume</span>
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className={`mt-1.5 flex w-full items-center gap-3 rounded-xl border border-dashed px-4 py-3 text-left transition ${
                        resumeFile ? "border-cyan-400/40 bg-cyan-400/10" : "border-slate-700 bg-slate-950/40 hover:border-cyan-400/40"
                      }`}
                    >
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-cyan-400/10 text-cyan-300">
                        {resumeFile ? Icons.file : Icons.upload}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-white">{resumeFile ? resumeFile.name : "Upload resume"}</span>
                        <span className="block text-xs text-slate-400">{resumeFile ? "Click to change" : "PDF or DOCX"}</span>
                      </span>
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".pdf,.docx"
                      className="hidden"
                      onChange={(e) => setResumeFile(e.target.files?.[0] ?? null)}
                    />
                  </div>
                </Step>

                <Step number={2} title="Schedule" hint={`Times are in ${timezone}.`} icon={Icons.calendar}>
                  <label className="block text-sm">
                    <span className="text-slate-300">Start</span>
                    <input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} className={FIELD} />
                  </label>
                  <div className="text-sm">
                    <span className="text-slate-300">Duration</span>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      {DURATION_PRESETS.map((minutes) => {
                        const active = Number(duration) === minutes
                        return (
                          <button
                            key={minutes}
                            type="button"
                            onClick={() => setDuration(minutes)}
                            aria-pressed={active}
                            className={`rounded-full border px-3.5 py-1.5 text-sm font-medium transition ${
                              active ? "border-cyan-400/40 bg-cyan-400/10 text-cyan-200" : "border-slate-700 text-slate-300 hover:border-slate-500"
                            }`}
                          >
                            {minutes} min
                          </button>
                        )
                      })}
                      <label className="flex items-center gap-2 text-xs text-slate-400">
                        Custom
                        <input
                          type="number"
                          min={10}
                          max={240}
                          value={duration}
                          onChange={(e) => setDuration(e.target.value)}
                          aria-label="Duration in minutes"
                          className={`${SMALL_FIELD} w-20`}
                        />
                      </label>
                    </div>
                  </div>
                </Step>

                <Step number={3} title="Interview panel" hint="Add anyone by email. They don't need to be on your team." icon={Icons.users}>
                  <div className="space-y-2">
                    {emailRows.map((row, index) => (
                      <div key={row.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/40 p-2">
                        <Avatar label={row.name.trim() || row.email.trim() || "?"} tone={row.email.trim() ? "cyan" : "slate"} />
                        <input
                          type="email"
                          value={row.email}
                          onChange={(e) => updateEmailRow(row.id, { email: e.target.value })}
                          placeholder="panelist@company.com"
                          aria-label={`Panel member ${index + 1} email`}
                          className={`${SMALL_FIELD} min-w-[180px] flex-[2]`}
                        />
                        <input
                          value={row.name}
                          onChange={(e) => updateEmailRow(row.id, { name: e.target.value })}
                          placeholder="Name (optional)"
                          aria-label={`Panel member ${index + 1} name`}
                          className={`${SMALL_FIELD} min-w-[120px] flex-1`}
                        />
                        <RoleSelect value={row.panelRole} onChange={(panelRole) => updateEmailRow(row.id, { panelRole })} label={`Panel member ${index + 1} role`} />
                        <button
                          type="button"
                          onClick={() => removeEmailRow(row.id)}
                          aria-label={`Remove panel member ${index + 1}`}
                          className="rounded-lg border border-slate-700 px-2.5 py-1.5 text-slate-400 hover:text-white"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => setEmailRows((rows) => [...rows, newEmailRow()])}
                    className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-cyan-400/40 px-3.5 py-1.5 text-sm font-medium text-cyan-200 transition hover:bg-cyan-400/10"
                  >
                    {Icons.plus} Add panel member
                  </button>

                  {team.length ? (
                    <div className="border-t border-slate-800 pt-3">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Or add from your team</p>
                      <div className="mt-2 grid max-h-48 gap-2 overflow-y-auto sm:grid-cols-2">
                        {team.map((member) => {
                          const entry = teamPanel.find((p) => p.userId === member.userId)
                          return (
                            <div
                              key={member.userId}
                              className={`flex items-center gap-2.5 rounded-xl border px-3 py-2 transition ${
                                entry ? "border-cyan-400/40 bg-cyan-400/10" : "border-slate-800 bg-slate-950/40"
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={Boolean(entry)}
                                onChange={() => toggleTeamMember(member.userId)}
                                className="h-4 w-4 accent-cyan-400"
                                aria-label={`Add ${member.name || member.email}`}
                              />
                              <Avatar label={member.name || member.email} tone={entry ? "cyan" : "slate"} />
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm text-white">{member.name || member.email}</span>
                                <span className="block truncate text-xs text-slate-400">{member.email}</span>
                              </span>
                              {entry ? (
                                <RoleSelect
                                  value={entry.panelRole}
                                  onChange={(panelRole) => setTeamPanel((cur) => cur.map((p) => (p.userId === member.userId ? { ...p, panelRole } : p)))}
                                  label={`Role for ${member.name || member.email}`}
                                />
                              ) : null}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  ) : null}
                </Step>
              </div>

              {/* Live summary */}
              <aside className="border-t border-slate-800 bg-slate-950/40 p-5 sm:p-6 lg:border-l lg:border-t-0">
                <div className="lg:sticky lg:top-0">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Interview summary</p>
                  <div className="mt-2 divide-y divide-slate-800">
                    <SummaryRow icon={Icons.user} label="Candidate" value={name.trim() || "Not added yet"} muted={!name.trim()} />
                    <SummaryRow icon={Icons.file} label="Role" value={jobTitle || "Select a job"} muted={!jobTitle} />
                    <SummaryRow icon={Icons.calendar} label="When" value={whenLabel || "Pick a time"} muted={!whenLabel} />
                    <SummaryRow icon={Icons.clock} label="Duration" value={`${Number(duration) || 0} minutes`} />
                    <div className="py-2">
                      <div className="flex items-start gap-3">
                        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-cyan-400/10 text-cyan-300">{Icons.users}</span>
                        <div className="min-w-0">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">Panel</p>
                          {panelPeople.length ? (
                            <div className="mt-1.5 flex items-center">
                              <div className="flex -space-x-2">
                                {panelPeople.slice(0, 5).map((person) => (
                                  <Avatar key={person.key} label={person.label} />
                                ))}
                              </div>
                              <span className="ml-2 text-sm font-medium text-white">
                                {panelPeople.length} interviewer{panelPeople.length > 1 ? "s" : ""}
                              </span>
                            </div>
                          ) : (
                            <p className="text-sm text-slate-500">No one added yet</p>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-900/80 p-4">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">What happens next</p>
                    <ul className="mt-2 space-y-2 text-xs text-slate-300">
                      <li className="flex gap-2">
                        <span className="text-cyan-300">{Icons.mail}</span>
                        Candidate and each interviewer get their own secure, expiring link.
                      </li>
                      <li className="flex gap-2">
                        <span className="text-cyan-300">{Icons.shield}</span>
                        Recording only starts after participants consent.
                      </li>
                      <li className="flex gap-2">
                        <span className="text-cyan-300">{Icons.check}</span>
                        Interviewers get the questionnaire, private notes, scorecards and Copilot.
                      </li>
                    </ul>
                  </div>
                </div>
              </aside>
            </div>

            {/* Footer */}
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-slate-800 bg-slate-900 px-5 py-4 sm:px-7">
              <div className="min-w-0 flex-1">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-cyan-400/40 bg-cyan-400/10 px-2.5 py-1 text-xs font-medium text-cyan-200">
                  Uses 1 interview credit
                </span>
                {error ? (
                  <p role="alert" className="mt-2 text-sm text-rose-300">
                    {error}
                  </p>
                ) : null}
              </div>
              <div className="flex items-center gap-3">
                <button type="button" onClick={onBack} className="rounded-xl border border-slate-700 px-4 py-2.5 text-sm text-slate-200 transition hover:border-slate-500">
                  Back
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="hv-solid-action inline-flex items-center gap-2 rounded-xl bg-[#2563eb] px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-blue-600/20 transition hover:bg-[#1d4ed8] disabled:opacity-60"
                >
                  {submitting ? "Scheduling…" : "Schedule & send invitations"}
                  {!submitting ? Icons.arrow : null}
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
