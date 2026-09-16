"use client";

import { useEffect, useState } from "react";
import { useAuthSearchParams } from "@/lib/client/use-auth-search-params";

import { showActionFeedback } from "@/lib/client/action-feedback";
import { buildAuthUrl } from "@/lib/client/auth-query";

const FIELD_CLASS =
  "w-full rounded-xl border border-slate-700 bg-slate-900/80 px-3.5 py-2 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-violet-400/60 focus:shadow-[0_0_0_3px_rgba(139,92,246,0.08)]";

const SELECT_CLASS = FIELD_CLASS.replace("w-full", "w-full max-w-[260px]");

const QUESTION_TYPE_OPTIONS = [
  { value: "SINGLE_CHOICE", label: "Single Choice" },
  { value: "MULTI_SELECT", label: "Multi Select" },
  { value: "SHORT_ANSWER", label: "Short Answer" },
  { value: "SCENARIO", label: "Scenario" },
  { value: "CODING", label: "Coding" },
];

const ACTIVITY_TYPE_OPTIONS = [
  { value: "ASSESSMENT", label: "Assessment", hint: "What do you know?" },
  { value: "CHALLENGE", label: "Challenge", hint: "Can you solve this problem?" },
  { value: "TASK", label: "Task", hint: "Can you perform this work?" },
];

const DEFAULT_FORM = {
  jobId: "",
  title: "",
  description: "",
  durationMinutes: 30,
  passingPercentage: 60,
  questionCount: 10,
  difficulty: "MID",
  questionTypes: ["SINGLE_CHOICE", "SHORT_ANSWER"],
  randomizeQuestions: false,
  randomizeOptions: false,
  linkExpiryDays: 7,
  blockCopyPaste: false,
  cameraMonitoring: false,
  // Defaults preserve today's candidate-assessment behavior exactly — the
  // candidate workflow looks and behaves identically unless a recruiter
  // explicitly switches Participant to Employee.
  activityType: "ASSESSMENT",
  participantType: "CANDIDATE",
  skills: "",
};

export default function CreateAssessmentModal({ open, onClose, initialAssessment, defaultJobId, onSuccess }) {
  const searchParams = useAuthSearchParams();
  const [form, setForm] = useState(DEFAULT_FORM);
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(false);

  const isEditMode = Boolean(initialAssessment?.id);

  useEffect(() => {
    if (!open) return;

    fetch(buildAuthUrl("/api/jobs", searchParams), { credentials: "include" })
      .then((res) => res.json())
      .then((data) => setJobs(Array.isArray(data?.jobs) ? data.jobs : []))
      .catch(() => setJobs([]));

    if (initialAssessment) {
      setForm({
        jobId: initialAssessment.jobId ?? "",
        title: initialAssessment.title ?? "",
        description: initialAssessment.description ?? "",
        durationMinutes: initialAssessment.durationMinutes ?? 30,
        passingPercentage: Number(initialAssessment.passingPercentage ?? 60),
        questionCount: initialAssessment.questionCount ?? 10,
        difficulty: initialAssessment.difficulty ?? "MID",
        questionTypes: initialAssessment.questionTypes?.length ? initialAssessment.questionTypes : ["SINGLE_CHOICE"],
        randomizeQuestions: Boolean(initialAssessment.randomizeQuestions),
        randomizeOptions: Boolean(initialAssessment.randomizeOptions),
        linkExpiryDays: initialAssessment.linkExpiryDays ?? 7,
        blockCopyPaste: Boolean(initialAssessment.settings?.security?.blockCopyPaste),
        cameraMonitoring: Boolean(initialAssessment.settings?.security?.cameraMonitoring),
        activityType: initialAssessment.activityType ?? "ASSESSMENT",
        participantType: initialAssessment.participantType ?? "CANDIDATE",
        skills: Array.isArray(initialAssessment.skills) ? initialAssessment.skills.join(", ") : "",
      });
    } else {
      setForm({ ...DEFAULT_FORM, jobId: defaultJobId ?? "" });
    }
  }, [open, initialAssessment, defaultJobId, searchParams]);

  if (!open) return null;

  const handleChange = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  // Picking a job shouldn't force the recruiter to also type a title by hand -
  // default it from the job, but never clobber something they already typed.
  const handleJobChange = (jobId) => {
    const job = jobs.find((j) => (j.jobId ?? j.job_id) === jobId);
    const jobTitle = job?.jobTitle ?? job?.job_title ?? "";
    setForm((current) => ({
      ...current,
      jobId,
      title: current.title.trim() === "" ? (jobTitle ? `${jobTitle} Assessment` : "") : current.title,
    }));
  };

  const toggleQuestionType = (value) => {
    setForm((current) => {
      const has = current.questionTypes.includes(value);
      const next = has
        ? current.questionTypes.filter((t) => t !== value)
        : [...current.questionTypes, value];
      return { ...current, questionTypes: next };
    });
  };

  const handleSubmit = async () => {
    // Job is required for a candidate activity ("is this candidate suitable
    // for this open job?") but never for an employee activity ("does this
    // employee have the required knowledge/skill/ability?", which has no
    // inherent job to attach to).
    const jobRequired = form.participantType !== "EMPLOYEE";
    if ((jobRequired && !form.jobId) || !form.title.trim()) {
      showActionFeedback({
        tone: "error",
        title: "Missing details",
        message: jobRequired ? "Job and title are required." : "Title is required.",
      });
      return;
    }

    try {
      setLoading(true);

      const payload = {
        jobId: form.jobId || null,
        title: form.title.trim(),
        description: form.description?.trim() || null,
        durationMinutes: Number(form.durationMinutes),
        passingPercentage: Number(form.passingPercentage),
        questionCount: form.questionCount ? Number(form.questionCount) : null,
        difficulty: form.difficulty || null,
        questionTypes: form.questionTypes,
        randomizeQuestions: Boolean(form.randomizeQuestions),
        randomizeOptions: Boolean(form.randomizeOptions),
        linkExpiryDays: Number(form.linkExpiryDays),
        security: {
          blockCopyPaste: Boolean(form.blockCopyPaste),
          cameraMonitoring: Boolean(form.cameraMonitoring),
        },
        activityType: form.activityType,
        participantType: form.participantType,
        skills: form.skills
          ? form.skills.split(",").map((s) => s.trim()).filter(Boolean)
          : [],
      };

      const endpoint = isEditMode
        ? buildAuthUrl(`/api/assessments/${initialAssessment.id}`, searchParams)
        : buildAuthUrl("/api/assessments", searchParams);
      const method = isEditMode ? "PATCH" : "POST";

      const res = await fetch(endpoint, {
        method,
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok) {
        const message = data?.error?.message || "Failed to save assessment";
        showActionFeedback({ tone: "error", title: "Save failed", message });
        return;
      }

      showActionFeedback({
        tone: "success",
        title: isEditMode ? "Assessment updated" : "Assessment created",
        message: isEditMode ? "Configuration saved." : "Draft assessment created. Add questions next.",
      });

      onSuccess?.(data?.data);
      onClose?.();
    } catch (err) {
      showActionFeedback({
        tone: "error",
        title: "Save failed",
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
      <div className="hv-theme-modal relative w-full max-w-3xl overflow-hidden rounded-[28px] border border-violet-500/20 bg-[#0a1020]/95 text-white shadow-[0_0_60px_rgba(139,92,246,0.18)]">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(99,102,241,0.18),transparent_32%),radial-gradient(circle_at_bottom_right,rgba(59,130,246,0.14),transparent_28%)]" />
        <div className="relative max-h-[calc(100dvh-2rem)] overflow-y-auto p-5 sm:max-h-[calc(100dvh-3rem)] sm:p-6 md:p-8">
          <div className="mb-6 flex items-start justify-between gap-4 border-b border-slate-800/80 pb-5">
            <div className="min-w-0">
              <span className="inline-flex items-center gap-2 rounded-full border border-violet-400/25 bg-violet-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-violet-200">
                <span className="h-1.5 w-1.5 rounded-full bg-violet-300" aria-hidden="true" />
                VERIS Assessment
              </span>
              <h2 className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-[28px]">
                {isEditMode ? "Edit Assessment" : "Create Assessment"}
              </h2>
              <p className="mt-1.5 max-w-2xl text-sm leading-6 text-slate-400">
                Configure a scored skills test. Add or generate questions after saving.
              </p>
            </div>
            <button
              onClick={onClose}
              className="rounded-full border border-slate-700/80 bg-slate-900/80 px-3.5 py-1.5 text-sm text-slate-300 transition hover:border-violet-400/60 hover:text-white"
            >
              Close
            </button>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {!isEditMode && (
              <>
                <div>
                  <label className="mb-2 block text-sm text-slate-300">Participant</label>
                  <select
                    value={form.participantType}
                    onChange={(e) => handleChange("participantType", e.target.value)}
                    className={SELECT_CLASS}
                  >
                    <option value="CANDIDATE">Candidate</option>
                    <option value="EMPLOYEE">Employee</option>
                  </select>
                </div>

                <div>
                  <label className="mb-2 block text-sm text-slate-300">Activity Type</label>
                  <select
                    value={form.activityType}
                    onChange={(e) => handleChange("activityType", e.target.value)}
                    className={SELECT_CLASS}
                  >
                    {ACTIVITY_TYPE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label} — {option.hint}
                      </option>
                    ))}
                  </select>
                </div>

                {form.participantType === "EMPLOYEE" && (
                  <div className="md:col-span-2">
                    <label className="mb-2 block text-sm text-slate-300">Skills / Competencies (comma separated)</label>
                    <input
                      value={form.skills}
                      onChange={(e) => handleChange("skills", e.target.value)}
                      placeholder="e.g. Negotiation, Conflict Resolution, Financial Analysis, SQL — any technical, functional, or behavioral skill"
                      className={FIELD_CLASS}
                    />
                  </div>
                )}
              </>
            )}

            <div>
              <label className="mb-2 block text-sm text-slate-300">
                {form.participantType === "EMPLOYEE" ? "Job / Target Role (optional)" : "Job"}
              </label>
              <select
                value={form.jobId}
                onChange={(e) => handleJobChange(e.target.value)}
                className={SELECT_CLASS}
                disabled={isEditMode}
              >
                <option value="">{form.participantType === "EMPLOYEE" ? "No job / target role" : "Select Job"}</option>
                {jobs.map((job) => (
                  <option key={job.jobId ?? job.job_id} value={job.jobId ?? job.job_id}>
                    {job.jobTitle ?? job.job_title}
                  </option>
                ))}
              </select>
              {form.participantType === "EMPLOYEE" && (
                <p className="mt-1.5 text-xs text-slate-500">
                  Optional context only — e.g. a target role for future internal mobility. This employee&apos;s
                  activity does not need a job.
                </p>
              )}
            </div>

            <div>
              <label className="mb-2 block text-sm text-slate-300">Difficulty</label>
              <select
                value={form.difficulty}
                onChange={(e) => handleChange("difficulty", e.target.value)}
                className={SELECT_CLASS}
              >
                <option value="JUNIOR">Junior</option>
                <option value="MID">Mid</option>
                <option value="SENIOR">Senior</option>
              </select>
            </div>

            <div className="md:col-span-2">
              <label className="mb-2 block text-sm text-slate-300">Title</label>
              <input
                value={form.title}
                onChange={(e) => handleChange("title", e.target.value)}
                placeholder="Auto-filled from the selected job - edit if you'd like"
                className={FIELD_CLASS}
              />
            </div>

            <div className="md:col-span-2">
              <label className="mb-2 block text-sm text-slate-300">Description</label>
              <textarea
                value={form.description}
                onChange={(e) => handleChange("description", e.target.value)}
                placeholder="What this assessment evaluates."
                rows={3}
                className={FIELD_CLASS}
              />
            </div>

            <div>
              <label className="mb-2 block text-sm text-slate-300">Duration (minutes)</label>
              <input
                type="number"
                min={5}
                max={240}
                value={form.durationMinutes}
                onChange={(e) => handleChange("durationMinutes", e.target.value)}
                className={FIELD_CLASS}
              />
            </div>

            <div>
              <label className="mb-2 block text-sm text-slate-300">Passing Percentage</label>
              <input
                type="number"
                min={0}
                max={100}
                value={form.passingPercentage}
                onChange={(e) => handleChange("passingPercentage", e.target.value)}
                className={FIELD_CLASS}
              />
            </div>

            <div>
              <label className="mb-2 block text-sm text-slate-300">Question Count</label>
              <input
                type="number"
                min={1}
                max={100}
                value={form.questionCount}
                onChange={(e) => handleChange("questionCount", e.target.value)}
                className={FIELD_CLASS}
              />
            </div>

            <div>
              <label className="mb-2 block text-sm text-slate-300">Link Expiry (days)</label>
              <input
                type="number"
                min={1}
                max={90}
                value={form.linkExpiryDays}
                onChange={(e) => handleChange("linkExpiryDays", e.target.value)}
                className={FIELD_CLASS}
              />
            </div>

            <div className="md:col-span-2">
              <label className="mb-2 block text-sm text-slate-300">Question Types</label>
              <div className="flex flex-wrap gap-2">
                {QUESTION_TYPE_OPTIONS.map((option) => {
                  const selected = form.questionTypes.includes(option.value);
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => toggleQuestionType(option.value)}
                      className={`rounded-full border px-3.5 py-1.5 text-sm font-medium transition ${
                        selected
                          ? "border-violet-400/60 bg-violet-500/20 text-white"
                          : "border-slate-700 bg-slate-900/70 text-slate-400 hover:text-white"
                      }`}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
              {form.questionTypes.includes("CODING") ? (
                <p className="mt-2 text-xs text-slate-500">
                  {form.participantType === "EMPLOYEE" && !form.jobId
                    ? "Coding questions will be generated as requested for this employee activity."
                    : "Coding questions are only generated if this job has coding enabled (Job settings → Coding Assessment). Otherwise they're skipped automatically."}
                </p>
              ) : null}
            </div>

            <div className="md:col-span-2 flex flex-col gap-3 rounded-[20px] border border-slate-800 bg-slate-950/40 p-4 sm:flex-row sm:items-center sm:justify-between">
              <label className="flex items-center gap-2 text-sm text-slate-300">
                <input
                  type="checkbox"
                  checked={form.randomizeQuestions}
                  onChange={(e) => handleChange("randomizeQuestions", e.target.checked)}
                  className="h-4 w-4 rounded border-slate-600 bg-slate-900 text-violet-500"
                />
                Randomize question order
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-300">
                <input
                  type="checkbox"
                  checked={form.randomizeOptions}
                  onChange={(e) => handleChange("randomizeOptions", e.target.checked)}
                  className="h-4 w-4 rounded border-slate-600 bg-slate-900 text-violet-500"
                />
                Randomize option order
              </label>
            </div>

            <div className="md:col-span-2 flex flex-col gap-3 rounded-[20px] border border-slate-800 bg-slate-950/40 p-4">
              <div>
                <p className="text-sm font-medium text-slate-200">Integrity &amp; Security</p>
                <p className="mt-0.5 text-xs text-slate-500">
                  Signals are recorded for recruiter review only - VerisNova never auto-decides a candidate cheated.
                </p>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <label className="flex items-center gap-2 text-sm text-slate-300">
                  <input
                    type="checkbox"
                    checked={form.blockCopyPaste}
                    onChange={(e) => handleChange("blockCopyPaste", e.target.checked)}
                    className="h-4 w-4 rounded border-slate-600 bg-slate-900 text-violet-500"
                  />
                  Block copy/paste
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-300">
                  <input
                    type="checkbox"
                    checked={form.cameraMonitoring}
                    onChange={(e) => handleChange("cameraMonitoring", e.target.checked)}
                    className="h-4 w-4 rounded border-slate-600 bg-slate-900 text-violet-500"
                  />
                  Camera-based integrity monitoring
                </label>
              </div>
              {form.cameraMonitoring && (
                <p className="text-xs text-slate-500">
                  Candidates will be asked to grant camera access before starting. VerisNova detects face
                  presence and multiple-person presence only - no video is recorded, stored, or shown to
                  recruiters.
                </p>
              )}
            </div>
          </div>

          <div className="mt-6 flex items-center justify-end gap-3 border-t border-slate-800/80 pt-5">
            <button
              onClick={onClose}
              className="rounded-full border border-slate-700 bg-slate-900/80 px-4 py-2 text-sm text-slate-300 transition hover:text-white"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={loading}
              className="rounded-full bg-violet-500/90 px-5 py-2 text-sm font-semibold text-white shadow-[0_0_0_1px_rgba(167,139,250,0.35)] transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? "Saving..." : isEditMode ? "Save Changes" : "Create Assessment"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
