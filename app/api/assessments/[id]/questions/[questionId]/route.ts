import { getRecruiterRequestContext } from "@/lib/server/auth-context"
import { assertCanAssessment } from "@/lib/server/assessment/auth"
import { updateQuestionSchema } from "@/lib/server/assessment/validators"
import { ApiError } from "@/lib/server/errors"
import { prisma } from "@/lib/server/prisma"
import { errorResponse, successResponse } from "@/lib/server/response"

async function loadEditableQuestion(assessmentId: string, questionId: string, organizationId: string) {
  const assessment = await prisma.assessment.findFirst({
    where: { id: assessmentId, organizationId },
  })
  if (!assessment) {
    throw new ApiError(404, "ASSESSMENT_NOT_FOUND", "Assessment not found")
  }

  const question = await prisma.assessmentQuestion.findUnique({
    where: { id: questionId },
    include: { version: true },
  })

  if (!question || question.version.assessmentId !== assessmentId) {
    throw new ApiError(404, "QUESTION_NOT_FOUND", "Question not found")
  }

  // Immutable-once-published rule: a FINALIZED version may have already been
  // sent to a candidate, so it can never be edited directly. Callers must add
  // edits through a DRAFT version - POST /questions or /generate-questions
  // create one via copy-on-write when needed.
  if (question.version.status !== "DRAFT") {
    throw new ApiError(
      409,
      "VERSION_NOT_DRAFT",
      "This question belongs to a finalized version and cannot be edited. Use the draft version created for further edits."
    )
  }

  return question
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; questionId: string }> }
) {
  try {
    const auth = await getRecruiterRequestContext(request)
    await assertCanAssessment(auth, "assessments.edit")
    const { id, questionId } = await context.params

    await loadEditableQuestion(id, questionId, auth.organizationId)
    const payload = updateQuestionSchema.parse(await request.json())

    const updated = await prisma.assessmentQuestion.update({
      where: { id: questionId },
      data: {
        ...(payload.questionText !== undefined ? { questionText: payload.questionText } : {}),
        ...(payload.points !== undefined ? { points: payload.points } : {}),
        ...(payload.orderIndex !== undefined ? { orderIndex: payload.orderIndex } : {}),
        ...(payload.required !== undefined ? { required: payload.required } : {}),
        ...(payload.rubric !== undefined
          ? {
              rubric: payload.rubric
                ? { criteria: payload.rubric.criteria, modelAnswerNotes: payload.rubric.modelAnswerNotes ?? null }
                : undefined,
            }
          : {}),
        ...(payload.explanation !== undefined ? { explanation: payload.explanation } : {}),
        updatedAt: new Date(),
      },
      include: { options: { orderBy: { optionOrder: "asc" } } },
    })

    return successResponse(updated)
  } catch (error) {
    return errorResponse(error)
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string; questionId: string }> }
) {
  try {
    const auth = await getRecruiterRequestContext(request)
    await assertCanAssessment(auth, "assessments.edit")
    const { id, questionId } = await context.params

    await loadEditableQuestion(id, questionId, auth.organizationId)

    await prisma.$transaction([
      prisma.assessmentQuestionOption.deleteMany({ where: { questionId } }),
      prisma.assessmentQuestion.delete({ where: { id: questionId } }),
    ])

    return successResponse({ deleted: true })
  } catch (error) {
    return errorResponse(error)
  }
}
