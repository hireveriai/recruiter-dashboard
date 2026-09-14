import { getRecruiterRequestContext } from "@/lib/server/auth-context"
import { assertCanAssessment } from "@/lib/server/assessment/auth"
import { ApiError } from "@/lib/server/errors"
import { prisma } from "@/lib/server/prisma"
import { errorResponse, successResponse } from "@/lib/server/response"

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await getRecruiterRequestContext(request)
    await assertCanAssessment(auth, "assessments.publish")
    const { id } = await context.params

    const assessment = await prisma.assessment.findFirst({
      where: { id, organizationId: auth.organizationId },
    })

    if (!assessment) {
      throw new ApiError(404, "ASSESSMENT_NOT_FOUND", "Assessment not found")
    }

    const draft = await prisma.assessmentVersion.findFirst({
      where: { assessmentId: id, status: "DRAFT" },
      orderBy: { versionNumber: "desc" },
    })

    if (!draft) {
      throw new ApiError(
        409,
        "NO_DRAFT_VERSION",
        "There is no draft version to publish. Generate or add questions first."
      )
    }

    const questionCount = await prisma.assessmentQuestion.count({ where: { versionId: draft.id } })
    if (questionCount < 1) {
      throw new ApiError(422, "NO_QUESTIONS", "Add at least one question before publishing.")
    }

    const [, updatedAssessment] = await prisma.$transaction([
      prisma.assessmentVersion.update({
        where: { id: draft.id },
        data: { status: "FINALIZED" },
      }),
      prisma.assessment.update({
        where: { id },
        data: { status: "PUBLISHED", activeVersionId: draft.id, updatedAt: new Date() },
      }),
    ])

    return successResponse(updatedAssessment)
  } catch (error) {
    return errorResponse(error)
  }
}
