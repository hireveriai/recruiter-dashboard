import { getRecruiterRequestContext } from "@/lib/server/auth-context"
import { assertCanAssessment } from "@/lib/server/assessment/auth"
import { listInvitesQuerySchema } from "@/lib/server/assessment/validators"
import { ApiError } from "@/lib/server/errors"
import { prisma } from "@/lib/server/prisma"
import { errorResponse, successResponse } from "@/lib/server/response"

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await getRecruiterRequestContext(request)
    await assertCanAssessment(auth, "assessments.view")
    const { id } = await context.params

    const assessment = await prisma.assessment.findFirst({
      where: { id, organizationId: auth.organizationId },
    })
    if (!assessment) {
      throw new ApiError(404, "ASSESSMENT_NOT_FOUND", "Assessment not found")
    }

    const url = new URL(request.url)
    const query = listInvitesQuerySchema.parse({
      page: url.searchParams.get("page") ?? undefined,
      pageSize: url.searchParams.get("pageSize") ?? undefined,
    })

    const where = { assessmentId: id, organizationId: auth.organizationId }

    const [total, invites] = await Promise.all([
      prisma.assessmentInvite.count({ where }),
      prisma.assessmentInvite.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { attempt: true },
      }),
    ])

    const candidateIds = [...new Set(invites.map((i) => i.candidateId).filter((v): v is string => Boolean(v)))]
    const employeeIds = [...new Set(invites.map((i) => i.employeeId).filter((v): v is string => Boolean(v)))]
    const [candidates, employees] = await Promise.all([
      candidateIds.length
        ? prisma.candidate.findMany({
            where: { candidateId: { in: candidateIds } },
            select: { candidateId: true, fullName: true, email: true },
          })
        : Promise.resolve([]),
      employeeIds.length
        ? prisma.employee.findMany({
            where: { id: { in: employeeIds }, organizationId: auth.organizationId },
            select: { id: true, fullName: true, email: true },
          })
        : Promise.resolve([]),
    ])
    const candidateById = new Map(candidates.map((c) => [c.candidateId, c]))
    const employeeById = new Map(employees.map((e) => [e.id, e]))

    return successResponse({
      invites: invites.map((invite) => ({
        ...invite,
        candidate: invite.candidateId ? candidateById.get(invite.candidateId) ?? null : null,
        employee: invite.employeeId ? employeeById.get(invite.employeeId) ?? null : null,
      })),
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      },
    })
  } catch (error) {
    return errorResponse(error)
  }
}
