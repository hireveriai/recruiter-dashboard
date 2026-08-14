"use client"

import { useEffect, useState } from "react"
import { Mail, Sparkles } from "lucide-react"

import { buildAuthUrl } from "@/lib/client/auth-query"

export function CandidateFeedbackModal({ interview, searchParams, onClose, onSent }) {
  const [text, setText] = useState("")
  const [isGenerating, setIsGenerating] = useState(false)
  const [isSending, setIsSending] = useState(false)
  const [error, setError] = useState("")
  const [sentAt, setSentAt] = useState(null)

  const isOpen = Boolean(interview)

  useEffect(() => {
    if (!interview) {
      setText("")
      setError("")
      setSentAt(null)
      return
    }

    setSentAt(interview.candidateFeedbackSentAt || null)

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

    if (!window.confirm(`Send this feedback to ${interview.candidateName || "the candidate"}${interview.candidateEmail ? ` (${interview.candidateEmail})` : ""}?`)) {
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
          body: JSON.stringify({ text }),
        }
      )
      const data = await response.json()
      if (!response.ok || !data.success) {
        throw new Error(data?.error?.message || "Failed to send candidate feedback")
      }
      setSentAt(data.data.sentAt)
      onSent?.(interview, { text, sentAt: data.data.sentAt, sentTo: data.data.sentTo })
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
        <div className="relative overflow-hidden rounded-[28px] border border-emerald-400/20 bg-[radial-gradient(circle_at_top,_rgba(16,185,129,0.13),_transparent_34%),linear-gradient(180deg,rgba(15,23,42,0.98),rgba(9,14,28,0.98))] shadow-[0_0_80px_rgba(16,185,129,0.12)]">
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
              scores, risk flags, or a hiring decision. Review and edit before sending.
            </p>

            {interview?.candidateEmail ? (
              <div className="mb-4 flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/40 px-4 py-2.5 text-sm text-slate-300">
                <Mail className="h-4 w-4 shrink-0 text-cyan-300" aria-hidden="true" />
                Will be sent to <span className="font-semibold text-white">{interview.candidateEmail}</span>
              </div>
            ) : (
              <div className="mb-4 rounded-xl border border-rose-400/25 bg-rose-500/10 px-4 py-2.5 text-sm text-rose-100">
                No email is on file for this candidate -- feedback cannot be sent until one is added.
              </div>
            )}

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
                disabled={isGenerating || isSending || !text.trim() || !interview?.candidateEmail}
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
