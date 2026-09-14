"use client";

// Two small guides shown across the Assessment pages so a recruiter always
// knows (a) where Assessment sits relative to Screening/Interview, and
// (b) which step of building+sending one specific assessment they're on.
// Mirrors the visual language of components/HiringWorkflow.js (violet accent,
// pill badges) without depending on it.

const BUILD_STEPS = [
  { key: "create", label: "Create" },
  { key: "questions", label: "Generate & Review Questions" },
  { key: "publish", label: "Publish" },
  { key: "send", label: "Send to Candidate" },
  { key: "results", label: "Review Results" },
];

export function HiringContextStrip({ className = "" }) {
  return (
    <div className={`rounded-2xl border border-violet-500/20 bg-violet-500/5 p-4 sm:p-5 ${className}`}>
      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-violet-300">Where this fits in hiring</p>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        <span className="rounded-full border border-slate-700 bg-slate-900/60 px-3 py-1 text-slate-300">
          VERIS Screening <span className="text-slate-500">(optional)</span>
        </span>
        <span className="text-slate-600" aria-hidden="true">→</span>
        <span className="rounded-full border border-violet-400/40 bg-violet-500/15 px-3 py-1 font-medium text-violet-100">
          VERIS Assessment <span className="text-violet-300/80">(optional)</span>
        </span>
        <span className="text-slate-600" aria-hidden="true">→</span>
        <span className="rounded-full border border-slate-700 bg-slate-900/60 px-3 py-1 text-slate-300">
          VERIS AI Interview <span className="text-slate-500">(optional, can be sent directly)</span>
        </span>
      </div>
      <p className="mt-3 text-sm leading-6 text-slate-400">
        Every stage is independent. Send an Assessment before an interview, skip it and go straight to the interview
        link, or use Assessment on its own — nothing here is a required prerequisite for anything else.
      </p>
    </div>
  );
}

export function AssessmentBuildSteps({ currentStep, className = "" }) {
  const currentIndex = BUILD_STEPS.findIndex((step) => step.key === currentStep);

  return (
    <div className={`rounded-2xl border border-slate-800 bg-slate-900/40 p-4 sm:p-5 ${className}`}>
      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Building this assessment</p>
      <ol className="mt-3 flex flex-wrap items-center gap-x-1.5 gap-y-2 text-sm">
        {BUILD_STEPS.map((step, index) => {
          const isCurrent = index === currentIndex;
          const isDone = currentIndex >= 0 && index < currentIndex;

          return (
            <li key={step.key} className="flex items-center gap-1.5">
              <span
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-medium ${
                  isCurrent
                    ? "border-violet-400/50 bg-violet-500/20 text-white"
                    : isDone
                      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                      : "border-slate-700 bg-slate-950/40 text-slate-500"
                }`}
              >
                <span className="text-xs">{index + 1}.</span>
                {step.label}
              </span>
              {index < BUILD_STEPS.length - 1 ? <span className="text-slate-700" aria-hidden="true">→</span> : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
