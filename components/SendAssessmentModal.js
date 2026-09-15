"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuthSearchParams } from "@/lib/client/use-auth-search-params";

import { showActionFeedback } from "@/lib/client/action-feedback";
import { buildAuthUrl } from "@/lib/client/auth-query";
import { copyText } from "@/lib/client/copy-to-clipboard";
import { formatDateTime } from "@/lib/client/date-format";

const FIELD_CLASS =
  "w-full rounded-xl border border-slate-700 bg-slate-900/80 px-3.5 py-2 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-400/60 focus:shadow-[0_0_0_3px_rgba(34,211,238,0.08)]";

export default function SendAssessmentModal({
  isOpen,
  onClose,
  defaultJobId,
  defaultCandidateName,
  defaultCandidateEmail,
}) {
  const searchParams = useAuthSearchParams();
  const [jobs, setJobs] = useState([]);
  const [assessments, setAssessments] = useState([]);
  const [jobId, setJobId] = useState(defaultJobId ?? "");
  const [assessmentId, setAssessmentId] = useState("");
  const [candidateEmail, setCandidateEmail] = useState(defaultCandidateEmail ?? "");
  const [candidateName, setCandidateName] = useState(defaultCandidateName ?? "");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (!isOpen) return;

    setJobId(defaultJobId ?? "");
    setAssessmentId("");
    setCandidateEmail(defaultCandidateEmail ?? "");
    setCandidateName(defaultCandidateName ?? "");
    setResult(null);

    fetch(buildAuthUrl("/api/jobs?view=selector", searchParams), { credentials: "include" })
      .then((res) => res.json())
      .then((data) => setJobs(Array.isArray(data?.jobs) ? data.jobs : []))
      .catch(() => setJobs([]));

    fetch(buildAuthUrl("/api/assessments?status=PUBLISHED&pageSize=100", searchParams), { credentials: "include" })
      .then((res) => res.json())
      .then((data) => setAssessments(Array.isArray(data?.data?.assessments) ? data.data.assessments : []))
      .catch(() => setAssessments([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, defaultJobId, defaultCandidateName, defaultCandidateEmail]);

  const assessmentsForJob = useMemo(
    () => assessments.filter((a) => !jobId || a.jobId === jobId),
    [assessments, jobId]
  );

  if (!isOpen) return null;

  const handleClose = () => {
    setResult(null);
    onClose?.();
  };

  const handleSend = async () => {
    if (!assessmentId) {
      showActionFeedback({ tone: "error", title: "Missing details", message: "Select an assessment." });
      return;
    }
    if (!candidateEmail.trim()) {
      showActionFeedback({ tone: "error", title: "Missing details", message: "Enter the candidate's email address." });
      return;
    }

    try {
      setLoading(true);
      const res = await fetch(
        buildAuthUrl(`/api/assessments/${assessmentId}/invite`, searchParams),
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            candidateEmail: candidateEmail.trim(),
            candidateName: candidateName.trim() || undefined,
          }),
        }
      );

      const data = await res.json();

      if (!res.ok) {
        const message = data?.error?.message || "Failed to send assessment";
        showActionFeedback({ tone: "error", title: "Send failed", message });
        return;
      }

      setResult(data?.data);
      showActionFeedback({
        tone: "success",
        title: "Assessment sent",
        message: data?.data?.emailSent
          ? "The candidate has been emailed the assessment link."
          : "Invite created, but the email could not be sent. Share the link manually.",
      });
    } catch (err) {
      showActionFeedback({
        tone: "error",
        title: "Send failed",
        message: err instanceof Error ? err.message : "Something went wrong",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="hv-theme-dialog-backdrop fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/80 px-4 py-4 backdrop-blur-md sm:py-6"
      role="dialog"
      aria-modal="true"
    >
      <div className="hv-theme-modal relative w-full max-w-2xl overflow-hidden rounded-[28px] border border-cyan-500/20 bg-[#0a1020]/95 text-white shadow-[0_0_60px_rgba(34,211,238,0.16)]">
        <div className="relative max-h-[calc(100dvh-2rem)] overflow-y-auto p-5 sm:max-h-[calc(100dvh-3rem)] sm:p-6 md:p-8">
          <div className="mb-6 flex items-start justify-between gap-4 border-b border-slate-800/80 pb-5">
            <div>
              <span className="inline-flex items-center gap-2 rounded-full border border-cyan-400/25 bg-cyan-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-200">
                <span className="h-1.5 w-1.5 rounded-full bg-cyan-300" aria-hidden="true" />
                VERIS Assessment
              </span>
              <h2 className="mt-3 text-2xl font-semibold tracking-tight text-white">Send Assessment</h2>
              <p className="mt-1.5 max-w-xl text-sm leading-6 text-slate-400">
                Invite a candidate to a published VERIS Assessment. Independent of Screening or the interview link.
              </p>
            </div>
            <button
              onClick={handleClose}
              className="rounded-full border border-slate-700/80 bg-slate-900/80 px-3.5 py-1.5 text-sm text-slate-300 transition hover:border-cyan-400/60 hover:text-white"
            >
              Close
            </button>
          </div>

          {result ? (
            <div className="space-y-4">
              <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-100">
                Invite created{result.emailSent ? " and emailed to the candidate." : "."}
              </div>
              {result.creditWarning ? (
                <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100">
                  {result.creditWarning}
                </div>
              ) : null}
              {result.emailError ? (
                <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-100">
                  Email delivery failed: {result.emailError}
                </div>
              ) : null}
              <div className="rounded-2xl border border-slate-800 bg-slate-950/50 p-4">
                <div className="mb-2 text-xs uppercase tracking-[0.18em] text-slate-500">Assessment Link</div>
                <div className="flex items-center gap-2">
                  <input readOnly value={result.assessmentUrl ?? ""} className={FIELD_CLASS} />
                  <button
                    type="button"
                    onClick={() => copyText(result.assessmentUrl ?? "")}
                    className="rounded-xl border border-slate-700 bg-slate-900/80 px-3.5 py-2 text-sm text-slate-200 transition hover:text-white"
                  >
                    Copy
                  </button>
                </div>
                {result.invite?.expiresAt ? (
                  <div className="mt-2 text-xs text-slate-500">Expires {formatDateTime(result.invite.expiresAt)}</div>
                ) : null}
              </div>
              <div className="flex justify-end">
                <button
                  onClick={handleClose}
                  className="rounded-full bg-cyan-500/90 px-5 py-2 text-sm font-semibold text-white transition hover:bg-cyan-500"
                >
                  Done
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="mb-2 block text-sm text-slate-300">Job</label>
                <select value={jobId} onChange={(e) => setJobId(e.target.value)} className={FIELD_CLASS}>
                  <option value="">All Jobs</option>
                  {jobs.map((job) => (
                    <option key={job.jobId} value={job.jobId}>
                      {job.jobTitle}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-2 block text-sm text-slate-300">Assessment</label>
                <p className="mb-2 text-xs text-slate-400">
                  Only assessments you&apos;ve published are shown here — drafts and AI-generated questions still
                  awaiting your review can&apos;t be sent to a candidate yet.
                </p>
                <select value={assessmentId} onChange={(e) => setAssessmentId(e.target.value)} className={FIELD_CLASS}>
                  <option value="">Select a published assessment</option>
                  {assessmentsForJob.map((assessment) => (
                    <option key={assessment.id} value={assessment.id}>
                      {assessment.title}
                    </option>
                  ))}
                </select>
                {assessmentsForJob.length === 0 ? (
                  <p className="mt-1.5 text-xs text-amber-300/90">
                    No published assessments{jobId ? " for this job" : ""} yet. Publish one from the Assessments page first.
                  </p>
                ) : null}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-2 block text-sm text-slate-300">Candidate Email</label>
                  <input
                    type="email"
                    value={candidateEmail}
                    onChange={(e) => setCandidateEmail(e.target.value)}
                    placeholder="candidate@example.com"
                    className={FIELD_CLASS}
                  />
                </div>
                <div>
                  <label className="mb-2 block text-sm text-slate-300">Candidate Name (optional)</label>
                  <input
                    value={candidateName}
                    onChange={(e) => setCandidateName(e.target.value)}
                    placeholder="Full name"
                    className={FIELD_CLASS}
                  />
                </div>
                <p className="sm:col-span-2 text-xs text-slate-500">
                  If this email isn&apos;t already a candidate in your workspace, one will be created automatically.
                </p>
              </div>

              <div className="flex items-center justify-end gap-3 border-t border-slate-800/80 pt-5">
                <button
                  onClick={handleClose}
                  className="rounded-full border border-slate-700 bg-slate-900/80 px-4 py-2 text-sm text-slate-300 transition hover:text-white"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSend}
                  disabled={loading || !assessmentId || !candidateEmail.trim()}
                  className="rounded-full bg-cyan-500/90 px-5 py-2 text-sm font-semibold text-white transition hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loading ? "Sending..." : "Send Assessment"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
