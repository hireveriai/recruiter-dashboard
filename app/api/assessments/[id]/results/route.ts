import { getRecruiterRequestContext } from "@/lib/server/auth-context"
import { assertCanAssessment } from "@/lib/server/assessment/auth"
import { assertCanEmployees, hasOrgWideEmployeeActivityAccess } from "@/lib/server/employees/auth"
import { computeRiskLevel } from "@/lib/server/assessment/versions"
import { ApiError } from "@/lib/server/errors"
import { prisma } from "@/lib/server/prisma"
import { errorResponse, successResponse } from "@/lib/server/response"

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await getRecruiterRequestContext(request)
    const { id } = await context.params

    const assessment = await prisma.assessment.findFirst({
      where: { id, organizationId: auth.organizationId },
    })
    if (!assessment) {
      throw new ApiError(404, "ASSESSMENT_NOT_FOUND", "Assessment not found")
    }

    const isEmployeeActivity = assessment.participantType === "EMPLOYEE"
    if (isEmployeeActivity) {
      await assertCanEmployees(auth, "employeeActivities.view_results")
    } else {
      await assertCanAssessment(auth, "assessments.view_results")
    }

    // Manager (direct-report) scoping: a caller who only holds
    // employeeActivities.view_results (not the org-wide .manage permission)
    // sees results only for employees who report to them. This is the
    // "managers can see assigned/direct-report results" requirement — it is
    // deliberately narrower than the org-wide assessments.view_results
    // behavior above, which is unaffected by this change.
    const canSeeAllEmployees = isEmployeeActivity ? await hasOrgWideEmployeeActivityAccess(auth) : true

    const results = await prisma.assessmentResult.findMany({
      where: { assessmentId: id, organizationId: auth.organizationId },
      orderBy: { createdAt: "desc" },
      include: { attempt: { include: { invite: true } } },
    })

    // Resolve display data via separate lookups rather than relations, per
    // the schema's plain-scalar-FK design (jobId/candidateId/employeeId are
    // not Prisma relations to JobPosition/Candidate/Employee).
    const candidateIds = [...new Set(results.map((r) => r.candidateId).filter((v): v is string => Boolean(v)))]
    const employeeIds = [...new Set(results.map((r) => r.employeeId).filter((v): v is string => Boolean(v)))]
    const jobIds = [...new Set(results.map((r) => r.jobId))]
    const attemptIds = results.map((r) => r.attemptId)

    const [candidates, employees, jobs, signalCounts] = await Promise.all([
      candidateIds.length
        ? prisma.candidate.findMany({
            where: { candidateId: { in: candidateIds } },
            select: { candidateId: true, fullName: true, email: true },
          })
        : Promise.resolve([]),
      employeeIds.length
        ? prisma.employee.findMany({
            where: { id: { in: employeeIds }, organizationId: auth.organizationId },
            select: { id: true, fullName: true, email: true, managerUserId: true, department: true, title: true },
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
    const employeeById = new Map(employees.map((e) => [e.id, e]))
    const jobById = new Map(jobs.map((j) => [j.jobId, j.jobTitle]))
    const signalCountByAttempt = new Map(signalCounts.map((s) => [s.attemptId, s._count._all]))

    const rows = results
      .filter((result) => {
        if (!isEmployeeActivity || canSeeAllEmployees) return true
        const employee = result.employeeId ? employeeById.get(result.employeeId) : null
        return Boolean(employee && employee.managerUserId === auth.userId)
      })
      .map((result) => {
        const signalCount = signalCountByAttempt.get(result.attemptId) ?? 0
        return {
          id: result.id,
          attemptId: result.attemptId,
          assessmentId: result.assessmentId,
          candidate: result.candidateId ? candidateById.get(result.candidateId) ?? null : null,
          employee: result.employeeId ? employeeById.get(result.employeeId) ?? null : null,
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
