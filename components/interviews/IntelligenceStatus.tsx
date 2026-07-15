type IntelligenceStatusProps = {
  transcriptPreview?: string | null
  transcriptReady?: boolean | null
  cognitiveAnalysisReady?: boolean | null
  hasRecording?: boolean
  compact?: boolean
}

function hasTranscript(transcriptPreview?: string | null) {
  const value = String(transcriptPreview ?? "").trim()
  return Boolean(value && !/^transcript not available yet$/i.test(value))
}

export default function IntelligenceStatus({
  transcriptPreview,
  transcriptReady: transcriptReadyOverride,
  cognitiveAnalysisReady: cognitiveAnalysisReadyOverride,
  hasRecording = true,
}: IntelligenceStatusProps) {
  const transcriptReady = transcriptReadyOverride ?? hasTranscript(transcriptPreview)
  const cognitiveAnalysisReady = cognitiveAnalysisReadyOverride ?? transcriptReady
  const statuses = [
    {
      label: transcriptReady ? "Transcript Ready" : "Transcript Processing",
      ready: transcriptReady,
      pendingText: "Transcript Processing",
    },
    {
      label: hasRecording ? "Evidence Timeline Available" : "Evidence Timeline Pending",
      ready: hasRecording,
      pendingText: "Timeline waits for replay evidence",
    },
    {
      label: "Behavioral Analysis Complete",
      ready: true,
      pendingText: "",
    },
    {
      label: cognitiveAnalysisReady ? "VERIS Analysis Complete" : "VERIS Analysis Pending",
      ready: cognitiveAnalysisReady,
      pendingText: "Insights unlock after transcript processing",
    },
  ]

  return (
    <div className="rounded-2xl border border-slate-800/90 bg-slate-950/35 p-3">
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <p className="min-w-0 break-words text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">Analysis Pipeline</p>
        <span className="hv-ai-node h-1.5 w-1.5 rounded-full bg-cyan-300/80" />
      </div>
      <div className="grid gap-1.5">
        {statuses.map((status) => (
          <div key={status.label} className="flex min-w-0 items-start gap-2 rounded-xl border border-white/[0.04] bg-slate-950/20 px-2.5 py-2">
            <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[9px] ${
              status.ready
                ? "border-emerald-400/25 bg-emerald-500/10 text-emerald-200"
                : "hv-ai-node border-amber-400/25 bg-amber-500/10 text-amber-200"
            }`}>
              {status.ready ? "OK" : "..."}
            </span>
            <span className="min-w-0">
              <span className={`block line-clamp-2 min-w-0 break-words text-xs leading-4 ${status.ready ? "text-slate-200" : "text-amber-100"}`}>{status.label}</span>
              {!status.ready && status.pendingText ? <span className="mt-0.5 block line-clamp-2 min-w-0 break-words text-[11px] leading-4 text-slate-500">{status.pendingText}</span> : null}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
