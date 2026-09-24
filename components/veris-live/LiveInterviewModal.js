"use client"

import { useEffect, useState } from "react"

import { showActionFeedback } from "@/lib/client/action-feedback"
import { buildAuthUrl } from "@/lib/client/auth-query"
import { useAuthSearchParams } from "@/lib/client/use-auth-search-params"

const PANEL_ROLE_LABELS = { HIRING_MANAGER: "Hiring manager", INTERVIEWER: "Interviewer", PANEL_MEMBER: "Panel member" }
const FIELD = "mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-slate-900"

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

export default function LiveInterviewModal({ onClose, onBack }) {
  const searchParams = useAuthSearchParams()
  const [jobs, setJobs] = useState([])
  const [team, setTeam] = useState([])
  const [jobId, setJobId] = useState("")
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [resumeFile, setResumeFile] = useState(null)
  const [start, setStart] = useState(defaultStart)
  const [duration, setDuration] = useState(45)
  const [panel, setPanel] = useState([])
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

  const togglePanelMember = (userId) => {
    setPanel((current) =>
      current.some((entry) => entry.userId === userId)
        ? current.filter((entry) => entry.userId !== userId)
        : [...current, { userId, panelRole: "INTERVIEWER" }]
    )
  }

  const submit = async (event) => {
    event.preventDefault()
    setError("")
    if (!jobId || !name.trim() || !email.trim() || !resumeFile) {
      setError("Job, candidate name, email and resume are required.")
      return
    }
    if (panel.length === 0) {
      setError("Add at least one interviewer.")
      return
    }
    const candidateEmail = email.trim().toLowerCase()
    const clash = team.some(
      (member) => panel.some((entry) => entry.userId === member.userId) && member.email?.toLowerCase() === candidateEmail
    )
    if (clash) {
      setError("The candidate cannot also be an interviewer.")
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
            interviewers: panel,
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
    >
      <div className="relative w-full max-w-2xl rounded-[28px] border border-slate-200 bg-white p-5 text-slate-900 shadow-xl sm:p-6">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 pb-4">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">VERIS Live Interview</h2>
            <p className="mt-1 text-sm text-slate-500">Schedule a live video interview with your interviewer or panel.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-full border border-slate-300 px-3 py-1 text-sm text-slate-700 hover:text-slate-900">
            Close
          </button>
        </div>

        {done ? (
          <div className="mt-5 space-y-4">
            <p className="text-base font-semibold text-emerald-700">Interview scheduled.</p>
            <p className="text-sm text-slate-700">
              {done.invitations
                ? `${done.invitations.sent} invitation(s) sent${
                    done.invitations.failed ? `, ${done.invitations.failed} failed. Resend from the Interviews page.` : "."
                  }`
                : "Invitations were not sent yet."}
            </p>
            <div className="flex justify-end">
              <button type="button" onClick={onClose} className="rounded-xl bg-[#2563eb] px-5 py-2 text-sm font-semibold text-white">
                Done
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="mt-5 space-y-4">
            <label className="block text-sm">
              <span className="text-slate-700">Job</span>
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
                <span className="text-slate-700">Candidate name</span>
                <input value={name} onChange={(e) => setName(e.target.value)} className={FIELD} />
              </label>
              <label className="block text-sm">
                <span className="text-slate-700">Candidate email</span>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={FIELD} />
              </label>
            </div>
            <label className="block text-sm">
              <span className="text-slate-700">Resume (PDF or DOCX)</span>
              <input
                type="file"
                accept=".pdf,.docx"
                onChange={(e) => setResumeFile(e.target.files?.[0] ?? null)}
                className="mt-1 block w-full text-sm text-slate-700"
              />
            </label>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="text-slate-700">Start ({timezone})</span>
                <input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} className={FIELD} />
              </label>
              <label className="block text-sm">
                <span className="text-slate-700">Duration (minutes)</span>
                <input type="number" min={10} max={240} value={duration} onChange={(e) => setDuration(e.target.value)} className={FIELD} />
              </label>
            </div>

            <fieldset className="text-sm">
              <legend className="text-slate-700">Interview panel</legend>
              <div className="mt-2 max-h-56 space-y-2 overflow-y-auto">
                {team.length === 0 ? <p className="text-slate-500">No team members available.</p> : null}
                {team.map((member) => {
                  const entry = panel.find((p) => p.userId === member.userId)
                  return (
                    <div key={member.userId} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white shadow-sm px-3 py-2">
                      <input
                        type="checkbox"
                        checked={Boolean(entry)}
                        onChange={() => togglePanelMember(member.userId)}
                        className="h-4 w-4 accent-cyan-600"
                        aria-label={`Add ${member.name || member.email}`}
                      />
                      <span className="min-w-0 flex-1 truncate">
                        {member.name || member.email}
                        <span className="ml-2 text-xs text-slate-500">{member.email}</span>
                      </span>
                      {entry ? (
                        <select
                          value={entry.panelRole}
                          onChange={(e) =>
                            setPanel((cur) => cur.map((p) => (p.userId === member.userId ? { ...p, panelRole: e.target.value } : p)))
                          }
                          className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs"
                        >
                          {Object.entries(PANEL_ROLE_LABELS).map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            </fieldset>

            <p className="text-xs text-slate-500">Uses 1 interview credit. Each participant receives a personal, expiring link by email.</p>
            {error ? <p className="text-sm text-rose-700">{error}</p> : null}

            <div className="flex justify-between gap-3">
              <button type="button" onClick={onBack} className="rounded-xl border border-slate-300 px-4 py-2 text-sm text-slate-800">
                Back
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="rounded-xl bg-[#2563eb] px-5 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                {submitting ? "Scheduling…" : "Schedule & send invitations"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
