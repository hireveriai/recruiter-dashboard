"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuthSearchParams } from "@/lib/client/use-auth-search-params";

import { showActionFeedback } from "@/lib/client/action-feedback";
import { buildAuthUrl } from "@/lib/client/auth-query";
import { copyText } from "@/lib/client/copy-to-clipboard";
import { formatDateTime } from "@/lib/client/date-format";

// Same control styling as the Create Job modal. Slate and cyan are remapped by
// the light theme (globals.css), so one set of classes serves both themes.
const FIELD_CLASS =
  "w-full rounded-xl border border-slate-700 bg-slate-900/80 px-3.5 py-2 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-300/70 focus:shadow-[0_0_0_3px_rgba(34,211,238,0.12)]";

const FIELD_ERROR_CLASS = "border-rose-400/70 focus:border-rose-300 focus:shadow-[0_0_0_3px_rgba(244,63,94,0.12)]";

const DIFFICULTY_LABELS = { JUNIOR: "Junior", MID: "Mid", SENIOR: "Senior" };

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value ?? "").trim());
}

function Section({ step, title, description, children }) {
  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-cyan-400/15 text-xs font-semibold text-cyan-200"
        >
          {step}
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-white">{title}</h3>
          {description ? <p className="mt-0.5 text-xs leading-5 text-slate-400">{description}</p> : null}
        </div>
      </div>
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  );
}

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
  const [emailTouched, setEmailTouched] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    setJobId(defaultJobId ?? "");
    setAssessmentId("");
    setCandidateEmail(defaultCandidateEmail ?? "");
    setCandidateName(defaultCandidateName ?? "");
    setResult(null);
    setEmailTouched(false);
    setCopied(false);

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

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(timer);
  }, [copied]);

  if (!isOpen) return null;

  const handleClose = () => {
    setResult(null);
    onClose?.();
  };

  const emailInvalid = candidateEmail.trim() !== "" && !isValidEmail(candidateEmail);
  const showEmailError = emailTouched && emailInvalid;

  const handleSend = async () => {
    if (!assessmentId) {
      showActionFeedback({ tone: "error", title: "Missing details", message: "Select an assessment." });
      return;
    }
    if (!candidateEmail.trim()) {
      showActionFeedback({ tone: "error", title: "Missing details", message: "Enter the candidate's email address." });
      return;
    }
    // The invite API only accepts a well-formed email (inviteAssessmentSchema).
    if (emailInvalid) {
      setEmailTouched(true);
      showActionFeedback({ tone: "error", title: "Missing details", message: "Enter a valid email address." });
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

  const copyLink = async () => {
    const ok = await copyText(result?.assessmentUrl ?? "");
    setCopied(Boolean(ok));
  };

  // Clears the candidate but keeps the chosen assessment, for inviting the
  // next person to the same test.
  const sendAnother = () => {
    setResult(null);
    setCandidateEmail("");
    setCandidateName("");
    setEmailTouched(false);
    setCopied(false);
  };

  const selectedAssessment = assessments.find((a) => a.id === assessmentId) ?? null;
  const assessmentFacts = selectedAssessment
    ? [
        selectedAssessment.durationMinutes ? `${selectedAssessment.durationMinutes} min` : null,
        selectedAssessment.questionCount ? `${selectedAssessment.questionCount} questions` : null,
        selectedAssessment.passingPercentage !== undefined && selectedAssessment.passingPercentage !== null
          ? `Pass ${Number(selectedAssessment.passingPercentage)}%`
          : null,
        DIFFICULTY_LABELS[selectedAssessment.difficulty] ?? null,
        selectedAssessment.linkExpiryDays ? `Link valid ${selectedAssessment.linkExpiryDays} days` : null,
      ].filter(Boolean)
    : [];

  return (
    <div
      className="hv-theme-dialog-backdrop fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/80 px-3 py-3 backdrop-blur-md sm:items-center sm:px-4 sm:py-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="send-assessment-title"
    >
      <div className="hv-send-assessment-modal hv-theme-modal relative flex max-h-[calc(100dvh-1.5rem)] w-full max-w-2xl flex-col overflow-hidden rounded-[24px] border border-slate-700/70 bg-[#0a1020]/95 text-white shadow-[0_30px_80px_rgba(2,6,23,0.55)] sm:max-h-[calc(100dvh-3rem)]">
        <div className="flex flex-none items-start justify-between gap-4 border-b border-slate-800 px-5 py-3.5 sm:px-7 sm:py-5 [@media(max-height:720px)]:sm:py-3.5">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-300">VERIS Assessment</p>
            <h2 id="send-assessment-title" className="mt-1 text-xl font-semibold tracking-tight text-white sm:text-2xl">
              Send Assessment
            </h2>
            <p className="mt-1 hidden max-w-xl text-sm leading-6 text-slate-400 sm:block [@media(max-height:720px)]:hidden">
              Invite a candidate to a published VERIS Assessment. Independent of Screening or the interview link.
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="flex-none rounded-full border border-slate-700/80 bg-slate-900/80 px-3.5 py-1.5 text-sm text-slate-300 transition hover:border-cyan-300/60 hover:text-white"
          >
            Close
          </button>
        </div>

        {result ? (
          <>
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5 sm:px-7 sm:py-6" aria-live="polite">
              <section className="rounded-2xl border border-emerald-400/25 bg-emerald-500/[0.08] p-4 sm:p-5">
                <div className="flex items-start gap-3">
                  <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-emerald-400/15 text-emerald-200">
                    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-white">
                      Invite created{result.emailSent ? " and emailed to the candidate." : "."}
                    </p>
                    {selectedAssessment ? (
                      <p className="mt-0.5 text-xs text-slate-400">
                        {selectedAssessment.title} · {candidateEmail.trim()}
                      </p>
                    ) : null}
                  </div>
                </div>
              </section>
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
              <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Assessment Link</p>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <input
                    readOnly
                    aria-label="Assessment link"
                    value={result.assessmentUrl ?? ""}
                    onFocus={(event) => event.target.select()}
                    className={`${FIELD_CLASS} min-w-0 flex-1 font-mono text-xs`}
                  />
                  <button
                    type="button"
                    onClick={copyLink}
                    className="flex-none rounded-xl border border-slate-600 bg-slate-900/90 px-4 py-2 text-sm text-slate-100 transition hover:border-cyan-300/60"
                  >
                    {copied ? "Copied" : "Copy"}
                  </button>
                </div>
                {result.invite?.expiresAt ? (
                  <p className="mt-2 text-xs text-slate-500">Expires {formatDateTime(result.invite.expiresAt)}</p>
                ) : null}
              </div>
            </div>
            <div className="flex flex-none gap-2 border-t border-slate-800 bg-slate-950/40 px-5 py-3 sm:justify-end sm:px-7 sm:py-3.5 [&>button]:flex-1 sm:[&>button]:flex-none">
              <button
                type="button"
                onClick={sendAnother}
                className="rounded-xl border border-slate-700 bg-slate-900/80 px-5 py-2.5 text-sm text-slate-200 transition hover:border-slate-500 hover:bg-slate-800"
              >
                Send another
              </button>
              <button
                type="button"
                onClick={handleClose}
                className="hv-solid-action rounded-xl bg-cyan-600 px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-cyan-500"
              >
                Done
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5 sm:px-7 sm:py-6">
              <Section step={1} title="Assessment" description="Only assessments you've published can be sent.">
                <div>
                  <label htmlFor="send_assessment_job" className="mb-1.5 block text-sm text-slate-300">
                    Job
                  </label>
                  <select id="send_assessment_job" value={jobId} onChange={(e) => setJobId(e.target.value)} className={FIELD_CLASS}>
                    <option value="">All Jobs</option>
                    {jobs.map((job) => (
                      <option key={job.jobId} value={job.jobId}>
                        {job.jobTitle}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="send_assessment_assessment" className="mb-1.5 block text-sm text-slate-300">
                    Assessment <span className="text-rose-300" aria-hidden="true">*</span>
                  </label>
                  <select
                    id="send_assessment_assessment"
                    value={assessmentId}
                    onChange={(e) => setAssessmentId(e.target.value)}
                    className={FIELD_CLASS}
                  >
                    <option value="">Select a published assessment</option>
                    {assessmentsForJob.map((assessment) => (
                      <option key={assessment.id} value={assessment.id}>
                        {assessment.title}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1.5 text-xs leading-5 text-slate-400">
                    Only assessments you&apos;ve published are shown here — drafts and AI-generated questions still
                    awaiting your review can&apos;t be sent to a candidate yet.
                  </p>
                  {assessmentsForJob.length === 0 ? (
                    <p className="mt-1.5 text-xs text-amber-300/90">
                      No published assessments{jobId ? " for this job" : ""} yet. Publish one from the{" "}
                      <a href={buildAuthUrl("/assessments", searchParams)} className="font-semibold underline underline-offset-2">
                        Assessments page
                      </a>{" "}
                      first.
                    </p>
                  ) : null}
                  {assessmentFacts.length > 0 ? (
                    <ul className="mt-2.5 flex flex-wrap gap-1.5" aria-label="Assessment settings">
                      {assessmentFacts.map((fact) => (
                        <li
                          key={fact}
                          className="rounded-full border border-slate-700 bg-slate-900/60 px-2.5 py-0.5 text-xs text-slate-300"
                        >
                          {fact}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </Section>

              <Section step={2} title="Candidate" description="Who receives the assessment link.">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label htmlFor="send_assessment_email" className="mb-1.5 block text-sm text-slate-300">
                      Candidate Email <span className="text-rose-300" aria-hidden="true">*</span>
                    </label>
                    <input
                      id="send_assessment_email"
                      type="email"
                      value={candidateEmail}
                      onChange={(e) => setCandidateEmail(e.target.value)}
                      onBlur={() => setEmailTouched(true)}
                      placeholder="candidate@example.com"
                      aria-invalid={showEmailError}
                      aria-describedby={showEmailError ? "send_assessment_email_error" : undefined}
                      className={`${FIELD_CLASS} ${showEmailError ? FIELD_ERROR_CLASS : ""}`}
                    />
                    {showEmailError ? (
                      <p id="send_assessment_email_error" className="mt-1.5 text-xs text-rose-300">
                        Enter a valid email address.
                      </p>
                    ) : null}
                  </div>
                  <div>
                    <label htmlFor="send_assessment_name" className="mb-1.5 block text-sm text-slate-300">
                      Candidate Name (optional)
                    </label>
                    <input
                      id="send_assessment_name"
                      value={candidateName}
                      onChange={(e) => setCandidateName(e.target.value)}
                      placeholder="Full name"
                      className={FIELD_CLASS}
                    />
                  </div>
                </div>
                <p className="text-xs text-slate-500">
                  If this email isn&apos;t already a candidate in your workspace, one will be created automatically.
                </p>
              </Section>
            </div>

            <div className="flex flex-none gap-2 border-t border-slate-800 bg-slate-950/40 px-5 py-3 sm:justify-end sm:px-7 sm:py-3.5 [&>button]:flex-1 sm:[&>button]:flex-none">
              <button
                type="button"
                onClick={handleClose}
                className="rounded-xl border border-slate-700 bg-slate-900/80 px-5 py-2.5 text-sm text-slate-200 transition hover:border-slate-500 hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSend}
                disabled={loading || !assessmentId || !candidateEmail.trim()}
                className="hv-solid-action rounded-xl bg-cyan-600 px-6 py-2.5 text-sm font-semibold text-white shadow-[0_10px_20px_rgba(8,145,178,0.22)] transition hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading ? "Sending..." : "Send Assessment"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
