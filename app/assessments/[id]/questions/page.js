"use client"

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
  "w-full rounded-xl border border-slate-700 bg-slate-900/80 px-3.5 py-2 text-sm text-white outline-none transition focus:border-violet-400/60 focus:shadow-[0_0_0_3px_rgba(139,92,246,0.08)]"

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
      if (!window.confirm(confirmMessage)) return
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
    const confirmed = window.confirm(
      assessment?.status === "PUBLISHED"
        ? "Publishing again will create a new version from your current edits and become the version sent to future candidates. Continue?"
        : "Publish this assessment? Candidates can only be invited to a published assessment."
    )
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

  return (
    <div className="hv-page-enter min-h-screen bg-slate-950 text-white">
      <Navbar />

      <main className="mx-auto max-w-[1100px] px-4 py-7 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <button onClick={() => router.push(buildAuthUrl("/assessments", searchParams))} className="text-sm text-slate-400 hover:text-white">
              &larr; Back to Assessments
            </button>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white">{assessment?.title}</h1>
            <p className="mt-1 text-sm text-slate-400">
              {assessment?.jobTitle} &middot; {questions.length} question(s) &middot;{" "}
              <span className={assessment?.status === "PUBLISHED" ? "text-emerald-300" : "text-amber-300"}>
                {assessment?.status}
              </span>
              {editable ? (
                <span className="ml-2 text-xs text-slate-500">
                  {savedAt ? `Draft autosaved ${savedAt}` : "Draft — edits save automatically"}
                </span>
              ) : null}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <BackToDashboardLink className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-300 transition hover:border-slate-500 hover:text-white" />
            <button
              onClick={() => setPreview((p) => !p)}
              className="rounded-full border border-slate-700 bg-slate-900/80 px-4 py-2 text-sm text-slate-200 transition hover:text-white"
            >
              {preview ? "Exit Preview" : "Preview"}
            </button>
            <button
              onClick={handleSaveDraft}
              disabled={busy || !editable}
              title="Every edit already saves automatically — this just confirms your draft is up to date."
              className="rounded-full border border-slate-700 bg-slate-900/80 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              Save Draft
            </button>
            <button
              onClick={handlePublish}
              disabled={busy || questions.length === 0 || !editable}
              title={!editable ? "This version is already published. Edit a question to start a new draft to publish." : ""}
              className="rounded-full bg-emerald-500/90 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {assessment?.status === "PUBLISHED" && !editable ? "Published" : "Publish"}
            </button>
          </div>
        </div>

        <AssessmentWorkflowPanel
          className="mt-5"
          assessmentId={id}
          isPublished={assessment?.status === "PUBLISHED"}
          hasQuestions={questions.length > 0}
          hasInvites={inviteCount > 0}
          hasResults={false}
        />

        {!editable ? (
          <div className="mt-5 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100">
            This assessment has no draft version - it is showing the finalized version read-only. Add or generate a
            question to start a new draft version.
          </div>
        ) : null}

        {displayVersion?.canGenerate === false ? (
          <div className="mt-5 rounded-2xl border border-slate-800 bg-slate-950/40 p-4 text-xs text-slate-400">
            You&apos;ve used all {displayVersion.generationLimit} AI generation attempts for this draft. You can
            continue editing the questions manually or add your own questions.
          </div>
        ) : null}

        <div className="mt-5 flex flex-wrap items-center gap-3 rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
          <span className="text-sm text-slate-300">Generate more with AI</span>
          <input
            type="number"
            min={1}
            max={50}
            value={genCount}
            onChange={(e) => setGenCount(e.target.value)}
            className="w-20 rounded-lg border border-slate-700 bg-slate-900/80 px-2 py-1.5 text-sm text-white outline-none"
          />
          <select
            value={genType}
            onChange={(e) => setGenType(e.target.value)}
            title="Question type to generate"
            className="rounded-lg border border-slate-700 bg-slate-900/80 px-2 py-1.5 text-sm text-slate-200 outline-none"
          >
            <option value="ALL">All Types</option>
            {MANUAL_ADD_TYPES.map((type) => (
              <option key={type} value={type}>
                {QUESTION_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
          <button
            onClick={handleGenerate}
            disabled={busy || displayVersion?.canGenerate === false}
            title={displayVersion?.canGenerate === false ? "AI generation limit reached for this draft" : undefined}
            className="rounded-full border border-violet-400/40 bg-violet-500/10 px-4 py-1.5 text-sm font-medium text-violet-100 transition hover:bg-violet-500/20 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? "Working..." : "Generate"}
          </button>
          {typeof displayVersion?.remainingGenerations === "number" ? (
            <span className="rounded-full bg-slate-800/70 px-3 py-1 text-xs text-slate-400">
              {displayVersion.canGenerate
                ? `${displayVersion.remainingGenerations} AI generation${displayVersion.remainingGenerations === 1 ? "" : "s"} remaining`
                : "AI generation limit reached"}
            </span>
          ) : null}
          <div className="ml-auto flex items-center gap-2">
            <select
              value={manualType}
              onChange={(e) => setManualType(e.target.value)}
              className="rounded-full border border-slate-700 bg-slate-900/80 px-3 py-1.5 text-sm text-slate-200 outline-none"
            >
              {MANUAL_ADD_TYPES.map((type) => (
                <option key={type} value={type}>
                  {QUESTION_TYPE_LABELS[type]}
                </option>
              ))}
            </select>
            <button
              onClick={handleAddManual}
              disabled={busy}
              className="rounded-full border border-slate-700 bg-slate-900/80 px-4 py-1.5 text-sm text-slate-200 transition hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              + Add Manual Question
            </button>
          </div>
        </div>

        <div className="mt-5 space-y-4">
          {questions.length === 0 ? (
            <div className="rounded-2xl border border-slate-800 bg-slate-950/30 p-8 text-center text-sm text-slate-400">
              No questions yet. Generate with AI or add one manually.
            </div>
          ) : (
            questions.map((question, index) => {
              const isObjective = question.questionType === "SINGLE_CHOICE" || question.questionType === "MULTI_SELECT"
              const isCoding = question.questionType === "CODING"
              const codingSpec = question.rubric?.codingSpec ?? null
              return (
                <div key={question.id} className="rounded-[20px] border border-slate-800 bg-slate-900/40 p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-violet-300">
                      <span>Q{index + 1}</span>
                      <span className="rounded-full border border-slate-700 bg-slate-950/60 px-2 py-0.5 text-slate-300">
                        {QUESTION_TYPE_LABELS[question.questionType] ?? question.questionType}
                      </span>
                      <span className="rounded-full border border-slate-700 bg-slate-950/60 px-2 py-0.5 text-slate-500">
                        {question.origin}
                      </span>
                    </div>
                    {editable && !preview ? (
                      <div className="flex items-center gap-1">
                        <button onClick={() => handleMove(question, -1)} disabled={index === 0} className="rounded-lg border border-slate-700 px-2 py-1 text-xs text-slate-300 disabled:opacity-30">
                          Up
                        </button>
                        <button onClick={() => handleMove(question, 1)} disabled={index === questions.length - 1} className="rounded-lg border border-slate-700 px-2 py-1 text-xs text-slate-300 disabled:opacity-30">
                          Down
                        </button>
                        <button onClick={() => handleDeleteQuestion(question.id)} className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-2 py-1 text-xs text-rose-200">
                          Delete
                        </button>
                      </div>
                    ) : null}
                  </div>

                  <div className="mt-3">
                    {preview ? (
                      <p className="text-base text-white">{question.questionText}</p>
                    ) : (
                      <textarea
                        defaultValue={question.questionText}
                        onBlur={(e) => handleQuestionTextBlur(question, e.target.value)}
                        disabled={!editable}
                        rows={2}
                        className={FIELD_CLASS}
                      />
                    )}
                  </div>

                  {isCoding ? (
                    <div className="mt-3 space-y-3 rounded-xl border border-slate-800 bg-slate-950/40 p-3">
                      <div className="flex items-center gap-2 text-sm text-slate-300">
                        <span className="text-xs uppercase tracking-[0.18em] text-slate-500">Language</span>
                        {preview ? (
                          <span className="text-white">{codingSpec?.language ?? "-"}</span>
                        ) : (
                          <input
                            defaultValue={codingSpec?.language ?? ""}
                            onBlur={(e) => handleCodingSpecUpdate(question, { language: e.target.value.trim() })}
                            disabled={!editable}
                            className={`${FIELD_CLASS} w-32`}
                          />
                        )}
                      </div>

                      <div>
                        <p className="mb-1 text-xs uppercase tracking-[0.18em] text-slate-500">Starter Code</p>
                        {preview ? (
                          <pre className="whitespace-pre-wrap text-xs text-slate-300">{codingSpec?.starterCode || "(none)"}</pre>
                        ) : (
                          <textarea
                            defaultValue={codingSpec?.starterCode ?? ""}
                            onBlur={(e) => handleCodingSpecUpdate(question, { starterCode: e.target.value })}
                            disabled={!editable}
                            rows={4}
                            className={`${FIELD_CLASS} font-mono text-xs`}
                          />
                        )}
                      </div>

                      <div>
                        <p className="mb-1 text-xs uppercase tracking-[0.18em] text-slate-500">
                          Test Cases (executed against the candidate&apos;s code — hidden ones are used for grading only)
                        </p>
                        <div className="space-y-2">
                          {(codingSpec?.testCases ?? []).map((testCase, tcIndex) => (
                            <div key={tcIndex} className="grid gap-2 rounded-lg border border-slate-800 p-2 sm:grid-cols-[1fr_1fr_auto_auto]">
                              <input
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
                              <label className="flex items-center gap-1 text-xs text-slate-400">
                                <input
                                  type="checkbox"
                                  checked={Boolean(testCase.hidden)}
                                  onChange={(e) => {
                                    const testCases = [...codingSpec.testCases]
                                    testCases[tcIndex] = { ...testCase, hidden: e.target.checked }
                                    handleCodingSpecUpdate(question, { testCases })
                                  }}
                                  disabled={!editable || preview}
                                  className="h-4 w-4 rounded border-slate-600 bg-slate-900"
                                />
                                Hidden
                              </label>
                              {editable && !preview ? (
                                <button
                                  onClick={() => {
                                    const testCases = codingSpec.testCases.filter((_, i) => i !== tcIndex)
                                    handleCodingSpecUpdate(question, { testCases })
                                  }}
                                  className="text-xs text-rose-300"
                                >
                                  Remove
                                </button>
                              ) : null}
                            </div>
                          ))}
                        </div>
                        {editable && !preview ? (
                          <button
                            onClick={() =>
                              handleCodingSpecUpdate(question, {
                                testCases: [...(codingSpec?.testCases ?? []), { input: "", expectedOutput: "", hidden: false }],
                              })
                            }
                            className="mt-2 text-xs font-medium text-violet-300"
                          >
                            + Add test case
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ) : isObjective ? (
                    <div className="mt-3 space-y-2">
                      {question.options.map((option) => (
                        <div key={option.id} className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={option.isCorrect}
                            onChange={(e) => handleOptionUpdate(question, option, { isCorrect: e.target.checked })}
                            disabled={!editable || preview}
                            className="h-4 w-4 rounded border-slate-600 bg-slate-900 text-emerald-500"
                          />
                          {preview ? (
                            <span className={option.isCorrect ? "font-medium text-emerald-300" : "text-slate-300"}>
                              {option.optionText} {option.isCorrect ? "(correct)" : ""}
                            </span>
                          ) : (
                            <input
                              defaultValue={option.optionText}
                              onBlur={(e) => handleOptionUpdate(question, option, { optionText: e.target.value })}
                              disabled={!editable}
                              className={`${FIELD_CLASS} flex-1`}
                            />
                          )}
                          {editable && !preview ? (
                            <button onClick={() => handleDeleteOption(question, option)} className="text-xs text-rose-300">
                              Remove
                            </button>
                          ) : null}
                        </div>
                      ))}
                      {editable && !preview ? (
                        <button onClick={() => handleAddOption(question)} className="text-xs font-medium text-violet-300">
                          + Add option
                        </button>
                      ) : null}
                    </div>
                  ) : (
                    <div className="mt-3 rounded-xl border border-slate-800 bg-slate-950/40 p-3 text-sm text-slate-300">
                      <p className="mb-1 text-xs uppercase tracking-[0.18em] text-slate-500">Grading Rubric</p>
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
                        defaultValue={Number(question.points)}
                        onBlur={(e) => handlePointsBlur(question, e.target.value)}
                        disabled={!editable}
                        className="w-20 rounded-lg border border-slate-700 bg-slate-900/80 px-2 py-1 text-sm text-white outline-none"
                      />
                    )}
                  </div>
                </div>
              )
            })
          )}
        </div>
      </main>
    </div>
  )
}
