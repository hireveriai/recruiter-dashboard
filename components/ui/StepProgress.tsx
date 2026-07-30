"use client"

export type StepProgressKey = "UPLOAD" | "JD_READY" | "JD_PROCESSED" | "MATCH_READY" | "MATCHED"

type StepProgressProps = {
  currentStep: StepProgressKey
}

const steps = [
  { key: "UPLOAD", label: "Start VERIS Screening" },
  { key: "JD_PROCESSED", label: "Analyze Job" },
  { key: "MATCHED", label: "Run Matching" },
] as const

function getActiveIndex(currentStep: StepProgressKey) {
  if (currentStep === "MATCHED") {
    return 2
  }

  if (currentStep === "JD_READY" || currentStep === "JD_PROCESSED" || currentStep === "MATCH_READY") {
    return 1
  }

  return 0
}

export function StepProgress({ currentStep }: StepProgressProps) {
  const activeIndex = getActiveIndex(currentStep)

  return (
    <nav
      aria-label="VERIS screening progress"
      className="hv-step-progress rounded-2xl border border-slate-800 bg-[#0f172a] px-5 py-5"
    >
      <ol className="flex items-start">
        {steps.map((step, index) => {
          const completed = index < activeIndex
          const active = index === activeIndex
          const state = completed ? "completed" : active ? "active" : "upcoming"
          const circleClass = completed
            ? "bg-green-500 text-white"
            : active
              ? "bg-blue-500 text-white"
              : "bg-gray-700 text-gray-300"
          const lineClass = index < activeIndex ? "bg-green-500" : "bg-gray-700"

          return (
            <li key={step.key} className="flex flex-1 items-start last:flex-none">
              <div className="flex min-w-0 flex-col items-center gap-2">
                <span
                  className={[
                    "hv-step-progress-circle flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold transition",
                    circleClass,
                  ].join(" ")}
                  data-state={state}
                  aria-current={active ? "step" : undefined}
                >
                  {index + 1}
                </span>
                <span
                  className={`hv-step-progress-label text-center text-xs font-medium ${active ? "text-blue-100" : completed ? "text-green-200" : "text-gray-400"}`}
                  data-state={state}
                >
                  {step.label}
                </span>
              </div>
              {index < steps.length - 1 ? (
                <div className="hv-step-progress-track mx-3 mt-4 h-0.5 min-w-8 flex-1 rounded-full bg-gray-700">
                  <div
                    className={`hv-step-progress-line h-full rounded-full transition ${lineClass}`}
                    data-state={index < activeIndex ? "completed" : "upcoming"}
                  />
                </div>
              ) : null}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
