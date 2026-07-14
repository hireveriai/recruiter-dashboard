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
    detail: "Preparing recruiter intelligence and secure workspace context.",
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

const wavePaths = [
  { path: "M 325 325 C 242 250 146 198 50 216", end: [50, 216], color: "#22d3ee" },
  { path: "M 325 325 C 230 306 128 300 52 300", end: [52, 300], color: "#38bdf8" },
  { path: "M 325 325 C 226 374 130 406 50 390", end: [50, 390], color: "#60a5fa" },
  { path: "M 325 325 C 394 190 478 100 598 92", end: [598, 92], color: "#22d3ee" },
  { path: "M 325 325 C 424 286 512 276 602 280", end: [602, 280], color: "#3b82f6" },
  { path: "M 325 325 C 430 384 518 448 596 506", end: [596, 506], color: "#60a5fa" },
]

export default function VerisGlobeLoader({
  eyebrow = "VERIS Screening",
  steps = defaultSteps,
  activeIndex = 0,
  fullscreen = true,
  viewportOffset = "none",
}: VerisGlobeLoaderProps) {
  const safeSteps = steps.length > 0 ? steps : defaultSteps
  const safeIndex = Math.min(Math.max(activeIndex, 0), safeSteps.length - 1)
  const activeStep = safeSteps[safeIndex] ?? safeSteps[0]
  const progress = Math.round(((safeIndex + 1) / safeSteps.length) * 100)
  const titleLength = activeStep.label.length
  const titleSizeClass =
    titleLength > 24
      ? "text-base sm:text-lg lg:text-xl"
      : titleLength > 16
        ? "text-lg sm:text-xl lg:text-[22px]"
        : "text-xl sm:text-[22px] lg:text-[24px]"
  const rootStyle = {
    "--hv-loader-viewport-offset": viewportOffset === "navbar" ? "88px" : "0px",
  } as CSSProperties

  return (
    <div
      aria-busy="true"
      aria-live="polite"
      className={[
        "relative flex items-center justify-center overflow-hidden bg-[#08111f] px-4 py-8 text-white",
        fullscreen ? "min-h-[calc(100svh-var(--hv-loader-viewport-offset))]" : "min-h-[560px] rounded-[28px] border border-slate-800",
      ].join(" ")}
      role="status"
      style={rootStyle}
    >
      <div aria-hidden="true" className="absolute inset-0 bg-[radial-gradient(circle_at_50%_42%,rgba(34,211,238,0.14),transparent_31%),radial-gradient(circle_at_50%_50%,rgba(59,130,246,0.10),transparent_48%),linear-gradient(180deg,#08111f,#0b1322)]" />
      <div aria-hidden="true" className="hv-veris-loader-grid absolute inset-0 opacity-25" />

      <div className="relative flex h-full w-full max-w-6xl items-center justify-center animate-[overlay-panel-in_220ms_ease-out_forwards]">
        <div className="relative flex h-[min(92vw,calc(100svh-var(--hv-loader-viewport-offset)-190px),680px)] min-h-[430px] w-[min(92vw,calc(100svh-var(--hv-loader-viewport-offset)-190px),680px)] min-w-[430px] items-center justify-center max-[520px]:h-[92vw] max-[520px]:min-h-0 max-[520px]:w-[92vw] max-[520px]:min-w-0">
          <div className="hv-veris-loader-ring absolute inset-0 rounded-full border border-cyan-300/10" />
          <div className="hv-veris-loader-ring-reverse absolute inset-[8%] rounded-full border border-dashed border-sky-400/24" />
          <div className="absolute inset-[16%] rounded-full border border-blue-400/14" />
          <div className="absolute inset-[24%] rounded-full border border-cyan-300/14" />

          <svg
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
            viewBox="0 0 650 650"
          >
            {wavePaths.map((wave, index) => {
              const isComplete = index < safeIndex
              const isActive = index === safeIndex

              return (
                <g key={wave.path} className="hv-veris-wave">
                  <path
                    d={wave.path}
                    fill="none"
                    stroke={wave.color}
                    strokeDasharray="6 10"
                    strokeLinecap="round"
                    strokeOpacity={isActive || isComplete ? 0.62 : 0.24}
                    strokeWidth={isActive ? 1.8 : 1.2}
                  />
                  <circle
                    r={isActive ? 5 : 3.5}
                    fill={isActive || isComplete ? wave.color : "#164e63"}
                    opacity={isActive || isComplete ? 1 : 0.52}
                    className="hv-veris-wave-dot"
                    style={{ animationDelay: `${index * 280}ms` }}
                  >
                    <animateMotion dur="2.8s" repeatCount="indefinite" path={wave.path} />
                  </circle>
                  <circle
                    cx={wave.end[0]}
                    cy={wave.end[1]}
                    r="8"
                    fill="rgba(8, 17, 31, 0.94)"
                    stroke={wave.color}
                    strokeOpacity={isActive || isComplete ? 0.75 : 0.38}
                    strokeWidth="1.4"
                  />
                  <circle
                    cx={wave.end[0]}
                    cy={wave.end[1]}
                    r="3"
                    fill={isActive || isComplete ? wave.color : "#2563eb"}
                    opacity={isActive || isComplete ? 1 : 0.55}
                    className={isActive ? "hv-veris-end-dot" : ""}
                  />
                </g>
              )
            })}
          </svg>

          <div
            className="absolute inset-[13%] rounded-full p-[2px] shadow-[0_0_110px_rgba(34,211,238,0.20)] transition-[background] duration-500 sm:inset-[19%] lg:inset-[22%]"
            style={{
              background: `conic-gradient(from 225deg, rgba(34,211,238,0.95) 0deg, rgba(59,130,246,0.95) ${progress * 3.6}deg, rgba(255,255,255,0.08) ${progress * 3.6}deg, rgba(255,255,255,0.08) 360deg)`,
            }}
          >
            <div className="relative h-full w-full rounded-full border border-cyan-300/20 bg-[#0b1220]/96 px-5 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.08),inset_0_-30px_80px_rgba(34,211,238,0.07)] sm:px-8">
              <div className="absolute inset-0 overflow-hidden rounded-full">
                <div className="absolute inset-0 rounded-full bg-[radial-gradient(circle_at_50%_18%,rgba(255,255,255,0.07),transparent_32%),linear-gradient(180deg,rgba(255,255,255,0.035),transparent_52%)]" />
              </div>
              <div aria-hidden="true" className="hv-veris-loader-scan absolute inset-x-7 top-0 h-px bg-gradient-to-r from-transparent via-cyan-200/80 to-transparent" />
              <div aria-hidden="true" className="absolute inset-x-10 top-1/2 h-px bg-cyan-300/10" />

              <div className="absolute inset-0 z-10 text-center">
                <p className="absolute left-1/2 top-[16%] max-w-[76%] -translate-x-1/2 text-center text-[8px] font-semibold uppercase leading-4 tracking-[0.08em] text-cyan-200/75 sm:text-[9px] sm:tracking-[0.14em] lg:text-[10px]">
                  {eyebrow}
                </p>
                <h2
                  className={[
                    "absolute left-1/2 top-[31%] max-w-[90%] -translate-x-1/2 whitespace-nowrap font-semibold leading-[1.16] tracking-tight text-white",
                    titleSizeClass,
                  ].join(" ")}
                >
                  {activeStep.label}
                </h2>
                <p
                  className="absolute left-1/2 top-[57%] max-w-[80%] -translate-x-1/2 text-[10px] leading-4 text-slate-400 sm:text-[11px] sm:leading-5 lg:text-xs"
                  style={{
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                    overflowWrap: "anywhere",
                  }}
                >
                  {activeStep.detail}
                </p>

              </div>

            </div>
          </div>

          <div className="absolute bottom-[11%] left-1/2 z-10 flex w-[42%] -translate-x-1/2 flex-wrap justify-center gap-1.5 rounded-full border border-cyan-300/12 bg-[#08111f]/68 px-3 py-2 backdrop-blur-sm sm:gap-2">
            {safeSteps.map((step, index) => {
              const isComplete = index < safeIndex
              const isActive = index === safeIndex

              return (
                <span
                  key={`${step.label}-${index}`}
                  aria-label={step.label}
                  className={[
                    "h-1.5 w-1.5 rounded-full border transition duration-300 sm:h-2 sm:w-2",
                    isActive
                      ? "border-cyan-200 bg-cyan-300 shadow-[0_0_16px_rgba(34,211,238,0.95)]"
                      : isComplete
                        ? "border-emerald-200 bg-emerald-300"
                        : "border-slate-600 bg-slate-800",
                  ].join(" ")}
                />
              )
            })}
          </div>
          <p className="absolute bottom-[4.5%] left-1/2 z-10 -translate-x-1/2 text-[8px] uppercase tracking-[0.18em] text-slate-500 sm:text-[9px]">
            {safeIndex + 1} / {safeSteps.length}
          </p>

          <div aria-hidden="true" className="absolute inset-[35%] rounded-full border border-cyan-300/10 hv-veris-loader-core" />
          <div className="absolute bottom-[8%] left-1/2 h-px w-[36%] -translate-x-1/2 bg-gradient-to-r from-transparent via-cyan-300/24 to-transparent" />
        </div>
      </div>
    </div>
  )
}

