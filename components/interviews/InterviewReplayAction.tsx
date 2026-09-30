"use client"

import { ArrowRight, Play } from "lucide-react"

type InterviewReplayActionProps = {
  href: string
  candidateName?: string
  disabledLabel?: string
  compact?: boolean
}

export default function InterviewReplayAction({
  href,
  candidateName = "candidate",
  disabledLabel = "Replay Evidence Pending",
  compact = false,
}: InterviewReplayActionProps) {
  // Solid brand gradient (cyan-600 -> blue-600): a translucent fill washed
  // out to lavender on the light theme. Laid out like WarRoomAction (icon,
  // text, arrow) so the two actions read as a pair.
  const className = `hv-preserve-dark group/replay relative inline-flex w-full min-w-0 transform-gpu items-center justify-between gap-3 overflow-hidden rounded-2xl border border-cyan-300/30 bg-[linear-gradient(135deg,#0891b2,#2563eb)] text-left text-white shadow-[0_10px_28px_rgba(37,99,235,0.28)] transition-all duration-200 hover:-translate-y-px hover:shadow-[0_16px_36px_rgba(37,99,235,0.36)] hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-cyan-300/50 ${compact ? "px-4 py-3" : "px-4 py-3.5"}`

  if (!href) {
    return (
      <span
        className={`${className} cursor-not-allowed opacity-50 saturate-50 hover:translate-y-0 hover:brightness-100`}
        aria-label={`Interview replay unavailable for ${candidateName}`}
        title="Recording evidence is not available for this interview"
      >
        <span className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/15 text-white">
            <Play className="h-4 w-4" strokeWidth={2} />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold">{disabledLabel}</span>
            <span className="mt-1 block truncate text-xs text-white/75">Recording file is not available</span>
          </span>
        </span>
      </span>
    )
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={className}
      aria-label={`Open interview replay for ${candidateName}`}
    >
      <span className="pointer-events-none absolute inset-x-4 top-0 h-px bg-gradient-to-r from-transparent via-white/60 to-transparent" />
      <span className="relative z-10 flex min-w-0 items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/20 text-white ring-1 ring-white/25 transition group-hover/replay:bg-white/25">
          <Play className="ml-0.5 h-4 w-4 fill-current" strokeWidth={2} />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-white">Open Interview Replay</span>
          <span className="mt-1 hidden truncate text-xs text-white/80 sm:block" title="Replay video, transcript, and timeline signals">
            Replay video, transcript, and timeline signals
          </span>
        </span>
      </span>
      <span className="relative z-10 shrink-0 text-white transition group-hover/replay:translate-x-0.5">
        <ArrowRight className="h-4 w-4" strokeWidth={1.8} />
      </span>
    </a>
  )
}
