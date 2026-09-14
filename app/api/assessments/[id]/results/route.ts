import { getRecruiterRequestContext } from "@/lib/server/auth-context"
import { assertCanAssessment } from "@/lib/server/assessment/auth"
import { computeRiskLevel } from "@/lib/server/assessment/versions"
import { ApiError } from "@/lib/server/errors"
import { prisma } from "@/lib/server/prisma"
import { errorResponse, successResponse } from "@/lib/server/response"

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await getRecruiterRequestContext(request)
    await assertCanAssessment(auth, "assessments.view_results")
    const { id } = await context.params

    const assessment = await prisma.assessment.findFirst({
      where: { id, organizationId: auth.organizationId },
    })
    if (!assessment) {
      throw new ApiError(404, "ASSESSMENT_NOT_FOUND", "Assessment not found")
    }

    const results = await prisma.assessmentResult.findMany({
      where: { assessmentId: id, organizationId: auth.organizationId },
      orderBy: { createdAt: "desc" },
      include: { attempt: { include: { invite: true } } },
    })

    // Resolve display data via separate lookups rather than relations, per
    // the schema's plain-scalar-FK design (jobId/candidateId are not Prisma
    // relations to JobPosition/Candidate).
    const candidateIds = [...new Set(results.map((r) => r.candidateId))]
    const jobIds = [...new Set(results.map((r) => r.jobId))]
    const attemptIds = results.map((r) => r.attemptId)

    const [candidates, jobs, signalCounts] = await Promise.all([
      candidateIds.length
        ? prisma.candidate.findMany({
            where: { candidateId: { in: candidateIds } },
            select: { candidateId: true, fullName: true, email: true },
          })
        : Promise.resolve([]),
      jobIds.length
        ? prisma.jobPosition.findMany({
            where: { jobId: { in: jobIds } },
            select: { jobId: true, jobTitle: true },
          })
        : Promise.resolve([]),
      attemptIds.length
        ? prisma.assessmentSignal.groupBy({
            by: ["attemptId"],
            where: { attemptId: { in: attemptIds } },
            _count: { _all: true },
          })
        : Promise.resolve([]),
    ])

    const candidateById = new Map(candidates.map((c) => [c.candidateId, c]))
    const jobById = new Map(jobs.map((j) => [j.jobId, j.jobTitle]))
    const signalCountByAttempt = new Map(signalCounts.map((s) => [s.attemptId, s._count._all]))

    const rows = results.map((result) => {
      const signalCount = signalCountByAttempt.get(result.attemptId) ?? 0
      return {
        id: result.id,
        attemptId: result.attemptId,
        assessmentId: result.assessmentId,
        candidate: candidateById.get(result.candidateId) ?? null,
        jobTitle: jobById.get(result.jobId) ?? null,
        status: result.attempt.status,
        percentage: result.percentage,
        passed: result.passed,
        riskLevel: result.riskLevel ?? computeRiskLevel(signalCount),
        sentAt: result.attempt.invite.sentAt,
        completedAt: result.completedAt,
      }
    })

    return successResponse({ results: rows })
  } catch (error) {
    return errorResponse(error)
  }
}
