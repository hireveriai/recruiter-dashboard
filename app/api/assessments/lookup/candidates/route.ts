import { getRecruiterRequestContext } from "@/lib/server/auth-context"
import { assertCanAssessment } from "@/lib/server/assessment/auth"
import { prisma } from "@/lib/server/prisma"
import { errorResponse, successResponse } from "@/lib/server/response"

/**
 * Read-only candidate lookup for the "Send Assessment" picker. The Candidate
 * table has no direct jobId column (association only exists via Interview),
 * so this simply lists the organization's candidates for the recruiter to
 * search/select from - it does not touch the Screening/Interview pipeline.
 */
export async function GET(request: Request) {
  try {
    const auth = await getRecruiterRequestContext(request)
    await assertCanAssessment(auth, "assessments.send")

    const url = new URL(request.url)
    const search = (url.searchParams.get("search") ?? "").trim()

    const candidates = await prisma.candidate.findMany({
      where: {
        organizationId: auth.organizationId,
        ...(search
          ? {
              OR: [
                { fullName: { contains: search, mode: "insensitive" } },
                { email: { contains: search, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      select: { candidateId: true, fullName: true, email: true },
      orderBy: { createdAt: "desc" },
      take: 50,
    })

    return successResponse({ candidates })
  } catch (error) {
    return errorResponse(error)
  }
}
