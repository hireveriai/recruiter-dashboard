"use client";

import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";

import { buildAuthUrl } from "@/lib/client/auth-query";

/**
 * Compact Interview Focus summary for the Create/Edit Job modal. The full
 * editor lives on the questionnaire page; this never creates a plan or calls
 * the AI. Renders nothing unless Interview Focus is enabled.
 */
export default function InterviewFocusSummary({ jobId = null, searchParams }) {
  const [enabled, setEnabled] = useState(false);
  const [plan, setPlan] = useState(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const statusRes = await fetch(buildAuthUrl("/api/interview-focus", searchParams), { credentials: "include" });
        const status = await statusRes.json();
        if (cancelled || !statusRes.ok || !status?.data?.enabled) return;
        setEnabled(true);

        if (!jobId) return;
        const res = await fetch(buildAuthUrl(`/api/jobs/${jobId}/focus?view=summary`, searchParams), {
          credentials: "include",
          cache: "no-store",
        });
        const data = await res.json();
        if (!cancelled && res.ok) setPlan(data?.data?.active ?? null);
      } catch {
        // The summary is informational; the modal works without it.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [jobId, searchParams]);

  if (!enabled) return null;

  const customized = plan?.origin === "CUSTOM";
  const questionsHref = jobId ? buildAuthUrl(`/jobs/${jobId}/questionnaire`, searchParams) : null;

  return (
    <div className="md:col-span-2 rounded-[24px] border border-slate-800 bg-slate-950/40 p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-white">Interview Focus</p>
            <span
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                customized
                  ? "border-sky-300/30 bg-sky-400/10 text-sky-200"
                  : "border-violet-300/30 bg-violet-400/10 text-violet-200"
              }`}
            >
              {customized ? null : <Sparkles className="h-3 w-3" aria-hidden="true" />}
              {customized ? "Customized" : "VERIS Recommended"}
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-400">
            {plan
              ? "The competencies this interview covers. Coverage shapes the questions, not the score."
              : jobId
                ? "VERIS recommends the competencies to cover when the questionnaire is prepared."
                : "VERIS will recommend the competencies to cover from the title, description, skills and experience level. You can customize them on the next step."}
          </p>
          {plan ? (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {plan.areas.map((area) => (
                <span key={area.areaKey} className="rounded-full border border-slate-700 bg-slate-900/60 px-2.5 py-0.5 text-xs text-slate-200">
                  {area.label} <span className="font-semibold text-violet-200">{area.coverageWeight}%</span>
                </span>
              ))}
            </div>
          ) : null}
        </div>
        {questionsHref ? (
          <a
            href={questionsHref}
            className="flex-none rounded-full border border-violet-400/40 bg-violet-500/10 px-3.5 py-1.5 text-sm font-medium text-violet-100 transition hover:bg-violet-500/20"
          >
            Customize
          </a>
        ) : null}
      </div>
    </div>
  );
}
