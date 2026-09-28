"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Laptop, MonitorSmartphone, Smartphone, X } from "lucide-react";
import { useAuthSearchParams } from "@/lib/client/use-auth-search-params";

import InterviewFocusSummary from "@/components/interview-focus/InterviewFocusSummary";
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

const DIFFICULTY_OPTIONS = [
  { value: "JUNIOR", label: "Junior" },
  { value: "MID", label: "Mid" },
  { value: "SENIOR", label: "Senior" },
];

const INTERVIEW_DURATION_OPTIONS = [30, 45, 60];

const CODING_DIFFICULTY_OPTIONS = [
  { value: "EASY", label: "Easy" },
  { value: "MEDIUM", label: "Medium" },
  { value: "HARD", label: "Hard" },
];

const CODING_DURATION_OPTIONS = [10, 15, 20, 30];

const DEVICE_REQUIREMENT_OPTIONS = [
  {
    value: "ANY_DEVICE",
    label: "Laptop/Desktop or Mobile",
    short: "Any device",
    description: "Best for most roles and the highest completion rate.",
    icon: MonitorSmartphone,
    badge: "Default",
  },
  {
    value: "DESKTOP_ONLY",
    label: "Laptop/Desktop Only",
    short: "Laptop/desktop only",
    description: "Best when the interview needs a full screen, a keyboard, or a hands-on exercise.",
    icon: Laptop,
    badge: "Recommended",
  },
  {
    value: "MOBILE_ONLY",
    label: "Mobile Only",
    short: "Mobile only",
    description: "Useful for on-the-go roles and quick video screens.",
    icon: Smartphone,
    badge: null,
  },
];

const INTERVIEW_MODE_OPTIONS = [
  {
    value: "STANDARD",
    label: "Standard Interview",
    short: "Standard",
    description:
      "Every candidate receives the same structured questionnaire, so candidates can be evaluated consistently.",
    badge: "Default",
  },
  {
    value: "INDIVIDUALIZED",
    label: "Individualized Interview",
    short: "Individualized",
    description:
      "Each candidate receives a different structured questionnaire, while questions remain aligned with this job's requirements, competencies, experience level, and evaluation criteria.",
    badge: null,
  },
];

// Shared control styling. Kept compact: the previous px-4 py-3 made every input
// and select noticeably taller than the text they hold. Slate and cyan are
// remapped by the light theme (globals.css), so one set of classes serves both.
const FIELD_CLASS =
  "w-full rounded-xl border border-slate-700 bg-slate-900/80 px-3.5 py-2 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-300/70 focus:shadow-[0_0_0_3px_rgba(34,211,238,0.12)]";

const FIELD_ERROR_CLASS = "border-rose-400/70 focus:border-rose-300 focus:shadow-[0_0_0_3px_rgba(244,63,94,0.12)]";

const JOB_CONFIG_NOTES = [
  {
    title: "Scoped to your organization",
    detail: "The job is created under the organization you are signed in to.",
  },
  {
    title: "Skills are cleaned up for you",
    detail: "Separate entries with commas and VERIS formats and de-duplicates them.",
  },
  {
    title: "One timeline for every interview",
    detail: "Each interview link generated from this job uses the same duration.",
  },
  {
    title: "Assessment settings carry over",
    detail: "Any additional assessment stays attached and applies to every interview.",
  },
  {
    title: "Edits update this job",
    detail: "Saving changes updates the existing role instead of creating a copy.",
  },
  {
    title: "Questions come next",
    detail: "VERIS drafts the questionnaire, and you can review it before inviting anyone.",
  },
];

function createDefaultForm() {
  return {
    job_title: "",
    job_description: "",
    experience_level_id: "",
    difficulty_profile: "MID",
    core_skills: "",
    interview_duration_minutes: 30,
    // No longer shown in the form: question generation never read it and its
    // options (coding, system design, architecture...) made every role look
    // technical. Kept in the payload so existing jobs keep their stored value.
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

/** Distinct skills as typed, for the chip preview. The payload is built from
 * the raw comma-separated text exactly as before; the server de-duplicates. */
function distinctSkills(value) {
  const seen = new Set();
  const skills = [];

  for (const raw of String(value ?? "").split(",")) {
    const skill = raw.trim();
    const key = skill.toLowerCase();

    if (skill && !seen.has(key)) {
      seen.add(key);
      skills.push(skill);
    }
  }

  return skills;
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

/** A numbered group of related settings. */
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

function FieldLabel({ htmlFor, required = false, children }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-sm text-slate-300">
      {children}
      {required ? (
        <span className="ml-0.5 text-rose-300" aria-hidden="true">
          *
        </span>
      ) : null}
    </label>
  );
}

function FieldError({ id, message }) {
  if (!message) return null;
  return (
    <p id={id} className="mt-1.5 text-xs text-rose-300">
      {message}
    </p>
  );
}

/** Pick one of a few fixed values, shown side by side. */
function Segmented({ label, labelId, value, options, onChange }) {
  return (
    <div
      role="radiogroup"
      aria-label={labelId ? undefined : label}
      aria-labelledby={labelId}
      className="flex w-full rounded-xl border border-slate-700 bg-slate-900/70 p-1"
    >
      {options.map((option) => {
        const selected = String(value) === String(option.value);
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
            className={`flex-1 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-sm font-medium transition ${
              selected
                ? "bg-cyan-400/15 text-cyan-100 shadow-[inset_0_0_0_1px_rgba(103,232,249,0.45)]"
                : "text-slate-400 hover:text-white"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function OptionBadge({ children }) {
  return (
    <span className="flex-none rounded-full border border-cyan-300/25 bg-cyan-300/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-cyan-100">
      {children}
    </span>
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
  const [errors, setErrors] = useState({});
  const titleRef = useRef(null);
  const levelRef = useRef(null);

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
    setErrors({});
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

  const skills = useMemo(() => distinctSkills(form.core_skills), [form.core_skills]);

  const handleChange = (key, value) => {
    setForm((prev) => ({
      ...prev,
      [key]: value,
    }));
    setErrors((prev) => (prev[key] ? { ...prev, [key]: undefined } : prev));
  };

  const removeSkill = (skill) => {
    const target = skill.toLowerCase();
    const remaining = form.core_skills
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item && item.toLowerCase() !== target);
    handleChange("core_skills", remaining.join(", "));
  };

  const resetForm = () => {
    setForm(createDefaultForm());
  };

  const handleClose = () => {
    resetModalState();
    setOpen(false);
  };

  // The two fields the API requires (createJobSchema / updateJobSchema).
  // Checked here so the recruiter sees which field needs attention instead of
  // a generic failure after the request.
  const validate = () => {
    const next = {};
    if (!form.job_title.trim()) {
      next.job_title = "Enter a job title.";
    }
    if (!(Number(form.experience_level_id) > 0)) {
      next.experience_level_id = "Select an experience level.";
    }
    setErrors(next);

    if (next.job_title) {
      titleRef.current?.focus();
    } else if (next.experience_level_id) {
      levelRef.current?.focus();
    }

    return Object.keys(next).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) {
      return;
    }

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

  const selectedLevel = levelOptions.find(
    (lvl) => String(lvl.experience_level_id) === String(form.experience_level_id)
  );
  const selectedMode = INTERVIEW_MODE_OPTIONS.find((option) => option.value === form.interview_mode);
  const selectedDevice = DEVICE_REQUIREMENT_OPTIONS.find(
    (option) => option.value === form.device_requirement
  );
  const codingType = CODING_ASSESSMENT_OPTIONS.find(
    (option) => option.value && option.value === form.coding_assessment_type
  );
  const summary = [
    selectedLevel ? selectedLevel.label : "No experience level yet",
    `${form.interview_duration_minutes} min interview`,
    selectedMode?.short,
    selectedDevice?.short,
    showCodingDetails ? `Coding${codingType ? `: ${codingType.label}` : ""}` : null,
  ].filter(Boolean);

  return (
    <>
      <div
        className="hv-theme-dialog-backdrop fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/80 px-3 py-3 backdrop-blur-md sm:items-center sm:px-4 sm:py-6"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-job-title"
      >
        <div className="hv-create-job-modal hv-theme-modal relative flex max-h-[calc(100dvh-1.5rem)] w-full max-w-6xl flex-col overflow-hidden rounded-[24px] border border-slate-700/70 bg-[#0a1020]/95 text-white shadow-[0_30px_80px_rgba(2,6,23,0.55)] sm:max-h-[calc(100dvh-3rem)]">
          {/* Header stays put while the form scrolls. */}
          <div className="flex flex-none items-start justify-between gap-4 border-b border-slate-800 px-5 py-3.5 sm:px-7 sm:py-5 [@media(max-height:720px)]:sm:py-3.5">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-300">
                Role Configuration
              </p>
              <h2
                id="create-job-title"
                className="mt-1 text-xl font-semibold tracking-tight text-white sm:text-2xl"
              >
                {isEditMode ? "Edit Job" : "Create Job"}
              </h2>
              <p className="mt-1 hidden max-w-2xl text-sm leading-6 text-slate-400 sm:block [@media(max-height:720px)]:hidden">
                Define the role, experience level, and evaluation context VERIS uses to build
                the interview for this job.
              </p>
            </div>

            <div className="flex flex-none items-center gap-2">
              {isEditMode && jobIdForQuestions ? (
                <a
                  href={buildAuthUrl(`/jobs/${jobIdForQuestions}/questionnaire`, searchParams)}
                  className="rounded-full border border-cyan-300/40 bg-cyan-400/10 px-3.5 py-1.5 text-sm font-medium text-cyan-100 transition hover:bg-cyan-400/20"
                >
                  Questions
                </a>
              ) : null}
              <button
                type="button"
                onClick={handleClose}
                className="rounded-full border border-slate-700/80 bg-slate-900/80 px-3.5 py-1.5 text-sm text-slate-300 transition hover:border-cyan-300/60 hover:text-white"
              >
                Close
              </button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-7 sm:py-6">
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
              {/* Left: what the role is, and how its questions are built. */}
              <div className="space-y-5">
                <Section
                  step={1}
                  title="Role details"
                  description="What VERIS reads to understand the role."
                >
                  <div>
                    <FieldLabel htmlFor="job_title" required>
                      Job Title
                    </FieldLabel>
                    <input
                      id="job_title"
                      ref={titleRef}
                      autoFocus={!isEditMode}
                      value={form.job_title}
                      onChange={(e) => handleChange("job_title", e.target.value)}
                      placeholder="Principal Data Engineer"
                      aria-invalid={Boolean(errors.job_title)}
                      aria-describedby={errors.job_title ? "job_title_error" : undefined}
                      className={`${FIELD_CLASS} ${errors.job_title ? FIELD_ERROR_CLASS : ""}`}
                    />
                    <FieldError id="job_title_error" message={errors.job_title} />
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <FieldLabel htmlFor="experience_level_id" required>
                        Experience Level
                      </FieldLabel>
                      <select
                        id="experience_level_id"
                        ref={levelRef}
                        value={form.experience_level_id}
                        onChange={(e) => handleChange("experience_level_id", e.target.value)}
                        aria-invalid={Boolean(errors.experience_level_id)}
                        aria-describedby={
                          errors.experience_level_id ? "experience_level_error" : undefined
                        }
                        className={`${FIELD_CLASS} ${errors.experience_level_id ? FIELD_ERROR_CLASS : ""}`}
                      >
                        <option value="">Select Experience Level</option>
                        {levelOptions.map((lvl) => (
                          <option key={lvl.experience_level_id} value={lvl.experience_level_id}>
                            {lvl.label}
                          </option>
                        ))}
                      </select>
                      <FieldError id="experience_level_error" message={errors.experience_level_id} />
                    </div>

                    <div>
                      <p id="difficulty_profile_label" className="mb-1.5 block text-sm text-slate-300">
                        Difficulty Profile
                      </p>
                      <Segmented
                        labelId="difficulty_profile_label"
                        value={form.difficulty_profile}
                        options={DIFFICULTY_OPTIONS}
                        onChange={(value) => handleChange("difficulty_profile", value)}
                      />
                    </div>
                  </div>

                  <div>
                    <FieldLabel htmlFor="job_description">Job Description</FieldLabel>
                    <textarea
                      id="job_description"
                      value={form.job_description}
                      onChange={(e) => handleChange("job_description", e.target.value)}
                      placeholder="Describe the responsibilities, expectations, and requirements for this role."
                      rows={5}
                      className={`${FIELD_CLASS} resize-y leading-6`}
                    />
                  </div>

                  <div>
                    <FieldLabel htmlFor="core_skills">Core Skills</FieldLabel>
                    <input
                      id="core_skills"
                      value={form.core_skills}
                      onChange={(e) => handleChange("core_skills", e.target.value)}
                      placeholder="Enter the key skills, qualifications, competencies, or requirements for this role."
                      aria-describedby="core_skills_hint"
                      className={FIELD_CLASS}
                    />
                    {skills.length > 0 ? (
                      <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Skills VERIS will use">
                        {skills.map((skill) => (
                          <li
                            key={skill.toLowerCase()}
                            className="inline-flex items-center gap-1 rounded-full border border-cyan-300/25 bg-cyan-400/10 py-0.5 pl-2.5 pr-1 text-xs text-cyan-100"
                          >
                            {skill}
                            <button
                              type="button"
                              onClick={() => removeSkill(skill)}
                              aria-label={`Remove ${skill}`}
                              className="rounded-full p-0.5 text-cyan-200/80 transition hover:bg-cyan-400/20 hover:text-white"
                            >
                              <X className="h-3 w-3" aria-hidden="true" />
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    <p id="core_skills_hint" className="mt-1.5 text-xs text-slate-500">
                      Separate skills with commas.
                      {skills.length > 0
                        ? ` ${skills.length} skill${skills.length === 1 ? "" : "s"} will be used.`
                        : ""}
                    </p>
                  </div>
                </Section>

                <Section
                  step={2}
                  title="Questionnaire"
                  description="Controls the structured questionnaire. Every candidate is also asked about their own background and receives follow-up questions based on their answers."
                >
                  <div className="grid gap-3" role="radiogroup" aria-label="Interview mode">
                    {INTERVIEW_MODE_OPTIONS.map((option) => {
                      const selected = form.interview_mode === option.value;

                      return (
                        <label
                          key={option.value}
                          className={`cursor-pointer rounded-xl border p-3.5 transition ${
                            selected
                              ? "border-cyan-300/70 bg-cyan-400/10 shadow-[0_0_0_1px_rgba(103,232,249,0.18)]"
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
                                selected ? "border-cyan-300" : "border-slate-600"
                              }`}
                            >
                              {selected ? <span className="h-2.5 w-2.5 rounded-full bg-cyan-300" /> : null}
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-sm font-semibold text-white">{option.label}</span>
                                {option.badge ? <OptionBadge>{option.badge}</OptionBadge> : null}
                              </div>
                              <p className="mt-1 text-xs leading-5 text-slate-400">{option.description}</p>
                            </div>
                          </div>
                        </label>
                      );
                    })}
                  </div>

                  <InterviewFocusSummary jobId={jobIdForQuestions} searchParams={searchParams} />
                </Section>
              </div>

              {/* Right: how the interview runs. */}
              <div className="space-y-5">
                <Section
                  step={3}
                  title="Interview setup"
                  description="Applies to every interview link created for this job."
                >
                  <div>
                    <p id="interview_duration_label" className="mb-1.5 block text-sm text-slate-300">
                      Interview Timeline
                    </p>
                    <Segmented
                      labelId="interview_duration_label"
                      value={form.interview_duration_minutes}
                      options={INTERVIEW_DURATION_OPTIONS.map((minutes) => ({
                        value: minutes,
                        label: `${minutes} minutes`,
                      }))}
                      onChange={(value) => handleChange("interview_duration_minutes", Number(value))}
                    />
                    <p className="mt-1.5 text-xs leading-5 text-slate-400">
                      Every interview link created for this job inherits this duration.
                    </p>
                  </div>

                  <div>
                    <p className="text-sm text-slate-300">Allowed Devices</p>
                    <p className="mt-0.5 text-xs leading-5 text-slate-400">
                      Choose the devices candidates can use for this interview. General screening
                      defaults to laptop, desktop, or mobile.
                    </p>
                    <div className="mt-2.5 grid gap-2" role="radiogroup" aria-label="Allowed devices">
                      {DEVICE_REQUIREMENT_OPTIONS.map((option) => {
                        const Icon = option.icon;
                        const selected = form.device_requirement === option.value;

                        return (
                          <label
                            key={option.value}
                            className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition ${
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
                            <span
                              className={`flex h-9 w-9 flex-none items-center justify-center rounded-lg ${
                                selected ? "bg-cyan-300/20 text-cyan-100" : "bg-slate-800 text-slate-300"
                              }`}
                            >
                              <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="flex items-center justify-between gap-2">
                                <span className="text-sm font-semibold text-white">{option.label}</span>
                                {option.badge ? <OptionBadge>{option.badge}</OptionBadge> : null}
                              </span>
                              <span className="mt-0.5 block text-xs leading-5 text-slate-400">
                                {option.description}
                              </span>
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                </Section>

                <Section
                  step={4}
                  title="Additional Assessment: Coding"
                  description="Only for roles that require a hands-on coding exercise. Leave this off for roles assessed through discussion."
                >
                  <div className="flex items-center justify-between gap-3">
                    <p id="coding_required_label" className="text-sm text-slate-300">
                      Include a coding assessment
                    </p>
                    <div className="w-36">
                      <Segmented
                        labelId="coding_required_label"
                        value={form.coding_required}
                        options={[
                          { value: "NO", label: "No" },
                          { value: "YES", label: "Yes" },
                        ]}
                        onChange={(value) => handleChange("coding_required", value)}
                      />
                    </div>
                  </div>

                  {showCodingDetails ? (
                    <div className="grid gap-4 border-t border-slate-800 pt-4 sm:grid-cols-2">
                      <div>
                        <FieldLabel htmlFor="coding_assessment_type">Assessment Type</FieldLabel>
                        <select
                          id="coding_assessment_type"
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
                        <FieldLabel htmlFor="coding_languages">Coding Languages</FieldLabel>
                        <input
                          id="coding_languages"
                          value={form.coding_languages}
                          onChange={(e) => handleChange("coding_languages", e.target.value)}
                          placeholder="JavaScript, Python, SQL"
                          className={FIELD_CLASS}
                        />
                      </div>

                      <div>
                        <p id="coding_difficulty_label" className="mb-1.5 block text-sm text-slate-300">
                          Coding Difficulty
                        </p>
                        <Segmented
                          labelId="coding_difficulty_label"
                          value={form.coding_difficulty}
                          options={CODING_DIFFICULTY_OPTIONS}
                          onChange={(value) => handleChange("coding_difficulty", value)}
                        />
                      </div>

                      <div>
                        <p id="coding_duration_label" className="mb-1.5 block text-sm text-slate-300">
                          Coding Duration
                        </p>
                        <Segmented
                          labelId="coding_duration_label"
                          value={form.coding_duration_minutes}
                          options={CODING_DURATION_OPTIONS.map((minutes) => ({
                            value: minutes,
                            label: `${minutes}m`,
                          }))}
                          onChange={(value) => handleChange("coding_duration_minutes", Number(value))}
                        />
                      </div>
                    </div>
                  ) : null}
                </Section>
              </div>
            </div>

            {/* Reference notes, kept but set quietly under the form. */}
            <div className="mt-6 border-t border-slate-800 pt-5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                Good to know
              </p>
              <ul className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
                {JOB_CONFIG_NOTES.map((note) => (
                  <li key={note.title} className="flex gap-2.5">
                    <span className="mt-1.5 h-1.5 w-1.5 flex-none rounded-full bg-cyan-300/70" aria-hidden="true" />
                    <span className="min-w-0">
                      <span className="block text-xs font-semibold text-slate-200">{note.title}</span>
                      <span className="block text-xs leading-5 text-slate-400">{note.detail}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Footer stays put: a summary of the choices and the actions. */}
          <div className="flex flex-none flex-col gap-3 border-t border-slate-800 bg-slate-950/40 px-5 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-7 sm:py-3.5">
            <p className="hidden min-w-0 text-xs leading-5 text-slate-400 sm:block" aria-live="polite">
              {summary.join(" · ")}
            </p>
            <div className="flex flex-none gap-2 [&>button]:flex-1 sm:[&>button]:flex-none">
              <button
                type="button"
                onClick={handleClose}
                className="rounded-xl border border-slate-700 bg-slate-900/80 px-5 py-2.5 text-sm text-slate-200 transition hover:border-slate-500 hover:bg-slate-800"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={handleSubmit}
                disabled={loading}
                className="hv-solid-action rounded-xl bg-cyan-600 px-6 py-2.5 text-sm font-semibold text-white shadow-[0_10px_20px_rgba(8,145,178,0.22)] transition hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-60"
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
