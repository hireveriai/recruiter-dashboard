"use client"

import { use, useEffect, useState } from "react"

import Navbar from "@/components/Navbar"
import SendInterviewModal from "@/components/SendInterviewModal"
import { buildAuthUrl } from "@/lib/client/auth-query"
import { useAuthSearchParams } from "@/lib/client/use-auth-search-params"

const CARD = "rounded-2xl border border-slate-200 bg-white shadow-sm p-5"

function clock(ms) {
  if (ms === null || ms === undefined) return ""
  const total = Math.floor(ms / 1000)
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`
}

function label(value) {
  return String(value || "").replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase())
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

  return (
    <div className="hv-page-enter min-h-screen bg-slate-50 text-slate-900">
      <Navbar onSendInterviewClick={() => setOpenSend(true)} />
      <main className="mx-auto max-w-[1200px] space-y-6 px-4 py-8 sm:px-6">
        {error ? <p className="text-rose-700">{error}</p> : null}
        {!report && !error ? <p className="text-slate-500">Loading…</p> : null}
        {report ? (
          <>
            <section className={CARD}>
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">VERIS Live Interview Report</p>
              <h1 className="mt-2 text-2xl font-semibold">{report.interview.candidateName || "Candidate"}</h1>
              <p className="mt-1 text-sm text-slate-500">
                {report.interview.jobTitle} · {label(report.interview.liveStatus)} ·{" "}
                {report.interview.startedAt ? new Date(report.interview.startedAt).toLocaleString() : "Not started"}
                {report.interview.endedAt ? ` – ${new Date(report.interview.endedAt).toLocaleTimeString()}` : ""}
              </p>
              <ul className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
                {report.participants.map((p) => (
                  <li key={p.participantId} className="rounded-xl border border-slate-200 px-3 py-2">
                    <span className="font-medium">{p.displayName}</span>{" "}
                    <span className="text-slate-500">{p.role === "CANDIDATE" ? "Candidate" : label(p.panelRole)}</span>
                    <span className="block text-xs text-slate-500">
                      {p.firstJoinedAt ? `Joined ${new Date(p.firstJoinedAt).toLocaleTimeString()}` : "Did not join"} ·{" "}
                      {p.recordingConsent ? "Consented to recording" : "No recording consent"}
                    </span>
                  </li>
                ))}
              </ul>
            </section>

            <section className={CARD}>
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-cyan-700">Interviewer evaluation</p>
              <h2 className="mt-1 text-lg font-semibold">What the interviewers recorded</h2>
              <p className="mt-1 text-xs text-slate-500">
                Independent ratings from each interviewer (1–5 evidence strength). Shown side by side; VERIS does not combine them into a score or make a hiring recommendation.
              </p>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                {report.scorecards.map((card) => (
                  <div key={card.participantId} className="rounded-xl border border-slate-200 p-4">
                    <p className="font-medium">
                      {card.interviewer} <span className="text-xs text-slate-500">{label(card.panelRole)}</span>
                    </p>
                    {!card.submittedAt ? (
                      <p className="mt-2 text-sm text-slate-500">Scorecard not submitted.</p>
                    ) : (
                      <ul className="mt-2 space-y-2 text-sm">
                        {[...card.ratings]
                          .sort((a, b) => ["OVERALL", "FOCUS_AREA", "QUESTION"].indexOf(a.targetType) - ["OVERALL", "FOCUS_AREA", "QUESTION"].indexOf(b.targetType))
                          .map((r, i) => (
                            <li key={i}>
                              <span className="text-slate-700">
                                {r.targetType === "OVERALL" ? "Overall" : r.targetType === "FOCUS_AREA" ? r.focusArea : `Q${questionText(r.questionId)?.order ?? "?"}`}
                              </span>
                              <span className="ml-2 font-semibold">{r.rating ? `${r.rating}/5` : "—"}</span>
                              {r.evidence ? <p className="text-xs text-slate-500">{r.evidence}</p> : null}
                            </li>
                          ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            </section>

            <section className={CARD}>
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-cyan-700">VERIS evidence</p>
              <h2 className="mt-1 text-lg font-semibold">What was observed in the interview</h2>
              <p className="mt-1 text-xs text-slate-500">Factual record from the session. VERIS does not score the candidate in a Live Interview.</p>
              <h3 className="mt-4 text-sm font-semibold">Questionnaire coverage</h3>
              <ol className="mt-3 space-y-1 text-sm">
                {report.questions.map((q) => (
                  <li key={q.questionId}>
                    <span className="text-slate-500">{q.order}.</span> {q.text}{" "}
                    <span className="text-xs text-slate-500">
                      {q.focusArea ? `${q.focusArea} · ` : ""}
                      {label(q.status)}
                    </span>
                  </li>
                ))}
              </ol>
              {report.manualQuestions.length ? (
                <>
                  <h3 className="mt-4 text-sm font-semibold">Additional questions asked</h3>
                  <ul className="mt-1 space-y-1 text-sm text-slate-700">
                    {report.manualQuestions.map((m, i) => (
                      <li key={i}>
                        {m.text} <span className="text-xs text-slate-500">{m.askedBy}</span>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
              <p className="mt-3 text-xs text-slate-500">Copilot suggestions requested: {report.copilotSuggestions}</p>
            </section>

            <section className={CARD}>
              <h2 className="text-lg font-semibold">Transcript <span className="text-xs font-normal text-slate-500">VERIS evidence</span></h2>
              {report.transcript.length === 0 ? (
                <p className="mt-2 text-sm text-slate-500">
                  {report.recordings.some((r) => r.kind === "PARTICIPANT_AUDIO")
                    ? "Transcription is being prepared or unavailable."
                    : "No transcript: the interview was not recorded."}
                </p>
              ) : (
                <ul className="mt-3 max-h-[480px] space-y-2 overflow-y-auto text-sm">
                  {report.transcript.map((s, i) => (
                    <li key={i}>
                      <span className="mr-2 font-mono text-xs text-slate-500">{clock(s.startMs)}</span>
                      <span className={s.role === "CANDIDATE" ? "font-semibold text-cyan-700" : "font-semibold"}>{s.speaker}:</span> {s.text}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className={CARD}>
              <h2 className="text-lg font-semibold">Recordings <span className="text-xs font-normal text-slate-500">VERIS evidence</span></h2>
              {report.recordings.length === 0 ? <p className="mt-2 text-sm text-slate-500">Not recorded.</p> : null}
              <ul className="mt-3 space-y-3 text-sm">
                {report.recordings.map((r) => (
                  <li key={r.recordingId}>
                    {r.kind === "COMPOSITE" ? "Full interview (video)" : `Audio: ${r.speaker}`}{" "}
                    <span className="text-xs text-slate-500">
                      {label(r.status)}
                      {r.transcriptionStatus ? ` · transcript ${label(r.transcriptionStatus)}` : ""}
                    </span>
                    {r.status === "COMPLETE" ? (
                      playback[r.recordingId] && playback[r.recordingId] !== "error" ? (
                        r.kind === "COMPOSITE" ? (
                          <video src={playback[r.recordingId]} controls className="mt-2 w-full rounded-xl" />
                        ) : (
                          <audio src={playback[r.recordingId]} controls className="mt-2 w-full" />
                        )
                      ) : (
                        <button type="button" onClick={() => play(r.recordingId)} className="ml-3 rounded-lg border border-slate-300 px-2 py-0.5 text-xs">
                          {playback[r.recordingId] === "error" ? "Unavailable, retry" : "Play"}
                        </button>
                      )
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>

            <section className={CARD}>
              <h2 className="text-lg font-semibold">Timeline <span className="text-xs font-normal text-slate-500">VERIS evidence</span></h2>
              <ul className="mt-3 space-y-1 text-xs text-slate-500">
                {report.timeline.map((e, i) => (
                  <li key={i}>
                    {new Date(e.at).toLocaleTimeString()} · {label(e.type)}
                    {e.participant ? ` · ${e.participant}` : ""}
                  </li>
                ))}
              </ul>
            </section>
          </>
        ) : null}
      </main>
      <SendInterviewModal isOpen={openSend} onClose={() => setOpenSend(false)} />
    </div>
  )
}
