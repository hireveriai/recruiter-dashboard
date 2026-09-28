"use client"
import { formatLabel } from "@/lib/client/format-label"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { useAuthSearchParams } from "@/lib/client/use-auth-search-params"

import BackToDashboardLink from "@/components/BackToDashboardLink"
import Navbar from "@/components/Navbar"
import { buildAuthUrl } from "@/lib/client/auth-query"
import { showActionFeedback } from "@/lib/client/action-feedback"
import { AssessmentWorkflowPanel } from "@/components/AssessmentWorkflowGuide"

const QUESTION_TYPE_LABELS = {
  SINGLE_CHOICE: "Single Choice",
  MULTI_SELECT: "Multi Select",
  SHORT_ANSWER: "Short Answer",
  SCENARIO: "Scenario",
  CODING: "Coding",
}

const MANUAL_ADD_TYPES = ["SHORT_ANSWER", "SINGLE_CHOICE", "MULTI_SELECT", "SCENARIO", "CODING"]

const DEFAULT_CODING_SPEC = {
  language: "python",
  starterCode: "",
  testCases: [{ input: "", expectedOutput: "", hidden: false }],
}

const FIELD_CLASS =
  "w-full rounded-xl border border-slate-700 bg-slate-900/80 px-3.5 py-2 text-sm text-white outline-none transition focus:border-cyan-300/70 focus:shadow-[0_0_0_3px_rgba(34,211,238,0.12)] disabled:opacity-60"

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
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {children}
      </svg>
    </button>
  )
}

/** In-app replacement for window.confirm, with the same wording. */
function ConfirmDialog({ state, onAnswer }) {
  if (!state) return null
  return (
    <div
      className="hv-theme-dialog-backdrop fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/70 px-4 backdrop-blur-sm"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="aq-confirm-title"
    >
      <div className="hv-theme-modal w-full max-w-md rounded-[20px] border border-slate-700/70 bg-[#0a1020] p-6 shadow-[0_24px_80px_rgba(2,6,23,0.55)]">
        <h2 id="aq-confirm-title" className="text-lg font-semibold text-white">
          {state.title}
        </h2>
        <p className="mt-2 text-sm leading-6 text-slate-300">{state.message}</p>
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => onAnswer(false)}
            className="rounded-xl border border-slate-700 bg-slate-900/80 px-4 py-2 text-sm text-slate-200 transition hover:border-slate-500"
          >
            Cancel
          </button>
          <button
            type="button"
            autoFocus
            onClick={() => onAnswer(true)}
            className="hv-solid-action rounded-xl bg-cyan-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-cyan-500"
          >
            {state.confirmLabel ?? "Continue"}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function AssessmentQuestionsPage() {
  const { id } = useParams()
  const router = useRouter()
  const searchParams = useAuthSearchParams()

  const [assessment, setAssessment] = useState(null)
  const [versions, setVersions] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [savedAt, setSavedAt] = useState("")
  const [preview, setPreview] = useState(false)
  const [genCount, setGenCount] = useState(5)
  const [genType, setGenType] = useState("ALL")
  const [inviteCount, setInviteCount] = useState(0)
  const [manualType, setManualType] = useState("SHORT_ANSWER")
  const [confirmState, setConfirmState] = useState(null)

  // Resolves true when the recruiter confirms.
  const askConfirm = (options) => new Promise((resolve) => setConfirmState({ ...options, resolve }))
  const answerConfirm = (answer) => {
    confirmState?.resolve(answer)
    setConfirmState(null)
  }

  const apiBase = useMemo(() => buildAuthUrl(`/api/assessments/${id}`, searchParams), [id, searchParams])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(apiBase, { credentials: "include", cache: "no-store" })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error?.message || "Failed to load assessment")
      setAssessment(data.data)
      setVersions(data.data?.versions ?? [])
    } catch (err) {
      showActionFeedback({ tone: "error", title: "Load failed", message: err.message })
    } finally {
      setLoading(false)
    }
  }, [apiBase])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    fetch(buildAuthUrl(`/api/assessments/${id}/invites?pageSize=1`, searchParams), { credentials: "include" })
      .then((res) => res.json())
      .then((data) => setInviteCount(Number(data?.data?.meta?.total ?? 0)))
      .catch(() => setInviteCount(0))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const draftVersion = versions.find((v) => v.status === "DRAFT")
  const finalizedVersion = versions.find((v) => v.status === "FINALIZED")
  const displayVersion = draftVersion ?? finalizedVersion
  const questions = displayVersion?.questions ?? []
  const editable = Boolean(draftVersion)

  // Default "Generate more with AI" to however many questions are still
  // needed to reach the count the recruiter configured when creating the
  // assessment, instead of an arbitrary hardcoded number.
  useEffect(() => {
    if (!assessment) return
    const target = Number(assessment.questionCount) || 10
    setGenCount(Math.max(1, target - questions.length))
  }, [assessment, questions.length])

  const handleGenerate = async () => {
    if (displayVersion?.canGenerate === false) {
      showActionFeedback({
        tone: "error",
        title: "Generation limit reached",
        message: "You've used all AI generation attempts for this draft. Edit questions manually instead.",
      })
      return
    }

    const remaining = displayVersion?.remainingGenerations
    const isFirstGeneration = questions.length === 0 && (displayVersion?.generationAttempts ?? 0) === 0
    if (!isFirstGeneration) {
      const confirmMessage =
        typeof remaining === "number"
          ? `Generate more questions with AI? This will use 1 of your remaining AI generation attempts. ${remaining} generation${remaining === 1 ? "" : "s"} remaining.`
          : "Generate more questions with AI?"
      const confirmed = await askConfirm({ title: "Generate more questions?", message: confirmMessage, confirmLabel: "Generate" })
      if (!confirmed) return
    }

    try {
      setBusy(true)
      const res = await fetch(buildAuthUrl(`/api/assessments/${id}/generate-questions`, searchParams), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          questionCount: Number(genCount) || 5,
          // Omitted (=> "ALL") falls back to the assessment's configured
          // question-type mix on the server, exactly as before this control
          // existed. Picking one type restricts generation to only that type.
          ...(genType !== "ALL" ? { questionTypes: [genType] } : {}),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error?.message || "Generation failed")
      showActionFeedback({ tone: "success", title: "Questions generated", message: `${data.data.questionsGenerated} question(s) added.` })
      await load()
      markSaved()
    } catch (err) {
      showActionFeedback({ tone: "error", title: "Generation failed", message: err.message })
    } finally {
      setBusy(false)
    }
  }

  const markSaved = () => setSavedAt(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }))

  const handleSaveDraft = async () => {
    setBusy(true)
    try {
      await load()
      markSaved()
      showActionFeedback({
        tone: "success",
        title: "Draft saved",
        message: "Your questions are saved as a draft. Click Publish when you're ready to send this to candidates.",
      })
    } finally {
      setBusy(false)
    }
  }

  const handleAddManual = async () => {
    const isObjective = manualType === "SINGLE_CHOICE" || manualType === "MULTI_SELECT"
    const isCoding = manualType === "CODING"

    const body = {
      questionType: manualType,
      questionText: "New question - edit me",
      points: 1,
      ...(isObjective
        ? { options: [{ optionText: "Option 1", isCorrect: true }, { optionText: "Option 2", isCorrect: false }] }
        : isCoding
          ? { codingSpec: DEFAULT_CODING_SPEC }
          : { rubric: { criteria: ["Answer addresses the question"] } }),
    }

    try {
      setBusy(true)
      const res = await fetch(buildAuthUrl(`/api/assessments/${id}/questions`, searchParams), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error?.message || "Failed to add question")
      await load()
      markSaved()
    } catch (err) {
      showActionFeedback({ tone: "error", title: "Add failed", message: err.message })
    } finally {
      setBusy(false)
    }
  }

  const handleDeleteQuestion = async (questionId) => {
    try {
      setBusy(true)
      const res = await fetch(buildAuthUrl(`/api/assessments/${id}/questions/${questionId}`, searchParams), {
        method: "DELETE",
        credentials: "include",
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error?.message || "Failed to delete question")
      await load()
      markSaved()
    } catch (err) {
      showActionFeedback({ tone: "error", title: "Delete failed", message: err.message })
    } finally {
      setBusy(false)
    }
  }

  const patchQuestion = async (questionId, payload) => {
    const res = await fetch(buildAuthUrl(`/api/assessments/${id}/questions/${questionId}`, searchParams), {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data?.error?.message || "Failed to update question")
    return data.data
  }

  const handleMove = async (question, direction) => {
    const index = questions.findIndex((q) => q.id === question.id)
    const targetIndex = index + direction
    if (targetIndex < 0 || targetIndex >= questions.length) return

    const target = questions[targetIndex]
    try {
      setBusy(true)
      await patchQuestion(question.id, { orderIndex: target.orderIndex })
      await patchQuestion(target.id, { orderIndex: question.orderIndex })
      await load()
      markSaved()
    } catch (err) {
      showActionFeedback({ tone: "error", title: "Reorder failed", message: err.message })
    } finally {
      setBusy(false)
    }
  }

  const handleQuestionTextBlur = async (question, value) => {
    if (value === question.questionText) return
    try {
      await patchQuestion(question.id, { questionText: value })
      markSaved()
    } catch (err) {
      showActionFeedback({ tone: "error", title: "Save failed", message: err.message })
    }
  }

  const handlePointsBlur = async (question, value) => {
    const points = Number(value)
    if (!Number.isFinite(points) || points === Number(question.points)) return
    try {
      await patchQuestion(question.id, { points })
      markSaved()
    } catch (err) {
      showActionFeedback({ tone: "error", title: "Save failed", message: err.message })
    }
  }

  const handleCodingSpecUpdate = async (question, partialSpec) => {
    const currentSpec = question.rubric?.codingSpec ?? DEFAULT_CODING_SPEC
    const nextSpec = { ...currentSpec, ...partialSpec }
    try {
      await patchQuestion(question.id, { codingSpec: nextSpec })
      await load()
      markSaved()
    } catch (err) {
      showActionFeedback({ tone: "error", title: "Save failed", message: err.message })
    }
  }

  const handleOptionUpdate = async (question, option, payload) => {
    try {
      const res = await fetch(
        buildAuthUrl(`/api/assessments/${id}/questions/${question.id}/options/${option.id}`, searchParams),
        {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      )
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error?.message || "Failed to update option")
      await load()
      markSaved()
    } catch (err) {
      showActionFeedback({ tone: "error", title: "Save failed", message: err.message })
    }
  }

  const handleAddOption = async (question) => {
    try {
      const res = await fetch(buildAuthUrl(`/api/assessments/${id}/questions/${question.id}/options`, searchParams), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ optionText: "New option", isCorrect: false }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error?.message || "Failed to add option")
      await load()
      markSaved()
    } catch (err) {
      showActionFeedback({ tone: "error", title: "Add option failed", message: err.message })
    }
  }

  const handleDeleteOption = async (question, option) => {
    try {
      const res = await fetch(
        buildAuthUrl(`/api/assessments/${id}/questions/${question.id}/options/${option.id}`, searchParams),
        { method: "DELETE", credentials: "include" }
      )
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error?.message || "Failed to delete option")
      await load()
      markSaved()
    } catch (err) {
      showActionFeedback({ tone: "error", title: "Delete option failed", message: err.message })
    }
  }

  const handlePublish = async () => {
    const confirmed = await askConfirm({
      title: assessment?.status === "PUBLISHED" ? "Publish a new version?" : "Publish this assessment?",
      message:
        assessment?.status === "PUBLISHED"
          ? "Publishing again will create a new version from your current edits and become the version sent to future candidates. Continue?"
          : "Publish this assessment? Candidates can only be invited to a published assessment.",
      confirmLabel: "Publish",
    })
    if (!confirmed) return

    try {
      setBusy(true)
      const res = await fetch(buildAuthUrl(`/api/assessments/${id}/publish`, searchParams), {
        method: "POST",
        credentials: "include",
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error?.message || "Publish failed")
      showActionFeedback({ tone: "success", title: "Assessment published", message: "Ready to send to candidates." })
      await load()
    } catch (err) {
      showActionFeedback({ tone: "error", title: "Publish failed", message: err.message })
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 text-white">
        <Navbar />
        <div className="p-10 text-center text-slate-400">Loading assessment...</div>
      </div>
    )
  }

  const isPublished = assessment?.status === "PUBLISHED"
  const targetCount = Number(assessment?.questionCount) || null
  const totalPoints = questions.reduce((sum, q) => sum + (Number(q.points) || 0), 0)

  return (
    <div className="hv-page-enter min-h-screen bg-slate-950 text-white">
      <Navbar />

      <main className="mx-auto max-w-[1100px] space-y-5 px-4 pb-32 pt-6 sm:px-6 lg:px-8 lg:pt-7">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <header className="min-w-0">
            <button
              type="button"
              onClick={() => router.push(buildAuthUrl("/assessments", searchParams))}
              className="text-sm text-slate-400 hover:text-white"
            >
              &larr; Back to Assessments
            </button>
            <p className="mt-4 text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-300">Assessment questions</p>
            <h1 className="mt-1.5 text-2xl font-semibold tracking-tight text-white sm:text-[1.75rem]">{assessment?.title}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              {assessment?.jobTitle ? <span className="text-slate-400">{assessment.jobTitle}</span> : null}
              <span
                className={`rounded-full border px-2.5 py-0.5 font-medium ${
                  isPublished
                    ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-300"
                    : "border-amber-400/30 bg-amber-500/10 text-amber-300"
                }`}
              >
                {formatLabel(assessment?.status)}
              </span>
              {typeof displayVersion?.remainingGenerations === "number" ? (
                <span className="rounded-full border border-slate-700 bg-slate-900/70 px-2.5 py-0.5 text-slate-400">
                  {displayVersion.canGenerate
                    ? `${displayVersion.remainingGenerations} AI generation${displayVersion.remainingGenerations === 1 ? "" : "s"} remaining`
                    : "AI generation limit reached"}
                </span>
              ) : null}
            </div>
          </header>
          <div className="flex flex-wrap items-center gap-2">
            <BackToDashboardLink className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-300 transition hover:border-slate-500 hover:text-white" />
            <div role="radiogroup" aria-label="View mode" className="flex rounded-xl border border-slate-700 bg-slate-900/70 p-1">
              {[
                [false, "Edit"],
                [true, "Preview"],
              ].map(([value, label]) => (
                <button
                  key={label}
                  type="button"
                  role="radio"
                  aria-checked={preview === value}
                  onClick={() => setPreview(value)}
                  className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                    preview === value
                      ? "bg-cyan-400/15 text-cyan-100 shadow-[inset_0_0_0_1px_rgba(103,232,249,0.45)]"
                      : "text-slate-400 hover:text-white"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <AssessmentWorkflowPanel
          assessmentId={id}
          isPublished={isPublished}
          hasQuestions={questions.length > 0}
          hasInvites={inviteCount > 0}
          hasResults={false}
        />

        {!editable ? (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100">
            This assessment has no draft version - it is showing the finalized version read-only. Add or generate a
            question to start a new draft version.
          </div>
        ) : null}

        {displayVersion?.canGenerate === false ? (
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-xs text-slate-400">
            You&apos;ve used all {displayVersion.generationLimit} AI generation attempts for this draft. You can
            continue editing the questions manually or add your own questions.
          </div>
        ) : null}

        <div className="grid gap-3 lg:grid-cols-[1.4fr_1fr]">
          <section className="rounded-xl border border-cyan-300/20 bg-cyan-400/[0.05] p-4 sm:p-5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-300">AI Generation</p>
            <p className="mt-1 text-xs leading-5 text-slate-400">
              Generates new questions with AI and adds them to this draft. &ldquo;All Types&rdquo; mixes across the
              types configured for this assessment; picking one type generates only that type.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <label className="sr-only" htmlFor="aq-gen-count">Number of questions to generate</label>
              <input
                id="aq-gen-count"
                type="number"
                min={1}
                max={50}
                value={genCount}
                onChange={(e) => setGenCount(e.target.value)}
                className="h-9 w-20 rounded-lg border border-slate-700 bg-slate-900/80 px-2.5 text-sm text-white outline-none focus:border-cyan-300/70"
              />
              <select
                value={genType}
                onChange={(e) => setGenType(e.target.value)}
                title="Question type to generate"
                aria-label="Question type to generate"
                className="h-9 rounded-lg border border-slate-700 bg-slate-900/80 px-2.5 text-sm text-slate-200 outline-none focus:border-cyan-300/70"
              >
                <option value="ALL">All Types</option>
                {MANUAL_ADD_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {QUESTION_TYPE_LABELS[type]}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={handleGenerate}
                disabled={busy || displayVersion?.canGenerate === false}
                title={displayVersion?.canGenerate === false ? "AI generation limit reached for this draft" : undefined}
                className="hv-solid-action h-9 rounded-lg bg-cyan-600 px-4 text-sm font-semibold text-white transition hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busy ? "Working..." : "Generate"}
              </button>
            </div>
          </section>

          <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 sm:p-5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Add Manually</p>
            <p className="mt-1 text-xs leading-5 text-slate-400">Adds one blank question of the chosen type for you to write yourself — no AI involved.</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <select
                value={manualType}
                onChange={(e) => setManualType(e.target.value)}
                aria-label="Question type to add"
                className="h-9 rounded-lg border border-slate-700 bg-slate-900/80 px-2.5 text-sm text-slate-200 outline-none focus:border-cyan-300/70"
              >
                {MANUAL_ADD_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {QUESTION_TYPE_LABELS[type]}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={handleAddManual}
                disabled={busy}
                className="h-9 rounded-lg border border-slate-700 bg-slate-900/80 px-4 text-sm text-slate-200 transition hover:border-cyan-300/50 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                + Add Manual Question
              </button>
            </div>
          </section>
        </div>

        {questions.length > 0 ? (
          <p className="text-xs text-slate-400">
            <span className="font-semibold text-white">{questions.length}</span> question{questions.length === 1 ? "" : "s"}
            {targetCount ? ` of ${targetCount} planned` : ""} · {totalPoints} point{totalPoints === 1 ? "" : "s"} in total
          </p>
        ) : null}

        <div className="space-y-3">
          {questions.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-700 p-8 text-center text-sm text-slate-400">
              No questions yet. Generate with AI or add one manually.
            </div>
          ) : (
            questions.map((question, index) => {
              const isObjective = question.questionType === "SINGLE_CHOICE" || question.questionType === "MULTI_SELECT"
              const isCoding = question.questionType === "CODING"
              const codingSpec = question.rubric?.codingSpec ?? null
              return (
                <article key={question.id} className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 sm:p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="flex h-7 min-w-7 items-center justify-center rounded-full bg-cyan-400/15 px-2 text-xs font-semibold text-cyan-200">
                        Q{index + 1}
                      </span>
                      <span className="rounded-full border border-slate-700 px-2 py-0.5 text-[11px] text-slate-300">
                        {QUESTION_TYPE_LABELS[question.questionType] ?? question.questionType}
                      </span>
                      <span className="rounded-full border border-slate-700 px-2 py-0.5 text-[11px] text-slate-500">
                        {formatLabel(question.origin, question.origin)}
                      </span>
                    </div>
                    {editable && !preview ? (
                      <div className="flex items-center gap-0.5">
                        <IconButton label="Move up" onClick={() => handleMove(question, -1)} disabled={index === 0}>
                          <path d="M12 19V5M5 12l7-7 7 7" />
                        </IconButton>
                        <IconButton label="Move down" onClick={() => handleMove(question, 1)} disabled={index === questions.length - 1}>
                          <path d="M12 5v14M19 12l-7 7-7-7" />
                        </IconButton>
                        <IconButton label="Delete question" tone="danger" onClick={() => handleDeleteQuestion(question.id)}>
                          <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
                        </IconButton>
                      </div>
                    ) : null}
                  </div>

                  <div className="mt-3">
                    {preview ? (
                      <p className="text-base leading-7 text-white">{question.questionText}</p>
                    ) : (
                      <textarea
                        aria-label={`Question ${index + 1}`}
                        defaultValue={question.questionText}
                        onBlur={(e) => handleQuestionTextBlur(question, e.target.value)}
                        disabled={!editable}
                        rows={2}
                        className={`${FIELD_CLASS} resize-y leading-6`}
                      />
                    )}
                  </div>

                  {isCoding ? (
                    <div className="mt-3 space-y-3 rounded-lg border border-slate-800 bg-slate-950/40 p-3.5">
                      <div className="flex items-center gap-2 text-sm text-slate-300">
                        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Language</span>
                        {preview ? (
                          <span className="text-white">{codingSpec?.language ?? "-"}</span>
                        ) : (
                          <input
                            aria-label="Language"
                            defaultValue={codingSpec?.language ?? ""}
                            onBlur={(e) => handleCodingSpecUpdate(question, { language: e.target.value.trim() })}
                            disabled={!editable}
                            className={`${FIELD_CLASS} w-32`}
                          />
                        )}
                      </div>

                      <div>
                        <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Starter Code</p>
                        {preview ? (
                          <pre className="whitespace-pre-wrap text-xs text-slate-300">{codingSpec?.starterCode || "(none)"}</pre>
                        ) : (
                          <textarea
                            aria-label="Starter code"
                            defaultValue={codingSpec?.starterCode ?? ""}
                            onBlur={(e) => handleCodingSpecUpdate(question, { starterCode: e.target.value })}
                            disabled={!editable}
                            rows={4}
                            className={`${FIELD_CLASS} font-mono text-xs`}
                          />
                        )}
                      </div>

                      <div>
                        <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                          Test Cases (executed against the candidate&apos;s code — hidden ones are used for grading only)
                        </p>
                        <div className="space-y-2">
                          {(codingSpec?.testCases ?? []).map((testCase, tcIndex) => (
                            <div key={tcIndex} className="grid gap-2 rounded-lg border border-slate-800 p-2 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-center">
                              <input
                                aria-label={`Test case ${tcIndex + 1} input`}
                                defaultValue={testCase.input}
                                placeholder="stdin input"
                                onBlur={(e) => {
                                  const testCases = [...codingSpec.testCases]
                                  testCases[tcIndex] = { ...testCase, input: e.target.value }
                                  handleCodingSpecUpdate(question, { testCases })
                                }}
                                disabled={!editable || preview}
                                className={`${FIELD_CLASS} font-mono text-xs`}
                              />
                              <input
                                aria-label={`Test case ${tcIndex + 1} expected output`}
                                defaultValue={testCase.expectedOutput}
                                placeholder="expected stdout"
                                onBlur={(e) => {
                                  const testCases = [...codingSpec.testCases]
                                  testCases[tcIndex] = { ...testCase, expectedOutput: e.target.value }
                                  handleCodingSpecUpdate(question, { testCases })
                                }}
                                disabled={!editable || preview}
                                className={`${FIELD_CLASS} font-mono text-xs`}
                              />
                              <label className="flex items-center gap-1.5 text-xs text-slate-400">
                                <input
                                  type="checkbox"
                                  checked={Boolean(testCase.hidden)}
                                  onChange={(e) => {
                                    const testCases = [...codingSpec.testCases]
                                    testCases[tcIndex] = { ...testCase, hidden: e.target.checked }
                                    handleCodingSpecUpdate(question, { testCases })
                                  }}
                                  disabled={!editable || preview}
                                  className="h-4 w-4 accent-cyan-400"
                                />
                                Hidden
                              </label>
                              {editable && !preview ? (
                                <button
                                  type="button"
                                  onClick={() => {
                                    const testCases = codingSpec.testCases.filter((_, i) => i !== tcIndex)
                                    handleCodingSpecUpdate(question, { testCases })
                                  }}
                                  className="rounded-lg px-2 py-1 text-xs text-rose-300 transition hover:bg-rose-500/10"
                                >
                                  Remove
                                </button>
                              ) : null}
                            </div>
                          ))}
                        </div>
                        {editable && !preview ? (
                          <button
                            type="button"
                            onClick={() =>
                              handleCodingSpecUpdate(question, {
                                testCases: [...(codingSpec?.testCases ?? []), { input: "", expectedOutput: "", hidden: false }],
                              })
                            }
                            className="mt-2 text-xs font-semibold text-cyan-300 hover:text-cyan-100"
                          >
                            + Add test case
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ) : isObjective ? (
                    <div className="mt-3 space-y-2">
                      <p className="text-[11px] text-slate-500">Tick the correct answer{question.questionType === "MULTI_SELECT" ? "s" : ""}.</p>
                      {question.options.map((option, optionIndex) => (
                        <div
                          key={option.id}
                          className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 ${
                            option.isCorrect ? "border-emerald-500/30 bg-emerald-500/[0.07]" : "border-slate-800 bg-slate-950/30"
                          }`}
                        >
                          <input
                            type="checkbox"
                            aria-label={`Option ${optionIndex + 1} is correct`}
                            checked={option.isCorrect}
                            onChange={(e) => handleOptionUpdate(question, option, { isCorrect: e.target.checked })}
                            disabled={!editable || preview}
                            className="h-4 w-4 flex-none accent-emerald-500"
                          />
                          {preview ? (
                            <span className={option.isCorrect ? "font-medium text-emerald-300" : "text-slate-300"}>
                              {option.optionText} {option.isCorrect ? "(correct)" : ""}
                            </span>
                          ) : (
                            <input
                              aria-label={`Option ${optionIndex + 1}`}
                              defaultValue={option.optionText}
                              onBlur={(e) => handleOptionUpdate(question, option, { optionText: e.target.value })}
                              disabled={!editable}
                              className="min-w-0 flex-1 bg-transparent py-1 text-sm text-white outline-none placeholder:text-slate-500"
                            />
                          )}
                          {editable && !preview ? (
                            <button
                              type="button"
                              onClick={() => handleDeleteOption(question, option)}
                              aria-label={`Remove option ${optionIndex + 1}`}
                              className="rounded-lg px-2 py-1 text-xs text-rose-300 transition hover:bg-rose-500/10"
                            >
                              Remove
                            </button>
                          ) : null}
                        </div>
                      ))}
                      {editable && !preview ? (
                        <button
                          type="button"
                          onClick={() => handleAddOption(question)}
                          className="text-xs font-semibold text-cyan-300 hover:text-cyan-100"
                        >
                          + Add option
                        </button>
                      ) : null}
                    </div>
                  ) : (
                    <div className="mt-3 rounded-lg border border-slate-800 bg-slate-950/40 p-3.5 text-sm text-slate-300">
                      <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Grading Rubric</p>
                      {question.rubric?.criteria?.length ? (
                        <ul className="list-disc space-y-1 pl-5">
                          {question.rubric.criteria.map((c, i) => (
                            <li key={i}>{c}</li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-slate-500">No rubric set.</p>
                      )}
                      {question.rubric?.modelAnswerNotes ? (
                        <p className="mt-2 text-slate-400">Model answer notes: {question.rubric.modelAnswerNotes}</p>
                      ) : null}
                    </div>
                  )}

                  {question.explanation ? (
                    <p className="mt-2 text-xs text-slate-500">Explanation: {question.explanation}</p>
                  ) : null}

                  <div className="mt-3 flex items-center gap-2 text-sm text-slate-400">
                    <span>Points:</span>
                    {preview ? (
                      <span className="text-white">{Number(question.points)}</span>
                    ) : (
                      <input
                        type="number"
                        min={0}
                        aria-label={`Points for question ${index + 1}`}
                        defaultValue={Number(question.points)}
                        onBlur={(e) => handlePointsBlur(question, e.target.value)}
                        disabled={!editable}
                        className="w-20 rounded-lg border border-slate-700 bg-slate-900/80 px-2 py-1 text-sm text-white outline-none focus:border-cyan-300/70"
                      />
                    )}
                  </div>
                </article>
              )
            })
          )}
        </div>
      </main>

      {/* Save and publish stay in reach however long the list gets. */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-800 bg-slate-950/90 backdrop-blur">
        <div className="mx-auto flex max-w-[1100px] flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <p className="hidden text-xs text-slate-400 sm:block" aria-live="polite">
            {editable
              ? savedAt
                ? `Draft autosaved ${savedAt}`
                : "Draft — edits save automatically"
              : "Showing the published version (read-only)."}
          </p>
          <div className="flex gap-2 [&>button]:flex-1 sm:[&>button]:flex-none">
            <button
              type="button"
              onClick={handleSaveDraft}
              disabled={busy || !editable}
              title="Every edit already saves automatically — this just confirms your draft is up to date."
              className="whitespace-nowrap rounded-xl border border-slate-700 bg-slate-900/80 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Save Draft
            </button>
            <button
              type="button"
              onClick={handlePublish}
              disabled={busy || questions.length === 0 || !editable}
              title={!editable ? "This version is already published. Edit a question to start a new draft to publish." : ""}
              className="hv-solid-action whitespace-nowrap rounded-xl bg-cyan-600 px-5 py-2 text-sm font-semibold text-white shadow-[0_10px_20px_rgba(8,145,178,0.22)] transition hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isPublished && !editable ? "Published" : "Publish"}
            </button>
          </div>
        </div>
      </div>

      <ConfirmDialog state={confirmState} onAnswer={answerConfirm} />
    </div>
  )
}
