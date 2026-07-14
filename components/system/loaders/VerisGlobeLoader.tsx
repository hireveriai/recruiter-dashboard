import type { CSSProperties } from "react"

type VerisGlobeStep = {
  label: string
  detail: string
}

type VerisGlobeLoaderProps = {
  eyebrow?: string
  steps?: VerisGlobeStep[]
  activeIndex?: number
  fullscreen?: boolean
  viewportOffset?: "none" | "navbar"
}

const defaultSteps: VerisGlobeStep[] = [
  {
    label: "Loading workspace",
    detail: "Preparing recruiter data and secure workspace context.",
  },
  {
    label: "Syncing records",
    detail: "Loading the latest candidates, interviews, and hiring signals.",
  },
  {
    label: "Building view",
    detail: "Organizing the data into the recruiter screen.",
  },
  {
    label: "Results ready",
    detail: "The workspace is ready for review.",
  },
]

export default function VerisGlobeLoader({
  eyebrow = "HireVeri",
  steps = defaultSteps,
  activeIndex = 0,
  fullscreen = true,
  viewportOffset = "none",
}: VerisGlobeLoaderProps) {
  const safeSteps = steps.length > 0 ? steps : defaultSteps
  const safeIndex = Math.min(Math.max(activeIndex, 0), safeSteps.length - 1)
  const activeStep = safeSteps[safeIndex] ?? safeSteps[0]
  const progress = Math.round(((safeIndex + 1) / safeSteps.length) * 100)
  const rootStyle = {
    "--hv-loader-viewport-offset": viewportOffset === "navbar" ? "88px" : "0px",
  } as CSSProperties

  return (
    <div
      aria-busy="true"
      aria-live="polite"
      className={[
        "relative flex items-center justify-center bg-slate-950 px-4 py-8 text-white",
        fullscreen ? "min-h-[calc(100svh-var(--hv-loader-viewport-offset))]" : "min-h-[420px] rounded-2xl border border-slate-800",
      ].join(" ")}
      role="status"
      style={rootStyle}
    >
      <div className="w-full max-w-xl rounded-2xl border border-slate-800 bg-slate-900/80 p-6 shadow-[0_24px_70px_rgba(2,6,23,0.28)] backdrop-blur sm:p-8">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">{eyebrow}</p>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-white">{activeStep.label}</h2>
            <p className="mt-2 text-sm leading-6 text-slate-400">{activeStep.detail}</p>
          </div>
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-slate-700 bg-slate-950 text-sm font-semibold text-sky-200">
            {progress}%
          </div>
        </div>

        <div className="mt-7">
          <div className="h-2 overflow-hidden rounded-full bg-slate-800">
            <div
              className="h-full rounded-full bg-sky-400 transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>

          <ol className="mt-6 grid gap-3">
            {safeSteps.map((step, index) => {
              const isComplete = index < safeIndex
              const isActive = index === safeIndex

              return (
                <li key={`${step.label}-${index}`} className="flex items-start gap-3">
                  <span
                    className={[
                      "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold",
                      isActive
                        ? "border-sky-300 bg-sky-400/15 text-sky-100"
                        : isComplete
                          ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-200"
                          : "border-slate-700 bg-slate-950 text-slate-500",
                    ].join(" ")}
                  >
                    {isComplete ? "✓" : index + 1}
                  </span>
                  <div className="min-w-0">
                    <p className={["text-sm font-semibold", isActive ? "text-white" : "text-slate-300"].join(" ")}>
                      {step.label}
                    </p>
                    <p className="mt-0.5 text-xs leading-5 text-slate-500">{step.detail}</p>
                  </div>
                </li>
              )
            })}
          </ol>
        </div>
      </div>
    </div>
  )
}
