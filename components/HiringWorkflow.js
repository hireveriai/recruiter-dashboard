"use client"

import Link from "next/link"
import { useMemo } from "react"

import { canAccessFeature } from "@/lib/client/permissions"
import { deriveDashboardState } from "@/lib/dashboard/dashboard-state-engine"

const stepThemes = {
  blue: {
    glow: "shadow-[0_0_34px_rgba(59,130,246,0.16)]",
    border: "border-blue-400/35",
    text: "text-blue-200",
    indicator: "bg-blue-400",
    background: "from-blue-500/18 via-blue-500/8 to-slate-950/30",
  },
  violet: {
    glow: "shadow-[0_0_36px_rgba(139,92,246,0.2)]",
    border: "border-violet-400/35",
    text: "text-violet-200",
    indicator: "bg-violet-400",
    background: "from-violet-500/18 via-fuchsia-500/8 to-slate-950/30",
  },
  cyan: {
    glow: "shadow-[0_0_34px_rgba(34,211,238,0.17)]",
    border: "border-cyan-400/35",
    text: "text-cyan-200",
    indicator: "bg-cyan-400",
    background: "from-cyan-500/18 via-sky-500/8 to-slate-950/30",
  },
  teal: {
    glow: "shadow-[0_0_34px_rgba(45,212,191,0.17)]",
    border: "border-teal-400/35",
    text: "text-teal-200",
    indicator: "bg-teal-400",
    background: "from-teal-500/18 via-emerald-500/8 to-slate-950/30",
  },
  amber: {
    glow: "shadow-[0_0_34px_rgba(245,158,11,0.17)]",
    border: "border-amber-300/35",
    text: "text-amber-200",
    indicator: "bg-amber-300",
    background: "from-amber-500/18 via-yellow-500/8 to-slate-950/30",
  },
  green: {
    glow: "shadow-[0_0_34px_rgba(34,197,94,0.17)]",
    border: "border-emerald-400/35",
    text: "text-emerald-200",
    indicator: "bg-emerald-400",
    background: "from-emerald-500/18 via-green-500/8 to-slate-950/30",
  },
}

const workflowSteps = [
  {
    id: "create-job",
    number: 1,
    title: "Create Job",
    description: "Define role, skills, interview duration, and hiring configuration.",
    cta: "Create Job",
    theme: "blue",
    action: "create-job",
  },
  {
    id: "veris-screening",
    number: 2,
    title: "VERIS Screening",
    description: "Resume verification, profile matching, risk checks, and candidate shortlisting.",
    cta: "Start Screening",
    secondaryCta: "Skip",
    theme: "violet",
    optional: true,
    href: "/ai-screening",
  },
  {
    id: "send-link",
    number: 3,
    title: "Send Interview Link",
    description: "Invite shortlisted candidates securely for VERIS interviews.",
    cta: "Send Interview Link",
    theme: "cyan",
    action: "send-link",
  },
  {
    id: "ai-interview",
    number: 4,
    title: "VERIS Interview",
    description: "Track interview starts, completion, and review readiness.",
    cta: "View Interviews",
    theme: "teal",
    href: "/interviews",
  },
  {
    id: "review-reports",
    number: 5,
    title: "Review Reports",
    description: "Review competency evidence, integrity indicators, and recommendations.",
    cta: "Open Reports",
    theme: "amber",
    href: "/reports",
  },
  {
    id: "hiring-decision",
    number: 6,
    title: "Hiring Decision",
    description: "Approve, reject, or escalate candidates with full audit trail visibility.",
    cta: "Review Candidates",
    theme: "green",
    href: "/candidates",
  },
]

function CheckIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  )
}

function AiIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
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
  )
}

function getWorkflowFacts(overview) {
  const metrics = overview?.workflowMetrics ?? {}
  const pipeline = overview?.pipeline ?? {}
  const dashboardState = deriveDashboardState(overview?.dashboardState ?? {})
  const hasActiveJobs = Number(metrics.activeJobs ?? dashboardState.active_jobs_count ?? metrics.jobs ?? 0) > 0
  const hasJobs = hasActiveJobs
  const invitesSent = Number(metrics.invites ?? overview?.pendingInterviews?.length ?? 0) > 0
  const screeningStarted = Boolean(metrics.screeningStarted) || Number(metrics.screeningRuns ?? 0) > 0 || Number(overview?.veris?.length ?? 0) > 0
  const screeningCompleted = Boolean(metrics.screeningCompleted) || Number(metrics.shortlistedCandidates ?? 0) > 0 || Number(overview?.veris?.length ?? 0) > 0
  const activeInterviews = Number(metrics.interviewsRunning ?? pipeline.inProgress ?? 0)
  const pendingReports = Number(metrics.pendingReports ?? metrics.reportsReady ?? pipeline.completed ?? 0)
  const pendingDecisions = Number(metrics.decisionsPending ?? 0)
  const completedInterviews = Number(metrics.completedInterviews ?? pipeline.completed ?? 0)
  const reviewedReports = Number(metrics.reviewedReports ?? 0)
  const screeningSkipped = Boolean(!screeningStarted && invitesSent)

  return {
    hasJobs,
    hasActiveJobs,
    screeningStarted,
    screeningCompleted,
    screeningSkipped,
    invitesSent,
    activeInterviews,
    pendingReports,
    pendingDecisions,
    completedInterviews,
    reviewedReports,
    shortlistedCandidates: Number(metrics.shortlistedCandidates ?? 0),
    interviewsCount: dashboardState.interviews_count,
    pendingReviewsCount: dashboardState.pending_reviews_count,
  }
}

function buildStepStatuses(activeStepId, completedStepIds = [], skippedStepIds = []) {
  const completed = new Set(completedStepIds)
  const skipped = new Set(skippedStepIds)

  return workflowSteps.reduce((statuses, step) => {
    if (step.id === activeStepId) {
      statuses[step.id] = "active"
    } else if (skipped.has(step.id)) {
      statuses[step.id] = "skipped"
    } else if (completed.has(step.id)) {
      statuses[step.id] = "completed"
    } else {
      statuses[step.id] = "pending"
    }

    return statuses
  }, {})
}

function getCompletedStageCount(facts) {
  return (
    Number(facts.hasJobs) +
    Number(facts.screeningCompleted || facts.screeningSkipped) +
    Number(facts.invitesSent) +
    Number(facts.completedInterviews > 0) +
    Number(facts.reviewedReports > 0)
  )
}

function getWorkflowState(overview) {
  const facts = getWorkflowFacts(overview)

  if (!facts.hasJobs) {
    return {
      activeStepId: "create-job",
      recommendation: "Create a job and begin candidate evaluation.",
      statuses: buildStepStatuses("create-job"),
      facts,
    }
  }

  if (facts.activeInterviews > 0) {
    return {
      activeStepId: "ai-interview",
      recommendation: `${facts.activeInterviews} interview${facts.activeInterviews === 1 ? " is" : "s are"} active. Track starts, completion, and review readiness.`,
      statuses: buildStepStatuses(
        "ai-interview",
        ["create-job", "send-link", ...(facts.screeningCompleted ? ["veris-screening"] : [])],
        facts.screeningSkipped ? ["veris-screening"] : []
      ),
      facts,
    }
  }

  if (facts.pendingDecisions > 0) {
    return {
      activeStepId: "hiring-decision",
      recommendation: "Finalize hiring decisions for shortlisted candidates.",
      statuses: buildStepStatuses(
        "hiring-decision",
        ["create-job", "send-link", "ai-interview", "review-reports", ...(facts.screeningCompleted ? ["veris-screening"] : [])],
        facts.screeningSkipped ? ["veris-screening"] : []
      ),
      facts,
    }
  }

  if (facts.pendingReports > 0) {
    return {
      activeStepId: "review-reports",
      recommendation: `${facts.pendingReports} interview report${facts.pendingReports === 1 ? " is" : "s are"} ready for review.`,
      statuses: buildStepStatuses(
        "review-reports",
        ["create-job", "send-link", "ai-interview", ...(facts.screeningCompleted ? ["veris-screening"] : [])],
        facts.screeningSkipped ? ["veris-screening"] : []
      ),
      facts,
    }
  }

  if (facts.invitesSent) {
    return {
      activeStepId: "ai-interview",
      recommendation: "Interview links are out. Monitor starts, recovery signals, and interview progress.",
      statuses: buildStepStatuses(
        "ai-interview",
        ["create-job", "send-link", ...(facts.screeningCompleted ? ["veris-screening"] : [])],
        facts.screeningSkipped ? ["veris-screening"] : []
      ),
      facts,
    }
  }

  if (facts.screeningSkipped) {
    return {
      activeStepId: "send-link",
      recommendation: "Invite candidates to begin VERIS interviews.",
      statuses: buildStepStatuses("send-link", ["create-job"], ["veris-screening"]),
      facts,
    }
  }

  if (facts.screeningCompleted) {
    return {
      activeStepId: "send-link",
      recommendation: "Send interview links to shortlisted candidates.",
      statuses: buildStepStatuses("send-link", ["create-job", "veris-screening"]),
      facts,
    }
  }

  if (facts.screeningStarted) {
    return {
      activeStepId: "veris-screening",
      recommendation: "VERIS Screening is in progress. Review shortlists before inviting candidates.",
      statuses: buildStepStatuses("veris-screening", ["create-job"]),
      facts,
    }
  }

  return {
    activeStepId: "veris-screening",
    recommendation: "VERIS Screening is optional. Use it to strengthen evaluation before interviews.",
    statuses: buildStepStatuses("veris-screening", ["create-job"]),
    facts,
  }
}

function getStepStatus(step, state) {
  return state.statuses[step.id] ?? "pending"
}

function getProgressLabel(state) {
  return `${getCompletedStageCount(state.facts)} of 5 workflow stages completed`
}

function getActiveSummary(state) {
  const facts = state.facts

  if (state.activeStepId === "ai-interview" && facts.activeInterviews > 0) return `${facts.activeInterviews} live`
  if (state.activeStepId === "review-reports" && facts.pendingReports > 0) return `${facts.pendingReports} ready`
  if (state.activeStepId === "hiring-decision" && facts.pendingDecisions > 0) return `${facts.pendingDecisions} pending`
  if (state.activeStepId === "send-link" && facts.shortlistedCandidates > 0) return `${facts.shortlistedCandidates} shortlisted`
  return "Recommended"
}

function getStepSignal(step, status) {
  if (status === "active") return "Now"
  if (status === "completed") return "Done"
  if (status === "skipped") return "Skipped"
  if (step.optional) return "Recommended"
  return "Pending"
}

function getCollapsedMeta(step, status) {
  if (status === "completed") return "Completed"
  if (status === "skipped") return "Skipped"
  if (step.optional) return "Recommended"
  return ""
}

function WorkflowAction({ step, onAction, highlighted = false }) {
  const baseClass = [
    "inline-flex items-center justify-center rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition duration-200",
    highlighted
      ? "hv-preserve-dark border-white/20 bg-white text-slate-950 shadow-[0_10px_30px_rgba(255,255,255,0.12)] hover:bg-cyan-50"
      : "border-white/10 bg-white/10 text-white hover:border-white/25 hover:bg-white/15",
  ].join(" ")

  if (step.href) {
    return (
      <Link href={step.href} className={baseClass}>
        {step.cta}
      </Link>
    )
  }

  return (
    <button type="button" className={baseClass} onClick={() => onAction(step.action)}>
      {step.cta}
    </button>
  )
}

function WorkflowStepCard({ step, status, onAction, profile }) {
  const canUseStep =
    (step.id === "create-job" && canAccessFeature(profile, "createJob")) ||
    (step.id === "veris-screening" && canAccessFeature(profile, "aiScreening")) ||
    (step.id === "send-link" && canAccessFeature(profile, "sendInterview")) ||
    (step.id === "ai-interview" && canAccessFeature(profile, "interviews")) ||
    (step.id === "review-reports" && canAccessFeature(profile, "reports")) ||
    (step.id === "hiring-decision" && canAccessFeature(profile, "candidates"))

  if (!canUseStep) {
    return null
  }

  const theme = stepThemes[step.theme]
  const isActive = status === "active"
  const isCompleted = status === "completed"
  const isSkipped = status === "skipped"
  const isPending = status === "pending"
  const shouldExpand = isActive
  const collapsedMeta = getCollapsedMeta(step, status)
  const cardClass = [
    "group relative overflow-hidden text-left transition duration-200",
    shouldExpand ? "rounded-xl border p-3" : "rounded-lg border border-transparent px-2.5 py-1.5",
    isActive ? `${theme.border} bg-gradient-to-br ${theme.background} ${theme.glow} hiring-workflow-active scale-[1.01]` : "",
    !shouldExpand && isCompleted ? "bg-emerald-500/[0.025] text-slate-300 hover:border-emerald-400/10 hover:bg-emerald-500/[0.045]" : "",
    !shouldExpand && isSkipped ? "bg-violet-500/[0.025] text-slate-500 hover:border-violet-400/10 hover:bg-violet-500/[0.045]" : "",
    !shouldExpand && isPending ? "bg-slate-950/10 text-slate-500 hover:border-slate-800/70 hover:bg-slate-950/25" : "",
  ].join(" ")

  return (
    <div className={cardClass}>
      {shouldExpand ? <div className={`absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-current to-transparent opacity-30 ${theme.text}`} /> : null}
      <div className="flex w-full items-start gap-2.5 text-left">
        <div className="relative shrink-0">
          <div className={[
            "flex items-center justify-center rounded-lg border font-semibold transition",
            shouldExpand ? "h-7 w-7 text-[11px]" : "mt-0.5 h-6 w-6 text-[10px]",
            isActive ? `${theme.border} ${theme.text} bg-white/10 shadow-[0_0_18px_currentColor]` : "",
            isCompleted ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200" : "",
            isSkipped ? "border-violet-400/20 bg-violet-500/5 text-violet-300" : "",
            isPending ? "border-slate-700 bg-slate-900 text-slate-500" : "",
          ].join(" ")}>
            {isCompleted ? <CheckIcon /> : step.number}
          </div>
          {isActive ? <span className={`absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full ${theme.indicator} hiring-workflow-pulse`} /> : null}
        </div>

        <div className="min-w-0 flex-1">
          <div className={shouldExpand ? "flex w-full items-start justify-between gap-2 text-left" : "grid min-w-0 gap-0.5"}>
            <div className={shouldExpand ? "flex min-w-0 flex-wrap items-center gap-2" : "min-w-0"}>
              <p className={shouldExpand ? "text-[13px] font-semibold leading-tight text-white" : "whitespace-normal break-words text-[13px] font-medium leading-[1.2] tracking-[0.02em] text-slate-200"}>
                {step.title}
              </p>
              {step.optional && shouldExpand ? (
                <span className="rounded-full border border-violet-300/25 bg-violet-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-violet-200">
                  Optional Intelligence
                </span>
              ) : null}
              {isSkipped && shouldExpand ? (
                <span className="rounded-full border border-slate-600 bg-slate-900 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                  Skipped
                </span>
              ) : null}
            </div>
            {shouldExpand ? <div className="flex shrink-0 items-center gap-2 pt-0.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-slate-500">
              <span className={isActive ? theme.text : isCompleted ? "text-emerald-300" : isSkipped ? "text-violet-300" : ""}>
                {getStepSignal(step, status)}
              </span>
            </div> : null}
            {!shouldExpand && collapsedMeta ? (
              <p className={[
                "text-[9px] font-semibold uppercase leading-none tracking-[0.16em]",
                isCompleted ? "text-emerald-300/75" : isSkipped ? "text-violet-300/70" : "text-slate-500",
              ].join(" ")}>
                {collapsedMeta}
              </p>
            ) : null}
          </div>

          {shouldExpand ? (
            <>
              <p className="mt-1.5 text-[11px] leading-4 text-slate-400">{step.description}</p>
              <div className="mt-2.5 flex flex-wrap gap-2">
                <WorkflowAction step={step} onAction={onAction} highlighted={isActive} />
                {step.secondaryCta && isActive && canAccessFeature(profile, "sendInterview") ? (
                  <button
                    type="button"
                    className="inline-flex items-center justify-center rounded-lg border border-violet-300/15 px-2.5 py-1.5 text-[11px] font-semibold text-violet-200 transition duration-200 hover:border-violet-300/35 hover:bg-violet-500/10"
                    onClick={() => onAction("skip-screening")}
                  >
                    {step.secondaryCta}
                  </button>
                ) : null}
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  )
}

export default function HiringWorkflow({ overview, profile = null, onAction }) {
  const state = useMemo(() => getWorkflowState(overview), [overview])

  const handleAction = (action) => {
    onAction(action)
  }

  return (
    <div className="mt-6">
      <h3 className="text-[11px] font-medium uppercase tracking-[0.3em] text-slate-500">Hiring Workflow</h3>

        <div className="hv-theme-intelligence-panel mt-3 overflow-hidden rounded-xl border border-cyan-300/15 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.12),transparent_38%),linear-gradient(135deg,rgba(15,23,42,0.95),rgba(2,6,23,0.84))] p-3 shadow-[0_14px_44px_rgba(2,6,23,0.28)]">
        <div className="flex items-start gap-2.5">
          <div className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-cyan-300/25 bg-cyan-400/10 text-cyan-100 shadow-[0_0_24px_rgba(34,211,238,0.16)]">
            <AiIcon />
            <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-cyan-300 hiring-workflow-pulse" />
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-cyan-200/80">VERIS Recommendation</p>
            <p className="mt-1.5 text-[13px] leading-5 text-white">{state.recommendation}</p>
            <div className="mt-2.5 flex flex-wrap gap-2 text-[9px] font-semibold uppercase tracking-[0.14em]">
              <span className="rounded-full border border-cyan-300/20 bg-cyan-400/10 px-2 py-0.5 text-cyan-100">{getProgressLabel(state)}</span>
              <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-slate-300">{getActiveSummary(state)}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="relative mt-3.5 space-y-1.5 pl-2">
        <div className="absolute bottom-4 left-[21px] top-4 w-px overflow-hidden bg-slate-800/90">
          <div className="h-1/2 w-full bg-gradient-to-b from-blue-400 via-violet-400 to-cyan-300 hiring-workflow-flow" />
        </div>
        {workflowSteps.map((step) => {
          const status = getStepStatus(step, state)

          return (
            <div key={step.id} className="relative pl-6">
              <WorkflowStepCard
                step={step}
                status={status}
                onAction={handleAction}
                profile={profile}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
