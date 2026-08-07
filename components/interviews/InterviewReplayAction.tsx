"use client"

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
  const className = compact
    ? "hv-preserve-dark group/replay inline-flex w-full min-w-0 items-center gap-3 rounded-2xl border border-cyan-300/30 bg-[linear-gradient(135deg,rgba(8,145,178,0.45),rgba(3,105,161,0.55))] px-4 py-3 text-left text-white shadow-[0_0_28px_rgba(34,211,238,0.1)] transition duration-200 hover:border-cyan-200/45 hover:bg-cyan-500/25 hover:shadow-[0_0_34px_rgba(34,211,238,0.16)] focus:outline-none focus:ring-2 focus:ring-cyan-300/35"
    : "hv-preserve-dark group/replay inline-flex w-full min-w-0 items-center gap-4 rounded-2xl border border-cyan-300/30 bg-[linear-gradient(135deg,rgba(8,145,178,0.45),rgba(3,105,161,0.55))] px-4 py-4 text-left text-white shadow-[0_0_34px_rgba(34,211,238,0.12)] transition duration-200 hover:-translate-y-0.5 hover:border-cyan-200/50 hover:shadow-[0_0_42px_rgba(34,211,238,0.18)] focus:outline-none focus:ring-2 focus:ring-cyan-300/35"

  if (!href) {
    return (
      <span
        className={`${className} cursor-not-allowed opacity-55`}
        aria-label={`Interview replay unavailable for ${candidateName}`}
        title="Recording evidence is not available for this interview"
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-700 bg-slate-900/80 text-slate-500">▶</span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold">{disabledLabel}</span>
          <span className="mt-1 block truncate text-xs text-slate-400">Recording file is not available</span>
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
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/25 bg-white/15 text-white transition group-hover/replay:bg-white/20">▶</span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold">Open Interview Replay</span>
        <span
          className="mt-1 hidden truncate text-xs text-white/75 sm:block"
          title="Replay video, transcript, and timeline signals"
        >
          Replay video, transcript, and timeline signals
        </span>
      </span>
    </a>
  )
}
