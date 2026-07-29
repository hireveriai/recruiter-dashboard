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

export default function DashboardIntelligenceBanner({ overview, profile = null, onCreateJob, onSendInterview }) {
  const canCreateJob = canAccessFeature(profile, "createJob");
  const canSendInterview = canAccessFeature(profile, "sendInterview");
  const canUseAiScreening = canAccessFeature(profile, "aiScreening");

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

  return (
    <section className="hv-elevated-section mb-5 overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/80 px-6 py-6 shadow-[0_14px_40px_rgba(2,6,23,0.22)] transition-all duration-300 sm:px-7">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-3xl min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">HireVeri Workflow</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-white">Start by creating a job and inviting candidates.</h2>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-300">
            Create a job and begin candidate evaluation.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-3">
          {canCreateJob && onCreateJob ? <ActionButton onClick={onCreateJob}>Create Job</ActionButton> : null}
        </div>
      </div>
    </section>
  );
}
