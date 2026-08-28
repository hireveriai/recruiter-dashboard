import { getRecruiterRequestContext } from "@/lib/server/auth-context"
import { ApiError } from "@/lib/server/errors"
import { errorResponse, successResponse } from "@/lib/server/response"
import { generateStructuredQuestionnaire } from "@/lib/server/interview/questionnaire-generator"
import {
  getJobQuestionnaireContext,
  getQuestionnaireForEditing,
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
    const { jobId } = await context.params
    const body = await request.json().catch(() => ({}))
    const scope = String(body.scope ?? "all")

    const job = await getJobQuestionnaireContext(auth.organizationId, jobId)
    const current = await getQuestionnaireForEditing({
      organizationId: auth.organizationId,
      jobId,
      createdBy: auth.userId,
    })

    const existing = current.questions

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

      return successResponse({
        scope: "all",
        questionCount: saved.questionCount,
        openAiCalls: generated.openAiCalls,
      })
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

    return successResponse({
      scope: "question",
      replacedIndex: targetIndex,
      questionText: replacement.questionText,
      questionCount: saved.questionCount,
      openAiCalls: generated.openAiCalls,
    })
  } catch (error) {
    return errorResponse(error)
  }
}
