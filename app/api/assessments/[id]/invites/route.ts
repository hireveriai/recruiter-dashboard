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

    const candidateIds = [...new Set(invites.map((i) => i.candidateId))]
    const candidates = candidateIds.length
      ? await prisma.candidate.findMany({
          where: { candidateId: { in: candidateIds } },
          select: { candidateId: true, fullName: true, email: true },
        })
      : []
    const candidateById = new Map(candidates.map((c) => [c.candidateId, c]))

    return successResponse({
      invites: invites.map((invite) => ({
        ...invite,
        candidate: candidateById.get(invite.candidateId) ?? null,
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
