import { getRecruiterRequestContext } from "@/lib/server/auth-context"
import { assertCanEmployees } from "@/lib/server/employees/auth"
import { errorResponse, successResponse } from "@/lib/server/response"
import { getEmployee } from "@/lib/server/services/employee"
import { prisma } from "@/lib/server/prisma"

// GET /api/employees/[id]/activities
// Lists every Assessment/Challenge/Task invite (and, once started, its
// attempt/result) assigned to one employee. Mirrors the read pattern in
// app/api/assessments/[id]/results/route.ts — jobId/employeeId are plain
// scalar FKs, so display data (assessment title/type) is resolved with a
// separate lookup rather than a Prisma relation.
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await getRecruiterRequestContext(request)
    await assertCanEmployees(auth, "employeeActivities.view")
    const { id } = await context.params

    const employee = await getEmployee(auth.organizationId, id)

    const invites = await prisma.assessmentInvite.findMany({
      where: { employeeId: employee.id, organizationId: auth.organizationId },
      orderBy: { createdAt: "desc" },
      include: { attempt: { include: { result: true } } },
    })

    const assessmentIds = [...new Set(invites.map((invite) => invite.assessmentId))]
    const assessments = assessmentIds.length
      ? await prisma.assessment.findMany({
          where: { id: { in: assessmentIds } },
          select: { id: true, title: true, activityType: true, durationMinutes: true },
        })
      : []
    const assessmentById = new Map(assessments.map((a) => [a.id, a]))

    const activities = invites.map((invite) => {
      const assessment = assessmentById.get(invite.assessmentId)
      const attempt = invite.attempt
      const result = attempt?.result ?? null

      return {
        inviteId: invite.id,
        assessmentId: invite.assessmentId,
        title: assessment?.title ?? null,
        activityType: assessment?.activityType ?? "ASSESSMENT",
        durationMinutes: assessment?.durationMinutes ?? null,
        inviteStatus: invite.status,
        expiresAt: invite.expiresAt,
        attemptId: attempt?.id ?? null,
        attemptStatus: attempt?.status ?? "NOT_STARTED",
        percentage: result?.percentage ?? null,
        passed: result?.passed ?? null,
        completedAt: result?.completedAt ?? null,
      }
    })

    return successResponse({ employee, activities })
  } catch (error) {
    return errorResponse(error)
  }
}
