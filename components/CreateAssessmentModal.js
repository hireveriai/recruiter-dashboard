"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { useAuthSearchParams } from "@/lib/client/use-auth-search-params";

import { showActionFeedback } from "@/lib/client/action-feedback";
import { buildAuthUrl } from "@/lib/client/auth-query";

// Same control styling as the Create Job modal. Slate and cyan are remapped by
// the light theme (globals.css), so one set of classes serves both themes.
const FIELD_CLASS =
  "w-full rounded-xl border border-slate-700 bg-slate-900/80 px-3.5 py-2 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-300/70 focus:shadow-[0_0_0_3px_rgba(34,211,238,0.12)] disabled:cursor-not-allowed disabled:opacity-60";

const FIELD_ERROR_CLASS = "border-rose-400/70 focus:border-rose-300 focus:shadow-[0_0_0_3px_rgba(244,63,94,0.12)]";

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

const PARTICIPANT_OPTIONS = [
  { value: "CANDIDATE", label: "Candidate" },
  { value: "EMPLOYEE", label: "Employee" },
];

const DIFFICULTY_OPTIONS = [
  { value: "JUNIOR", label: "Junior" },
  { value: "MID", label: "Mid" },
  { value: "SENIOR", label: "Senior" },
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

function splitSkills(value) {
  return value ? value.split(",").map((s) => s.trim()).filter(Boolean) : [];
}

function isWholeNumber(value) {
  return String(value ?? "").trim() !== "" && Number.isInteger(Number(value));
}

/** A numbered group of related settings (same pattern as Create Job). */
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

function Segmented({ labelId, value, options, onChange }) {
  return (
    <div role="radiogroup" aria-labelledby={labelId} className="flex w-full rounded-xl border border-slate-700 bg-slate-900/70 p-1">
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

function CheckRow({ checked, onChange, title, detail }) {
  return (
    <label
      className={`flex cursor-pointer items-start gap-3 rounded-xl border px-3.5 py-3 transition ${
        checked ? "border-cyan-300/60 bg-cyan-400/10" : "border-slate-700 bg-slate-900/50 hover:border-slate-500"
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 flex-none accent-cyan-400"
      />
      <span className="min-w-0">
        <span className="block text-sm font-medium text-white">{title}</span>
        {detail ? <span className="mt-0.5 block text-xs leading-5 text-slate-400">{detail}</span> : null}
      </span>
    </label>
  );
}

export default function CreateAssessmentModal({ open, onClose, initialAssessment, defaultJobId, onSuccess }) {
  const searchParams = useAuthSearchParams();
  const [form, setForm] = useState(DEFAULT_FORM);
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState({});

  const isEditMode = Boolean(initialAssessment?.id);

  useEffect(() => {
    if (!open) return;

    setErrors({});

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

  const handleChange = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => (current[key] ? { ...current, [key]: undefined } : current));
  };

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
    setErrors((current) => ({ ...current, jobId: undefined, title: undefined }));
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

  const removeSkill = (skill) => {
    const target = skill.toLowerCase();
    handleChange(
      "skills",
      splitSkills(form.skills)
        .filter((item) => item.toLowerCase() !== target)
        .join(", ")
    );
  };

  // Mirrors createAssessmentSchema / updateAssessmentSchema, so the recruiter
  // sees which field needs attention instead of a generic save failure.
  const validate = () => {
    const next = {};
    const jobRequired = form.participantType !== "EMPLOYEE";
    const title = form.title.trim();

    if (jobRequired && !form.jobId) next.jobId = "Select a job.";
    if (!title) next.title = "Enter a title.";
    else if (title.length > 200) next.title = "Keep the title to 200 characters or fewer.";
    if ((form.description ?? "").trim().length > 4000) next.description = "Keep the description to 4,000 characters or fewer.";

    const duration = Number(form.durationMinutes);
    if (!isWholeNumber(form.durationMinutes) || duration < 5 || duration > 240) {
      next.durationMinutes = "Enter whole minutes from 5 to 240.";
    }

    const passing = Number(form.passingPercentage);
    if (String(form.passingPercentage ?? "").trim() === "" || Number.isNaN(passing) || passing < 0 || passing > 100) {
      next.passingPercentage = "Enter a percentage from 0 to 100.";
    }

    if (form.questionCount) {
      const count = Number(form.questionCount);
      if (!isWholeNumber(form.questionCount) || count < 1 || count > 100) {
        next.questionCount = "Enter a whole number from 1 to 100, or leave it empty.";
      }
    }

    const expiry = Number(form.linkExpiryDays);
    if (!isWholeNumber(form.linkExpiryDays) || expiry < 1 || expiry > 90) {
      next.linkExpiryDays = "Enter whole days from 1 to 90.";
    }

    if (!isEditMode && form.participantType === "EMPLOYEE") {
      const skills = splitSkills(form.skills);
      if (skills.length > 20) next.skills = "Add up to 20 skills.";
      else if (skills.some((skill) => skill.length > 60)) next.skills = "Keep each skill to 60 characters or fewer.";
    }

    setErrors(next);
    return next;
  };

  const handleSubmit = async () => {
    const found = validate();
    const firstError = Object.values(found).find(Boolean);
    if (firstError) {
      // Job and title keep the original summary message.
      const jobRequired = form.participantType !== "EMPLOYEE";
      showActionFeedback({
        tone: "error",
        title: "Missing details",
        message:
          found.jobId || found.title === "Enter a title."
            ? jobRequired
              ? "Job and title are required."
              : "Title is required."
            : firstError,
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

  const isEmployee = form.participantType === "EMPLOYEE";
  const skillChips = splitSkills(form.skills).filter(
    (skill, index, list) => list.findIndex((item) => item.toLowerCase() === skill.toLowerCase()) === index
  );
  const activity = ACTIVITY_TYPE_OPTIONS.find((option) => option.value === form.activityType);
  const summary = [
    isEmployee ? "Employee" : "Candidate",
    activity?.label,
    `${form.durationMinutes || "–"} min`,
    form.questionCount ? `${form.questionCount} questions` : "Question count not set",
    `Pass ${form.passingPercentage === "" ? "–" : form.passingPercentage}%`,
    `Link valid ${form.linkExpiryDays || "–"} days`,
  ].filter(Boolean);
  const numberField = (key, label, min, max, hint) => (
    <div>
      <FieldLabel htmlFor={`assessment_${key}`}>{label}</FieldLabel>
      <input
        id={`assessment_${key}`}
        type="number"
        min={min}
        max={max}
        value={form[key]}
        onChange={(e) => handleChange(key, e.target.value)}
        aria-invalid={Boolean(errors[key])}
        aria-describedby={errors[key] ? `assessment_${key}_error` : `assessment_${key}_hint`}
        className={`${FIELD_CLASS} ${errors[key] ? FIELD_ERROR_CLASS : ""}`}
      />
      {errors[key] ? (
        <FieldError id={`assessment_${key}_error`} message={errors[key]} />
      ) : (
        <p id={`assessment_${key}_hint`} className="mt-1 text-[11px] text-slate-500">
          {hint}
        </p>
      )}
    </div>
  );

  return (
    <div
      className="hv-theme-dialog-backdrop fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/80 px-3 py-3 backdrop-blur-md sm:items-center sm:px-4 sm:py-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-assessment-title"
    >
      <div className="hv-create-assessment-modal hv-theme-modal relative flex max-h-[calc(100dvh-1.5rem)] w-full max-w-6xl flex-col overflow-hidden rounded-[24px] border border-slate-700/70 bg-[#0a1020]/95 text-white shadow-[0_30px_80px_rgba(2,6,23,0.55)] sm:max-h-[calc(100dvh-3rem)]">
        {/* Header stays put while the form scrolls. */}
        <div className="flex flex-none items-start justify-between gap-4 border-b border-slate-800 px-5 py-3.5 sm:px-7 sm:py-5 [@media(max-height:720px)]:sm:py-3.5">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-300">VERIS Assessment</p>
            <h2 id="create-assessment-title" className="mt-1 text-xl font-semibold tracking-tight text-white sm:text-2xl">
              {isEditMode ? "Edit Assessment" : "Create Assessment"}
            </h2>
            <p className="mt-1 hidden max-w-2xl text-sm leading-6 text-slate-400 sm:block [@media(max-height:720px)]:hidden">
              Configure a scored skills test. Add or generate questions after saving.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex-none rounded-full border border-slate-700/80 bg-slate-900/80 px-3.5 py-1.5 text-sm text-slate-300 transition hover:border-cyan-300/60 hover:text-white"
          >
            Close
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-7 sm:py-6">
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
            {/* Left: who it is for and what it is. */}
            <div className="space-y-5">
              <Section step={1} title="Who and what" description="Who takes this activity, and what it is for.">
                {!isEditMode ? (
                  <>
                    <div>
                      <p id="assessment_participant_label" className="mb-1.5 block text-sm text-slate-300">
                        Participant
                      </p>
                      <Segmented
                        labelId="assessment_participant_label"
                        value={form.participantType}
                        options={PARTICIPANT_OPTIONS}
                        onChange={(value) => handleChange("participantType", value)}
                      />
                    </div>

                    <div>
                      <p className="mb-1.5 block text-sm text-slate-300">Activity Type</p>
                      <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Activity type">
                        {ACTIVITY_TYPE_OPTIONS.map((option) => {
                          const selected = form.activityType === option.value;
                          return (
                            <label
                              key={option.value}
                              className={`cursor-pointer rounded-xl border px-3 py-2.5 transition ${
                                selected
                                  ? "border-cyan-300/70 bg-cyan-400/10 shadow-[0_0_0_1px_rgba(103,232,249,0.18)]"
                                  : "border-slate-700 bg-slate-900/50 hover:border-slate-500"
                              }`}
                            >
                              <input
                                type="radio"
                                name="assessment_activity_type"
                                value={option.value}
                                checked={selected}
                                onChange={() => handleChange("activityType", option.value)}
                                className="sr-only"
                              />
                              <span className="block text-sm font-semibold text-white">{option.label}</span>
                              <span className="mt-0.5 block text-xs text-slate-400">{option.hint}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>

                    {isEmployee && (
                      <div>
                        <FieldLabel htmlFor="assessment_skills">Skills / Competencies (comma separated)</FieldLabel>
                        <input
                          id="assessment_skills"
                          value={form.skills}
                          onChange={(e) => handleChange("skills", e.target.value)}
                          placeholder="e.g. Negotiation, Conflict Resolution, Financial Analysis, SQL — any technical, functional, or behavioral skill"
                          aria-invalid={Boolean(errors.skills)}
                          className={`${FIELD_CLASS} ${errors.skills ? FIELD_ERROR_CLASS : ""}`}
                        />
                        {skillChips.length > 0 ? (
                          <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Skills">
                            {skillChips.map((skill) => (
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
                        <FieldError id="assessment_skills_error" message={errors.skills} />
                      </div>
                    )}
                  </>
                ) : (
                  <p className="text-sm text-slate-300">
                    {isEmployee ? "Employee" : "Candidate"} · {activity?.label ?? form.activityType}
                  </p>
                )}

                <div>
                  <FieldLabel htmlFor="assessment_job" required={!isEmployee}>
                    {isEmployee ? "Job / Target Role (optional)" : "Job"}
                  </FieldLabel>
                  <select
                    id="assessment_job"
                    value={form.jobId}
                    onChange={(e) => handleJobChange(e.target.value)}
                    className={`${FIELD_CLASS} ${errors.jobId ? FIELD_ERROR_CLASS : ""}`}
                    disabled={isEditMode}
                    aria-invalid={Boolean(errors.jobId)}
                  >
                    <option value="">{isEmployee ? "No job / target role" : "Select Job"}</option>
                    {jobs.map((job) => (
                      <option key={job.jobId ?? job.job_id} value={job.jobId ?? job.job_id}>
                        {job.jobTitle ?? job.job_title}
                      </option>
                    ))}
                  </select>
                  <FieldError id="assessment_job_error" message={errors.jobId} />
                  {isEmployee && (
                    <p className="mt-1.5 text-xs text-slate-500">
                      Optional context only — e.g. a target role for future internal mobility. This employee&apos;s
                      activity does not need a job.
                    </p>
                  )}
                </div>

                <div>
                  <FieldLabel htmlFor="assessment_title" required>
                    Title
                  </FieldLabel>
                  <input
                    id="assessment_title"
                    value={form.title}
                    onChange={(e) => handleChange("title", e.target.value)}
                    placeholder="Auto-filled from the selected job - edit if you'd like"
                    aria-invalid={Boolean(errors.title)}
                    className={`${FIELD_CLASS} ${errors.title ? FIELD_ERROR_CLASS : ""}`}
                  />
                  <FieldError id="assessment_title_error" message={errors.title} />
                </div>

                <div>
                  <FieldLabel htmlFor="assessment_description">Description</FieldLabel>
                  <textarea
                    id="assessment_description"
                    value={form.description}
                    onChange={(e) => handleChange("description", e.target.value)}
                    placeholder="What this assessment evaluates."
                    rows={3}
                    aria-invalid={Boolean(errors.description)}
                    className={`${FIELD_CLASS} resize-y leading-6 ${errors.description ? FIELD_ERROR_CLASS : ""}`}
                  />
                  <FieldError id="assessment_description_error" message={errors.description} />
                </div>
              </Section>

              <Section step={2} title="Test settings" description="Timing, scoring and how long the invite link stays valid.">
                <div>
                  <p id="assessment_difficulty_label" className="mb-1.5 block text-sm text-slate-300">
                    Difficulty
                  </p>
                  <Segmented
                    labelId="assessment_difficulty_label"
                    value={form.difficulty}
                    options={DIFFICULTY_OPTIONS}
                    onChange={(value) => handleChange("difficulty", value)}
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  {numberField("durationMinutes", "Duration (minutes)", 5, 240, "5 to 240 minutes")}
                  {numberField("passingPercentage", "Passing Percentage", 0, 100, "0 to 100%")}
                  {numberField("questionCount", "Question Count", 1, 100, "1 to 100 questions")}
                  {numberField("linkExpiryDays", "Link Expiry (days)", 1, 90, "1 to 90 days")}
                </div>
              </Section>
            </div>

            {/* Right: what the questions look like, and integrity. */}
            <div className="space-y-5">
              <Section step={3} title="Questions" description="The question formats VERIS generates, and their order.">
                <div className="flex flex-wrap gap-2" role="group" aria-label="Question types">
                  {QUESTION_TYPE_OPTIONS.map((option) => {
                    const selected = form.questionTypes.includes(option.value);
                    return (
                      <button
                        key={option.value}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => toggleQuestionType(option.value)}
                        className={`rounded-full border px-3.5 py-1.5 text-sm font-medium transition ${
                          selected
                            ? "border-cyan-300/60 bg-cyan-400/15 text-cyan-100"
                            : "border-slate-700 bg-slate-900/70 text-slate-400 hover:text-white"
                        }`}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
                {form.questionTypes.includes("CODING") ? (
                  <p className="text-xs leading-5 text-slate-400">
                    {isEmployee && !form.jobId
                      ? "Coding questions will be generated as requested for this employee activity."
                      : "Coding questions are only generated if this job has coding enabled (Job settings → Coding Assessment). Otherwise they're skipped automatically."}
                  </p>
                ) : null}
                <div className="grid gap-2 sm:grid-cols-2">
                  <CheckRow
                    checked={form.randomizeQuestions}
                    onChange={(value) => handleChange("randomizeQuestions", value)}
                    title="Randomize question order"
                  />
                  <CheckRow
                    checked={form.randomizeOptions}
                    onChange={(value) => handleChange("randomizeOptions", value)}
                    title="Randomize option order"
                  />
                </div>
              </Section>

              <Section
                step={4}
                title="Integrity & Security"
                description="Signals are recorded for recruiter review only - VerisNova never auto-decides a candidate cheated."
              >
                <div className="grid gap-2">
                  <CheckRow
                    checked={form.blockCopyPaste}
                    onChange={(value) => handleChange("blockCopyPaste", value)}
                    title="Block copy/paste"
                  />
                  <CheckRow
                    checked={form.cameraMonitoring}
                    onChange={(value) => handleChange("cameraMonitoring", value)}
                    title="Camera-based integrity monitoring"
                    detail={
                      form.cameraMonitoring
                        ? "Candidates will be asked to grant camera access before starting. VerisNova detects face presence and multiple-person presence only - no video is recorded, stored, or shown to recruiters."
                        : null
                    }
                  />
                </div>
              </Section>
            </div>
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
              onClick={onClose}
              className="rounded-xl border border-slate-700 bg-slate-900/80 px-5 py-2.5 text-sm text-slate-200 transition hover:border-slate-500 hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={loading}
              className="hv-solid-action whitespace-nowrap rounded-xl bg-cyan-600 px-4 py-2.5 text-sm font-semibold text-white shadow-[0_10px_20px_rgba(8,145,178,0.22)] transition hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-60 sm:px-6"
            >
              {loading ? "Saving..." : isEditMode ? "Save Changes" : "Create Assessment"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
