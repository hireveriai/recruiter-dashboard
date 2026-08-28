"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  Check,
  GripVertical,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";

import { buildAuthUrl } from "@/lib/client/auth-query";

const SOURCE_LABELS = {
  job: "Role requirement",
  experience: "Experience",
  behavioral: "Judgement",
  resume: "Candidate background",
};

const PHASE_OPTIONS = ["warmup", "core", "probe", "closing"];

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

export default function QuestionnaireReviewPage() {
  const { jobId } = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);
  const [version, setVersion] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [dirty, setDirty] = useState(false);
  const dragIndex = useRef(null);

  const baseUrl = useMemo(
    () => buildAuthUrl(`/api/jobs/${jobId}/questionnaire`, searchParams),
    [jobId, searchParams]
  );

  const notify = useCallback((tone, message) => {
    setToast({ tone, message });
    setTimeout(() => setToast(null), 4000);
  }, []);

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
      setQuestions(withKeys(data.data.questions));
      setDirty(false);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [baseUrl]);

  useEffect(() => {
    load();
  }, [load]);

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
    setQuestions((prev) => [...prev, emptyQuestion()]);
    setDirty(true);
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

  const save = async () => {
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

  const goBack = () => {
    if (dirty && !window.confirm("You have unsaved changes. Leave without saving?")) return;
    router.push(buildAuthUrl("/jobs", searchParams));
  };

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-slate-400">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        Preparing the questionnaire…
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16 text-center">
        <p className="text-lg text-white">Could not load the questionnaire</p>
        <p className="mt-2 text-sm text-slate-400">{error}</p>
        <button
          onClick={load}
          className="mt-6 rounded-2xl bg-violet-600 px-5 py-2.5 text-sm text-white hover:bg-violet-500"
        >
          Try again
        </button>
      </div>
    );
  }

  const isFinalized = version?.status === "FINALIZED";

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <button
        onClick={goBack}
        className="mb-6 inline-flex items-center gap-2 text-sm text-slate-400 transition hover:text-white"
      >
        <ArrowLeft className="h-4 w-4" /> Back to jobs
      </button>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-white">Interview questionnaire</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-400">
            These structured questions are asked in every interview for this role. Each candidate
            also gets questions about their own background, plus follow-up questions based on their
            answers.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`rounded-full px-3 py-1 text-xs ${
              isFinalized
                ? "bg-emerald-500/10 text-emerald-300"
                : "bg-amber-500/10 text-amber-300"
            }`}
          >
            v{version?.versionNumber} · {isFinalized ? "Finalized" : "Draft"}
          </span>
          {dirty ? (
            <span className="rounded-full bg-amber-500/10 px-3 py-1 text-xs text-amber-300">
              Unsaved changes
            </span>
          ) : null}
        </div>
      </div>

      {isFinalized ? (
        <p className="mt-4 rounded-2xl border border-slate-800 bg-slate-950/40 px-4 py-3 text-xs text-slate-400">
          This version is in use. Editing it creates a new draft — interviews that already ran keep
          the questions they were asked.
        </p>
      ) : null}

      <div className="mt-6 flex flex-wrap gap-3">
        <button
          onClick={() => regenerate("all")}
          disabled={busy !== null}
          className="inline-flex items-center gap-2 rounded-2xl border border-slate-700 px-4 py-2 text-sm text-slate-200 transition hover:border-slate-500 disabled:opacity-50"
        >
          {busy === "regenerate-all" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          Regenerate all
        </button>
        <button
          onClick={addQuestion}
          disabled={busy !== null}
          className="inline-flex items-center gap-2 rounded-2xl border border-slate-700 px-4 py-2 text-sm text-slate-200 transition hover:border-slate-500 disabled:opacity-50"
        >
          <Plus className="h-4 w-4" /> Add question
        </button>
        <div className="ml-auto flex gap-3">
          <button
            onClick={save}
            disabled={busy !== null || !dirty}
            className="inline-flex items-center gap-2 rounded-2xl border border-slate-700 px-4 py-2 text-sm text-slate-200 transition hover:border-slate-500 disabled:opacity-40"
          >
            {busy === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Save draft
          </button>
          <button
            onClick={finalize}
            disabled={busy !== null || questions.length === 0}
            className="inline-flex items-center gap-2 rounded-2xl bg-violet-600 px-5 py-2 text-sm text-white transition hover:bg-violet-500 disabled:opacity-50"
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

      <ol className="mt-6 space-y-3">
        {questions.map((q, index) => (
          <li
            key={q.key}
            draggable
            onDragStart={() => {
              dragIndex.current = index;
            }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              if (dragIndex.current !== null) move(dragIndex.current, index);
              dragIndex.current = null;
            }}
            className="rounded-[20px] border border-slate-800 bg-slate-950/40 p-4"
          >
            <div className="flex items-start gap-3">
              <div className="flex flex-col items-center pt-2 text-slate-600">
                <GripVertical className="h-4 w-4 cursor-grab" />
                <span className="mt-1 text-xs text-slate-500">{index + 1}</span>
              </div>

              <div className="flex-1 space-y-3">
                <textarea
                  value={q.questionText}
                  onChange={(e) => mutate(index, "questionText", e.target.value)}
                  rows={2}
                  placeholder="Question the interviewer will ask"
                  className="w-full resize-none rounded-2xl border border-slate-700 bg-slate-900/80 px-4 py-3 text-sm text-white outline-none transition focus:border-violet-400/60"
                />

                <input
                  value={q.evaluationCriteria}
                  onChange={(e) => mutate(index, "evaluationCriteria", e.target.value)}
                  placeholder="What a strong answer should demonstrate"
                  className="w-full rounded-2xl border border-slate-800 bg-slate-900/50 px-4 py-2.5 text-xs text-slate-300 outline-none transition focus:border-violet-400/60"
                />

                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={q.sourceType}
                    onChange={(e) => mutate(index, "sourceType", e.target.value)}
                    className="rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-1.5 text-xs text-slate-300"
                  >
                    {Object.entries(SOURCE_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>

                  <input
                    value={q.competencyLabel}
                    onChange={(e) => mutate(index, "competencyLabel", e.target.value)}
                    placeholder="Competency"
                    className="w-40 rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-1.5 text-xs text-slate-300 outline-none focus:border-violet-400/60"
                  />

                  <select
                    value={q.phaseHint}
                    onChange={(e) => mutate(index, "phaseHint", e.target.value)}
                    className="rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-1.5 text-xs text-slate-300"
                  >
                    {PHASE_OPTIONS.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>

                  <select
                    value={q.difficultyLevel}
                    onChange={(e) => mutate(index, "difficultyLevel", Number(e.target.value))}
                    className="rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-1.5 text-xs text-slate-300"
                  >
                    {[1, 2, 3, 4, 5].map((d) => (
                      <option key={d} value={d}>
                        Difficulty {d}
                      </option>
                    ))}
                  </select>

                  <span className="rounded-full bg-slate-800/70 px-2.5 py-1 text-[10px] uppercase tracking-wide text-slate-400">
                    {q.origin === "RECRUITER" ? "Yours" : "AI"}
                  </span>

                  <div className="ml-auto flex items-center gap-1">
                    <button
                      onClick={() => move(index, index - 1)}
                      disabled={index === 0}
                      title="Move up"
                      className="rounded-lg px-2 py-1 text-xs text-slate-400 hover:text-white disabled:opacity-30"
                    >
                      ↑
                    </button>
                    <button
                      onClick={() => move(index, index + 1)}
                      disabled={index === questions.length - 1}
                      title="Move down"
                      className="rounded-lg px-2 py-1 text-xs text-slate-400 hover:text-white disabled:opacity-30"
                    >
                      ↓
                    </button>
                    {q.questionnaireQuestionId ? (
                      <button
                        onClick={() => regenerate("question", q.questionnaireQuestionId)}
                        disabled={busy !== null || dirty}
                        title={dirty ? "Save your changes first" : "Regenerate this question"}
                        className="rounded-lg px-2 py-1 text-slate-400 transition hover:text-white disabled:opacity-30"
                      >
                        {busy === q.questionnaireQuestionId ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <RefreshCw className="h-3.5 w-3.5" />
                        )}
                      </button>
                    ) : null}
                    <button
                      onClick={() => removeQuestion(index)}
                      title="Delete question"
                      className="rounded-lg px-2 py-1 text-slate-400 transition hover:text-rose-400"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </li>
        ))}
      </ol>

      {questions.length === 0 ? (
        <p className="mt-8 rounded-2xl border border-dashed border-slate-800 py-10 text-center text-sm text-slate-500">
          No questions yet. Add one, or regenerate the questionnaire.
        </p>
      ) : null}

      {toast ? (
        <div
          className={`fixed bottom-6 right-6 rounded-2xl px-4 py-3 text-sm shadow-lg ${
            toast.tone === "error"
              ? "bg-rose-500/90 text-white"
              : "bg-emerald-500/90 text-white"
          }`}
        >
          {toast.message}
        </div>
      ) : null}
    </div>
  );
}
