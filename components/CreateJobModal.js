"use client";

import { useEffect, useMemo, useState } from "react";
import { Laptop, MonitorSmartphone, Smartphone } from "lucide-react";
import { useAuthSearchParams } from "@/lib/client/use-auth-search-params";

import { showActionFeedback } from "@/lib/client/action-feedback";
import { buildAuthUrl } from "@/lib/client/auth-query";

const FALLBACK_LEVELS = [
  { experience_level_id: 1, label: "Fresher / Student" },
  { experience_level_id: 2, label: "Junior" },
  { experience_level_id: 3, label: "Mid" },
  { experience_level_id: 4, label: "Senior" },
];

const CODING_ASSESSMENT_OPTIONS = [
  { value: "", label: "Select Coding Assessment Type" },
  { value: "LIVE_CODING", label: "Live Coding" },
  { value: "DEBUGGING", label: "Debugging" },
  { value: "SQL", label: "SQL" },
  { value: "BACKEND_LOGIC", label: "Backend Logic" },
  { value: "DSA", label: "DSA" },
];

const INTERVIEW_DURATION_OPTIONS = [30, 45, 60];

const DEVICE_REQUIREMENT_OPTIONS = [
  {
    value: "ANY_DEVICE",
    label: "Laptop/Desktop or Mobile",
    description: "Best for general screening and maximum completion.",
    icon: MonitorSmartphone,
    badge: "Default",
  },
  {
    value: "DESKTOP_ONLY",
    label: "Laptop/Desktop Only",
    description: "Recommended for coding and technical interviews.",
    icon: Laptop,
    badge: "Recommended",
  },
  {
    value: "MOBILE_ONLY",
    label: "Mobile Only",
    description: "Useful for field roles and quick video screens.",
    icon: Smartphone,
    badge: null,
  },
];

const INTERVIEW_MODE_OPTIONS = [
  {
    value: "STANDARD",
    label: "Standard Interview",
    description:
      "Every candidate receives the same structured questionnaire, so candidates can be evaluated consistently.",
    badge: "Default",
  },
  {
    value: "INDIVIDUALIZED",
    label: "Individualized Interview",
    description:
      "Each candidate receives a different structured questionnaire, while questions remain aligned with this job's requirements, competencies, experience level, and evaluation criteria.",
    badge: null,
  },
];

const QUESTION_TYPE_OPTIONS = [
  { value: "AUTO", label: "Auto Detect" },
  { value: "coding", label: "Coding" },
  { value: "technical_discussion", label: "Technical Discussion" },
  { value: "system_design", label: "System Design" },
  { value: "behavioral", label: "Behavioral" },
  { value: "architecture", label: "Architecture" },
  { value: "troubleshooting", label: "Troubleshooting" },
  { value: "mcq", label: "MCQ" },
  { value: "case_study", label: "Case Study" },
];

// Shared control styling. Kept compact: the previous px-4 py-3 made every input
// and select noticeably taller than the text they hold.
const FIELD_CLASS =
  "w-full rounded-xl border border-slate-700 bg-slate-900/80 px-3.5 py-2 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-violet-400/60 focus:shadow-[0_0_0_3px_rgba(139,92,246,0.08)]";

function createDefaultForm() {
  return {
    job_title: "",
    job_description: "",
    experience_level_id: "",
    difficulty_profile: "MID",
    core_skills: "",
    interview_duration_minutes: 30,
    question_type_default: "AUTO",
    device_requirement: "ANY_DEVICE",
    coding_required: "NO",
    coding_assessment_type: "",
    coding_difficulty: "MEDIUM",
    coding_duration_minutes: 15,
    coding_languages: "",
    is_active: true,
    interview_mode: "STANDARD",
  };
}

function mapJobToForm(job) {
  if (!job) {
    return createDefaultForm();
  }

  return {
    job_title: job.jobTitle ?? job.job_title ?? "",
    job_description: job.jobDescription ?? job.job_description ?? "",
    experience_level_id: String(job.experienceLevelId ?? job.experience_level_id ?? ""),
    difficulty_profile: String(job.difficultyProfile ?? job.difficulty_profile ?? "MID"),
    core_skills: Array.isArray(job.coreSkills ?? job.core_skills)
      ? (job.coreSkills ?? job.core_skills).join(", ")
      : "",
    interview_duration_minutes: Number(
      job.interviewDurationMinutes ?? job.interview_duration_minutes ?? 30
    ),
    question_type_default:
      job.questionTypeDefault ?? job.question_type_default ?? "AUTO",
    device_requirement: job.deviceRequirement ?? job.device_requirement ?? "ANY_DEVICE",
    coding_required: job.codingRequired ?? job.coding_required ?? "NO",
    coding_assessment_type: job.codingAssessmentType ?? job.coding_assessment_type ?? "",
    coding_difficulty: job.codingDifficulty ?? job.coding_difficulty ?? "MEDIUM",
    coding_duration_minutes: Number(
      job.codingDurationMinutes ?? job.coding_duration_minutes ?? 15
    ),
    coding_languages: Array.isArray(job.codingLanguages ?? job.coding_languages)
      ? (job.codingLanguages ?? job.coding_languages).join(", ")
      : "",
    is_active: job.isActive ?? job.is_active ?? true,
    // Existing jobs keep whatever mode they already have. Only brand new jobs
    // default to STANDARD, so nothing already running changes behaviour.
    interview_mode: job.interviewMode ?? job.interview_mode ?? "INDIVIDUALIZED",
  };
}

function NoticeModal({ open, title, message, onClose, tone = "error" }) {
  if (!open) {
    return null;
  }

  const toneClass =
    tone === "success"
      ? "border-emerald-400/25 bg-emerald-500/10 text-emerald-100"
      : "border-rose-400/25 bg-rose-500/10 text-rose-100";

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/80 px-4 backdrop-blur-md">
      <div className="hv-preserve-dark w-full max-w-xl rounded-[28px] border border-cyan-400/20 bg-[linear-gradient(180deg,rgba(15,23,42,0.98),rgba(9,14,28,0.98))] p-6 shadow-[0_0_80px_rgba(34,211,238,0.12)]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-2xl font-semibold text-white">{title}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-cyan-400/25 bg-cyan-400/10 px-4 py-2 text-sm text-cyan-100 transition hover:bg-cyan-400/20"
          >
            Close
          </button>
        </div>
        <div className={`mt-6 rounded-2xl border p-4 text-sm ${toneClass}`}>{message}</div>
        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-2xl bg-white px-5 py-2.5 text-sm font-medium text-slate-900 transition hover:bg-slate-100"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}

export default function CreateJobModal({
  open,
  setOpen,
  mode = "create",
  initialJob = null,
  onSuccess,
}) {
  const searchParams = useAuthSearchParams();
  const [loading, setLoading] = useState(false);
  const [levels, setLevels] = useState([]);
  const [notice, setNotice] = useState({ open: false, title: "", message: "", tone: "error" });
  const [form, setForm] = useState(createDefaultForm);

  const isEditMode = mode === "edit";
  const actionLabel = isEditMode ? "Save Changes" : "Create Job";
  const loadingLabel = isEditMode ? "Saving..." : "Creating...";
  const showCodingDetails = form.coding_required !== "NO";
  // Only an existing job has a questionnaire to review. A brand new job goes
  // straight to its questionnaire after Create, so no link is needed here.
  const jobIdForQuestions = initialJob?.jobId ?? initialJob?.job_id ?? null;

  const resetModalState = () => {
    setForm(createDefaultForm());
    setLoading(false);
    setNotice({ open: false, title: "", message: "", tone: "error" });
  };

  useEffect(() => {
    if (!open) {
      resetModalState();
      return;
    }

    setForm(mapJobToForm(isEditMode ? initialJob : null));
  }, [initialJob, isEditMode, open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    fetch(buildAuthUrl("/api/experience-levels", searchParams), { credentials: "include" })
      .then(async (res) => {
        const data = await res.json();

        if (!res.ok) {
          throw new Error(data?.error?.message || "Failed to load levels");
        }

        return Array.isArray(data) ? data : [];
      })
      .then((data) => setLevels(data))
      .catch((err) => {
        console.error("Failed to load levels", err);
        setLevels(FALLBACK_LEVELS);
      });
  }, [open, searchParams]);

  const levelOptions = useMemo(
    () => (levels.length > 0 ? levels : FALLBACK_LEVELS),
    [levels]
  );

  const handleChange = (key, value) => {
    setForm((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  const resetForm = () => {
    setForm(createDefaultForm());
  };

  const handleClose = () => {
    resetModalState();
    setOpen(false);
  };

  const handleSubmit = async () => {
    try {
      setLoading(true);

      const payload = {
        ...form,
        experience_level_id: Number(form.experience_level_id),
        interview_duration_minutes: Number(form.interview_duration_minutes),
        device_requirement: form.device_requirement,
        coding_assessment_type: form.coding_assessment_type || null,
        coding_difficulty: form.coding_difficulty || null,
        coding_duration_minutes:
          form.coding_duration_minutes === "" || form.coding_duration_minutes === null
            ? null
            : Number(form.coding_duration_minutes),
        core_skills: form.core_skills
          .split(",")
          .map((skill) => skill.trim())
          .filter(Boolean),
        coding_languages: form.coding_languages
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
        skill_baseline: [],
        is_active: Boolean(form.is_active),
        interview_mode: form.interview_mode,
      };

      const endpoint = isEditMode
        ? buildAuthUrl(`/api/jobs/${initialJob?.jobId ?? initialJob?.job_id}`, searchParams)
        : buildAuthUrl("/api/jobs/create", searchParams);
      const method = isEditMode ? "PATCH" : "POST";

      const res = await fetch(endpoint, {
        method,
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok) {
        const message = data?.error?.message || data?.message || "Failed to save job";
        setNotice({
          open: true,
          title: isEditMode ? "Unable to update job" : "Unable to create job",
          message,
          tone: "error",
        });
        showActionFeedback({
          tone: "error",
          title: isEditMode ? "Job update failed" : "Job creation failed",
          message,
        });
        return;
      }

      if (!isEditMode) {
        resetForm();
      }

      // Hand the new job id back so the caller can send the recruiter straight
      // to the questionnaire review step.
      onSuccess?.(isEditMode ? null : data?.data?.job_id ?? data?.job_id ?? null);
      showActionFeedback({
        tone: "success",
        title: isEditMode ? "Job updated successfully" : "Job created successfully",
        message: isEditMode
          ? "The role configuration has been saved."
          : "The job is ready for candidate evaluation.",
      });
      handleClose();
    } catch (err) {
      console.error(err);
      const message = err instanceof Error ? err.message : "Something went wrong";
      setNotice({
        open: true,
        title: isEditMode ? "Unable to update job" : "Unable to create job",
        message,
        tone: "error",
      });
      showActionFeedback({
        tone: "error",
        title: isEditMode ? "Job update failed" : "Job creation failed",
        message,
      });
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;

  return (
    <>
      <div className="hv-theme-dialog-backdrop fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/80 px-4 py-4 backdrop-blur-md sm:py-6" role="dialog" aria-modal="true">
        <div className="hv-create-job-modal hv-theme-modal relative w-full max-w-5xl overflow-hidden rounded-[28px] border border-violet-500/20 bg-[#0a1020]/95 text-white shadow-[0_0_60px_rgba(139,92,246,0.18)]">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(99,102,241,0.18),transparent_32%),radial-gradient(circle_at_bottom_right,rgba(59,130,246,0.14),transparent_28%)]" />
          <div className="relative max-h-[calc(100dvh-2rem)] overflow-y-auto p-5 sm:max-h-[calc(100dvh-3rem)] sm:p-6 md:p-8">
            <div className="mb-6 flex items-start justify-between gap-4 border-b border-slate-800/80 pb-5">
              <div className="min-w-0">
                <span className="inline-flex items-center gap-2 rounded-full border border-violet-400/25 bg-violet-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-violet-200">
                  <span className="h-1.5 w-1.5 rounded-full bg-violet-300" aria-hidden="true" />
                  Role Configuration
                </span>
                <h2 className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-[28px]">
                  {isEditMode ? "Edit Job" : "Create Job"}
                </h2>
                <p className="mt-1.5 max-w-2xl text-sm leading-6 text-slate-400">
                  Define the role, experience level, and evaluation context VERIS uses to build
                  the interview for this job.
                </p>
              </div>

              <div className="flex flex-none items-center gap-2">
                {isEditMode && jobIdForQuestions ? (
                  <a
                    href={buildAuthUrl(`/jobs/${jobIdForQuestions}/questionnaire`, searchParams)}
                    className="rounded-full border border-violet-400/40 bg-violet-500/10 px-3.5 py-1.5 text-sm font-medium text-violet-100 transition hover:bg-violet-500/20"
                  >
                    Questions
                  </a>
                ) : null}
                <button
                  onClick={handleClose}
                  className="rounded-full border border-slate-700/80 bg-slate-900/80 px-3.5 py-1.5 text-sm text-slate-300 transition hover:border-violet-400/60 hover:text-white"
                >
                  Close
                </button>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="md:col-span-2">
                <label className="mb-2 block text-sm text-slate-300">Job Title</label>
                <input
                  value={form.job_title}
                  onChange={(e) => handleChange("job_title", e.target.value)}
                  placeholder="Principal Data Engineer"
                  className={FIELD_CLASS}
                />
              </div>

              <div>
                <label className="mb-2 block text-sm text-slate-300">Experience Level</label>
                <select
                  value={form.experience_level_id}
                  onChange={(e) => handleChange("experience_level_id", e.target.value)}
                  className={FIELD_CLASS}
                >
                  <option value="">Select Experience Level</option>
                  {levelOptions.map((lvl) => (
                    <option key={lvl.experience_level_id} value={lvl.experience_level_id}>
                      {lvl.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-2 block text-sm text-slate-300">Difficulty Profile</label>
                <select
                  value={form.difficulty_profile}
                  onChange={(e) => handleChange("difficulty_profile", e.target.value)}
                  className={FIELD_CLASS}
                >
                  <option value="JUNIOR">Junior</option>
                  <option value="MID">Mid</option>
                  <option value="SENIOR">Senior</option>
                </select>
              </div>

              <div className="md:col-span-2">
                <label className="mb-2 block text-sm text-slate-300">Job Description</label>
                <textarea
                  value={form.job_description}
                  onChange={(e) => handleChange("job_description", e.target.value)}
                  placeholder="Describe the responsibilities, expectations, and requirements for this role."
                  rows={4}
                  className={FIELD_CLASS}
                />
              </div>

              <div className="md:col-span-2">
                <label className="mb-2 block text-sm text-slate-300">Core Skills</label>
                <input
                  value={form.core_skills}
                  onChange={(e) => handleChange("core_skills", e.target.value)}
                  placeholder="Enter the key skills, qualifications, competencies, or requirements for this role."
                  className={FIELD_CLASS}
                />
              </div>

              <div className="md:col-span-2 flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="flex flex-none items-center gap-3">
                  <label
                    htmlFor="interview_duration_minutes"
                    className="text-sm text-slate-300"
                  >
                    Interview Timeline
                  </label>
                  <select
                    id="interview_duration_minutes"
                    value={form.interview_duration_minutes}
                    onChange={(e) =>
                      handleChange("interview_duration_minutes", Number(e.target.value))
                    }
                    className="w-[132px] rounded-xl border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-white outline-none transition focus:border-violet-400/60 focus:shadow-[0_0_0_3px_rgba(139,92,246,0.08)]"
                  >
                    {INTERVIEW_DURATION_OPTIONS.map((minutes) => (
                      <option key={minutes} value={minutes}>
                        {minutes} minutes
                      </option>
                    ))}
                  </select>
                </div>

                <p className="text-xs leading-5 text-slate-400 sm:pl-1">
                  Every interview link created for this job inherits this duration.
                </p>
              </div>

              <div className="md:col-span-2 rounded-[24px] border border-slate-800 bg-slate-950/40 p-5">
                <p className="text-sm font-semibold text-white">Interview Mode</p>
                <p className="mt-1 text-sm text-slate-400">
                  Controls the structured questionnaire. Every candidate is also asked about their
                  own background and receives follow-up questions based on their answers.
                </p>

                <div
                  className="mt-4 grid gap-3 md:grid-cols-2"
                  role="radiogroup"
                  aria-label="Interview mode"
                >
                  {INTERVIEW_MODE_OPTIONS.map((option) => {
                    const selected = form.interview_mode === option.value;

                    return (
                      <label
                        key={option.value}
                        className={`cursor-pointer rounded-2xl border p-4 transition ${
                          selected
                            ? "border-violet-400/70 bg-violet-500/10 shadow-[0_0_0_1px_rgba(167,139,250,0.25)]"
                            : "border-slate-700 bg-slate-900/50 hover:border-slate-500 hover:bg-slate-900/80"
                        }`}
                      >
                        <input
                          type="radio"
                          name="interview_mode"
                          value={option.value}
                          checked={selected}
                          onChange={() => handleChange("interview_mode", option.value)}
                          className="sr-only"
                        />
                        <div className="flex items-start gap-3">
                          <span
                            aria-hidden="true"
                            className={`mt-0.5 flex h-[18px] w-[18px] flex-none items-center justify-center rounded-full border-2 transition ${
                              selected ? "border-violet-300" : "border-slate-600"
                            }`}
                          >
                            {selected ? (
                              <span className="h-2.5 w-2.5 rounded-full bg-violet-300" />
                            ) : null}
                          </span>
                          <div className="min-w-0">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-sm font-semibold text-white">{option.label}</span>
                              {option.badge ? (
                                <span className="flex-none rounded-full border border-violet-300/25 bg-violet-300/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-100">
                                  {option.badge}
                                </span>
                              ) : null}
                            </div>
                            <p className="mt-1.5 text-xs leading-5 text-slate-400">
                              {option.description}
                            </p>
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="md:col-span-2 rounded-[24px] border border-slate-800 bg-slate-950/40 p-5">
                <p className="text-sm font-medium text-white">Allowed Devices</p>
                <p className="mt-1 text-sm text-slate-400">Choose the devices candidates can use for this interview. General screening defaults to laptop, desktop, or mobile.</p>
                <div className="mt-4 grid gap-3 md:grid-cols-3" role="radiogroup" aria-label="Allowed devices">
                  {DEVICE_REQUIREMENT_OPTIONS.map((option) => {
                    const Icon = option.icon;
                    const selected = form.device_requirement === option.value;

                    return (
                      <label
                        key={option.value}
                        className={`cursor-pointer rounded-2xl border p-4 transition ${
                          selected
                            ? "border-cyan-300/70 bg-cyan-400/10 shadow-[0_0_0_1px_rgba(103,232,249,0.18)]"
                            : "border-slate-700 bg-slate-900/50 hover:border-slate-500 hover:bg-slate-900/80"
                        }`}
                      >
                        <input
                          type="radio"
                          name="device_requirement"
                          value={option.value}
                          checked={selected}
                          onChange={() => handleChange("device_requirement", option.value)}
                          className="sr-only"
                        />
                        <div className="flex items-start justify-between gap-3">
                          <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${selected ? "bg-cyan-300/20 text-cyan-100" : "bg-slate-800 text-slate-300"}`}>
                            <Icon className="h-5 w-5" aria-hidden="true" />
                          </span>
                          {option.badge ? <span className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-cyan-100">{option.badge}</span> : null}
                        </div>
                        <p className="mt-4 text-sm font-semibold text-white">{option.label}</p>
                        <p className="mt-1 text-xs leading-5 text-slate-400">{option.description}</p>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="md:col-span-2 rounded-[24px] border border-slate-800 bg-slate-950/40 p-5">
                <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(260px,360px)] md:items-end">
                  <div>
                    <p className="text-sm font-medium text-white">Question Type</p>
                    <p className="mt-1 text-sm text-slate-400">
                      VERIS classifies every question first; use this only when a role needs a global override.
                    </p>
                  </div>
                  <div>
                    <label className="mb-2 block text-sm text-slate-300">Default Question Type</label>
                    <select
                      value={form.question_type_default}
                      onChange={(e) => handleChange("question_type_default", e.target.value)}
                      className={FIELD_CLASS}
                    >
                      {QUESTION_TYPE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              <div className="md:col-span-2 rounded-[24px] border border-slate-800 bg-slate-950/40 p-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-white">Additional Assessment: Coding</p>
                    <p className="mt-1 text-sm text-slate-400">
                      Only for roles that require a hands-on coding exercise. Leave this off for
                      roles assessed through discussion.
                    </p>
                  </div>

                  <div
                    className="flex flex-none items-center gap-1 rounded-full border border-slate-700 bg-slate-900/70 p-1"
                    role="radiogroup"
                    aria-label="Include a coding assessment"
                  >
                    {[
                      { value: "NO", label: "No" },
                      { value: "YES", label: "Yes" },
                    ].map((option) => {
                      const selected = form.coding_required === option.value;

                      return (
                        <button
                          key={option.value}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          onClick={() => handleChange("coding_required", option.value)}
                          className={`min-w-[64px] rounded-full px-4 py-1.5 text-sm font-medium transition ${
                            selected
                              ? "bg-violet-500/90 text-white shadow-[0_0_0_1px_rgba(167,139,250,0.35)]"
                              : "text-slate-400 hover:text-white"
                          }`}
                        >
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {showCodingDetails ? (
                  <div className="mt-5 grid gap-4 md:grid-cols-2">
                    <div>
                      <label className="mb-2 block text-sm text-slate-300">Assessment Type</label>
                      <select
                        value={form.coding_assessment_type}
                        onChange={(e) => handleChange("coding_assessment_type", e.target.value)}
                        className={FIELD_CLASS}
                      >
                        {CODING_ASSESSMENT_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                      <div>
                        <label className="mb-2 block text-sm text-slate-300">Coding Difficulty</label>
                        <select
                          value={form.coding_difficulty}
                          onChange={(e) => handleChange("coding_difficulty", e.target.value)}
                          className={FIELD_CLASS}
                        >
                          <option value="EASY">Easy</option>
                          <option value="MEDIUM">Medium</option>
                          <option value="HARD">Hard</option>
                        </select>
                      </div>

                      <div>
                        <label className="mb-2 block text-sm text-slate-300">Coding Duration</label>
                        <select
                          value={form.coding_duration_minutes}
                          onChange={(e) => handleChange("coding_duration_minutes", Number(e.target.value))}
                          className={FIELD_CLASS}
                        >
                          {[10, 15, 20, 30].map((minutes) => (
                            <option key={minutes} value={minutes}>
                              {minutes} minutes
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="md:col-span-2">
                        <label className="mb-2 block text-sm text-slate-300">Coding Languages</label>
                        <input
                          value={form.coding_languages}
                          onChange={(e) => handleChange("coding_languages", e.target.value)}
                          placeholder="JavaScript, Python, SQL"
                          className={FIELD_CLASS}
                        />
                      </div>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="mt-5 rounded-2xl border border-slate-800 bg-slate-900/70 p-4 text-sm text-slate-300">
              - Job config is created under the authenticated organization
              <br />- Skills are normalized from comma-separated input
              <br />- Timeline applies to every interview generated from this job
              <br />- Coding round settings stay attached to the job and carry into interview configuration
              <br />- Edit mode updates the role without creating a duplicate
            </div>

            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                onClick={handleClose}
                className="rounded-2xl border border-slate-700 bg-slate-900/80 px-5 py-3 text-sm text-slate-200 transition hover:border-slate-500 hover:bg-slate-800"
              >
                Cancel
              </button>

              <button
                onClick={handleSubmit}
                disabled={loading}
                className="rounded-2xl bg-gradient-to-r from-violet-500 via-fuchsia-500 to-indigo-500 px-6 py-3 text-sm font-medium text-white shadow-[0_18px_30px_rgba(139,92,246,0.28)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading ? loadingLabel : actionLabel}
              </button>
            </div>
          </div>
        </div>
      </div>

      <NoticeModal
        open={notice.open}
        title={notice.title}
        message={notice.message}
        tone={notice.tone}
        onClose={() => setNotice((current) => ({ ...current, open: false }))}
      />
    </>
  );
}
