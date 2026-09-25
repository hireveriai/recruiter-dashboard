"use client"

import { use, useEffect, useState } from "react"

import Navbar from "@/components/Navbar"
import SendInterviewModal from "@/components/SendInterviewModal"
import { buildAuthUrl } from "@/lib/client/auth-query"
import { useAuthSearchParams } from "@/lib/client/use-auth-search-params"

// Colors use the dashboard's dark-scale classes; its light theme remaps them.
// White text on colored fills carries hv-solid-action.
const CARD = "rounded-2xl border border-slate-800 bg-slate-900/80 p-5 shadow-sm sm:p-6"

function clock(ms) {
  if (ms === null || ms === undefined) return ""
  const total = Math.floor(ms / 1000)
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`
}

function label(value) {
  return String(value || "").replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase())
}

function initials(value) {
  const parts = String(value || "?").split(/\s+/).filter(Boolean)
  return ((parts[0]?.[0] ?? "?") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase()
}

const COVERAGE_TONE = {
  COVERED: "bg-emerald-500/10 text-emerald-300",
  ASKED: "bg-cyan-400/10 text-cyan-200",
  SKIPPED: "bg-amber-500/10 text-amber-300",
  NOT_ASKED: "bg-slate-800/60 text-slate-400",
}

function Avatar({ name, candidate, size = "h-9 w-9 text-xs" }) {
  return (
    <span
      aria-hidden="true"
      className={`hv-solid-action flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br font-semibold text-white ${size} ${
        candidate ? "from-cyan-500 to-blue-600" : "from-slate-500 to-slate-600"
      }`}
    >
      {initials(name)}
    </span>
  )
}

function SectionTitle({ eyebrow, title, hint }) {
  return (
    <div className="mb-4">
      {eyebrow ? <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-300">{eyebrow}</p> : null}
      <h2 className="mt-1 text-lg font-semibold text-white">{title}</h2>
      {hint ? <p className="mt-1 text-xs text-slate-400">{hint}</p> : null}
    </div>
  )
}

function Stat({ value, label: text, tone = "text-white" }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3">
      <p className={`text-2xl font-semibold ${tone}`}>{value}</p>
      <p className="text-xs text-slate-400">{text}</p>
    </div>
  )
}

function RatingDots({ rating }) {
  return (
    <span className="inline-flex items-center gap-1" aria-label={rating ? `${rating} out of 5` : "Not rated"}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} className={`h-2 w-2 rounded-full ${rating && n <= rating ? "bg-cyan-400" : "bg-slate-700"}`} />
      ))}
      <span className="ml-1.5 text-xs font-semibold text-white">{rating ? `${rating}/5` : "—"}</span>
    </span>
  )
}

/**
 * VERIS Live Interview report. Human ratings are shown per interviewer, side
 * by side; there is intentionally no combined score and no hiring
 * recommendation. Private interviewer notes are never included.
 */
export default function LiveInterviewReportPage({ params }) {
  const { interviewId } = use(params)
  const searchParams = useAuthSearchParams()
  const [report, setReport] = useState(null)
  const [error, setError] = useState("")
  const [openSend, setOpenSend] = useState(false)
  const [playback, setPlayback] = useState({})

  useEffect(() => {
    fetch(buildAuthUrl(`/api/live-interviews/${interviewId}/report`, searchParams), { credentials: "include" })
      .then(async (r) => {
        const body = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(body?.error?.message || body?.message || "Could not load the report.")
        setReport(body.data)
      })
      .catch((e) => setError(e.message))
  }, [interviewId, searchParams])

  const play = async (recordingId) => {
    const r = await fetch(buildAuthUrl(`/api/live-interviews/${interviewId}/recordings/${recordingId}`, searchParams), { credentials: "include" })
    const body = await r.json().catch(() => ({}))
    setPlayback((cur) => ({ ...cur, [recordingId]: r.ok ? body.data.url : "error" }))
  }

  const questionText = (id) => report?.questions.find((q) => q.questionId === id)

  const covered = report ? report.questions.filter((q) => q.status === "COVERED").length : 0
  const submitted = report ? report.scorecards.filter((c) => c.submittedAt).length : 0
  const recorded = report ? report.recordings.some((r) => r.kind === "COMPOSITE") : false
  const start = report?.interview.startedAt ? new Date(report.interview.startedAt) : null
  const end = report?.interview.endedAt ? new Date(report.interview.endedAt) : null

  return (
    <div className="hv-page-enter min-h-screen bg-slate-950 text-white">
      <Navbar onSendInterviewClick={() => setOpenSend(true)} />
      <main className="mx-auto max-w-[1200px] space-y-6 px-4 py-8 sm:px-6">
        {error ? <p className="rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-rose-300">{error}</p> : null}
        {!report && !error ? (
          <div className="space-y-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-32 animate-pulse rounded-2xl border border-slate-800 bg-slate-900/60" />
            ))}
          </div>
        ) : null}

        {report ? (
          <>
            {/* Hero */}
            <section className="relative overflow-hidden rounded-3xl border border-slate-800 bg-slate-900 p-6 shadow-sm sm:p-8">
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 bg-[radial-gradient(50%_120%_at_0%_0%,rgba(34,211,238,0.12),transparent_60%),radial-gradient(40%_100%_at_100%_0%,rgba(37,99,235,0.10),transparent_60%)]"
              />
              <div className="relative flex flex-wrap items-start justify-between gap-4">
                <div className="flex items-start gap-4">
                  <span className="hv-solid-action flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-500 to-blue-600 text-white shadow-lg shadow-cyan-500/20">
                    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="6" width="12" height="12" rx="2.5" />
                      <path d="M15 10.5 21 7v10l-6-3.5" />
                    </svg>
                  </span>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-300">VERIS Live Interview Report</p>
                    <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">{report.interview.candidateName || "Candidate"}</h1>
                    <p className="mt-1 text-sm text-slate-400">{report.interview.jobTitle}</p>
                  </div>
                </div>
                <div className="text-right text-sm">
                  <span className="inline-flex rounded-full border border-slate-700 bg-slate-800/60 px-2.5 py-1 text-xs font-semibold text-slate-200">
                    {label(report.interview.liveStatus)}
                  </span>
                  <p className="mt-2 text-slate-400">
                    {start ? start.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "Not started"}
                    {end ? ` – ${end.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}` : ""}
                  </p>
                </div>
              </div>

              <div className="relative mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
                <Stat value={`${covered}/${report.questions.length}`} label="Questions covered" tone="text-emerald-300" />
                <Stat value={report.scorecards.length} label="Interviewers" />
                <Stat value={`${submitted}/${report.scorecards.length}`} label="Scorecards submitted" tone="text-cyan-300" />
                <Stat value={recorded ? "Yes" : "No"} label="Recorded" />
              </div>

              <div className="relative mt-5 flex flex-wrap gap-2">
                {report.participants.map((p) => (
                  <div key={p.participantId} className="flex items-center gap-2.5 rounded-full border border-slate-800 bg-slate-900/80 py-1 pl-1 pr-3">
                    <Avatar name={p.displayName} candidate={p.role === "CANDIDATE"} size="h-7 w-7 text-[10px]" />
                    <div className="leading-tight">
                      <p className="text-xs font-medium text-white">
                        {p.displayName} <span className="font-normal text-slate-400">· {p.role === "CANDIDATE" ? "Candidate" : label(p.panelRole)}</span>
                      </p>
                      <p className="text-[10px] text-slate-400">
                        {p.firstJoinedAt ? `Joined ${new Date(p.firstJoinedAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}` : "Did not join"} ·{" "}
                        {p.recordingConsent ? "Consented" : "No consent"}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* Interviewer evaluation */}
            <section className={CARD}>
              <SectionTitle
                eyebrow="Interviewer evaluation"
                title="What the interviewers recorded"
                hint="Independent ratings from each interviewer (1–5 evidence strength), side by side. VERIS does not combine them into a score or make a hiring recommendation."
              />
              <div className="grid gap-4 md:grid-cols-2">
                {report.scorecards.map((card) => (
                  <div key={card.participantId} className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
                    <div className="flex items-center gap-3">
                      <Avatar name={card.interviewer} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-white">{card.interviewer}</p>
                        <p className="text-xs text-slate-400">{label(card.panelRole)}</p>
                      </div>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${card.submittedAt ? "bg-emerald-500/10 text-emerald-300" : "bg-slate-800/60 text-slate-400"}`}
                      >
                        {card.submittedAt ? "Submitted" : "Pending"}
                      </span>
                    </div>
                    {!card.submittedAt ? (
                      <p className="mt-4 rounded-xl border border-dashed border-slate-700 px-3 py-4 text-center text-xs text-slate-400">Scorecard not submitted yet.</p>
                    ) : (
                      <ul className="mt-4 space-y-3">
                        {[...card.ratings]
                          .sort((a, b) => ["OVERALL", "FOCUS_AREA", "QUESTION"].indexOf(a.targetType) - ["OVERALL", "FOCUS_AREA", "QUESTION"].indexOf(b.targetType))
                          .map((r, i) => (
                            <li key={i} className={r.targetType === "OVERALL" ? "rounded-xl border border-cyan-400/30 bg-cyan-400/[0.06] p-3" : ""}>
                              <div className="flex items-center justify-between gap-3">
                                <span className={`text-sm ${r.targetType === "OVERALL" ? "font-semibold text-white" : "text-slate-300"}`}>
                                  {r.targetType === "OVERALL" ? "Overall" : r.targetType === "FOCUS_AREA" ? r.focusArea : `Q${questionText(r.questionId)?.order ?? "?"}`}
                                </span>
                                <RatingDots rating={r.rating} />
                              </div>
                              {r.evidence ? <p className="mt-1 text-xs leading-5 text-slate-400">{r.evidence}</p> : null}
                            </li>
                          ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            </section>

            {/* VERIS evidence: coverage */}
            <section className={CARD}>
              <SectionTitle
                eyebrow="VERIS evidence"
                title="What was observed in the interview"
                hint="Factual record from the session. VERIS does not score the candidate in a Live Interview."
              />
              <ol className="space-y-2">
                {report.questions.map((q) => (
                  <li key={q.questionId} className="flex items-start gap-3 rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2.5">
                    <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-800/60 text-[11px] font-semibold text-slate-300">
                      {q.order}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-white">{q.text}</p>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${COVERAGE_TONE[q.status] ?? COVERAGE_TONE.NOT_ASKED}`}>{label(q.status)}</span>
                        {q.focusArea ? <span className="rounded-full bg-slate-800/60 px-2 py-0.5 text-[11px] text-slate-400">{q.focusArea}</span> : null}
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
              {report.manualQuestions.length ? (
                <div className="mt-5">
                  <h3 className="text-sm font-semibold text-white">Additional questions asked</h3>
                  <ul className="mt-2 space-y-1.5">
                    {report.manualQuestions.map((m, i) => (
                      <li key={i} className="rounded-xl bg-slate-800/60 px-3 py-2 text-sm text-slate-300">
                        {m.text} {m.askedBy ? <span className="text-xs text-slate-400">· {m.askedBy}</span> : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <p className="mt-4 text-xs text-slate-400">Copilot suggestions requested by interviewers: {report.copilotSuggestions}</p>
            </section>

            <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
              {/* Transcript */}
              <section className={CARD}>
                <SectionTitle eyebrow="VERIS evidence" title="Transcript" />
                {report.transcript.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-slate-700 px-4 py-8 text-center text-sm text-slate-400">
                    {report.recordings.some((r) => r.kind === "PARTICIPANT_AUDIO")
                      ? "Transcription is being prepared or unavailable."
                      : "No transcript: the interview was not recorded."}
                  </p>
                ) : (
                  <ul className="max-h-[520px] space-y-3 overflow-y-auto pr-1">
                    {report.transcript.map((s, i) => {
                      const isCandidate = s.role === "CANDIDATE"
                      return (
                        <li key={i} className="flex items-start gap-2.5">
                          <Avatar name={s.speaker} candidate={isCandidate} size="h-7 w-7 text-[10px]" />
                          <div className={`min-w-0 flex-1 rounded-2xl px-3 py-2 ${isCandidate ? "bg-cyan-400/[0.07] ring-1 ring-cyan-400/20" : "bg-slate-800/60"}`}>
                            <p className="text-[11px] text-slate-400">
                              <span className={`font-semibold ${isCandidate ? "text-cyan-300" : "text-white"}`}>{s.speaker}</span>
                              <span className="ml-2 font-mono">{clock(s.startMs)}</span>
                            </p>
                            <p className="mt-0.5 text-sm leading-6 text-slate-200">{s.text}</p>
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </section>

              <div className="space-y-6">
                {/* Recordings */}
                <section className={CARD}>
                  <SectionTitle eyebrow="VERIS evidence" title="Recordings" />
                  {report.recordings.length === 0 ? (
                    <p className="rounded-xl border border-dashed border-slate-700 px-4 py-6 text-center text-sm text-slate-400">Not recorded.</p>
                  ) : null}
                  <ul className="space-y-2.5">
                    {report.recordings.map((r) => (
                      <li key={r.recordingId} className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
                        <div className="flex items-center gap-3">
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-cyan-400/10 text-cyan-300">
                            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                              {r.kind === "COMPOSITE" ? (
                                <>
                                  <rect x="3" y="6" width="12" height="12" rx="2.5" />
                                  <path d="M15 10.5 21 7v10l-6-3.5" />
                                </>
                              ) : (
                                <>
                                  <rect x="9" y="3" width="6" height="11" rx="3" />
                                  <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
                                </>
                              )}
                            </svg>
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-white">{r.kind === "COMPOSITE" ? "Full interview (video)" : `Audio · ${r.speaker}`}</p>
                            <p className="text-[11px] text-slate-400">
                              {label(r.status)}
                              {r.transcriptionStatus ? ` · transcript ${label(r.transcriptionStatus)}` : ""}
                            </p>
                          </div>
                          {r.status === "COMPLETE" && !(playback[r.recordingId] && playback[r.recordingId] !== "error") ? (
                            <button
                              type="button"
                              onClick={() => play(r.recordingId)}
                              className="hv-solid-action inline-flex items-center gap-1 rounded-lg bg-[#2563eb] px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-[#1d4ed8]"
                            >
                              <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3 w-3" fill="currentColor">
                                <path d="M7 5v14l12-7z" />
                              </svg>
                              {playback[r.recordingId] === "error" ? "Retry" : "Play"}
                            </button>
                          ) : null}
                        </div>
                        {r.status === "COMPLETE" && playback[r.recordingId] && playback[r.recordingId] !== "error" ? (
                          r.kind === "COMPOSITE" ? (
                            <video src={playback[r.recordingId]} controls className="mt-3 w-full rounded-xl" />
                          ) : (
                            <audio src={playback[r.recordingId]} controls className="mt-3 w-full" />
                          )
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </section>

                {/* Timeline */}
                <section className={CARD}>
                  <SectionTitle eyebrow="VERIS evidence" title="Timeline" />
                  <ol className="relative ml-2 space-y-3 border-l border-slate-800 pl-4">
                    {report.timeline.map((e, i) => (
                      <li key={i} className="relative">
                        <span aria-hidden="true" className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-slate-900 bg-cyan-400" />
                        <p className="text-xs font-medium text-white">{label(e.type)}</p>
                        <p className="text-[11px] text-slate-400">
                          {new Date(e.at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                          {e.participant ? ` · ${e.participant}` : ""}
                        </p>
                      </li>
                    ))}
                  </ol>
                </section>
              </div>
            </div>
          </>
        ) : null}
      </main>
      <SendInterviewModal isOpen={openSend} onClose={() => setOpenSend(false)} />
    </div>
  )
}
