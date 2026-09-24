"use client"

import { useEffect, useRef, useState } from "react"

import { showActionFeedback } from "@/lib/client/action-feedback"
import { buildAuthUrl } from "@/lib/client/auth-query"
import { useAuthSearchParams } from "@/lib/client/use-auth-search-params"

// Colors use the dashboard's dark-scale classes; its light theme remaps them.
const PANEL_ROLE_LABELS = { HIRING_MANAGER: "Hiring manager", INTERVIEWER: "Interviewer", PANEL_MEMBER: "Panel member" }
const FIELD = "mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-white"
const SMALL_FIELD = "rounded-lg border border-slate-700 bg-slate-900 px-2 py-2 text-sm text-white"
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

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

  return (
    <div
      className="hv-theme-dialog-backdrop fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/80 px-4 py-4 backdrop-blur-md sm:py-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="live-interview-title"
    >
      {/* The dashboard caps dialogs at the viewport height, so the card scrolls internally. */}
      <div className="relative flex max-h-[calc(100dvh-2rem)] w-full max-w-2xl flex-col overflow-hidden rounded-[28px] border border-slate-800 bg-slate-900 text-white shadow-[0_0_60px_rgba(37,99,235,0.18)]">
        <div className="flex items-start justify-between gap-4 border-b border-slate-800 p-5 pb-4 sm:px-6">
          <div>
            <h2 id="live-interview-title" className="text-2xl font-semibold tracking-tight">
              VERIS Live Interview
            </h2>
            <p className="mt-1 text-sm text-slate-400">Schedule a live video interview with your interviewer or panel.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-full border border-slate-700 px-3 py-1 text-sm text-slate-300 hover:text-white">
            Close
          </button>
        </div>

        {done ? (
          <div className="space-y-4 overflow-y-auto p-5 sm:px-6">
            <p className="text-base font-semibold text-emerald-300">Interview scheduled.</p>
            <p className="text-sm text-slate-300">
              {done.invitations
                ? `${done.invitations.sent} invitation(s) sent${
                    done.invitations.failed ? `, ${done.invitations.failed} failed. Resend from the Interviews page.` : "."
                  }`
                : "Invitations were not sent yet."}
            </p>
            <div className="flex justify-end">
              <button type="button" onClick={onClose} className="hv-solid-action rounded-xl bg-[#2563eb] px-5 py-2 text-sm font-semibold text-white">
                Done
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5 sm:px-6">
              <label className="block text-sm">
                <span className="text-slate-300">Job</span>
                <select value={jobId} onChange={(e) => setJobId(e.target.value)} className={FIELD}>
                  <option value="">Select a job</option>
                  {jobs.map((job) => {
                    const id = job.jobId || job.job_id || job.id
                    return (
                      <option key={id} value={id}>
                        {job.jobTitle || job.job_title || job.title}
                      </option>
                    )
                  })}
                </select>
              </label>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-sm">
                  <span className="text-slate-300">Candidate name</span>
                  <input value={name} onChange={(e) => setName(e.target.value)} className={FIELD} />
                </label>
                <label className="block text-sm">
                  <span className="text-slate-300">Candidate email</span>
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={FIELD} />
                </label>
              </div>

              <div className="text-sm">
                <span className="text-slate-300">Resume (PDF or DOCX)</span>
                <div className="mt-1 flex flex-wrap items-center gap-3 rounded-2xl border border-dashed border-slate-700 bg-slate-950/40 p-3">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="rounded-full border border-cyan-400/40 bg-cyan-500/15 px-4 py-2 text-sm font-medium text-cyan-200 hover:bg-cyan-500/25"
                  >
                    {resumeFile ? "Change file" : "Choose file"}
                  </button>
                  <span className="min-w-0 truncate text-slate-400">{resumeFile ? resumeFile.name : "No file chosen"}</span>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,.docx"
                    className="hidden"
                    onChange={(e) => setResumeFile(e.target.files?.[0] ?? null)}
                  />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-sm">
                  <span className="text-slate-300">Start ({timezone})</span>
                  <input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} className={FIELD} />
                </label>
                <label className="block text-sm">
                  <span className="text-slate-300">Duration (minutes)</span>
                  <input type="number" min={10} max={240} value={duration} onChange={(e) => setDuration(e.target.value)} className={FIELD} />
                </label>
              </div>

              <fieldset className="space-y-3 text-sm">
                <legend className="text-slate-300">Interview panel</legend>
                <p className="text-xs text-slate-400">Add anyone by email. They don&apos;t need to be on your team.</p>

                <div className="space-y-2">
                  {emailRows.map((row, index) => (
                    <div key={row.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/40 p-2">
                      <input
                        type="email"
                        value={row.email}
                        onChange={(e) => updateEmailRow(row.id, { email: e.target.value })}
                        placeholder="panelist@company.com"
                        aria-label={`Panel member ${index + 1} email`}
                        className={`${SMALL_FIELD} min-w-[200px] flex-[2]`}
                      />
                      <input
                        value={row.name}
                        onChange={(e) => updateEmailRow(row.id, { name: e.target.value })}
                        placeholder="Name (optional)"
                        aria-label={`Panel member ${index + 1} name`}
                        className={`${SMALL_FIELD} min-w-[140px] flex-1`}
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
                  className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-400/40 px-3 py-1.5 text-sm text-cyan-200 hover:bg-cyan-500/15"
                >
                  <span aria-hidden="true" className="text-base leading-none">+</span> Add panel member
                </button>

                {team.length ? (
                  <div className="pt-2">
                    <p className="text-xs uppercase tracking-wider text-slate-400">Or add from your team</p>
                    <div className="mt-2 max-h-48 space-y-2 overflow-y-auto">
                      {team.map((member) => {
                        const entry = teamPanel.find((p) => p.userId === member.userId)
                        return (
                          <div key={member.userId} className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2">
                            <input
                              type="checkbox"
                              checked={Boolean(entry)}
                              onChange={() => toggleTeamMember(member.userId)}
                              className="h-4 w-4 accent-cyan-400"
                              aria-label={`Add ${member.name || member.email}`}
                            />
                            <span className="min-w-0 flex-1 truncate">
                              {member.name || member.email}
                              <span className="ml-2 text-xs text-slate-400">{member.email}</span>
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
              </fieldset>
            </div>

            <div className="space-y-3 border-t border-slate-800 p-5 pt-4 sm:px-6">
              <p className="text-xs text-slate-400">Uses 1 interview credit. Each participant receives a personal, expiring link by email.</p>
              {error ? (
                <p role="alert" className="text-sm text-rose-300">
                  {error}
                </p>
              ) : null}
              <div className="flex justify-between gap-3">
                <button type="button" onClick={onBack} className="rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-200">
                  Back
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="hv-solid-action rounded-xl bg-[#2563eb] px-5 py-2 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {submitting ? "Scheduling…" : "Schedule & send invitations"}
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
