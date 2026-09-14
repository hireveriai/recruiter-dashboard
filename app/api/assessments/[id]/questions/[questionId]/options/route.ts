import { getRecruiterRequestContext } from "@/lib/server/auth-context"
import { assertCanAssessment } from "@/lib/server/assessment/auth"
import { createOptionSchema } from "@/lib/server/assessment/validators"
import { ApiError } from "@/lib/server/errors"
import { prisma } from "@/lib/server/prisma"
import { errorResponse, successResponse } from "@/lib/server/response"

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; questionId: string }> }
) {
  try {
    const auth = await getRecruiterRequestContext(request)
    await assertCanAssessment(auth, "assessments.edit")
    const { id, questionId } = await context.params

    const assessment = await prisma.assessment.findFirst({ where: { id, organizationId: auth.organizationId } })
    if (!assessment) {
      throw new ApiError(404, "ASSESSMENT_NOT_FOUND", "Assessment not found")
    }

    const question = await prisma.assessmentQuestion.findUnique({
      where: { id: questionId },
      include: { version: true },
    })
    if (!question || question.version.assessmentId !== id) {
      throw new ApiError(404, "QUESTION_NOT_FOUND", "Question not found")
    }
    if (question.version.status !== "DRAFT") {
      throw new ApiError(409, "VERSION_NOT_DRAFT", "This question belongs to a finalized version and cannot be edited.")
    }

    const payload = createOptionSchema.parse(await request.json())
    const orderIndex = payload.optionOrder ?? (await prisma.assessmentQuestionOption.count({ where: { questionId } }))

    const option = await prisma.assessmentQuestionOption.create({
      data: {
        questionId,
        optionText: payload.optionText,
        optionOrder: orderIndex,
        isCorrect: payload.isCorrect,
      },
    })

    return successResponse(option, 201)
  } catch (error) {
    return errorResponse(error)
  }
}
