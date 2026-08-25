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
    ? "hv-preserve-dark group/replay inline-flex w-full min-w-0 items-center gap-3 rounded-2xl border border-blue-300/30 bg-[linear-gradient(135deg,rgba(29,78,216,0.55),rgba(12,74,110,0.6))] px-4 py-3 text-left text-white shadow-[0_0_28px_rgba(59,130,246,0.12)] transition duration-200 hover:border-blue-200/45 hover:bg-blue-500/25 hover:shadow-[0_0_34px_rgba(59,130,246,0.18)] focus:outline-none focus:ring-2 focus:ring-blue-300/35"
    : "hv-preserve-dark group/replay inline-flex w-full min-w-0 items-center gap-4 rounded-2xl border border-blue-300/30 bg-[linear-gradient(135deg,rgba(29,78,216,0.55),rgba(12,74,110,0.6))] px-4 py-4 text-left text-white shadow-[0_0_34px_rgba(59,130,246,0.14)] transition duration-200 hover:-translate-y-0.5 hover:border-blue-200/50 hover:shadow-[0_0_42px_rgba(59,130,246,0.2)] focus:outline-none focus:ring-2 focus:ring-blue-300/35"

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
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-sky-200/40 bg-[linear-gradient(150deg,rgba(191,219,254,0.4),rgba(96,165,250,0.18))] text-white shadow-[0_2px_6px_rgba(3,50,75,0.35),inset_0_1px_0_rgba(255,255,255,0.35)] transition duration-200 group-hover/replay:border-sky-100/55 group-hover/replay:bg-[linear-gradient(150deg,rgba(191,219,254,0.5),rgba(96,165,250,0.24))]">
        <span className="ml-0.5 drop-shadow-[0_1px_1px_rgba(3,50,75,0.4)]">▶</span>
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold text-white drop-shadow-[0_1px_2px_rgba(3,50,75,0.35)]">Open Interview Replay</span>
        <span
          className="mt-1 hidden truncate text-xs text-white/80 sm:block"
          title="Replay video, transcript, and timeline signals"
        >
          Replay video, transcript, and timeline signals
        </span>
      </span>
    </a>
  )
}
