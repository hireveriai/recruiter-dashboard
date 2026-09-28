"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronUp,
  GripVertical,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";

import Navbar from "@/components/Navbar";
import InterviewFocusEditor from "@/components/interview-focus/InterviewFocusEditor";
import { buildAuthUrl } from "@/lib/client/auth-query";

const SOURCE_LABELS = {
  job: "Role requirement",
  experience: "Experience",
  behavioral: "Judgement",
  resume: "Candidate background",
};

const PHASE_OPTIONS = ["warmup", "core", "probe", "closing"];

const PHASE_LABELS = {
  warmup: "Warm-up",
  core: "Core",
  probe: "Probe",
  closing: "Closing",
};

// Limits enforced by the questionnaire service (sanitizeEditableQuestion /
// saveQuestionnaireDraft); checked here so problems show on the question.
const MAX_QUESTIONS = 40;
const MAX_QUESTION_LENGTH = 500;

// Same control styling as the recruiter modals. Slate and cyan are remapped by
// the light theme (globals.css), so one set of classes serves both themes.
const FIELD_CLASS =
  "w-full rounded-xl border border-slate-700 bg-slate-900/80 px-3.5 py-2 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-300/70 focus:shadow-[0_0_0_3px_rgba(34,211,238,0.12)]";
const SMALL_FIELD_CLASS =
  "w-full rounded-lg border border-slate-700 bg-slate-900/70 px-2.5 py-1.5 text-xs text-slate-200 outline-none transition placeholder:text-slate-500 focus:border-cyan-300/70";
const FIELD_ERROR_CLASS = "border-rose-400/70 focus:border-rose-300 focus:shadow-[0_0_0_3px_rgba(244,63,94,0.12)]";

function emptyQuestion() {
  return {
    key: `new-${Math.random().toString(36).slice(2)}`,
    questionnaireQuestionId: null,
    questionText: "",
    sourceType: "job",
    competencyLabel: "",
    evaluationCriteria: "",
    difficultyLevel: 3,
    phaseHint: "core",
    questionType: null,
    origin: "RECRUITER",
  };
}

function withKeys(questions) {
  return questions.map((q, i) => ({
    ...q,
    key: q.questionnaireQuestionId ?? `row-${i}`,
    competencyLabel: q.competencyLabel ?? "",
    evaluationCriteria: q.evaluationCriteria ?? "",
  }));
}

/** The server collapses whitespace before checking; mirror that here. */
function questionProblem(question) {
  const text = String(question.questionText ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "Write the question, or delete it.";
  if (text.length > MAX_QUESTION_LENGTH) return `Keep the question to ${MAX_QUESTION_LENGTH} characters.`;
  return null;
}

function IconButton({ label, onClick, disabled, tone = "default", children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={`flex h-8 w-8 items-center justify-center rounded-lg border border-transparent text-slate-400 transition disabled:cursor-not-allowed disabled:opacity-30 ${
        tone === "danger"
          ? "hover:border-rose-400/30 hover:bg-rose-500/10 hover:text-rose-300"
          : "hover:border-slate-700 hover:bg-slate-800/80 hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}

function ConfirmDialog({ state, onAnswer }) {
  if (!state) return null;
  return (
    <div
      className="hv-theme-dialog-backdrop fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/70 px-4 backdrop-blur-sm"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="questionnaire-confirm-title"
    >
      <div className="hv-theme-modal w-full max-w-md rounded-[20px] border border-slate-700/70 bg-[#0a1020] p-6 shadow-[0_24px_80px_rgba(2,6,23,0.55)]">
        <h2 id="questionnaire-confirm-title" className="text-lg font-semibold text-white">
          {state.title}
        </h2>
        <p className="mt-2 text-sm leading-6 text-slate-300">{state.message}</p>
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => onAnswer(false)}
            className="rounded-xl border border-slate-700 bg-slate-900/80 px-4 py-2 text-sm text-slate-200 transition hover:border-slate-500"
          >
            {state.cancelLabel ?? "Cancel"}
          </button>
          <button
            type="button"
            autoFocus
            onClick={() => onAnswer(true)}
            className={`rounded-xl px-4 py-2 text-sm font-semibold text-white transition ${
              state.tone === "danger"
                ? "hv-solid-action bg-rose-600 hover:bg-rose-500"
                : "hv-solid-action bg-cyan-600 hover:bg-cyan-500"
            }`}
          >
            {state.confirmLabel ?? "Continue"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function QuestionnaireReviewPage() {
  const { jobId } = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);
  const [version, setVersion] = useState(null);
  const [focusPlan, setFocusPlan] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [dirty, setDirty] = useState(false);
  const [jobTitle, setJobTitle] = useState("");
  const [showQuestionErrors, setShowQuestionErrors] = useState(false);
  const [dragOverIndex, setDragOverIndex] = useState(null);
  const [confirmState, setConfirmState] = useState(null);
  const dragIndex = useRef(null);
  const textareaRefs = useRef({});

  const baseUrl = useMemo(
    () => buildAuthUrl(`/api/jobs/${jobId}/questionnaire`, searchParams),
    [jobId, searchParams]
  );

  const notify = useCallback((tone, message) => {
    setToast({ tone, message });
    setTimeout(() => setToast(null), 4000);
  }, []);

  // In-app replacement for window.confirm; resolves true when confirmed.
  const askConfirm = useCallback(
    (options) => new Promise((resolve) => setConfirmState({ ...options, resolve })),
    []
  );

  const answerConfirm = (answer) => {
    confirmState?.resolve(answer);
    setConfirmState(null);
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // no-store matters here: after saving we immediately re-read, and a
      // cached response would show the recruiter their pre-save questionnaire.
      const res = await fetch(baseUrl, { credentials: "include", cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message || "Could not load the questionnaire");
      setVersion(data.data.version);
      setFocusPlan(data.data.focusPlan ?? null);
      setQuestions(withKeys(data.data.questions));
      setDirty(false);
      setShowQuestionErrors(false);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [baseUrl]);

  useEffect(() => {
    load();
  }, [load]);

  // The job's name for the header. Read-only and optional: the page works
  // without it.
  useEffect(() => {
    let active = true;
    fetch(buildAuthUrl("/api/jobs?view=selector&includeInactive=1", searchParams), { credentials: "include" })
      .then((res) => res.json())
      .then((data) => {
        const job = (data?.jobs ?? []).find((item) => (item.jobId ?? item.job_id) === jobId);
        if (active && job) setJobTitle(job.jobTitle ?? job.job_title ?? "");
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [jobId, searchParams]);

  // Unsaved-changes protection.
  useEffect(() => {
    if (!dirty) return undefined;
    const handler = (e) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const mutate = (index, field, value) => {
    setQuestions((prev) =>
      prev.map((q, i) => (i === index ? { ...q, [field]: value } : q))
    );
    setDirty(true);
  };

  const removeQuestion = (index) => {
    setQuestions((prev) => prev.filter((_, i) => i !== index));
    setDirty(true);
  };

  const addQuestion = () => {
    const next = emptyQuestion();
    setQuestions((prev) => [...prev, next]);
    setDirty(true);
    // Put the cursor in the new question.
    requestAnimationFrame(() => textareaRefs.current[next.key]?.focus());
  };

  const move = (from, to) => {
    if (to < 0 || to >= questions.length || from === to) return;
    setQuestions((prev) => {
      const next = [...prev];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
    setDirty(true);
  };

  // Blocks a save the server would reject, and points at the question.
  const checkQuestions = () => {
    if (questions.length > MAX_QUESTIONS) {
      notify("error", `A questionnaire is limited to ${MAX_QUESTIONS} questions`);
      return false;
    }
    const badIndex = questions.findIndex((q) => questionProblem(q));
    if (badIndex >= 0) {
      setShowQuestionErrors(true);
      notify("error", `Question ${badIndex + 1}: ${questionProblem(questions[badIndex])}`);
      textareaRefs.current[questions[badIndex].key]?.focus();
      return false;
    }
    return true;
  };

  const save = async () => {
    if (!checkQuestions()) return;
    setBusy("save");
    try {
      const res = await fetch(baseUrl, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questions }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message || "Could not save");
      notify("success", `Saved as draft v${data.data.versionNumber}`);
      await load();
    } catch (e) {
      notify("error", e.message);
    } finally {
      setBusy(null);
    }
  };

  const finalize = async () => {
    if (dirty && !checkQuestions()) return;
    setBusy("finalize");
    try {
      if (dirty) {
        const saveRes = await fetch(baseUrl, {
          method: "PUT",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ questions }),
        });
        if (!saveRes.ok) {
          const d = await saveRes.json();
          throw new Error(d?.error?.message || "Could not save before finalizing");
        }
      }
      const res = await fetch(baseUrl, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "finalize" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message || "Could not finalize");
      notify("success", `Questionnaire finalized. New interviews will use v${data.data.versionNumber}.`);
      await load();
    } catch (e) {
      notify("error", e.message);
    } finally {
      setBusy(null);
    }
  };

  const regenerate = async (scope, questionnaireQuestionId) => {
    if (version?.canGenerate === false) {
      notify("error", "AI generation limit reached for this draft. Edit questions manually instead.");
      return;
    }

    const remaining = version?.remainingGenerations;
    const confirmMessage =
      typeof remaining === "number"
        ? `Regenerate ${scope === "all" ? "all questions" : "this question"}? This will use 1 of your remaining AI generation attempts. ${remaining} generation${remaining === 1 ? "" : "s"} remaining.`
        : `Regenerate ${scope === "all" ? "all questions" : "this question"}?`;
    const confirmed = await askConfirm({
      title: scope === "all" ? "Regenerate all questions?" : "Regenerate this question?",
      message: confirmMessage,
      confirmLabel: "Regenerate",
    });
    if (!confirmed) return;

    setBusy(questionnaireQuestionId ?? "regenerate-all");
    try {
      const res = await fetch(
        buildAuthUrl(`/api/jobs/${jobId}/questionnaire/regenerate`, searchParams),
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ scope, questionnaireQuestionId }),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message || "Could not regenerate");
      notify("success", scope === "all" ? "Questionnaire regenerated" : "Question replaced");
      await load();
    } catch (e) {
      notify("error", e.message);
    } finally {
      setBusy(null);
    }
  };

  const goBack = async () => {
    if (dirty) {
      const leave = await askConfirm({
        title: "Leave without saving?",
        message: "You have unsaved changes. Leave without saving?",
        confirmLabel: "Leave",
        cancelLabel: "Stay",
        tone: "danger",
      });
      if (!leave) return;
    }
    router.push(buildAuthUrl("/jobs", searchParams));
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 text-white">
        <Navbar />
        <div className="flex min-h-[60vh] items-center justify-center text-slate-400">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          Preparing the questionnaire…
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-950 text-white">
        <Navbar />
        <div className="mx-auto max-w-2xl px-6 py-16 text-center">
          <p className="text-lg text-white">Could not load the questionnaire</p>
          <p className="mt-2 text-sm text-slate-400">{error}</p>
          <button
            type="button"
            onClick={load}
            className="hv-solid-action mt-6 rounded-xl bg-cyan-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-cyan-500"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  const isFinalized = version?.status === "FINALIZED";
  const aiCount = questions.filter((q) => q.origin !== "RECRUITER").length;
  const yoursCount = questions.length - aiCount;
  const atLimit = questions.length >= MAX_QUESTIONS;

  return (
    <div className="hv-page-enter min-h-screen bg-slate-950 text-white">
      <Navbar />

      <main className="mx-auto max-w-5xl px-4 pb-36 pt-6 sm:px-6 lg:px-8">
        <button
          type="button"
          onClick={goBack}
          className="inline-flex items-center gap-2 text-sm text-slate-400 transition hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" /> Back to jobs
        </button>

        <header className="mt-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-300">Interview questionnaire</p>
          <h1 className="mt-1.5 text-2xl font-semibold tracking-tight text-white sm:text-[1.75rem]">
            {jobTitle || "Interview questionnaire"}
          </h1>
          <p className="mt-1.5 max-w-3xl text-sm leading-6 text-slate-400">
            These structured questions are asked in every interview for this role. Each candidate
            also gets questions about their own background, plus follow-up questions based on their
            answers.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full border px-3 py-1 text-xs font-medium ${
                isFinalized
                  ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-300"
                  : "border-amber-400/30 bg-amber-500/10 text-amber-300"
              }`}
            >
              v{version?.versionNumber} · {isFinalized ? "Finalized" : "Draft"}
            </span>
            {focusPlan ? (
              <span
                title="The Interview Focus plan version these questions were generated from"
                className="rounded-full border border-cyan-300/25 bg-cyan-400/10 px-3 py-1 text-xs text-cyan-200"
              >
                Focus v{focusPlan.versionNumber}
              </span>
            ) : null}
            {dirty ? (
              <span className="rounded-full border border-amber-400/30 bg-amber-500/10 px-3 py-1 text-xs text-amber-300">
                Unsaved changes
              </span>
            ) : null}
            {typeof version?.remainingGenerations === "number" ? (
              <span className="rounded-full border border-slate-700 bg-slate-900/70 px-3 py-1 text-xs text-slate-400">
                {version.canGenerate
                  ? `${version.remainingGenerations} AI generation${version.remainingGenerations === 1 ? "" : "s"} remaining`
                  : "AI generation limit reached"}
              </span>
            ) : null}
          </div>
        </header>

        {isFinalized ? (
          <p className="mt-5 rounded-2xl border border-slate-800 bg-slate-900/50 px-4 py-3 text-xs leading-5 text-slate-400">
            This version is in use. Editing it creates a new draft — interviews that already ran keep
            the questions they were asked.
          </p>
        ) : null}

        {version?.canGenerate === false ? (
          <p className="mt-4 rounded-2xl border border-slate-800 bg-slate-900/50 px-4 py-3 text-xs leading-5 text-slate-400">
            You&apos;ve used all {version.generationLimit} AI generation attempts for this draft. You can
            continue editing the questions manually or add your own questions.
          </p>
        ) : null}

        {/* Renders nothing unless Interview Focus is enabled for this organization. */}
        <InterviewFocusEditor
          jobId={jobId}
          searchParams={searchParams}
          notify={notify}
          onApplied={load}
          questionEditsPending={dirty}
        />

        {questions.length > 0 ? (
          <div className="mt-6 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
            <p>
              <span className="font-semibold text-white">{questions.length}</span> question{questions.length === 1 ? "" : "s"}
              {" · "}
              {aiCount} by VERIS · {yoursCount} added by you
            </p>
            <p>Drag a card, or use the arrows, to change the order.</p>
          </div>
        ) : null}

        <ol className="mt-3 space-y-3">
          {questions.map((q, index) => {
            const problem = showQuestionErrors ? questionProblem(q) : null;
            const length = String(q.questionText ?? "").length;
            const focusLabel =
              q.focusAreaKey && focusPlan
                ? focusPlan.areas?.find((area) => area.areaKey === q.focusAreaKey)?.label ?? q.focusAreaKey
                : null;
            const fieldId = `question-${q.key}`;

            return (
              <li
                key={q.key}
                draggable
                onDragStart={() => {
                  dragIndex.current = index;
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (dragOverIndex !== index) setDragOverIndex(index);
                }}
                onDragLeave={() => setDragOverIndex((current) => (current === index ? null : current))}
                onDrop={() => {
                  if (dragIndex.current !== null) move(dragIndex.current, index);
                  dragIndex.current = null;
                  setDragOverIndex(null);
                }}
                onDragEnd={() => setDragOverIndex(null)}
                className={`rounded-2xl border bg-slate-900/60 p-4 transition sm:p-5 ${
                  problem
                    ? "border-rose-400/50"
                    : dragOverIndex === index
                      ? "border-cyan-300/60 shadow-[0_0_0_1px_rgba(103,232,249,0.25)]"
                      : "border-slate-800"
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className="flex flex-none flex-col items-center gap-1.5 pt-0.5">
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-cyan-400/15 text-xs font-semibold text-cyan-200">
                      {index + 1}
                    </span>
                    <GripVertical className="h-4 w-4 cursor-grab text-slate-600" aria-hidden="true" />
                  </div>

                  <div className="min-w-0 flex-1 space-y-3">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                          q.origin === "RECRUITER"
                            ? "border border-amber-400/30 bg-amber-500/10 text-amber-200"
                            : "border border-cyan-300/25 bg-cyan-400/10 text-cyan-200"
                        }`}
                      >
                        {q.origin === "RECRUITER" ? "Yours" : "AI"}
                      </span>
                      {focusLabel ? (
                        <span className="rounded-full border border-slate-700 bg-slate-800/70 px-2.5 py-0.5 text-[10px] font-medium text-slate-300">
                          {focusLabel}
                        </span>
                      ) : null}

                      <div className="ml-auto flex items-center gap-0.5">
                        <IconButton label="Move up" onClick={() => move(index, index - 1)} disabled={index === 0}>
                          <ChevronUp className="h-4 w-4" />
                        </IconButton>
                        <IconButton
                          label="Move down"
                          onClick={() => move(index, index + 1)}
                          disabled={index === questions.length - 1}
                        >
                          <ChevronDown className="h-4 w-4" />
                        </IconButton>
                        {q.questionnaireQuestionId ? (
                          <IconButton
                            label={
                              version?.canGenerate === false
                                ? "AI generation limit reached for this draft"
                                : dirty
                                  ? "Save your changes first"
                                  : "Regenerate this question"
                            }
                            onClick={() => regenerate("question", q.questionnaireQuestionId)}
                            disabled={busy !== null || dirty || version?.canGenerate === false}
                          >
                            {busy === q.questionnaireQuestionId ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <RefreshCw className="h-3.5 w-3.5" />
                            )}
                          </IconButton>
                        ) : null}
                        <IconButton label="Delete question" tone="danger" onClick={() => removeQuestion(index)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </IconButton>
                      </div>
                    </div>

                    <div>
                      <label htmlFor={fieldId} className="sr-only">
                        Question {index + 1}
                      </label>
                      <textarea
                        id={fieldId}
                        ref={(node) => {
                          if (node) textareaRefs.current[q.key] = node;
                          else delete textareaRefs.current[q.key];
                        }}
                        value={q.questionText}
                        onChange={(e) => mutate(index, "questionText", e.target.value)}
                        rows={2}
                        placeholder="Question the interviewer will ask"
                        aria-invalid={Boolean(problem)}
                        className={`${FIELD_CLASS} resize-y leading-6 ${problem ? FIELD_ERROR_CLASS : ""}`}
                      />
                      <div className="mt-1 flex items-start justify-between gap-3">
                        <p className="text-xs text-rose-300">{problem}</p>
                        {length > MAX_QUESTION_LENGTH - 100 ? (
                          <p className={`flex-none text-[11px] tabular-nums ${length > MAX_QUESTION_LENGTH ? "text-rose-300" : "text-slate-500"}`}>
                            {length}/{MAX_QUESTION_LENGTH}
                          </p>
                        ) : null}
                      </div>
                    </div>

                    <div>
                      <label htmlFor={`${fieldId}-criteria`} className="mb-1 block text-[11px] font-medium text-slate-400">
                        What a strong answer should demonstrate
                      </label>
                      <input
                        id={`${fieldId}-criteria`}
                        value={q.evaluationCriteria}
                        onChange={(e) => mutate(index, "evaluationCriteria", e.target.value)}
                        placeholder="What a strong answer should demonstrate"
                        className={`${FIELD_CLASS} text-xs text-slate-300`}
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      <label className="block">
                        <span className="mb-1 block text-[11px] font-medium text-slate-400">Source</span>
                        <select
                          value={q.sourceType}
                          onChange={(e) => mutate(index, "sourceType", e.target.value)}
                          className={SMALL_FIELD_CLASS}
                        >
                          {Object.entries(SOURCE_LABELS).map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-[11px] font-medium text-slate-400">Competency</span>
                        <input
                          value={q.competencyLabel}
                          onChange={(e) => mutate(index, "competencyLabel", e.target.value)}
                          placeholder="Competency"
                          className={SMALL_FIELD_CLASS}
                        />
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-[11px] font-medium text-slate-400">Phase</span>
                        <select
                          value={q.phaseHint}
                          onChange={(e) => mutate(index, "phaseHint", e.target.value)}
                          className={SMALL_FIELD_CLASS}
                        >
                          {PHASE_OPTIONS.map((p) => (
                            <option key={p} value={p}>
                              {PHASE_LABELS[p]}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-[11px] font-medium text-slate-400">Difficulty</span>
                        <select
                          value={q.difficultyLevel}
                          onChange={(e) => mutate(index, "difficultyLevel", Number(e.target.value))}
                          className={SMALL_FIELD_CLASS}
                        >
                          {[1, 2, 3, 4, 5].map((d) => (
                            <option key={d} value={d}>
                              Difficulty {d}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>

        {questions.length === 0 ? (
          <div className="mt-8 rounded-2xl border border-dashed border-slate-700 px-6 py-10 text-center">
            <p className="text-sm text-slate-300">No questions yet. Add one, or regenerate the questionnaire.</p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <button
                type="button"
                onClick={addQuestion}
                disabled={busy !== null}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900/80 px-4 py-2 text-sm text-slate-200 transition hover:border-slate-500 disabled:opacity-50"
              >
                <Plus className="h-4 w-4" /> Add question
              </button>
              <button
                type="button"
                onClick={() => regenerate("all")}
                disabled={busy !== null || version?.canGenerate === false}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900/80 px-4 py-2 text-sm text-slate-200 transition hover:border-slate-500 disabled:opacity-50"
              >
                <RefreshCw className="h-4 w-4" /> Regenerate
              </button>
            </div>
          </div>
        ) : null}

        {questions.length > 0 ? (
          <button
            type="button"
            onClick={addQuestion}
            disabled={busy !== null || atLimit}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-cyan-300/40 px-4 py-3 text-sm font-medium text-cyan-200 transition hover:bg-cyan-400/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
            {atLimit ? `Up to ${MAX_QUESTIONS} questions` : "Add question"}
          </button>
        ) : null}
      </main>

      {/* Actions stay in reach however long the list gets. */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-800 bg-slate-950/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <p className="hidden text-xs text-slate-400 sm:block" aria-live="polite">
            {dirty
              ? "Unsaved changes. Save the draft, or finalize to use these questions in new interviews."
              : isFinalized
                ? `v${version?.versionNumber} is in use for new interviews.`
                : `Draft v${version?.versionNumber}. Finalize to use it in new interviews.`}
          </p>
          <div className="flex flex-wrap gap-2 [&>button]:flex-1 sm:[&>button]:flex-none">
            <button
              type="button"
              onClick={() => regenerate("all")}
              disabled={busy !== null || version?.canGenerate === false}
              title={version?.canGenerate === false ? "AI generation limit reached for this draft" : undefined}
              className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm sm:px-4 text-slate-200 transition hover:border-slate-500 disabled:opacity-50"
            >
              {busy === "regenerate-all" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              Regenerate all
            </button>
            <button
              type="button"
              onClick={save}
              disabled={busy !== null || !dirty}
              className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm sm:px-4 text-slate-200 transition hover:border-slate-500 disabled:opacity-40"
            >
              {busy === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Save draft
            </button>
            <button
              type="button"
              onClick={finalize}
              disabled={busy !== null || questions.length === 0}
              className="hv-solid-action inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-cyan-600 px-3 py-2 text-sm sm:px-5 font-semibold text-white shadow-[0_10px_20px_rgba(8,145,178,0.22)] transition hover:bg-cyan-500 disabled:opacity-50"
            >
              {busy === "finalize" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Check className="h-4 w-4" />
              )}
              Finalize
            </button>
          </div>
        </div>
      </div>

      {toast ? (
        <div
          role="status"
          className={`hv-solid-action fixed bottom-24 right-4 z-40 max-w-sm rounded-2xl px-4 py-3 text-sm shadow-lg sm:right-6 ${
            toast.tone === "error"
              ? "bg-rose-500/95 text-white"
              : "bg-emerald-500/95 text-white"
          }`}
        >
          {toast.message}
        </div>
      ) : null}

      <ConfirmDialog state={confirmState} onAnswer={answerConfirm} />
    </div>
  );
}
