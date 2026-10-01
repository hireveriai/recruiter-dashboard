"use client"

import { useEffect, useState } from "react"

import { buildAuthUrl } from "@/lib/client/auth-query"

// Same visual language as the Live report page: dark-scale classes (the light
// theme remaps them) and hv-solid-action on white-on-color buttons.
const CARD = "rounded-xl border border-slate-800 bg-slate-900/80 p-4 shadow-[0_14px_44px_rgba(2,6,23,0.18)] sm:p-5"

const LEVELS = [
  { key: "STRONG", title: "Strong evidence", dot: "bg-emerald-400", text: "text-emerald-300", ring: "border-emerald-400/25" },
  { key: "PARTIAL", title: "Partial evidence", dot: "bg-amber-400", text: "text-amber-300", ring: "border-amber-400/25" },
  { key: "NOT_DEMONSTRATED", title: "Not demonstrated", dot: "bg-slate-500", text: "text-slate-400", ring: "border-slate-700" },
]

// Recruiter decision statuses (candidate_recruiter_decisions). The AI never sets these.
const DECISIONS = [
  { value: "PROCEED", label: "Proceed", tone: "border-emerald-400/50 bg-emerald-500/15 text-emerald-200" },
  { value: "HOLD", label: "Hold", tone: "border-amber-400/50 bg-amber-500/15 text-amber-200" },
  { value: "REJECT", label: "Reject", tone: "border-rose-400/50 bg-rose-500/15 text-rose-200" },
  { value: "REVIEW_REQUIRED", label: "Needs review", tone: "border-cyan-400/50 bg-cyan-400/15 text-cyan-100" },
]

export function clock(ms) {
  if (ms === null || ms === undefined) return ""
  const total = Math.floor(ms / 1000)
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`
}

function minutesText(seconds) {
  if (!seconds) return "0 min"
  if (seconds < 60) return `${seconds}s`
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return s ? `${m}m ${s}s` : `${m} min`
}

function Heading({ title, hint, right }) {
  return (
    <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-white">{title}</h3>
        {hint ? <p className="mt-0.5 text-xs text-slate-400">{hint}</p> : null}
      </div>
      {right}
    </div>
  )
}

function Quote({ quote, onJump }) {
  const where = (
    <>
      {quote.speaker ?? "Transcript"}
      {quote.atMs !== null && quote.atMs !== undefined ? <span className="ml-1.5 font-mono">{clock(quote.atMs)}</span> : null}
    </>
  )
  return (
    <blockquote className="mt-2 border-l-2 border-cyan-400/40 pl-3">
      <p className="text-xs leading-5 text-slate-300">&ldquo;{quote.quote}&rdquo;</p>
      {onJump && quote.atMs !== null && quote.atMs !== undefined ? (
        <button type="button" onClick={() => onJump(quote.atMs)} className="mt-0.5 text-[11px] text-slate-400 transition hover:text-cyan-300">
          {where} · View in transcript
        </button>
      ) : (
        <p className="mt-0.5 text-[11px] text-slate-400">{where}</p>
      )}
    </blockquote>
  )
}

function PointList({ title, hint, items, onJump, emptyText }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3.5">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-300">{title}</p>
      {hint ? <p className="mt-0.5 text-[11px] text-slate-400">{hint}</p> : null}
      {items.length === 0 ? (
        <p className="mt-2 text-xs text-slate-400">{emptyText}</p>
      ) : (
        <ul className="mt-2 space-y-3">
          {items.map((item, i) =>
            typeof item === "string" ? (
              <li key={i} className="flex gap-2 text-sm leading-6 text-slate-200">
                <span aria-hidden="true" className="mt-2.5 h-1 w-1 shrink-0 rounded-full bg-slate-500" />
                {item}
              </li>
            ) : (
              <li key={i}>
                <p className="text-sm leading-6 text-slate-200">{item.point}</p>
                {item.evidence.map((q, j) => (
                  <Quote key={j} quote={q} onJump={onJump} />
                ))}
              </li>
            )
          )}
        </ul>
      )}
    </div>
  )
}

function Spinner() {
  return <span aria-hidden="true" className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
}

/**
 * VERIS Debrief: competency coverage, the AI-assisted summary and the key
 * evidence, built from the transcript. The AI never sees interviewer ratings or
 * private notes and never gives a hire / reject verdict; the decision is made
 * by people in DebriefEvaluation.
 */
export function DebriefPanel({ debrief, error, generating, generateError, onGenerate, onJump }) {
  if (error) {
    return (
      <section className={CARD}>
        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-300">VERIS Debrief</p>
        <p className="mt-2 text-sm text-rose-300">{error}</p>
      </section>
    )
  }
  if (!debrief) return <div className="h-40 animate-pulse rounded-xl border border-slate-800 bg-slate-900/60" />

  const { summary, evidence } = debrief
  const quotes = summary
    ? [...summary.competencies.flatMap((c) => c.evidence), ...summary.strengths.flatMap((p) => p.evidence), ...summary.areasToProbe.flatMap((p) => p.evidence), ...summary.evidenceForReview.flatMap((p) => p.evidence)]
        .filter((q, i, all) => all.findIndex((o) => o.quote === q.quote) === i)
        .sort((a, b) => (a.atMs ?? 0) - (b.atMs ?? 0))
        .slice(0, 8)
    : []
  const startedAt = evidence.overview.startedAt ? Date.parse(evidence.overview.startedAt) : null
  const q = evidence.questions

  const generateButton = (label) => (
    <button
      type="button"
      onClick={onGenerate}
      disabled={generating || !debrief.canGenerate}
      className="hv-solid-action inline-flex items-center gap-2 rounded-lg bg-cyan-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {generating ? <Spinner /> : null}
      {generating ? "Generating…" : label}
    </button>
  )

  return (
    <section className={CARD} aria-labelledby="veris-debrief-title">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-300">VERIS Debrief</p>
          <h2 id="veris-debrief-title" className="mt-1 text-lg font-semibold text-white">
            Post-interview summary
          </h2>
          <p className="mt-1 max-w-2xl text-xs text-slate-400">
            Evidence for the panel discussion. VERIS summarises what was said; it does not recommend hiring or rejecting. The decision stays with your team.
          </p>
        </div>
        {summary ? (
          <div className="flex items-center gap-3">
            <p className="text-[11px] text-slate-400">
              Generated {new Date(summary.generatedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
            </p>
            {generateButton("Regenerate")}
          </div>
        ) : null}
      </div>

      {summary?.stale ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-400/30 bg-amber-500/10 px-3.5 py-2.5">
          <p className="text-xs text-amber-200">New transcript or question activity has arrived since this summary was generated.</p>
          {generateButton("Update summary")}
        </div>
      ) : null}
      {generateError ? (
        <p role="alert" className="mb-4 rounded-xl border border-rose-400/30 bg-rose-500/10 px-3.5 py-2.5 text-xs text-rose-300">
          {generateError}
        </p>
      ) : null}

      {!summary ? (
        <div className="rounded-xl border border-dashed border-slate-700 px-4 py-8 text-center">
          <p className="text-sm font-medium text-white">{debrief.canGenerate ? "The transcript is ready" : "Debrief not available yet"}</p>
          <p className="mx-auto mt-1 max-w-md text-xs text-slate-400">
            {debrief.canGenerate
              ? "Generate a summary of competency coverage, strengths, areas to probe and open questions. It is built from the transcript only, never from interviewer ratings or private notes."
              : debrief.blockedReason}
          </p>
          {debrief.canGenerate ? <div className="mt-4 flex justify-center">{generateButton("Generate debrief")}</div> : null}
        </div>
      ) : (
        <>
          {summary.overview ? <p className="mb-4 text-sm leading-6 text-slate-200">{summary.overview}</p> : null}

          {/* Competency coverage */}
          <Heading title="Competency coverage" hint="Strong evidence always cites the candidate's own words from the transcript." />
          <div className="grid gap-3 md:grid-cols-3">
            {LEVELS.map((level) => {
              const items = summary.competencies.filter((c) => c.level === level.key)
              return (
                <div key={level.key} className={`rounded-xl border bg-slate-950/40 p-3.5 ${level.ring}`}>
                  <p className={`flex items-center gap-2 text-xs font-semibold ${level.text}`}>
                    <span aria-hidden="true" className={`h-2 w-2 rounded-full ${level.dot}`} />
                    {level.title}
                    <span className="ml-auto font-normal text-slate-400">{items.length}</span>
                  </p>
                  {items.length === 0 ? (
                    <p className="mt-2 text-xs text-slate-400">None</p>
                  ) : (
                    <ul className="mt-2 space-y-3">
                      {items.map((c, i) => (
                        <li key={i}>
                          <p className="text-sm font-medium text-white">{c.name}</p>
                          {c.note ? <p className="mt-0.5 text-xs leading-5 text-slate-400">{c.note}</p> : null}
                          {c.evidence.slice(0, 2).map((quote, j) => (
                            <Quote key={j} quote={quote} onJump={onJump} />
                          ))}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )
            })}
          </div>

          {/* AI summary */}
          <div className="mt-5">
            <Heading title="VERIS AI summary" />
            <div className="grid gap-3 md:grid-cols-2">
              <PointList title="Strengths" items={summary.strengths} onJump={onJump} emptyText="No clear strengths were identified in the transcript." />
              <PointList title="Areas to probe" items={summary.areasToProbe} onJump={onJump} emptyText="Nothing flagged for follow-up." />
              <PointList title="Unresolved questions" items={summary.unresolvedQuestions} emptyText="No open questions." />
              <PointList
                title="Evidence requiring review"
                hint="Claims a person should verify before deciding."
                items={summary.evidenceForReview}
                onJump={onJump}
                emptyText="Nothing flagged for review."
              />
            </div>
          </div>
        </>
      )}

      {/* Key evidence: always factual, available before any summary exists */}
      <div className="mt-5">
        <Heading title="Key evidence" />
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
          <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3.5">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-300">Transcript excerpts</p>
            {quotes.length === 0 ? (
              <p className="mt-2 text-xs text-slate-400">
                {summary ? "The summary did not cite any transcript excerpts." : "Excerpts appear here once the debrief is generated."}
              </p>
            ) : (
              quotes.map((quote, i) => <Quote key={i} quote={quote} onJump={onJump} />)
            )}
          </div>
          <div className="space-y-3">
            <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3.5">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-300">Questions</p>
              <p className="mt-2 text-sm text-white">
                <span className="font-semibold text-emerald-300">{q.covered}</span> of {q.total} covered
              </p>
              <p className="mt-0.5 text-xs text-slate-400">
                {q.skipped} skipped · {q.notAsked} not asked · {q.manual} additional asked
              </p>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3.5">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-300">Screen-share activity</p>
              {evidence.screenShare.sessions.length === 0 ? (
                <p className="mt-2 text-xs text-slate-400">No screen was shared during this interview.</p>
              ) : (
                <>
                  <p className="mt-2 text-sm text-white">
                    Shared {evidence.screenShare.sessions.length === 1 ? "once" : `${evidence.screenShare.sessions.length} times`} · {minutesText(evidence.screenShare.totalSeconds)}
                  </p>
                  <ul className="mt-2 space-y-1.5">
                    {evidence.screenShare.sessions.map((s, i) => (
                      <li key={i} className="flex items-center gap-2 text-xs text-slate-300">
                        <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-violet-400" />
                        <span className="font-mono text-slate-400">{startedAt ? clock(Date.parse(s.startedAt) - startedAt) : ""}</span>
                        <span className="min-w-0 flex-1 truncate">{s.participant ?? "Participant"}</span>
                        <span className="text-slate-400">{s.seconds === null ? "still sharing" : minutesText(s.seconds)}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-[11px] text-slate-400">Start and stop times only. Screen content is not stored or analysed.</p>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {summary ? (
        <p className="mt-4 flex items-start gap-2 text-[11px] leading-5 text-slate-400">
          <svg aria-hidden="true" viewBox="0 0 24 24" className="mt-0.5 h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 11v5M12 8h.01" />
          </svg>
          AI-assisted from the transcript only. Every quote shown was matched against the transcript; quotes that could not be found were removed. Transcripts can contain recognition errors, so check the recording before relying on a single quote.
        </p>
      ) : null}
    </section>
  )
}

/**
 * The human side of the debrief: the viewer's own private notes (never shown to
 * anyone else) and the final recommendation, saved as the recruiter decision.
 */
export function DebriefEvaluation({ debrief, interviewId, searchParams, onDecisionSaved }) {
  const [status, setStatus] = useState(debrief?.decision?.status ?? "")
  const [notes, setNotes] = useState(debrief?.decision?.notes ?? "")
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState(null)

  useEffect(() => {
    setStatus(debrief?.decision?.status ?? "")
    setNotes(debrief?.decision?.notes ?? "")
  }, [debrief?.decision?.status, debrief?.decision?.notes])

  if (!debrief) return null
  const decided = debrief.decision
  const dirty = status !== (decided?.status ?? "") || notes.trim() !== (decided?.notes ?? "")

  const save = async () => {
    if (!status || !debrief.candidateId) return
    setSaving(true)
    setMessage(null)
    try {
      const r = await fetch(buildAuthUrl("/api/recruiter-decisions", searchParams), {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidateId: debrief.candidateId, interviewId, status, notes: notes.trim() || null }),
      })
      const body = await r.json().catch(() => null)
      if (!r.ok || !body?.success) throw new Error(body?.error?.message || "Could not save the recommendation.")
      onDecisionSaved?.({
        status: body.data.status,
        notes: body.data.notes ?? null,
        decidedAt: body.data.decidedAt ? new Date(body.data.decidedAt).toISOString() : null,
      })
      setMessage({ tone: "ok", text: "Recommendation saved." })
    } catch (e) {
      setMessage({ tone: "error", text: e.message })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
        <Heading
          title="Your private notes"
          hint="Only you can see these. They are not shared with other interviewers, the candidate or the AI."
          right={
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 text-slate-400" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="5" y="11" width="14" height="9" rx="2" />
              <path d="M8 11V8a4 4 0 0 1 8 0v3" />
            </svg>
          }
        />
        {debrief.myNotes.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-700 px-3 py-4 text-center text-xs text-slate-400">You did not take notes in this interview.</p>
        ) : (
          <ul className="max-h-64 space-y-2 overflow-y-auto pr-1">
            {debrief.myNotes.map((n) => (
              <li key={n.noteId} className="rounded-lg bg-slate-800/60 px-3 py-2">
                <p className="whitespace-pre-wrap text-sm leading-6 text-slate-200">{n.body}</p>
                <p className="mt-0.5 text-[11px] text-slate-400">
                  {n.questionOrder ? `Q${n.questionOrder} · ` : ""}
                  {new Date(n.createdAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-xl border border-cyan-400/25 bg-cyan-400/[0.04] p-4">
        <Heading title="Final recommendation" hint="Your team's decision, made by people. VERIS never sets this." />
        <div role="radiogroup" aria-label="Final recommendation" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {DECISIONS.map((d) => (
            <button
              key={d.value}
              type="button"
              role="radio"
              aria-checked={status === d.value}
              onClick={() => setStatus(d.value)}
              className={`rounded-lg border px-3 py-2 text-xs font-semibold transition ${
                status === d.value ? d.tone : "border-slate-700 bg-slate-900/60 text-slate-300 hover:border-slate-500 hover:text-white"
              }`}
            >
              {d.label}
            </button>
          ))}
        </div>
        <label className="mt-3 block">
          <span className="sr-only">Reason</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            maxLength={4000}
            rows={3}
            placeholder="Reason for the decision (visible to your team)"
            className="w-full resize-y rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-cyan-400 focus:outline-none"
          />
        </label>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <p className={`text-[11px] ${message?.tone === "error" ? "text-rose-300" : message ? "text-emerald-300" : "text-slate-400"}`} role={message ? "status" : undefined}>
            {message
              ? message.text
              : decided?.decidedAt
                ? `Last saved ${new Date(decided.decidedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}`
                : "No decision recorded yet."}
          </p>
          <button
            type="button"
            onClick={save}
            disabled={!status || !dirty || saving || !debrief.candidateId}
            className="hv-solid-action inline-flex items-center gap-2 rounded-lg bg-cyan-600 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? <Spinner /> : null}
            {saving ? "Saving…" : "Save recommendation"}
          </button>
        </div>
      </div>
    </div>
  )
}
