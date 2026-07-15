type CognitiveStreamLoaderProps = {
  steps: string[]
  compact?: boolean
}

export default function CognitiveStreamLoader({ steps, compact = false }: CognitiveStreamLoaderProps) {
  const visibleSteps = compact ? steps.slice(0, 4) : steps

  return (
    <div className="relative z-10 space-y-2" aria-label="Interview intelligence progress">
      <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-cyan-300/15 bg-cyan-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-100">
        <span className="hv-ai-node h-1.5 w-1.5 rounded-full bg-cyan-300" />
        Interview Intelligence Active
      </div>
      {visibleSteps.map((step, index) => {
        const complete = index < 2
        const active = index === 2

        return (
          <div
            key={step}
            className="flex min-w-0 items-center gap-3 rounded-xl border border-slate-800/80 bg-slate-950/35 px-3 py-2"
            style={{ animationDelay: `${index * 180}ms` }}
          >
            <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px] ${
              complete
                ? "border-emerald-400/25 bg-emerald-500/10 text-emerald-200"
                : active
                  ? "hv-ai-node border-cyan-400/30 bg-cyan-500/10 text-cyan-100"
                  : "border-slate-700 bg-slate-900/80 text-slate-500"
            }`}>
              {complete ? "✓" : "⋯"}
            </span>
            <span className={`truncate text-sm ${complete ? "text-slate-300" : active ? "text-cyan-100" : "text-slate-500"}`}>
              {step}
            </span>
          </div>
        )
      })}
    </div>
  )
}
