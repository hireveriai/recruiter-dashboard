"use client";

import Link from "next/link";

import { canAccessFeature } from "@/lib/client/permissions";
import { deriveDashboardState } from "@/lib/dashboard/dashboard-state-engine";

function ActionButton({ href, onClick, children, tone = "primary" }) {
  const className =
    tone === "secondary"
      ? "inline-flex min-w-max items-center justify-center whitespace-nowrap rounded-xl border border-slate-700 bg-slate-950/45 px-4 py-2.5 text-sm font-semibold text-slate-200 transition hover:border-slate-500 hover:bg-slate-900 hover:text-white"
      : "inline-flex min-w-max items-center justify-center whitespace-nowrap rounded-xl border border-sky-400/25 bg-sky-500/12 px-4 py-2.5 text-sm font-semibold text-sky-100 transition hover:border-sky-300/45 hover:bg-sky-500/18 hover:text-white";

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={className}>
        {children}
      </button>
    );
  }

  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}

/**
 * The default hero (no active workflow yet) has to name the right first
 * step for what this org actually bought -- "create a job" only makes
 * sense once AI Interview is entitled. Screening-only and Assessment-only
 * orgs get their own entry point instead of a step they can't take.
 */
function getDefaultHero({ canCreateJob, canUseAiScreening, canViewAssessments, onCreateJob }) {
  if (canCreateJob) {
    return {
      eyebrow: "VerisNova Workflow",
      heading: "Start by creating a job and inviting candidates.",
      description: "Create a job and begin candidate evaluation.",
      action: onCreateJob ? { label: "Create Job", onClick: onCreateJob } : null,
    };
  }

  if (canUseAiScreening && canViewAssessments) {
    return {
      eyebrow: "VerisNova Workflow",
      heading: "Start with VERIS Screening or VERIS Assessment.",
      description: "Verify and shortlist candidates with Screening, or send a scored skills test with Assessment -- use either independently.",
      action: { label: "Start VERIS Screening", href: "/ai-screening" },
    };
  }

  if (canUseAiScreening) {
    return {
      eyebrow: "VerisNova Workflow",
      heading: "Start by screening candidates with VERIS Screening.",
      description: "Verify resumes against job requirements and surface skill alignment, early risk indicators, and shortlist guidance.",
      action: { label: "Start VERIS Screening", href: "/ai-screening" },
    };
  }

  if (canViewAssessments) {
    return {
      eyebrow: "VerisNova Workflow",
      heading: "Start by creating your first VERIS Assessment.",
      description: "Build a scored skills test and send it to candidates -- independent of Screening or the AI Interview.",
      action: { label: "Create Assessment", href: "/assessments" },
    };
  }

  return {
    eyebrow: "VerisNova Workflow",
    heading: "Welcome to VerisNova.",
    description: "Your workspace is ready.",
    action: null,
  };
}

export default function DashboardIntelligenceBanner({ overview, profile = null, onCreateJob, onSendInterview }) {
  const canCreateJob = canAccessFeature(profile, "createJob", profile?.entitlements);
  const canSendInterview = canAccessFeature(profile, "sendInterview", profile?.entitlements);
  const canUseAiScreening = canAccessFeature(profile, "aiScreening", profile?.entitlements);
  const canViewAssessments = canAccessFeature(profile, "assessments", profile?.entitlements);

  if (!overview) {
    return (
      <section className="hv-elevated-section mb-4 overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/70 px-5 py-4 shadow-sm">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-sky-400" />
            <p className="text-sm font-medium text-slate-100">Preparing recruiter workflow snapshot</p>
          </div>
          <span className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Syncing</span>
        </div>
      </section>
    );
  }

  const state = deriveDashboardState(overview?.dashboardState ?? {});

  if (state.heroState === "WORKFLOW_ACTIVE") {
    const pendingCount = state.pending_reviews_count;
    const bannerText =
      pendingCount > 0
        ? `Hiring workflow active • ${pendingCount} candidate${pendingCount === 1 ? "" : "s"} pending review`
        : "Hiring workflow active • Evaluation pipeline is live";

    return (
      <section className="hv-elevated-section mb-4 overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/70 px-5 py-4 shadow-sm transition-all duration-300">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-400" />
            <p className="text-sm font-medium text-slate-100">{bannerText}</p>
          </div>
          <span className="text-xs font-semibold uppercase tracking-[0.12em] text-emerald-300/80">Operational</span>
        </div>
      </section>
    );
  }

  if (state.heroState === "VERIS_OPTIONAL") {
    return (
      <section className="hv-elevated-section mb-5 overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/80 px-6 py-6 shadow-[0_14px_40px_rgba(2,6,23,0.22)] transition-all duration-300 sm:px-7">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Optional Screening Layer</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-white">Run VERIS Screening before outreach.</h2>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-300">
              Verify resumes against job requirements and surface skill alignment, early risk indicators, and shortlist guidance.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-3">
            {canUseAiScreening ? <ActionButton href="/ai-screening">Start VERIS Screening</ActionButton> : null}
            {canSendInterview && onSendInterview ? <ActionButton tone="secondary" onClick={onSendInterview}>Skip & Continue Interviews</ActionButton> : null}
          </div>
        </div>
      </section>
    );
  }

  const hero = getDefaultHero({ canCreateJob, canUseAiScreening, canViewAssessments, onCreateJob });

  return (
    <section className="hv-elevated-section mb-5 overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/80 px-6 py-6 shadow-[0_14px_40px_rgba(2,6,23,0.22)] transition-all duration-300 sm:px-7">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-3xl min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">{hero.eyebrow}</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-white">{hero.heading}</h2>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-300">
            {hero.description}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-3">
          {hero.action?.onClick ? <ActionButton onClick={hero.action.onClick}>{hero.action.label}</ActionButton> : null}
          {hero.action?.href ? <ActionButton href={hero.action.href}>{hero.action.label}</ActionButton> : null}
        </div>
      </div>
    </section>
  );
}
