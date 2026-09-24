/**
 * Applying an Interview Focus change to a job's questionnaire.
 *
 * A focus change never alters a FINALIZED questionnaire. Applying a focus
 * draft generates a new DRAFT questionnaire version from that exact plan
 * version, then makes the plan ACTIVE. New interviews keep using the finalized
 * questionnaire until the recruiter reviews and finalizes the new draft;
 * interviews already created keep their own snapshots regardless.
 *
 * Costs one AI generation attempt against the questionnaire draft, like any
 * regeneration (see ai-generation-limit.ts), and supports the same
 * idempotency key so a retried request never generates twice.
 */

import { ApiError } from "@/lib/server/errors"
import {
  findIdempotentGenerationResult,
  storeIdempotentGenerationResult,
  type GenerationLimitInfo,
} from "@/lib/server/ai-generation-limit"
import { generateStructuredQuestionnaire, type GeneratedQuestion } from "@/lib/server/interview/questionnaire-generator"
import {
  activateFocusDraft,
  getFocusPlans,
  type FocusPlan,
  type GenerationFocus,
} from "@/lib/server/services/interview-focus"
import { getJobQuestionnaireContext } from "@/lib/server/services/job-context"
import {
  focusGenerationInput,
  getQuestionnaireForEditing,
  releaseInterviewGenerationAttempt,
  reserveInterviewGenerationAttempt,
  saveQuestionnaireDraft,
  type EditableQuestion,
} from "@/lib/server/services/job-questionnaire"

export function toEditableQuestion(question: GeneratedQuestion): EditableQuestion {
  return {
    questionText: question.questionText,
    sourceType: question.sourceType,
    competencyLabel: question.competencyLabel,
    evaluationCriteria: question.evaluationCriteria,
    difficultyLevel: question.difficultyLevel,
    phaseHint: question.phaseHint,
    questionType: question.questionType,
    origin: "AI",
    focusAreaKey: question.focusAreaKey ?? null,
  }
}

function planAsGenerationFocus(plan: FocusPlan): GenerationFocus {
  return {
    planId: plan.planId,
    versionNumber: plan.versionNumber,
    status: plan.status,
    resumeEmphasis: plan.resumeEmphasis,
    areas: plan.areas,
  }
}

export type AppliedFocusResult = GenerationLimitInfo & {
  questionnaireVersionNumber: number
  questionCount: number
  focusPlanVersion: number
  openAiCalls: number
}

export async function applyFocusAndRegenerate(params: {
  organizationId: string
  jobId: string
  createdBy?: string | null
  idempotencyKey?: string | null
}): Promise<AppliedFocusResult> {
  const job = await getJobQuestionnaireContext(params.organizationId, params.jobId)
  const { draft } = await getFocusPlans({ organizationId: params.organizationId, jobId: params.jobId })
  if (!draft) {
    throw new ApiError(404, "NO_FOCUS_DRAFT", "Save the focus as a draft before applying it")
  }

  const current = await getQuestionnaireForEditing({
    organizationId: params.organizationId,
    jobId: params.jobId,
    createdBy: params.createdBy,
  })

  const replay = await findIdempotentGenerationResult<AppliedFocusResult>(
    "job_questionnaire",
    current.version.questionnaire_id,
    params.idempotencyKey ?? null
  )
  if (replay) return replay

  // Reserve BEFORE the AI call (race-safe limit), release if generation fails.
  const reservation = await reserveInterviewGenerationAttempt({
    organizationId: params.organizationId,
    jobId: params.jobId,
    current: current.version,
    createdBy: params.createdBy,
  })

  try {
    const focus = planAsGenerationFocus(draft)
    const generated = await generateStructuredQuestionnaire({
      jobTitle: job.job_title,
      jobDescription: job.job_description,
      coreSkills: job.core_skills,
      experienceLevel: job.experience_level_label,
      durationMinutes: job.interview_duration_minutes,
      resumeQuestionsEnabled: job.resume_questions_enabled,
      excludeQuestions: current.questions.map((q) => q.question_text),
      ...focusGenerationInput(focus),
    })

    const saved = await saveQuestionnaireDraft({
      organizationId: params.organizationId,
      jobId: params.jobId,
      createdBy: params.createdBy,
      questions: generated.questions.map(toEditableQuestion),
      focusPlanId: draft.planId,
    })

    // Only after the questionnaire draft exists does the plan become ACTIVE.
    const activated = await activateFocusDraft({ organizationId: params.organizationId, jobId: params.jobId })

    const result: AppliedFocusResult = {
      questionnaireVersionNumber: saved.version.version_number,
      questionCount: saved.questionCount,
      focusPlanVersion: activated.versionNumber,
      openAiCalls: generated.openAiCalls,
      ...reservation.info,
    }
    await storeIdempotentGenerationResult(
      "job_questionnaire",
      current.version.questionnaire_id,
      params.idempotencyKey ?? null,
      result
    )
    return result
  } catch (error) {
    await releaseInterviewGenerationAttempt(reservation.versionId)
    throw error
  }
}
