"use client"

import { useEffect, useState } from "react"
import { Mail, Sparkles } from "lucide-react"

import { buildAuthUrl } from "@/lib/client/auth-query"

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const HIRING_DECISION_OPTIONS = [
  { value: "SHORTLISTED", label: "Shortlisted" },
  { value: "REJECTED", label: "Rejected" },
  { value: "UNDISCLOSED", label: "Prefer not to disclose" },
]

function parseCcInput(value) {
  return value
    .split(/[,\n]/)
    .map((email) => email.trim())
    .filter(Boolean)
}

export function CandidateFeedbackModal({ interview, searchParams, onClose, onSent }) {
  const [text, setText] = useState("")
  const [toEmail, setToEmail] = useState("")
  const [ccInput, setCcInput] = useState("")
  const [hiringDecision, setHiringDecision] = useState("UNDISCLOSED")
  const [includeSignature, setIncludeSignature] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [isSending, setIsSending] = useState(false)
  const [error, setError] = useState("")
  const [sentAt, setSentAt] = useState(null)

  const isOpen = Boolean(interview)

  useEffect(() => {
    if (!interview) {
      setText("")
      setToEmail("")
      setCcInput("")
      setHiringDecision("UNDISCLOSED")
      setIncludeSignature(false)
      setError("")
      setSentAt(null)
      return
    }

    setSentAt(interview.candidateFeedbackSentAt || null)
    setToEmail(interview.candidateEmail || "")
    setCcInput("")
    setHiringDecision(interview.candidateFeedbackHiringDecision || "UNDISCLOSED")

    if (interview.candidateFeedbackText) {
      setText(interview.candidateFeedbackText)
      return
    }

    generateFeedback(interview)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interview?.interviewId])

  async function generateFeedback(target) {
    const source = target || interview
    if (!source) return

    setIsGenerating(true)
    setError("")
    try {
      const response = await fetch(
        buildAuthUrl(`/api/interview/${source.interviewId}/candidate-feedback`, searchParams),
        { method: "POST", credentials: "include" }
      )
      const data = await response.json()
      if (!response.ok || !data.success) {
        throw new Error(data?.error?.message || "Failed to generate candidate feedback")
      }
      setText(data.data.text)
    } catch (generateError) {
      setError(generateError instanceof Error ? generateError.message : "Failed to generate candidate feedback")
    } finally {
      setIsGenerating(false)
    }
  }

  async function handleSend() {
    if (!interview || !text.trim()) return

    const trimmedTo = toEmail.trim()
    if (!trimmedTo || !EMAIL_PATTERN.test(trimmedTo)) {
      setError("Enter a valid recipient email before sending.")
      return
    }

    const ccList = parseCcInput(ccInput)
    const invalidCc = ccList.find((email) => !EMAIL_PATTERN.test(email))
    if (invalidCc) {
      setError(`"${invalidCc}" is not a valid email address.`)
      return
    }

    const recipientSummary = [trimmedTo, ...ccList].join(", ")
    const decisionLabel = HIRING_DECISION_OPTIONS.find((option) => option.value === hiringDecision)?.label
    const decisionNote =
      hiringDecision === "UNDISCLOSED" ? "" : ` The email will state the candidate is "${decisionLabel}".`
    if (!window.confirm(`Send this feedback to ${recipientSummary}?${decisionNote}`)) {
      return
    }

    setIsSending(true)
    setError("")
    try {
      const response = await fetch(
        buildAuthUrl(`/api/interview/${interview.interviewId}/candidate-feedback/send`, searchParams),
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, to: trimmedTo, cc: ccList, hiringDecision, includeSignature }),
        }
      )
      const data = await response.json()
      if (!response.ok || !data.success) {
        throw new Error(data?.error?.message || "Failed to send candidate feedback")
      }
      setSentAt(data.data.sentAt)
      onSent?.(interview, {
        text,
        sentAt: data.data.sentAt,
        sentTo: data.data.sentTo,
        hiringDecision: data.data.hiringDecision,
      })
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "Failed to send candidate feedback")
    } finally {
      setIsSending(false)
    }
  }

  if (!isOpen) return null

  return (
    <div
      className="hv-theme-dialog-backdrop fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/75 px-4 py-6 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={`Candidate feedback for ${interview?.candidateName || "candidate"}`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose?.()
      }}
    >
      <div className="my-auto w-full max-w-2xl">
        <div className="hv-theme-modal relative overflow-hidden rounded-[28px] border border-emerald-400/20 bg-[radial-gradient(circle_at_top,_rgba(16,185,129,0.13),_transparent_34%),linear-gradient(180deg,rgba(15,23,42,0.98),rgba(9,14,28,0.98))] shadow-[0_0_80px_rgba(16,185,129,0.12)]">
          <div className="flex flex-col gap-4 border-b border-white/10 px-6 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-8">
            <div>
              <h3 className="text-2xl font-semibold text-white">Candidate Feedback</h3>
              <p className="mt-2 text-sm text-slate-400">
                {interview?.candidateName || "Candidate"} · {interview?.jobTitle || "Role"}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="self-start rounded-full border border-emerald-400/25 bg-emerald-400/10 px-4 py-2 text-sm text-emerald-100 transition hover:bg-emerald-400/20 sm:self-auto"
            >
              Close
            </button>
          </div>

          <div className="px-6 py-6 sm:px-8">
            <p className="mb-4 text-sm leading-6 text-slate-400">
              This is a separate, candidate-friendly rewrite -- not the internal VERIS evaluation. It never includes
              scores or risk flags. Review and edit before sending.
            </p>

            <div className="mb-4 grid gap-2">
              <span className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Hiring Decision</span>
              <div className="flex flex-wrap gap-3">
                {HIRING_DECISION_OPTIONS.map((option) => (
                  <label
                    key={option.value}
                    className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3.5 py-2.5 text-sm transition ${
                      hiringDecision === option.value
                        ? "border-cyan-300/70 bg-cyan-300/10 text-white"
                        : "border-slate-700 bg-slate-900/60 text-slate-300 hover:border-slate-600"
                    }`}
                  >
                    <input
                      type="radio"
                      name="candidate-feedback-hiring-decision"
                      value={option.value}
                      checked={hiringDecision === option.value}
                      onChange={() => setHiringDecision(option.value)}
                      className="h-3.5 w-3.5 accent-cyan-300"
                    />
                    {option.label}
                  </label>
                ))}
              </div>
              <p className="text-xs text-slate-500">
                {hiringDecision === "UNDISCLOSED"
                  ? "No hiring decision will be included in the email."
                  : `The email will tell the candidate they were ${
                      hiringDecision === "SHORTLISTED" ? "shortlisted" : "not selected"
                    }.`}
              </p>
            </div>

            <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-slate-700 bg-slate-900/60 px-3.5 py-2.5">
              <div>
                <span className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Include Signature</span>
                <p className="mt-0.5 text-xs text-slate-500">
                  {includeSignature ? "Your organization's name will be added as a signature." : "No signature will be added."}
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={includeSignature}
                onClick={() => setIncludeSignature((current) => !current)}
                className={`inline-flex h-7 w-14 shrink-0 items-center rounded-full px-1 text-[10px] font-bold transition ${
                  includeSignature ? "justify-end bg-emerald-500 text-emerald-950" : "justify-start bg-slate-700 text-slate-300"
                }`}
              >
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white shadow">
                  {includeSignature ? "✓" : "✕"}
                </span>
              </button>
            </div>

            <div className="mb-4 grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <label htmlFor="candidate-feedback-to" className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                  <Mail className="h-3.5 w-3.5 text-cyan-300" aria-hidden="true" />
                  To
                </label>
                <input
                  id="candidate-feedback-to"
                  type="email"
                  value={toEmail}
                  onChange={(event) => setToEmail(event.target.value)}
                  placeholder="candidate@email.com"
                  className="h-11 rounded-xl border border-slate-700 bg-slate-900/80 px-3.5 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-cyan-300/70 focus:ring-2 focus:ring-cyan-300/10"
                />
              </div>
              <div className="grid gap-1.5">
                <label htmlFor="candidate-feedback-cc" className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                  CC (optional)
                </label>
                <input
                  id="candidate-feedback-cc"
                  type="text"
                  value={ccInput}
                  onChange={(event) => setCcInput(event.target.value)}
                  placeholder="you@company.com, teammate@company.com"
                  className="h-11 rounded-xl border border-slate-700 bg-slate-900/80 px-3.5 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-cyan-300/70 focus:ring-2 focus:ring-cyan-300/10"
                />
              </div>
            </div>
            {!interview?.candidateEmail ? (
              <p className="mb-4 -mt-2 text-xs text-amber-300/80">
                No email was on file for this candidate -- enter one above before sending.
              </p>
            ) : null}

            {sentAt ? (
              <div className="mb-4 rounded-xl border border-emerald-400/25 bg-emerald-400/10 px-4 py-2.5 text-sm text-emerald-100">
                Sent on {new Date(sentAt).toLocaleString()}. Sending again will deliver another email with the current text below.
              </div>
            ) : null}

            {error ? (
              <div className="mb-4 rounded-xl border border-rose-400/25 bg-rose-500/10 px-4 py-2.5 text-sm text-rose-100">{error}</div>
            ) : null}

            <textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              disabled={isGenerating}
              rows={12}
              placeholder={isGenerating ? "Generating feedback..." : "Feedback text"}
              className="w-full resize-y rounded-2xl border border-slate-700 bg-slate-900/80 px-4 py-3 text-sm leading-6 text-white outline-none transition placeholder:text-slate-600 focus:border-cyan-300/70 focus:ring-2 focus:ring-cyan-300/10"
            />

            <div className="mt-5 flex flex-col gap-3 border-t border-slate-800/90 pt-5 sm:flex-row sm:items-center sm:justify-between">
              <button
                type="button"
                onClick={() => generateFeedback(interview)}
                disabled={isGenerating || isSending}
                className="inline-flex items-center gap-2 self-start rounded-2xl border border-slate-700 bg-slate-900/60 px-4 py-2.5 text-sm font-semibold text-slate-200 transition hover:border-cyan-300/40 hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Sparkles className="h-4 w-4" aria-hidden="true" />
                {isGenerating ? "Generating..." : text ? "Regenerate" : "Generate"}
              </button>
              <button
                type="button"
                onClick={handleSend}
                disabled={isGenerating || isSending || !text.trim() || !toEmail.trim()}
                className="h-12 shrink-0 rounded-2xl bg-cyan-300 px-6 text-sm font-bold text-slate-950 shadow-[0_16px_42px_rgba(34,211,238,0.18)] transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSending ? "Sending..." : "Send to Candidate"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
