import { getRecruiterRequestContext } from "@/lib/server/auth-context"
import { assertCanAssessment } from "@/lib/server/assessment/auth"
import { ApiError } from "@/lib/server/errors"
import { prisma } from "@/lib/server/prisma"
import { errorResponse, successResponse } from "@/lib/server/response"

/**
 * Read-only lookup for the independent "VERIS Assessment - {percentage}% -
 * Passed/Failed" line recruiters see alongside a candidate's existing
 * Screening/Interview score. Deliberately never merged with that score - see
 * app/candidates/page.js's CompletedCandidateDetails, which renders this
 * result in its own card rather than folding it into `candidate.score`.
 */
export async function GET(request: Request) {
  try {
    const auth = await getRecruiterRequestContext(request)
    await assertCanAssessment(auth, "assessments.view_results")

    const url = new URL(request.url)
    const candidateId = url.searchParams.get("candidateId")

    if (!candidateId) {
      throw new ApiError(400, "CANDIDATE_ID_REQUIRED", "candidateId query param is required")
    }

    const result = await prisma.assessmentResult.findFirst({
      where: { candidateId, organizationId: auth.organizationId },
      orderBy: { completedAt: "desc" },
    })

    if (!result) {
      return successResponse({ result: null })
    }

    const assessment = await prisma.assessment.findUnique({
      where: { id: result.assessmentId },
      select: { title: true },
    })

    return successResponse({
      result: {
        assessmentTitle: assessment?.title ?? "VERIS Assessment",
        percentage: result.percentage,
        passed: result.passed,
        completedAt: result.completedAt,
      },
    })
  } catch (error) {
    return errorResponse(error)
  }
}
