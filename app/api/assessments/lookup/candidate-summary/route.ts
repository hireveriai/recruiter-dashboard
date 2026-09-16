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
async function loadSummary(candidateId: string, organizationId: string) {
  const result = await prisma.assessmentResult.findFirst({
    where: { candidateId, organizationId },
    orderBy: { completedAt: "desc" },
  })

  if (!result) return null

  const assessment = await prisma.assessment.findUnique({
    where: { id: result.assessmentId },
    select: { title: true },
  })

  return {
    assessmentTitle: assessment?.title ?? "VERIS Assessment",
    percentage: result.percentage,
    passed: result.passed,
    completedAt: result.completedAt,
  }
}

export async function GET(request: Request) {
  try {
    const auth = await getRecruiterRequestContext(request)
    await assertCanAssessment(auth, "assessments.view_results")

    const url = new URL(request.url)
    const candidateId = url.searchParams.get("candidateId")
    const candidateIdsParam = url.searchParams.get("candidateIds")

    if (candidateIdsParam) {
      const candidateIds = candidateIdsParam
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean)
        .slice(0, 200)

      const results = await prisma.assessmentResult.findMany({
        where: { candidateId: { in: candidateIds }, organizationId: auth.organizationId },
        orderBy: { completedAt: "desc" },
      })

      const assessmentIds = Array.from(new Set(results.map((r) => r.assessmentId)))
      const assessments = assessmentIds.length
        ? await prisma.assessment.findMany({ where: { id: { in: assessmentIds } }, select: { id: true, title: true } })
        : []
      const titleById = new Map(assessments.map((a) => [a.id, a.title]))

      const byCandidate: Record<string, unknown> = {}
      for (const result of results) {
        // Every row here came from a `candidateId: { in: candidateIds }`
        // filter, so candidateId is always populated — this guard only
        // narrows the type for TS (candidateId is nullable on the schema
        // now that Employee-participant rows exist).
        if (!result.candidateId) continue
        // Most recent result per candidate wins - results are already ordered desc.
        if (byCandidate[result.candidateId]) continue
        byCandidate[result.candidateId] = {
          assessmentTitle: titleById.get(result.assessmentId) ?? "VERIS Assessment",
          percentage: result.percentage,
          passed: result.passed,
          completedAt: result.completedAt,
        }
      }

      return successResponse({ results: byCandidate })
    }

    if (!candidateId) {
      throw new ApiError(400, "CANDIDATE_ID_REQUIRED", "candidateId or candidateIds query param is required")
    }

    const result = await loadSummary(candidateId, auth.organizationId)
    return successResponse({ result })
  } catch (error) {
    return errorResponse(error)
  }
}
