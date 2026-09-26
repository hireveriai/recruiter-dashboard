"use client"
import { formatLabel } from "@/lib/client/format-label"

export type TimelineStep = {
  label: string
  status: "pending" | "active" | "completed" | "error"
}

type ProcessingTimelineProps = {
  steps: TimelineStep[]
  errorLabel?: string
  onRetry?: () => void
}

function getStatusTone(status: TimelineStep["status"]) {
  if (status === "completed") {
    return {
      dot: "border-green-400 bg-green-500",
      text: "text-green-200",
      line: "border-green-500/30",
    }
  }

  if (status === "active") {
    return {
      dot: "border-blue-300 bg-blue-500 shadow-[0_0_0_4px_rgba(59,130,246,0.16)]",
      text: "text-blue-100",
      line: "border-blue-500/30",
    }
  }

  if (status === "error") {
    return {
      dot: "border-rose-300 bg-rose-500",
      text: "text-rose-200",
      line: "border-rose-500/30",
    }
  }

  return {
    dot: "border-gray-600 bg-gray-700",
    text: "text-gray-400",
    line: "border-gray-700",
  }
}

export function ProcessingTimeline({ steps, errorLabel, onRetry }: ProcessingTimelineProps) {
  return (
    <aside className="rounded-2xl border border-slate-800 bg-slate-950/25 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-white">Processing Timeline</h3>
          <p className="mt-1 text-xs text-slate-500">Live status for this screening run</p>
        </div>
        {errorLabel && onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold text-rose-100 transition hover:border-rose-300/50"
          >
            Retry
          </button>
        ) : null}
      </div>

      <ol className="mt-5 flex flex-col gap-3 border-l border-gray-700 pl-4">
        {steps.map((step) => {
          const tone = getStatusTone(step.status)

          return (
            <li key={step.label} className="relative">
              <span className={`absolute -left-[23px] top-0.5 h-3 w-3 rounded-full border ${tone.dot}`} />
              <div className={`border-l pl-3 ${tone.line}`}>
                <p className={`text-sm font-medium ${tone.text}`}>{step.label}</p>
                <p className="mt-0.5 text-xs text-slate-600">{formatLabel(step.status)}</p>
              </div>
            </li>
          )
        })}
      </ol>

      {errorLabel ? (
        <p className="mt-4 rounded-lg border border-rose-400/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">
          {errorLabel}
        </p>
      ) : null}
    </aside>
  )
}
