"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  Loader2,
  Minus,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";

import { buildAuthUrl } from "@/lib/client/auth-query";

const RESUME_EMPHASIS_OPTIONS = [
  { value: "OFF", label: "Off", hint: "No questions about the candidate's own background." },
  { value: "LIGHT", label: "Light", hint: "One question about the candidate's background." },
  { value: "STANDARD", label: "Standard", hint: "A small share of questions about their background." },
  { value: "HEAVY", label: "Heavy", hint: "A larger share of questions about their background." },
];

const STEP = 5;
const MIN_COVERAGE = 10;

function toWorking(plan) {
  if (!plan) return null;
  return {
    resumeEmphasis: plan.resumeEmphasis,
    areas: plan.areas.map((area) => ({ ...area })),
  };
}

/** Mirrors lib/server/interview-focus/focus-rules.ts; the server stays authoritative. */
function validate(working, maxAreas) {
  const errors = [];
  if (!working) return errors;
  const total = working.areas.reduce((sum, area) => sum + Number(area.coverageWeight || 0), 0);
  if (working.areas.length === 0) errors.push("Add at least one focus area.");
  if (working.areas.length > maxAreas) {
    errors.push(`This interview length allows at most ${maxAreas} focus areas.`);
  }
  if (total !== 100) errors.push(`Coverage adds up to ${total}%; it must total exactly 100%.`);
  working.areas.forEach((area, index) => {
    if (area.isCustom && String(area.label || "").trim().length < 2) {
      errors.push(`Focus area ${index + 1}: give the custom competency a name.`);
    }
    if (area.coverageWeight < MIN_COVERAGE) {
      errors.push(`${area.label || `Focus area ${index + 1}`}: needs at least ${MIN_COVERAGE}% coverage.`);
    }
  });
  return errors;
}

function sameWorking(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

export default function InterviewFocusEditor({ jobId, searchParams, onApplied, notify, questionEditsPending = false }) {
  const [state, setState] = useState(null);
  const [library, setLibrary] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const [working, setWorking] = useState(null);
  const [serverErrors, setServerErrors] = useState([]);
  const [busy, setBusy] = useState(null);
  const [adding, setAdding] = useState(false);
  const [custom, setCustom] = useState({ label: "", description: "" });

  const focusUrl = useMemo(
    () => buildAuthUrl(`/api/jobs/${jobId}/focus`, searchParams),
    [jobId, searchParams]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [statusRes, focusRes] = await Promise.all([
        fetch(buildAuthUrl("/api/interview-focus", searchParams), { credentials: "include", cache: "no-store" }),
        fetch(focusUrl, { credentials: "include", cache: "no-store" }),
      ]);
      const status = await statusRes.json();
      const focus = await focusRes.json();
      if (!focusRes.ok) throw new Error(focus?.error?.message || "Could not load the interview focus");
      setLibrary(status?.data?.library ?? []);
      setState(focus.data);
      setWorking(toWorking(focus.data?.draft ?? focus.data?.active));
      setServerErrors([]);
    } catch (e) {
      setLoadError(e.message);
    } finally {
      setLoading(false);
    }
  }, [focusUrl, searchParams]);

  useEffect(() => {
    load();
  }, [load]);

  const current = state?.draft ?? state?.active ?? null;
  const baseline = useMemo(() => toWorking(current), [current]);
  const dirty = working && baseline ? !sameWorking(working, baseline) : false;
  const errors = useMemo(() => validate(working, state?.maxAreas ?? 5), [working, state?.maxAreas]);
  const total = working?.areas.reduce((sum, area) => sum + Number(area.coverageWeight || 0), 0) ?? 0;
  const available = library.filter((entry) => !working?.areas.some((area) => area.areaKey === entry.key));
  const atLimit = (working?.areas.length ?? 0) >= (state?.maxAreas ?? 5);

  if (loading) {
    return (
      <div className="mt-6 flex items-center gap-2 rounded-[20px] border border-slate-800 bg-slate-950/40 px-5 py-4 text-sm text-slate-400">
        <Loader2 className="h-4 w-4 animate-spin" /> Preparing the VERIS recommended focus…
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="mt-6 rounded-[20px] border border-rose-400/30 bg-rose-500/10 px-5 py-4 text-sm text-rose-200">
        {loadError}{" "}
        <button onClick={load} className="underline">
          Try again
        </button>
      </div>
    );
  }

  if (!state?.enabled || !working) return null;

  const update = (index, patch) => {
    setWorking((prev) => ({
      ...prev,
      areas: prev.areas.map((area, i) => (i === index ? { ...area, ...patch } : area)),
    }));
    setServerErrors([]);
  };

  const step = (index, delta) => {
    const value = Math.min(100, Math.max(MIN_COVERAGE, Number(working.areas[index].coverageWeight) + delta));
    update(index, { coverageWeight: value });
  };

  const move = (from, to) => {
    if (to < 0 || to >= working.areas.length) return;
    setWorking((prev) => {
      const areas = [...prev.areas];
      const [item] = areas.splice(from, 1);
      areas.splice(to, 0, item);
      return { ...prev, areas };
    });
  };

  const remove = (index) => {
    setWorking((prev) => ({ ...prev, areas: prev.areas.filter((_, i) => i !== index) }));
    setServerErrors([]);
  };

  const addLibrary = (key) => {
    const entry = library.find((item) => item.key === key);
    if (!entry) return;
    setWorking((prev) => ({
      ...prev,
      areas: [
        ...prev.areas,
        { areaKey: entry.key, label: entry.label, description: entry.description, isCustom: false, coverageWeight: MIN_COVERAGE, rationale: null },
      ],
    }));
    setAdding(false);
  };

  const addCustom = () => {
    const label = custom.label.trim();
    if (label.length < 2) return;
    setWorking((prev) => ({
      ...prev,
      areas: [
        ...prev.areas,
        { areaKey: null, label, description: custom.description.trim() || null, isCustom: true, coverageWeight: MIN_COVERAGE, rationale: null },
      ],
    }));
    setCustom({ label: "", description: "" });
    setAdding(false);
  };

  const post = async (body, busyKey, successMessage) => {
    setBusy(busyKey);
    setServerErrors([]);
    try {
      const res = await fetch(focusUrl, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setServerErrors(data?.error?.errors ?? [data?.error?.message || "Could not update the interview focus"]);
        return null;
      }
      setState(data.data);
      setWorking(toWorking(data.data?.draft ?? data.data?.active));
      if (successMessage) notify?.("success", successMessage);
      return data.data;
    } catch (e) {
      setServerErrors([e.message]);
      return null;
    } finally {
      setBusy(null);
    }
  };

  const saveDraft = () =>
    post({ action: "save_draft", areas: working.areas, resumeEmphasis: working.resumeEmphasis }, "save", "Focus saved as a draft");

  const apply = async () => {
    if (dirty || !state.draft) {
      const saved = await post(
        { action: "save_draft", areas: working.areas, resumeEmphasis: working.resumeEmphasis },
        "apply",
        null
      );
      if (!saved) return;
    }
    const applied = await post({ action: "apply" }, "apply", null);
    if (applied) {
      notify?.("success", applied.applied?.questionnaireVersionNumber
        ? `Focus applied. Draft questionnaire v${applied.applied.questionnaireVersionNumber} is ready to review.`
        : "Focus applied.");
      onApplied?.(applied);
    }
  };

  const restore = () => post({ action: "restore_recommended" }, "restore", "VERIS Recommended focus restored as a draft");
  const discard = () => post({ action: "discard_draft" }, "discard", "Focus draft discarded");

  const isCustomized = current?.origin === "CUSTOM";
  const allErrors = [...errors, ...serverErrors];
  const disabled = busy !== null;

  return (
    <section className="mt-6 rounded-[24px] border border-slate-800 bg-slate-950/40 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold text-white">Interview Focus</h2>
            <span
              className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${
                isCustomized
                  ? "border-sky-300/30 bg-sky-400/10 text-sky-200"
                  : "border-violet-300/30 bg-violet-400/10 text-violet-200"
              }`}
            >
              {isCustomized ? null : <Sparkles className="h-3 w-3" aria-hidden="true" />}
              {isCustomized ? "Customized" : "VERIS Recommended"}
            </span>
            {state.draft ? (
              <span className="rounded-full bg-amber-500/10 px-2.5 py-0.5 text-[11px] text-amber-300">
                Draft v{state.draft.versionNumber} — not applied yet
              </span>
            ) : (
              <span className="rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-[11px] text-emerald-300">
                Active v{state.active?.versionNumber}
              </span>
            )}
          </div>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-400">
            Sets how much of the interview covers each competency. It shapes the questions VERIS
            generates; it does not change how candidates are scored.
          </p>
        </div>
        {!expanded ? (
          <button
            onClick={() => setExpanded(true)}
            className="rounded-2xl border border-violet-400/40 bg-violet-500/10 px-4 py-2 text-sm font-medium text-violet-100 transition hover:bg-violet-500/20"
          >
            Customize
          </button>
        ) : (
          <button
            onClick={() => {
              setExpanded(false);
              setWorking(baseline);
              setServerErrors([]);
            }}
            className="rounded-2xl border border-slate-700 px-4 py-2 text-sm text-slate-300 transition hover:border-slate-500"
          >
            Close editor
          </button>
        )}
      </div>

      {!expanded ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {current.areas.map((area) => (
            <span
              key={area.areaKey}
              title={area.rationale || area.description || undefined}
              className="rounded-full border border-slate-700 bg-slate-900/60 px-3 py-1 text-xs text-slate-200"
            >
              {area.label} <span className="font-semibold text-violet-200">{area.coverageWeight}%</span>
            </span>
          ))}
          <span className="rounded-full border border-slate-800 px-3 py-1 text-xs text-slate-400">
            Resume questions: {RESUME_EMPHASIS_OPTIONS.find((o) => o.value === current.resumeEmphasis)?.label}
          </span>
        </div>
      ) : (
        <div className="mt-5 space-y-5">
          <ol className="space-y-2">
            {working.areas.map((area, index) => (
              <li
                key={`${area.areaKey ?? "custom"}-${index}`}
                className="rounded-2xl border border-slate-800 bg-slate-900/50 p-3"
              >
                <div className="flex flex-wrap items-center gap-3">
                  <div className="min-w-0 flex-1">
                    {area.isCustom ? (
                      <input
                        value={area.label}
                        onChange={(e) => update(index, { label: e.target.value })}
                        maxLength={60}
                        placeholder="Custom competency name"
                        aria-label={`Focus area ${index + 1} name`}
                        className="w-full max-w-sm rounded-xl border border-slate-700 bg-slate-900/80 px-3 py-1.5 text-sm text-white outline-none focus:border-violet-400/60"
                      />
                    ) : (
                      <p className="text-sm font-medium text-white">{area.label}</p>
                    )}
                    <p className="mt-0.5 text-xs leading-5 text-slate-400">
                      {area.rationale ? (
                        <>
                          <Sparkles className="mr-1 inline h-3 w-3 text-violet-300" aria-hidden="true" />
                          {area.rationale}
                        </>
                      ) : (
                        area.description || (area.isCustom ? "Your own competency." : null)
                      )}
                    </p>
                  </div>

                  <div className="flex items-center gap-1" role="group" aria-label={`${area.label} coverage`}>
                    <button
                      onClick={() => step(index, -STEP)}
                      disabled={area.coverageWeight <= MIN_COVERAGE}
                      aria-label={`Decrease ${area.label}`}
                      className="rounded-lg border border-slate-700 p-1.5 text-slate-300 transition hover:border-slate-500 disabled:opacity-30"
                    >
                      <Minus className="h-3.5 w-3.5" />
                    </button>
                    <span className="w-12 text-center text-sm font-semibold tabular-nums text-white">
                      {area.coverageWeight}%
                    </span>
                    <button
                      onClick={() => step(index, STEP)}
                      disabled={area.coverageWeight >= 100}
                      aria-label={`Increase ${area.label}`}
                      className="rounded-lg border border-slate-700 p-1.5 text-slate-300 transition hover:border-slate-500 disabled:opacity-30"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  <div className="flex items-center gap-0.5">
                    <button
                      onClick={() => move(index, index - 1)}
                      disabled={index === 0}
                      aria-label={`Move ${area.label} up`}
                      className="rounded-lg p-1.5 text-slate-400 hover:text-white disabled:opacity-30"
                    >
                      <ArrowUp className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => move(index, index + 1)}
                      disabled={index === working.areas.length - 1}
                      aria-label={`Move ${area.label} down`}
                      className="rounded-lg p-1.5 text-slate-400 hover:text-white disabled:opacity-30"
                    >
                      <ArrowDown className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => remove(index)}
                      aria-label={`Remove ${area.label}`}
                      className="rounded-lg p-1.5 text-slate-400 transition hover:text-rose-400"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ol>

          <div className="flex flex-wrap items-center gap-3">
            {adding ? (
              <div className="w-full rounded-2xl border border-slate-800 bg-slate-900/40 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    defaultValue=""
                    onChange={(e) => e.target.value && addLibrary(e.target.value)}
                    aria-label="Add a competency from the VERIS library"
                    className="rounded-xl border border-slate-700 bg-slate-900/80 px-3 py-1.5 text-sm text-slate-200"
                  >
                    <option value="">Add from the VERIS library…</option>
                    {available.map((entry) => (
                      <option key={entry.key} value={entry.key}>
                        {entry.label}
                      </option>
                    ))}
                  </select>
                  <span className="text-xs text-slate-500">or create your own:</span>
                  <input
                    value={custom.label}
                    onChange={(e) => setCustom((prev) => ({ ...prev, label: e.target.value }))}
                    maxLength={60}
                    placeholder="Competency name"
                    className="w-48 rounded-xl border border-slate-700 bg-slate-900/80 px-3 py-1.5 text-sm text-white outline-none focus:border-violet-400/60"
                  />
                  <input
                    value={custom.description}
                    onChange={(e) => setCustom((prev) => ({ ...prev, description: e.target.value }))}
                    maxLength={240}
                    placeholder="What it means (optional)"
                    className="min-w-[12rem] flex-1 rounded-xl border border-slate-700 bg-slate-900/80 px-3 py-1.5 text-sm text-white outline-none focus:border-violet-400/60"
                  />
                  <button
                    onClick={addCustom}
                    disabled={custom.label.trim().length < 2}
                    className="rounded-xl bg-violet-600 px-3 py-1.5 text-sm text-white transition hover:bg-violet-500 disabled:opacity-40"
                  >
                    Add
                  </button>
                  <button onClick={() => setAdding(false)} aria-label="Cancel adding" className="rounded-lg p-1.5 text-slate-400 hover:text-white">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setAdding(true)}
                disabled={atLimit}
                title={atLimit ? `This interview length allows at most ${state.maxAreas} focus areas` : undefined}
                className="inline-flex items-center gap-2 rounded-2xl border border-slate-700 px-3.5 py-1.5 text-sm text-slate-200 transition hover:border-slate-500 disabled:opacity-40"
              >
                <Plus className="h-4 w-4" /> Add competency
              </button>
            )}
            <span className="text-xs text-slate-500">
              {working.areas.length} of {state.maxAreas} areas for a {state.durationMinutes}-minute interview
            </span>
            <span
              className={`ml-auto rounded-full px-3 py-1 text-xs font-semibold tabular-nums ${
                total === 100 ? "bg-emerald-500/10 text-emerald-300" : "bg-rose-500/10 text-rose-300"
              }`}
            >
              Total {total}%{total === 100 ? " ✓" : " — must be 100%"}
            </span>
          </div>

          <div>
            <p className="text-sm font-medium text-white">Resume-based questions</p>
            <p className="mt-0.5 text-xs text-slate-400">
              How many questions draw on the candidate&apos;s own background. Separate from the
              competencies above, which apply to every question.
            </p>
            <div className="mt-2 inline-flex flex-wrap gap-1 rounded-2xl border border-slate-700 bg-slate-900/60 p-1" role="radiogroup" aria-label="Resume emphasis">
              {RESUME_EMPHASIS_OPTIONS.map((option) => {
                const selected = working.resumeEmphasis === option.value;
                return (
                  <button
                    key={option.value}
                    role="radio"
                    aria-checked={selected}
                    title={option.hint}
                    onClick={() => setWorking((prev) => ({ ...prev, resumeEmphasis: option.value }))}
                    className={`rounded-xl px-3.5 py-1.5 text-sm transition ${
                      selected ? "bg-violet-600 text-white" : "text-slate-300 hover:text-white"
                    }`}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
            {state.resumeQuestionsEnabled === false ? (
              <p className="mt-2 text-xs text-amber-300">
                Resume questions are turned off for this job, so this setting has no effect.
              </p>
            ) : null}
          </div>

          {allErrors.length > 0 ? (
            <ul className="space-y-1 rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-xs text-rose-200" role="alert">
              {allErrors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          ) : null}

          <div className="flex flex-wrap items-center gap-3 border-t border-slate-800 pt-4">
            <button
              onClick={restore}
              disabled={disabled}
              className="inline-flex items-center gap-2 rounded-2xl border border-slate-700 px-3.5 py-2 text-sm text-slate-200 transition hover:border-slate-500 disabled:opacity-40"
            >
              {busy === "restore" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
              Restore VERIS Recommended
            </button>
            {state.draft ? (
              <button
                onClick={discard}
                disabled={disabled}
                className="rounded-2xl px-3.5 py-2 text-sm text-slate-400 transition hover:text-rose-300 disabled:opacity-40"
              >
                Discard draft
              </button>
            ) : null}
            <div className="ml-auto flex gap-3">
              <button
                onClick={saveDraft}
                disabled={disabled || !dirty || errors.length > 0}
                className="inline-flex items-center gap-2 rounded-2xl border border-slate-700 px-4 py-2 text-sm text-slate-200 transition hover:border-slate-500 disabled:opacity-40"
              >
                {busy === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Save draft
              </button>
              <button
                onClick={apply}
                disabled={disabled || questionEditsPending || errors.length > 0 || (!dirty && !state.draft)}
                title={questionEditsPending ? "Save or discard your question edits first" : undefined}
                className="inline-flex items-center gap-2 rounded-2xl bg-violet-600 px-5 py-2 text-sm font-medium text-white transition hover:bg-violet-500 disabled:opacity-40"
              >
                {busy === "apply" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Apply &amp; regenerate questions
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
