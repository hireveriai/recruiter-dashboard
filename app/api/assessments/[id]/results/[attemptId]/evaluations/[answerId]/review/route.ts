import { getRecruiterRequestContext } from "@/lib/server/auth-context"
import { assertCanEmployees, hasOrgWideEmployeeActivityAccess } from "@/lib/server/employees/auth"
import { manageReviewSchema } from "@/lib/server/employees/validators"
import { ApiError } from "@/lib/server/errors"
import { prisma } from "@/lib/server/prisma"
import { errorResponse, successResponse } from "@/lib/server/response"

// POST /api/assessments/[id]/results/[attemptId]/evaluations/[answerId]/review
//
// Manager review of one answer's AI evaluation. Deliberately restricted to
// Employee-participant activities (Assessments/Challenges/Tasks) — this is
// the "Manager / HR Review UI" write path, not a general candidate-results
// editor. The AI evaluation row (score/feedback/provider/model/status) is
// never modified: manager input is stored in the separate managerScore/
// managerFeedback/evaluatorType/evaluatorUserId/managerEvaluatedAt columns
// added specifically so the original AI evaluation is preserved as an
// audit trail alongside the manager's override.
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; attemptId: string; answerId: string }> },
) {
  try {
    const auth = await getRecruiterRequestContext(request)
    await assertCanEmployees(auth, "employeeActivities.review")
    const { id, attemptId, answerId } = await context.params

    const assessment = await prisma.assessment.findFirst({
      where: { id, organizationId: auth.organizationId },
    })
    if (!assessment) {
      throw new ApiError(404, "ASSESSMENT_NOT_FOUND", "Assessment not found")
    }
    if (assessment.participantType !== "EMPLOYEE") {
      throw new ApiError(409, "NOT_AN_EMPLOYEE_ACTIVITY", "Manager review only applies to Employee activities")
    }

    const attempt = await prisma.assessmentAttempt.findFirst({
      where: { id: attemptId, assessmentId: id, organizationId: auth.organizationId },
    })
    if (!attempt) {
      throw new ApiError(404, "ATTEMPT_NOT_FOUND", "Attempt not found")
    }

    if (attempt.employeeId) {
      const canSeeAllEmployees = await hasOrgWideEmployeeActivityAccess(auth)
      if (!canSeeAllEmployees) {
        const employee = await prisma.employee.findFirst({
          where: { id: attempt.employeeId, organizationId: auth.organizationId },
          select: { managerUserId: true },
        })
        if (!employee || employee.managerUserId !== auth.userId) {
          throw new ApiError(403, "NOT_YOUR_DIRECT_REPORT", "You can only review results for your direct reports")
        }
      }
    }

    // answerId must actually belong to this attempt — never trust the URL
    // param alone (prevents reviewing/reading another attempt's answer by
    // guessing/changing the id).
    const answer = await prisma.assessmentAnswer.findFirst({
      where: { id: answerId, attemptId },
      include: { evaluation: true },
    })
    if (!answer) {
      throw new ApiError(404, "ANSWER_NOT_FOUND", "Answer not found for this attempt")
    }
    if (!answer.evaluation) {
      throw new ApiError(409, "EVALUATION_NOT_READY", "This answer has not been evaluated yet")
    }

    const payload = manageReviewSchema.parse(await request.json())

    const evaluation = await prisma.assessmentAnswerEvaluation.update({
      where: { answerId },
      data: {
        evaluatorType: "MANAGER",
        evaluatorUserId: auth.userId,
        managerScore: payload.score,
        managerFeedback: payload.feedback ?? null,
        managerEvaluatedAt: new Date(),
      },
    })

    return successResponse(evaluation)
  } catch (error) {
    return errorResponse(error)
  }
}
