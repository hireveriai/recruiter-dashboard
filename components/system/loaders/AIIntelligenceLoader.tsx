import CognitiveStreamLoader from "./CognitiveStreamLoader"
import ForensicScanLoader from "./ForensicScanLoader"

type AIIntelligenceLoaderProps = {
  title: string
  steps: string[]
  variant?: "dashboard" | "candidates" | "veris" | "interviews" | "reports" | "default"
  compact?: boolean
  fullscreen?: boolean
}

const variantCopy: Record<NonNullable<AIIntelligenceLoaderProps["variant"]>, string> = {
  dashboard: "Synchronizing hiring intelligence",
  candidates: "Loading candidate cognition matrix",
  veris: "Correlating resume and interview evidence",
  interviews: "Building behavioral timeline",
  reports: "Preparing recruiter intelligence analytics",
  default: "Initializing Candidate Intelligence",
}

export default function AIIntelligenceLoader({
  title,
  steps,
  variant = "default",
  compact = false,
  fullscreen = false,
}: AIIntelligenceLoaderProps) {
  return (
    <section
      className={`hv-ai-panel rounded-[28px] border border-cyan-400/15 text-white shadow-[0_24px_90px_rgba(2,6,23,0.44),0_0_70px_rgba(34,211,238,0.07)] ${
        fullscreen ? "min-h-[58vh] p-8" : compact ? "p-5" : "p-7 sm:p-8"
      }`}
      role="status"
      aria-live="polite"
      aria-label={`${title} loading`}
    >
      <div className={`relative z-10 grid min-w-0 gap-6 ${compact ? "" : "xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.72fr)] xl:items-center"}`}>
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.34em] text-cyan-300/75">{title}</p>
          <h1 className="mt-4 max-w-3xl text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            {variantCopy[variant]}
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-300">
            Preparing recruiter telemetry, workflow signals, and competency evidence.
          </p>
          <div className="mt-6 flex max-w-xl items-center gap-2">
            {[0, 1, 2, 3].map((bar) => (
              <span
                key={bar}
                className="hv-ai-stream h-1.5 flex-1 rounded-full bg-gradient-to-r from-cyan-300/50 via-blue-400/30 to-transparent"
                style={{ animationDelay: `${bar * 170}ms` }}
              />
            ))}
          </div>
        </div>

        <div className="grid min-w-0 gap-4">
          <CognitiveStreamLoader steps={steps} compact={compact} />
          {!compact ? <ForensicScanLoader /> : null}
        </div>
      </div>
    </section>
  )
}
