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
    ? "group/replay inline-flex w-full min-w-0 items-center gap-3 rounded-2xl border border-cyan-300/20 bg-[linear-gradient(135deg,rgba(8,47,73,0.55),rgba(15,23,42,0.8))] px-4 py-3 text-left text-cyan-50 shadow-[0_0_28px_rgba(34,211,238,0.06)] transition duration-200 hover:border-cyan-200/35 hover:bg-cyan-500/10 hover:shadow-[0_0_34px_rgba(34,211,238,0.1)] focus:outline-none focus:ring-2 focus:ring-cyan-300/35"
    : "group/replay inline-flex w-full min-w-0 items-center gap-4 rounded-2xl border border-cyan-300/20 bg-[linear-gradient(135deg,rgba(8,47,73,0.55),rgba(15,23,42,0.8))] px-4 py-4 text-left text-cyan-50 shadow-[0_0_34px_rgba(34,211,238,0.08)] transition duration-200 hover:-translate-y-0.5 hover:border-cyan-200/40 hover:shadow-[0_0_42px_rgba(34,211,238,0.12)] focus:outline-none focus:ring-2 focus:ring-cyan-300/35"

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
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-cyan-200/15 bg-cyan-300/10 text-cyan-100 transition group-hover/replay:bg-cyan-300/15">▶</span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold">Open Interview Replay</span>
        <span className="mt-1 hidden truncate text-xs text-cyan-100/70 sm:block">Replay video, transcript, and timeline signals</span>
      </span>
    </a>
  )
}
