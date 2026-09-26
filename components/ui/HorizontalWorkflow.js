"use client";

// Compact horizontal rendering of the dashboard Hiring Workflow's visual
// language (components/HiringWorkflow.js): a VERIS recommendation with the
// next-step action on one row, then every step on a single line with a
// segmented progress bar -- completed steps checked, the current one glowing
// as "Now", the rest pending. Step descriptions show on hover so the strip
// stays short. Shared by the Assessments and VERIS Screening pages.

// Literal class strings so Tailwind picks them up.
const THEMES = {
  violet: {
    panel:
      "hv-theme-assessment-panel border-violet-300/15 bg-[radial-gradient(circle_at_top_left,rgba(139,92,246,0.12),transparent_38%),linear-gradient(135deg,rgba(15,23,42,0.95),rgba(2,6,23,0.84))]",
    iconBox: "border-violet-300/25 bg-violet-400/10 text-violet-100 shadow-[0_0_24px_rgba(139,92,246,0.16)]",
    iconDot: "bg-violet-300",
    eyebrow: "text-violet-200/80",
    chip: "border-violet-300/20 bg-violet-400/10 text-violet-100",
    border: "border-violet-400/35",
    text: "text-violet-200",
    indicator: "bg-violet-400",
    nodeActive: "bg-violet-400/15",
    card: "from-violet-500/15 via-fuchsia-500/5 to-transparent",
    segment: "bg-violet-400",
    flow: "via-white/70",
  },
  cyan: {
    panel:
      "hv-theme-intelligence-panel border-cyan-300/15 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.12),transparent_38%),linear-gradient(135deg,rgba(15,23,42,0.95),rgba(2,6,23,0.84))]",
    iconBox: "border-cyan-300/25 bg-cyan-400/10 text-cyan-100 shadow-[0_0_24px_rgba(34,211,238,0.16)]",
    iconDot: "bg-cyan-300",
    eyebrow: "text-cyan-200/80",
    chip: "border-cyan-300/20 bg-cyan-400/10 text-cyan-100",
    border: "border-cyan-400/35",
    text: "text-cyan-200",
    indicator: "bg-cyan-400",
    nodeActive: "bg-cyan-400/15",
    card: "from-cyan-500/15 via-sky-500/5 to-transparent",
    segment: "bg-cyan-400",
    flow: "via-white/70",
  },
};

const GRID_COLUMNS = {
  3: "lg:grid-cols-3",
  4: "lg:grid-cols-4",
  5: "lg:grid-cols-5",
};

function CheckIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function SparkIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2v4" />
      <path d="M12 18v4" />
      <path d="m4.93 4.93 2.83 2.83" />
      <path d="m16.24 16.24 2.83 2.83" />
      <path d="M2 12h4" />
      <path d="M18 12h4" />
      <path d="m4.93 19.07 2.83-2.83" />
      <path d="m16.24 7.76 2.83-2.83" />
      <circle cx="12" cy="12" r="3.4" />
    </svg>
  );
}

export const workflowActionClass =
  "inline-flex items-center justify-center whitespace-nowrap rounded-lg border border-white/20 bg-white px-3 py-1.5 text-xs font-semibold text-[#0f172a] shadow-[0_10px_30px_rgba(255,255,255,0.12)] transition duration-200 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60";

function WorkflowStep({ step, theme }) {
  const isActive = step.status === "active";
  const isCompleted = step.status === "completed";
  const label = step.statusLabel ?? (isActive ? "Now" : isCompleted ? "Completed" : "Pending");

  return (
    <li className="min-w-0" aria-current={isActive ? "step" : undefined} title={step.description}>
      {/* Segment of the progress bar, one per step so it lines up with its column. */}
      <div
        aria-hidden="true"
        className={`relative mb-2.5 hidden h-1 overflow-hidden rounded-full lg:block ${
          isCompleted ? "bg-emerald-400/70" : isActive ? theme.segment : "bg-slate-800"
        }`}
      >
        {isActive ? (
          <span className={`absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent to-transparent hiring-workflow-flow-x ${theme.flow}`} />
        ) : null}
      </div>

      <div
        className={[
          "flex items-center gap-2.5 rounded-xl border px-2 py-1.5 transition duration-200",
          isActive ? `${theme.border} bg-gradient-to-r ${theme.card}` : "border-transparent",
        ].join(" ")}
      >
        <div className="relative shrink-0">
          <div
            className={[
              "flex h-8 w-8 items-center justify-center rounded-lg border text-xs font-semibold",
              isActive ? `${theme.border} ${theme.text} ${theme.nodeActive} shadow-[0_0_16px_currentColor]` : "",
              isCompleted ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200" : "",
              !isActive && !isCompleted ? "border-slate-700 bg-slate-950/40 text-slate-500" : "",
            ].join(" ")}
          >
            {isCompleted ? <CheckIcon /> : step.number}
          </div>
          {isActive ? <span className={`absolute -right-1 -top-1 h-2 w-2 rounded-full ${theme.indicator} hiring-workflow-pulse`} /> : null}
        </div>
        <div className="min-w-0">
          <p className={`line-clamp-2 text-[13px] font-semibold leading-tight ${isActive ? "text-white" : isCompleted ? "text-slate-200" : "text-slate-400"}`}>
            {step.title}
          </p>
          <p
            className={[
              "mt-1 text-[9px] font-semibold uppercase leading-none tracking-[0.16em]",
              isActive ? theme.text : isCompleted ? "text-emerald-300/80" : "text-slate-500",
            ].join(" ")}
          >
            {label}
          </p>
        </div>
      </div>
    </li>
  );
}

/**
 * steps:  [{ id, number, title, description, status: "completed" | "active" | "pending", statusLabel? }]
 * chips:  [{ label, tone?: "accent" | "muted" }]
 * action: the current step's button, shown on the recommendation row.
 */
export default function HorizontalWorkflow({
  eyebrow,
  recommendation,
  chips = [],
  steps,
  action = null,
  theme: themeName = "violet",
  className = "",
}) {
  const theme = THEMES[themeName] ?? THEMES.violet;

  return (
    <section className={`overflow-hidden rounded-2xl border px-4 py-3.5 shadow-[0_14px_44px_rgba(2,6,23,0.28)] sm:px-5 ${theme.panel} ${className}`}>
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <div className={`relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border ${theme.iconBox}`}>
            <SparkIcon />
            <span className={`absolute -right-1 -top-1 h-2 w-2 rounded-full ${theme.iconDot} hiring-workflow-pulse`} />
          </div>
          <div className="min-w-0">
            <p className={`text-[10px] font-semibold uppercase tracking-[0.2em] ${theme.eyebrow}`}>{eyebrow}</p>
            <p className="mt-0.5 text-sm leading-5 text-white">{recommendation}</p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2 md:justify-end">
          {chips.map((chip) => (
            <span
              key={chip.label}
              className={`rounded-full border px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.14em] ${
                chip.tone === "muted" ? "border-white/10 bg-white/5 text-slate-300" : theme.chip
              }`}
            >
              {chip.label}
            </span>
          ))}
          {action}
        </div>
      </div>

      <ol className={`mt-3.5 grid grid-cols-2 gap-1.5 lg:gap-3 ${GRID_COLUMNS[steps.length] ?? "lg:grid-cols-5"}`}>
        {steps.map((step) => (
          <WorkflowStep key={step.id} step={step} theme={theme} />
        ))}
      </ol>
    </section>
  );
}
