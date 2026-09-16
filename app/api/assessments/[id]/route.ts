import { getRecruiterRequestContext } from "@/lib/server/auth-context"
import { assertCanAssessment } from "@/lib/server/assessment/auth"
import { assertCanEmployees } from "@/lib/server/employees/auth"
import { updateAssessmentSchema } from "@/lib/server/assessment/validators"
import { ApiError } from "@/lib/server/errors"
import { prisma } from "@/lib/server/prisma"
import { errorResponse, successResponse } from "@/lib/server/response"

async function loadAssessmentOrThrow(id: string, organizationId: string) {
  const assessment = await prisma.assessment.findFirst({
    where: { id, organizationId },
  })

  if (!assessment) {
    throw new ApiError(404, "ASSESSMENT_NOT_FOUND", "Assessment not found")
  }

  return assessment
}

// Employee-participant assessments are gated by employeeActivities.*
// instead of assessments.* — this loads the (still org-scoped) row first so
// the correct permission domain can be checked based on its participantType.
async function assertCanAccess(
  auth: Awaited<ReturnType<typeof getRecruiterRequestContext>>,
  assessment: { participantType: string },
  kind: "view" | "edit" | "manage",
) {
  if (assessment.participantType === "EMPLOYEE") {
    const permission =
      kind === "view" ? "employeeActivities.view" : kind === "edit" ? "employeeActivities.edit" : "employeeActivities.manage"
    await assertCanEmployees(auth, permission)
  } else {
    const permission = kind === "view" ? "assessments.view" : kind === "edit" ? "assessments.edit" : "assessments.manage"
    await assertCanAssessment(auth, permission)
  }
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await getRecruiterRequestContext(request)
    const { id } = await context.params

    const assessment = await loadAssessmentOrThrow(id, auth.organizationId)
    await assertCanAccess(auth, assessment, "view")

    const versions = await prisma.assessmentVersion.findMany({
      where: { assessmentId: id },
      orderBy: { versionNumber: "desc" },
      include: {
        questions: {
          orderBy: { orderIndex: "asc" },
          include: { options: { orderBy: { optionOrder: "asc" } } },
        },
      },
    })

    const job = await prisma.jobPosition.findUnique({
      where: { jobId: assessment.jobId },
      select: { jobId: true, jobTitle: true },
    })

    return successResponse({
      ...assessment,
      jobTitle: job?.jobTitle ?? null,
      versions,
    })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await getRecruiterRequestContext(request)
    const { id } = await context.params

    const assessment = await loadAssessmentOrThrow(id, auth.organizationId)
    await assertCanAccess(auth, assessment, "edit")
    const payload = updateAssessmentSchema.parse(await request.json())

    // Guardrail: once PUBLISHED, fields that change scoring semantics for an
    // already-issued version (duration, passing %, question count/types,
    // randomization, link expiry) may still be edited - they only affect
    // *future* invites, since a candidate's attempt snapshots the version it
    // was invited against. What is NOT allowed post-publish is reverting
    // status back to DRAFT from here (publish/unpublish has its own explicit
    // endpoint semantics) - status may only move to ARCHIVED via this route.
    if (assessment.status === "PUBLISHED" && payload.status === "DRAFT") {
      throw new ApiError(
        409,
        "CANNOT_UNPUBLISH",
        "A published assessment cannot be moved back to draft directly."
      )
    }

    const updated = await prisma.assessment.update({
      where: { id },
      data: {
        ...(payload.title !== undefined ? { title: payload.title } : {}),
        ...(payload.description !== undefined ? { description: payload.description } : {}),
        ...(payload.durationMinutes !== undefined ? { durationMinutes: payload.durationMinutes } : {}),
        ...(payload.passingPercentage !== undefined ? { passingPercentage: payload.passingPercentage } : {}),
        ...(payload.questionCount !== undefined ? { questionCount: payload.questionCount } : {}),
        ...(payload.difficulty !== undefined ? { difficulty: payload.difficulty } : {}),
        ...(payload.questionTypes !== undefined ? { questionTypes: payload.questionTypes } : {}),
        ...(payload.randomizeQuestions !== undefined ? { randomizeQuestions: payload.randomizeQuestions } : {}),
        ...(payload.randomizeOptions !== undefined ? { randomizeOptions: payload.randomizeOptions } : {}),
        ...(payload.linkExpiryDays !== undefined ? { linkExpiryDays: payload.linkExpiryDays } : {}),
        ...(payload.status !== undefined ? { status: payload.status } : {}),
        ...(payload.security !== undefined
          ? {
              settings: {
                ...(assessment.settings && typeof assessment.settings === "object" ? assessment.settings : {}),
                security: payload.security,
              },
            }
          : {}),
        updatedAt: new Date(),
      },
    })

    return successResponse(updated)
  } catch (error) {
    return errorResponse(error)
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await getRecruiterRequestContext(request)
    const { id } = await context.params

    const assessment = await loadAssessmentOrThrow(id, auth.organizationId)
    await assertCanAccess(auth, assessment, "manage")

    const inviteCount = await prisma.assessmentInvite.count({ where: { assessmentId: id } })
    if (inviteCount > 0) {
      throw new ApiError(
        409,
        "ASSESSMENT_HAS_INVITES",
        "This assessment has been sent to at least one candidate and cannot be deleted."
      )
    }

    // No invites exist, so no attempts/results can exist either - safe to
    // cascade-delete the version/question/option tree in a transaction.
    await prisma.$transaction(async (tx) => {
      const versions = await tx.assessmentVersion.findMany({
        where: { assessmentId: id },
        select: { id: true },
      })
      const versionIds = versions.map((v) => v.id)

      if (versionIds.length > 0) {
        const questions = await tx.assessmentQuestion.findMany({
          where: { versionId: { in: versionIds } },
          select: { id: true },
        })
        const questionIds = questions.map((q) => q.id)

        if (questionIds.length > 0) {
          await tx.assessmentQuestionOption.deleteMany({ where: { questionId: { in: questionIds } } })
          await tx.assessmentQuestion.deleteMany({ where: { id: { in: questionIds } } })
        }

        await tx.assessmentVersion.deleteMany({ where: { id: { in: versionIds } } })
      }

      await tx.assessment.delete({ where: { id } })
    })

    return successResponse({ deleted: true })
  } catch (error) {
    return errorResponse(error)
  }
}
