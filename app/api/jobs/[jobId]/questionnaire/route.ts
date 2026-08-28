import { getRecruiterRequestContext } from "@/lib/server/auth-context"
import { ApiError } from "@/lib/server/errors"
import { errorResponse, successResponse } from "@/lib/server/response"
import {
  discardQuestionnaireDraft,
  finalizeQuestionnaireDraft,
  getQuestionnaireForEditing,
  saveQuestionnaireDraft,
  type EditableQuestion,
} from "@/lib/server/services/job-questionnaire"

export const runtime = "nodejs"
export const maxDuration = 120

type Params = { params: Promise<{ jobId: string }> }

/** GET - the questionnaire the recruiter should review, generating a first one if needed. */
export async function GET(request: Request, context: Params) {
  try {
    const auth = await getRecruiterRequestContext(request)
    const { jobId } = await context.params

    const result = await getQuestionnaireForEditing({
      organizationId: auth.organizationId,
      jobId,
      createdBy: auth.userId,
    })

    return successResponse({
      version: {
        questionnaireVersionId: result.version.questionnaire_version_id,
        versionNumber: result.version.version_number,
        status: result.version.status,
        generatedBy: result.version.generated_by,
        interviewMode: result.version.interview_mode,
      },
      questions: result.questions.map((q) => ({
        questionnaireQuestionId: q.questionnaire_question_id,
        questionOrder: q.question_order,
        questionText: q.question_text,
        questionType: q.question_type,
        sourceType: q.source_type,
        competencyLabel: q.competency_label,
        evaluationCriteria: q.evaluation_criteria,
        difficultyLevel: q.difficulty_level,
        phaseHint: q.phase_hint,
        origin: q.origin,
      })),
    })
  } catch (error) {
    return errorResponse(error)
  }
}

/**
 * PUT - save recruiter edits as a draft.
 *
 * The whole ordered list is submitted, so edit, add, delete and reorder are all
 * expressed by the same payload and applied atomically. Order is taken from
 * array position.
 */
export async function PUT(request: Request, context: Params) {
  try {
    const auth = await getRecruiterRequestContext(request)
    const { jobId } = await context.params
    const body = await request.json().catch(() => ({}))

    if (!Array.isArray(body.questions)) {
      throw new ApiError(400, "QUESTIONS_REQUIRED", "questions must be an array")
    }

    const questions: EditableQuestion[] = body.questions.map((raw: Record<string, unknown>) => ({
      questionnaireQuestionId: (raw.questionnaireQuestionId as string) ?? null,
      questionText: String(raw.questionText ?? ""),
      sourceType: String(raw.sourceType ?? "job"),
      competencyLabel: (raw.competencyLabel as string) ?? null,
      evaluationCriteria: (raw.evaluationCriteria as string) ?? null,
      difficultyLevel: Number(raw.difficultyLevel ?? 3),
      phaseHint: String(raw.phaseHint ?? "core"),
      questionType: (raw.questionType as string) ?? null,
      origin: String(raw.origin ?? "AI"),
    }))

    const result = await saveQuestionnaireDraft({
      organizationId: auth.organizationId,
      jobId,
      questions,
      createdBy: auth.userId,
    })

    return successResponse({
      questionnaireVersionId: result.version.questionnaire_version_id,
      versionNumber: result.version.version_number,
      status: "DRAFT",
      questionCount: result.questionCount,
    })
  } catch (error) {
    return errorResponse(error)
  }
}

/** POST - finalize the draft so new interviews start using it. */
export async function POST(request: Request, context: Params) {
  try {
    const auth = await getRecruiterRequestContext(request)
    const { jobId } = await context.params
    const body = await request.json().catch(() => ({}))
    const action = String(body.action ?? "finalize")

    if (action === "discard") {
      const result = await discardQuestionnaireDraft({
        organizationId: auth.organizationId,
        jobId,
      })
      return successResponse(result)
    }

    if (action !== "finalize") {
      throw new ApiError(400, "UNSUPPORTED_ACTION", `Unsupported action: ${action}`)
    }

    const result = await finalizeQuestionnaireDraft({
      organizationId: auth.organizationId,
      jobId,
      finalizedBy: auth.userId,
    })

    return successResponse({ ...result, status: "FINALIZED" })
  } catch (error) {
    return errorResponse(error)
  }
}
