"use client"

type DecisionPillProps = {
  status?: string | null
  className?: string
}

const DECISION_STYLES: Record<string, { label: string; className: string }> = {
  PROCEED: {
    label: "Proceed",
    className: "border-emerald-300/25 bg-emerald-400/10 text-emerald-100 shadow-[0_0_18px_rgba(16,185,129,0.08)]",
  },
  HOLD: {
    label: "Hold",
    className: "border-amber-300/25 bg-amber-400/10 text-amber-100 shadow-[0_0_18px_rgba(245,158,11,0.08)]",
  },
  REJECT: {
    label: "Reject",
    className: "border-rose-300/20 bg-rose-400/10 text-rose-100 shadow-[0_0_18px_rgba(244,63,94,0.07)]",
  },
  REVIEW_REQUIRED: {
    label: "Escalate Review",
    className: "border-sky-300/20 bg-sky-400/10 text-sky-100 shadow-[0_0_18px_rgba(56,189,248,0.06)]",
  },
  REVIEWED: {
    label: "Escalate Review",
    className: "border-sky-300/20 bg-sky-400/10 text-sky-100 shadow-[0_0_18px_rgba(56,189,248,0.06)]",
  },
}

function normalizeDecisionStatus(status?: string | null) {
  return String(status ?? "").trim().toUpperCase()
}

export function getDecisionLabel(status?: string | null) {
  const normalized = normalizeDecisionStatus(status)
  return DECISION_STYLES[normalized]?.label ?? "Review Required"
}

export function DecisionPill({ status, className = "" }: DecisionPillProps) {
  const normalized = normalizeDecisionStatus(status)
  const tone = DECISION_STYLES[normalized] ?? DECISION_STYLES.REVIEW_REQUIRED

  return (
    <span
      className={`inline-flex max-w-full items-center rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] ${tone.className} ${className}`}
    >
      <span className="truncate">{tone.label}</span>
    </span>
  )
}
