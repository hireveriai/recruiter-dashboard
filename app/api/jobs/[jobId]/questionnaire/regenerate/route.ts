import { getRecruiterRequestContext } from "@/lib/server/auth-context"
import { assertEntitlement } from "@/lib/server/entitlements"
import { ApiError } from "@/lib/server/errors"
import { errorResponse, successResponse } from "@/lib/server/response"
import { generateStructuredQuestionnaire } from "@/lib/server/interview/questionnaire-generator"
import {
  findIdempotentGenerationResult,
  storeIdempotentGenerationResult,
} from "@/lib/server/ai-generation-limit"
import {
  getJobQuestionnaireContext,
  getQuestionnaireForEditing,
  releaseInterviewGenerationAttempt,
  reserveInterviewGenerationAttempt,
  saveQuestionnaireDraft,
  type EditableQuestion,
} from "@/lib/server/services/job-questionnaire"

export const runtime = "nodejs"
export const maxDuration = 120

type Params = { params: Promise<{ jobId: string }> }

/**
 * Regenerates questionnaire content into the DRAFT.
 *
 *   { scope: "all" }                      replace every question
 *   { scope: "question", questionnaireQuestionId } replace one, keeping the rest
 *
 * Single-question regeneration asks for a full set and takes one unused
 * question from it, so the replacement is aware of the questions already in the
 * questionnaire and will not duplicate them. That costs the same one call as
 * regenerating everything, but leaves the recruiter's other edits intact.
 */
export async function POST(request: Request, context: Params) {
  try {
    const auth = await getRecruiterRequestContext(request)
    await assertEntitlement(auth, "AI_INTERVIEW")
    const { jobId } = await context.params
    const body = await request.json().catch(() => ({}))
    const scope = String(body.scope ?? "all")
    const idempotencyKey = typeof body.idempotencyKey === "string" ? body.idempotencyKey.trim() || null : null

    const job = await getJobQuestionnaireContext(auth.organizationId, jobId)
    const current = await getQuestionnaireForEditing({
      organizationId: auth.organizationId,
      jobId,
      createdBy: auth.userId,
    })

    const replay = await findIdempotentGenerationResult(
      "job_questionnaire",
      current.version.questionnaire_id,
      idempotencyKey
    )
    if (replay) {
      return successResponse(replay)
    }

    const reservation = await reserveInterviewGenerationAttempt({
      organizationId: auth.organizationId,
      jobId,
      current: current.version,
      createdBy: auth.userId,
    })

    const existing = current.questions

    try {
      if (scope === "all") {
        const generated = await generateStructuredQuestionnaire({
          jobTitle: job.job_title,
          jobDescription: job.job_description,
          coreSkills: job.core_skills,
          experienceLevel: job.experience_level_label,
          durationMinutes: job.interview_duration_minutes,
          resumeQuestionsEnabled: job.resume_questions_enabled,
          excludeQuestions: existing.map((q) => q.question_text),
        })

        const saved = await saveQuestionnaireDraft({
          organizationId: auth.organizationId,
          jobId,
          createdBy: auth.userId,
          questions: generated.questions.map<EditableQuestion>((q) => ({
            questionText: q.questionText,
            sourceType: q.sourceType,
            competencyLabel: q.competencyLabel,
            evaluationCriteria: q.evaluationCriteria,
            difficultyLevel: q.difficultyLevel,
            phaseHint: q.phaseHint,
            questionType: q.questionType,
            origin: "AI",
          })),
        })

        const result = {
          scope: "all",
          questionCount: saved.questionCount,
          openAiCalls: generated.openAiCalls,
          ...reservation.info,
        }
        await storeIdempotentGenerationResult(
          "job_questionnaire",
          current.version.questionnaire_id,
          idempotencyKey,
          result
        )
        return successResponse(result)
      }

      if (scope !== "question") {
        throw new ApiError(400, "UNSUPPORTED_SCOPE", `Unsupported scope: ${scope}`)
      }

      const targetId = String(body.questionnaireQuestionId ?? "").trim()
      const targetIndex = existing.findIndex((q) => q.questionnaire_question_id === targetId)

      if (targetIndex === -1) {
        throw new ApiError(404, "QUESTION_NOT_FOUND", "Question not found in the current questionnaire")
      }

      const generated = await generateStructuredQuestionnaire({
        jobTitle: job.job_title,
        jobDescription: job.job_description,
        coreSkills: job.core_skills,
        experienceLevel: job.experience_level_label,
        durationMinutes: job.interview_duration_minutes,
        resumeQuestionsEnabled: job.resume_questions_enabled,
        excludeQuestions: existing.map((q) => q.question_text),
      })

      const keep = new Set(
        existing.filter((_, i) => i !== targetIndex).map((q) => q.question_text.toLowerCase())
      )
      const replacement =
        generated.questions.find((q) => !keep.has(q.questionText.toLowerCase())) ?? generated.questions[0]

      if (!replacement) {
        throw new ApiError(502, "REGENERATION_FAILED", "Could not generate a replacement question")
      }

      const questions: EditableQuestion[] = existing.map((q, index) =>
        index === targetIndex
          ? {
              questionText: replacement.questionText,
              sourceType: replacement.sourceType,
              competencyLabel: replacement.competencyLabel,
              evaluationCriteria: replacement.evaluationCriteria,
              difficultyLevel: replacement.difficultyLevel,
              phaseHint: replacement.phaseHint,
              questionType: replacement.questionType,
              origin: "AI",
            }
          : {
              questionnaireQuestionId: q.questionnaire_question_id,
              questionText: q.question_text,
              sourceType: q.source_type,
              competencyLabel: q.competency_label,
              evaluationCriteria: q.evaluation_criteria,
              difficultyLevel: q.difficulty_level,
              phaseHint: q.phase_hint,
              questionType: q.question_type,
              origin: q.origin,
            }
      )

      const saved = await saveQuestionnaireDraft({
        organizationId: auth.organizationId,
        jobId,
        questions,
        createdBy: auth.userId,
      })

      const result = {
        scope: "question",
        replacedIndex: targetIndex,
        questionText: replacement.questionText,
        questionCount: saved.questionCount,
        openAiCalls: generated.openAiCalls,
        ...reservation.info,
      }
      await storeIdempotentGenerationResult(
        "job_questionnaire",
        current.version.questionnaire_id,
        idempotencyKey,
        result
      )
      return successResponse(result)
    } catch (error) {
      // The reserved slot must not be spent for an unsupported scope / bad
      // target (client error, never reached the AI) or a provider failure -
      // only a completed generation should consume an attempt.
      await releaseInterviewGenerationAttempt(reservation.versionId)
      throw error
    }
  } catch (error) {
    return errorResponse(error)
  }
}
