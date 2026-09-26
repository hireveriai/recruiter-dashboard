"use client";

// Assessment-side counterpart to components/HiringWorkflow.js's "Hiring
// Workflow" panel - same visual language (recommendation card, checked/
// numbered vertical steps, connecting line, "NOW" pulse, CTA buttons) so a
// recruiter recognizes the pattern immediately, scoped to a single
// assessment's own build-and-send lifecycle instead of the org-wide pipeline.

const THEME = {
  border: "border-violet-400/35",
  text: "text-violet-200",
  indicator: "bg-violet-400",
  background: "from-violet-500/18 via-fuchsia-500/8 to-slate-950/30",
  glow: "shadow-[0_0_34px_rgba(139,92,246,0.18)]",
};

function CheckIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function buildSteps({ assessmentId, isPublished, hasQuestions, hasInvites, hasResults }) {
  return [
    {
      id: "create",
      number: 1,
      title: "Create Assessment",
      description: "Set the job, duration, passing percentage, and question mix.",
      done: true,
    },
    {
      id: "questions",
      number: 2,
      title: "Generate & Review Questions",
      description: "Generate questions with AI, then edit, add, or remove them before publishing.",
      cta: "Edit Questions",
      href: `/assessments/${assessmentId}/questions`,
      done: hasQuestions,
    },
    {
      id: "publish",
      number: 3,
      title: "Publish",
      description: "Lock the reviewed question set so it can be sent to a candidate.",
      cta: "Publish",
      href: `/assessments/${assessmentId}/questions`,
      done: isPublished,
    },
    {
      id: "send",
      number: 4,
      title: "Send to Candidate",
      description: "Invite a candidate independently of Screening or the interview link.",
      cta: "Send Assessment",
      href: "/assessments",
      done: hasInvites,
    },
    {
      id: "results",
      number: 5,
      title: "Review Results",
      description: "See objective + AI-evaluated scores, pass/fail, and integrity risk once completed.",
      cta: "View Results",
      href: `/assessments/${assessmentId}/results`,
      done: hasResults,
    },
  ];
}

function StepCard({ step, isActive }) {
  const isCompleted = step.done && !isActive;

  return (
    <div
      className={[
        "group relative overflow-hidden text-left transition duration-200",
        isActive ? `rounded-xl border p-3 ${THEME.border} bg-gradient-to-br ${THEME.background} ${THEME.glow} scale-[1.01]` : "rounded-lg border border-transparent px-2.5 py-1.5",
        !isActive && isCompleted ? "bg-emerald-500/[0.025] text-slate-300 hover:border-emerald-400/10 hover:bg-emerald-500/[0.045]" : "",
        !isActive && !isCompleted ? "bg-slate-950/10 text-slate-500 hover:border-slate-800/70 hover:bg-slate-950/25" : "",
      ].join(" ")}
    >
      <div className="flex w-full items-start gap-2.5 text-left">
        <div className="relative shrink-0">
          <div
            className={[
              "flex items-center justify-center rounded-lg border font-semibold transition",
              isActive ? `h-7 w-7 text-[11px] ${THEME.border} ${THEME.text} bg-white/10 shadow-[0_0_18px_currentColor]` : "mt-0.5 h-6 w-6 text-[10px]",
              isCompleted ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200" : "",
              !isActive && !isCompleted ? "border-slate-700 bg-slate-900 text-slate-500" : "",
            ].join(" ")}
          >
            {isCompleted ? <CheckIcon /> : step.number}
          </div>
          {isActive ? <span className={`absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full ${THEME.indicator} hiring-workflow-pulse`} /> : null}
        </div>

        <div className="min-w-0 flex-1">
          <div className={isActive ? "flex w-full items-start justify-between gap-2 text-left" : "grid min-w-0 gap-0.5"}>
            <p className={isActive ? "text-[13px] font-semibold leading-tight text-white" : "whitespace-normal break-words text-[13px] font-medium leading-[1.2] tracking-[0.02em] text-slate-200"}>
              {step.title}
            </p>
            {isActive ? (
              <span className={`shrink-0 pt-0.5 text-[9px] font-semibold uppercase tracking-[0.14em] ${THEME.text}`}>Now</span>
            ) : !isActive && (isCompleted || !step.done) ? (
              <p className={`text-[9px] font-semibold uppercase leading-none tracking-[0.16em] ${isCompleted ? "text-emerald-300/75" : "text-slate-500"}`}>
                {isCompleted ? "Completed" : "Pending"}
              </p>
            ) : null}
          </div>

          {isActive ? (
            <>
              <p className="mt-1.5 text-[11px] leading-4 text-slate-400">{step.description}</p>
              {step.cta && step.href ? (
                <div className="mt-2.5">
                  <a
                    href={step.href}
                    className="inline-flex items-center justify-center rounded-lg border border-white/20 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-[#0f172a] shadow-[0_10px_30px_rgba(255,255,255,0.12)] transition duration-200 hover:bg-[#ecfeff]"
                  >
                    {step.cta}
                  </a>
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * Vertical, checklist-style workflow panel for one assessment's own
 * create -> questions -> publish -> send -> results lifecycle. Visually
 * modeled on the recruiter dashboard's Hiring Workflow panel so the pattern
 * is immediately familiar.
 */
export function AssessmentWorkflowPanel({
  assessmentId,
  isPublished,
  hasQuestions,
  hasInvites,
  hasResults,
  className = "",
}) {
  const steps = buildSteps({ assessmentId, isPublished, hasQuestions, hasInvites, hasResults });
  const activeIndex = steps.findIndex((step) => !step.done);
  const completedCount = steps.filter((step) => step.done).length;
  const active = activeIndex === -1 ? steps[steps.length - 1] : steps[activeIndex];

  return (
    <div className={className}>
      <h3 className="text-[11px] font-medium uppercase tracking-[0.3em] text-slate-500">Assessment Workflow</h3>

      <div className="hv-theme-intelligence-panel mt-3 overflow-hidden rounded-xl border border-violet-300/15 bg-[radial-gradient(circle_at_top_left,rgba(139,92,246,0.12),transparent_38%),linear-gradient(135deg,rgba(15,23,42,0.95),rgba(2,6,23,0.84))] p-3 shadow-[0_14px_44px_rgba(2,6,23,0.28)]">
        <div className="flex items-start gap-2.5">
          <div className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-violet-300/25 bg-violet-400/10 text-violet-100 shadow-[0_0_24px_rgba(139,92,246,0.16)]">
            <span className="text-sm font-semibold">V</span>
            <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-violet-300 hiring-workflow-pulse" />
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-violet-200/80">Next Step</p>
            <p className="mt-1.5 text-[13px] leading-5 text-white">{active.title}: {active.description}</p>
            <div className="mt-2.5 flex flex-wrap gap-2 text-[9px] font-semibold uppercase tracking-[0.14em]">
              <span className="rounded-full border border-violet-300/20 bg-violet-400/10 px-2 py-0.5 text-violet-100">
                {completedCount} of {steps.length} workflow steps completed
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="relative mt-3.5 space-y-1.5 pl-2">
        <div className="absolute bottom-4 left-[21px] top-4 w-px overflow-hidden bg-slate-800/90">
          <div className="h-1/2 w-full bg-gradient-to-b from-violet-400 via-fuchsia-400 to-violet-300 hiring-workflow-flow" />
        </div>
        {steps.map((step, index) => (
          <div key={step.id} className="relative pl-6">
            <StepCard step={step} isActive={index === activeIndex || (activeIndex === -1 && index === steps.length - 1)} />
          </div>
        ))}
      </div>
    </div>
  );
}

// Same 5 steps as buildSteps() above, driven by the org-wide assessment
// summary (GET /api/dashboard/assessments) instead of one assessment's own
// progress -- this is the Assessments list page's view of "where am I".
const FLOW_STEPS = [
  { id: "create", number: 1, title: "Create Assessment", description: "Set the job, duration, passing percentage, and question mix." },
  { id: "questions", number: 2, title: "Generate & Review Questions", description: "Generate with AI, then edit, add, or remove before publishing." },
  { id: "publish", number: 3, title: "Publish", description: "Lock the reviewed question set so it can be sent to a candidate." },
  { id: "send", number: 4, title: "Send to Candidate", description: "Invite a candidate, independent of Screening or the interview link." },
  { id: "results", number: 5, title: "Review Results", description: "See scores, pass/fail, and integrity risk once completed." },
];

function countLabel(count, one, many) {
  return `${count} ${count === 1 ? one : many}`;
}

function getFlowState(summary) {
  const total = Number(summary?.totalAssessments ?? 0);
  const drafts = Number(summary?.draftAssessments ?? 0);
  const published = Number(summary?.publishedAssessments ?? 0);
  const invites = Number(summary?.invitesSent ?? 0);
  const completed = Number(summary?.completedAttempts ?? 0);
  const awaiting = Number(summary?.awaitingReview ?? 0);
  const recent = Array.isArray(summary?.recent) ? summary.recent : [];
  const done = {
    create: total > 0,
    questions: published > 0,
    publish: published > 0,
    send: invites > 0,
    results: completed > 0,
  };
  const completedCount = Object.values(done).filter(Boolean).length;

  if (!done.create) {
    return {
      activeId: "create",
      done,
      completedCount,
      recommendation: "Create your first VERIS Assessment: choose the job, duration, and passing score.",
      chip: "Start here",
      action: { kind: "create", label: "Create Assessment" },
    };
  }

  if (!done.publish) {
    const draft = recent.find((assessment) => assessment.status === "DRAFT");
    return {
      activeId: "questions",
      done,
      completedCount,
      recommendation: `${countLabel(drafts, "draft is", "drafts are")} waiting. Generate and review the questions, then publish.`,
      chip: countLabel(drafts, "draft", "drafts"),
      action: draft
        ? { kind: "link", label: "Open Draft", href: `/assessments/${draft.id}/questions` }
        : { kind: "drafts", label: "View Drafts" },
    };
  }

  if (!done.send) {
    return {
      activeId: "send",
      done,
      completedCount,
      recommendation: `${countLabel(published, "published assessment is", "published assessments are")} ready. Send one to a candidate.`,
      chip: `${published} published`,
      action: { kind: "send", label: "Send Assessment" },
    };
  }

  const withResults =
    recent.find((assessment) => Number(assessment.completedAttempts) > 0) ??
    recent.find((assessment) => Number(assessment.invitesSent) > 0);

  return {
    activeId: "results",
    done,
    completedCount,
    recommendation:
      completed === 0
        ? `${countLabel(invites, "invite has", "invites have")} been sent. Results appear here as candidates finish.`
        : awaiting > 0
          ? `${countLabel(completed, "attempt", "attempts")} submitted, ${awaiting} still being evaluated. Review scores, pass/fail, and integrity risk.`
          : `${countLabel(completed, "candidate has", "candidates have")} completed an assessment. Review scores, pass/fail, and integrity risk.`,
    chip: completed > 0 ? `${completed} completed` : `${invites} sent`,
    action: withResults ? { kind: "link", label: "View Results", href: `/assessments/${withResults.id}/results` } : null,
  };
}

function SparkIcon() {
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
  );
}

function FlowAction({ action, onCreate, onSend, onShowDrafts, hrefFor }) {
  const className =
    "inline-flex items-center justify-center rounded-lg border border-white/20 bg-white px-3 py-1.5 text-[11px] font-semibold text-[#0f172a] shadow-[0_10px_30px_rgba(255,255,255,0.12)] transition duration-200 hover:bg-violet-50";

  if (action.kind === "link") {
    return (
      <a href={hrefFor(action.href)} className={className}>
        {action.label}
      </a>
    );
  }

  const onClick = action.kind === "create" ? onCreate : action.kind === "send" ? onSend : onShowDrafts;
  return (
    <button type="button" onClick={onClick} className={className}>
      {action.label}
    </button>
  );
}

function FlowStep({ step, status, action, actionProps }) {
  const isActive = status === "active";
  const isCompleted = status === "completed";

  return (
    <li
      className={[
        "relative flex gap-3 rounded-xl border p-3 transition duration-200 lg:flex-col lg:items-center lg:text-center",
        isActive
          ? `${THEME.border} bg-gradient-to-br ${THEME.background} ${THEME.glow} hiring-workflow-active`
          : isCompleted
            ? "border-transparent hover:border-emerald-400/10 hover:bg-emerald-500/[0.035]"
            : "border-transparent hover:border-slate-800/70 hover:bg-slate-950/20",
      ].join(" ")}
    >
      {/* Opaque base so the connector line passes behind the node, not through it. */}
      <div className="relative z-10 h-9 w-9 shrink-0 rounded-xl bg-slate-900">
        <div
          className={[
            "flex h-full w-full items-center justify-center rounded-xl border text-xs font-semibold",
            isActive ? `${THEME.border} ${THEME.text} bg-violet-400/15 shadow-[0_0_18px_currentColor]` : "",
            isCompleted ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200" : "",
            !isActive && !isCompleted ? "border-slate-700 bg-slate-950/40 text-slate-500" : "",
          ].join(" ")}
        >
          {isCompleted ? <CheckIcon /> : step.number}
        </div>
        {isActive ? <span className={`absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full ${THEME.indicator} hiring-workflow-pulse`} /> : null}
      </div>

      <div className="min-w-0 lg:mt-1">
        <p className={`text-[13px] font-semibold leading-tight ${isActive ? "text-white" : isCompleted ? "text-slate-200" : "text-slate-400"}`}>
          {step.title}
        </p>
        <p
          className={[
            "mt-1 text-[9px] font-semibold uppercase leading-none tracking-[0.16em]",
            isActive ? THEME.text : isCompleted ? "text-emerald-300/80" : "text-slate-500",
          ].join(" ")}
        >
          {isActive ? "Now" : isCompleted ? "Completed" : "Pending"}
        </p>
        <p className={`mt-2 text-[11px] leading-4 ${isActive ? "text-slate-300" : "text-slate-500"}`}>{step.description}</p>
        {isActive && action ? (
          <div className="mt-3">
            <FlowAction action={action} {...actionProps} />
          </div>
        ) : null}
      </div>
    </li>
  );
}

/**
 * Horizontal counterpart to AssessmentWorkflowPanel for the Assessments list
 * page, in the dashboard Hiring Workflow's visual language: a VERIS
 * recommendation up top, then the five steps on one connecting line with
 * completed ones checked and the current one lifted out as the "Now" card.
 */
export function AssessmentFlowGuide({
  summary = null,
  loading = false,
  onCreate,
  onSend,
  onShowDrafts,
  hrefFor = (path) => path,
  className = "",
}) {
  const ready = Boolean(summary) && !loading;
  const state = ready ? getFlowState(summary) : null;
  const activeIndex = state ? FLOW_STEPS.findIndex((step) => step.id === state.activeId) : -1;
  const progressPercent = activeIndex > 0 ? (activeIndex / (FLOW_STEPS.length - 1)) * 100 : 0;
  const actionProps = { onCreate, onSend, onShowDrafts, hrefFor };

  return (
    <section
      className={`hv-theme-assessment-panel overflow-hidden rounded-2xl border border-violet-300/15 bg-[radial-gradient(circle_at_top_left,rgba(139,92,246,0.12),transparent_38%),linear-gradient(135deg,rgba(15,23,42,0.95),rgba(2,6,23,0.84))] p-4 shadow-[0_14px_44px_rgba(2,6,23,0.28)] sm:p-5 ${className}`}
    >
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="flex items-start gap-3">
          <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-violet-300/25 bg-violet-400/10 text-violet-100 shadow-[0_0_24px_rgba(139,92,246,0.16)]">
            <SparkIcon />
            <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-violet-300 hiring-workflow-pulse" />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-violet-200/80">
              Assessment Flow · VERIS Recommendation
            </p>
            <p className="mt-1.5 text-sm leading-6 text-white">
              {state ? state.recommendation : "Checking your assessment progress…"}
            </p>
          </div>
        </div>
        {state ? (
          <div className="flex shrink-0 flex-wrap gap-2 text-[9px] font-semibold uppercase tracking-[0.14em] md:justify-end">
            <span className="rounded-full border border-violet-300/20 bg-violet-400/10 px-2 py-1 text-violet-100">
              {state.completedCount} of {FLOW_STEPS.length} steps completed
            </span>
            <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-slate-300">{state.chip}</span>
          </div>
        ) : null}
      </div>

      <ol className="relative mt-5 grid gap-2 lg:grid-cols-5 lg:gap-3">
        {/* Connector through the node centres (12px card padding + half the 36px node). */}
        <li aria-hidden="true" className="pointer-events-none absolute left-[10%] right-[10%] top-[30px] hidden h-px overflow-hidden bg-slate-800/90 lg:block">
          <div
            className="h-full bg-gradient-to-r from-emerald-400/70 via-violet-400 to-violet-300 transition-[width] duration-700"
            style={{ width: `${progressPercent}%` }}
          />
          <div className="absolute inset-y-0 left-0 w-1/4 bg-gradient-to-r from-transparent via-violet-300/80 to-transparent hiring-workflow-flow-x" />
        </li>
        {FLOW_STEPS.map((step, index) => {
          const status = !state
            ? "pending"
            : index === activeIndex
              ? "active"
              : state.done[step.id]
                ? "completed"
                : "pending";
          return (
            <FlowStep
              key={step.id}
              step={step}
              status={status}
              action={index === activeIndex ? state?.action : null}
              actionProps={actionProps}
            />
          );
        })}
      </ol>

      <p className="mt-4 border-t border-violet-500/10 pt-3 text-[11px] leading-5 text-slate-500">
        Independent of VERIS Screening and the AI Interview: send it before an interview, skip straight to the
        interview link, or use it on its own.
      </p>
    </section>
  );
}
