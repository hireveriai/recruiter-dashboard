import { getRecruiterRequestContext } from "@/lib/server/auth-context"
import { assertCanAssessment } from "@/lib/server/assessment/auth"
import { createQuestionSchema } from "@/lib/server/assessment/validators"
import { getOrCreateDraftVersion } from "@/lib/server/assessment/versions"
import { ApiError } from "@/lib/server/errors"
import { prisma } from "@/lib/server/prisma"
import { errorResponse, successResponse } from "@/lib/server/response"

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await getRecruiterRequestContext(request)
    await assertCanAssessment(auth, "assessments.edit")
    const { id } = await context.params

    const assessment = await prisma.assessment.findFirst({
      where: { id, organizationId: auth.organizationId },
    })

    if (!assessment) {
      throw new ApiError(404, "ASSESSMENT_NOT_FOUND", "Assessment not found")
    }

    const payload = createQuestionSchema.parse(await request.json())

    const isObjective = payload.questionType === "SINGLE_CHOICE" || payload.questionType === "MULTI_SELECT"
    if (isObjective && (!payload.options || payload.options.length < 2)) {
      throw new ApiError(400, "OPTIONS_REQUIRED", "SINGLE_CHOICE/MULTI_SELECT questions need at least 2 options")
    }
    if (payload.questionType === "CODING" && !payload.codingSpec) {
      throw new ApiError(400, "CODING_SPEC_REQUIRED", "CODING questions need a language and at least one test case")
    }

    const question = await prisma.$transaction(async (tx) => {
      const draft = await getOrCreateDraftVersion(id, tx)
      const orderIndex =
        payload.orderIndex ?? (await tx.assessmentQuestion.count({ where: { versionId: draft.id } }))

      const created = await tx.assessmentQuestion.create({
        data: {
          versionId: draft.id,
          questionType: payload.questionType,
          questionText: payload.questionText,
          points: payload.points,
          orderIndex,
          required: payload.required,
          rubric: payload.codingSpec
            ? { codingSpec: payload.codingSpec }
            : payload.rubric
              ? { criteria: payload.rubric.criteria, modelAnswerNotes: payload.rubric.modelAnswerNotes ?? null }
              : undefined,
          explanation: payload.explanation ?? null,
          origin: "MANUAL",
        },
      })

      if (payload.options?.length) {
        await tx.assessmentQuestionOption.createMany({
          data: payload.options.map((option, idx) => ({
            questionId: created.id,
            optionText: option.optionText,
            optionOrder: option.optionOrder ?? idx,
            isCorrect: option.isCorrect,
          })),
        })
      }

      return tx.assessmentQuestion.findUnique({
        where: { id: created.id },
        include: { options: { orderBy: { optionOrder: "asc" } } },
      })
    })

    return successResponse(question, 201)
  } catch (error) {
    return errorResponse(error)
  }
}
