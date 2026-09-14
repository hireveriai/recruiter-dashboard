import { getRecruiterRequestContext } from "@/lib/server/auth-context"
import { assertCanAssessment } from "@/lib/server/assessment/auth"
import { updateOptionSchema } from "@/lib/server/assessment/validators"
import { ApiError } from "@/lib/server/errors"
import { prisma } from "@/lib/server/prisma"
import { errorResponse, successResponse } from "@/lib/server/response"

async function loadEditableOption(
  assessmentId: string,
  questionId: string,
  optionId: string,
  organizationId: string
) {
  const assessment = await prisma.assessment.findFirst({ where: { id: assessmentId, organizationId } })
  if (!assessment) {
    throw new ApiError(404, "ASSESSMENT_NOT_FOUND", "Assessment not found")
  }

  const option = await prisma.assessmentQuestionOption.findUnique({
    where: { id: optionId },
    include: { question: { include: { version: true } } },
  })

  if (!option || option.questionId !== questionId || option.question.version.assessmentId !== assessmentId) {
    throw new ApiError(404, "OPTION_NOT_FOUND", "Option not found")
  }

  if (option.question.version.status !== "DRAFT") {
    throw new ApiError(409, "VERSION_NOT_DRAFT", "This option belongs to a finalized version and cannot be edited.")
  }

  return option
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; questionId: string; optionId: string }> }
) {
  try {
    const auth = await getRecruiterRequestContext(request)
    await assertCanAssessment(auth, "assessments.edit")
    const { id, questionId, optionId } = await context.params

    await loadEditableOption(id, questionId, optionId, auth.organizationId)
    const payload = updateOptionSchema.parse(await request.json())

    const updated = await prisma.assessmentQuestionOption.update({
      where: { id: optionId },
      data: {
        ...(payload.optionText !== undefined ? { optionText: payload.optionText } : {}),
        ...(payload.isCorrect !== undefined ? { isCorrect: payload.isCorrect } : {}),
        ...(payload.optionOrder !== undefined ? { optionOrder: payload.optionOrder } : {}),
      },
    })

    return successResponse(updated)
  } catch (error) {
    return errorResponse(error)
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string; questionId: string; optionId: string }> }
) {
  try {
    const auth = await getRecruiterRequestContext(request)
    await assertCanAssessment(auth, "assessments.edit")
    const { id, questionId, optionId } = await context.params

    await loadEditableOption(id, questionId, optionId, auth.organizationId)
    await prisma.assessmentQuestionOption.delete({ where: { id: optionId } })

    return successResponse({ deleted: true })
  } catch (error) {
    return errorResponse(error)
  }
}
