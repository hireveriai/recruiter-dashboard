import { getRecruiterRequestContext } from "@/lib/server/auth-context"
import { assertCanAssessment } from "@/lib/server/assessment/auth"
import { assertCanEmployees, hasOrgWideEmployeeActivityAccess } from "@/lib/server/employees/auth"
import { computeRiskLevel } from "@/lib/server/assessment/versions"
import { ApiError } from "@/lib/server/errors"
import { prisma } from "@/lib/server/prisma"
import { errorResponse, successResponse } from "@/lib/server/response"

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string; attemptId: string }> }
) {
  try {
    const auth = await getRecruiterRequestContext(request)
    const { id, attemptId } = await context.params

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

    const attempt = await prisma.assessmentAttempt.findFirst({
      where: { id: attemptId, assessmentId: id, organizationId: auth.organizationId },
      include: {
        invite: true,
        result: true,
        signals: { orderBy: { createdAt: "asc" } },
        answers: {
          include: {
            evaluation: true,
            question: { include: { options: { orderBy: { optionOrder: "asc" } } } },
          },
        },
      },
    })

    if (!attempt) {
      throw new ApiError(404, "ATTEMPT_NOT_FOUND", "Attempt not found")
    }

    const [candidate, employee, job] = await Promise.all([
      attempt.candidateId
        ? prisma.candidate.findUnique({
            where: { candidateId: attempt.candidateId },
            select: { candidateId: true, fullName: true, email: true },
          })
        : Promise.resolve(null),
      attempt.employeeId
        ? prisma.employee.findUnique({
            where: { id: attempt.employeeId },
            select: { id: true, fullName: true, email: true, managerUserId: true, department: true, title: true },
          })
        : Promise.resolve(null),
      prisma.jobPosition.findUnique({
        where: { jobId: attempt.jobId },
        select: { jobId: true, jobTitle: true },
      }),
    ])

    // Manager (direct-report) scoping — same rule as the results list route.
    if (isEmployeeActivity && employee) {
      const canSeeAllEmployees = await hasOrgWideEmployeeActivityAccess(auth)
      if (!canSeeAllEmployees && employee.managerUserId !== auth.userId) {
        throw new ApiError(403, "NOT_YOUR_DIRECT_REPORT", "You can only view results for your direct reports")
      }
    }

    // All questions of the attempted version, so unanswered ones show up too.
    const allQuestions = await prisma.assessmentQuestion.findMany({
      where: { versionId: attempt.versionId },
      orderBy: { orderIndex: "asc" },
      include: { options: { orderBy: { optionOrder: "asc" } } },
    })

    const answerByQuestionId = new Map(attempt.answers.map((a) => [a.questionId, a]))

    const questionBreakdown = allQuestions.map((question) => {
      const answer = answerByQuestionId.get(question.id)
      const isObjective = question.questionType === "SINGLE_CHOICE" || question.questionType === "MULTI_SELECT"

      return {
        questionId: question.id,
        questionType: question.questionType,
        questionText: question.questionText,
        points: question.points,
        orderIndex: question.orderIndex,
        // Recruiter-facing detail view: correct answers/rubrics are fine to
        // include here, since this endpoint is gated on
        // assessments.view_results/employeeActivities.view_results
        // (recruiter/manager-only), never exposed to a candidate or employee.
        options: isObjective
          ? question.options.map((o) => ({ id: o.id, optionText: o.optionText, isCorrect: o.isCorrect }))
          : [],
        rubric: !isObjective ? question.rubric : null,
        answerId: answer?.id ?? null,
        candidateAnswer: answer?.answer ?? null,
        answeredAt: answer?.answeredAt ?? null,
        evaluation: answer?.evaluation
          ? {
              // AI evaluation — untouched by manager review.
              score: answer.evaluation.score,
              maxScore: answer.evaluation.maxScore,
              feedback: answer.evaluation.feedback,
              status: answer.evaluation.status,
              // Manager review, when one has been submitted (see
              // POST .../results/[attemptId]/evaluations/[answerId]/review).
              // AI's own score/feedback above are never overwritten by this.
              evaluatorType: answer.evaluation.evaluatorType,
              managerScore: answer.evaluation.managerScore,
              managerFeedback: answer.evaluation.managerFeedback,
              managerEvaluatedAt: answer.evaluation.managerEvaluatedAt,
            }
          : null,
      }
    })

    const riskLevel = attempt.result?.riskLevel ?? computeRiskLevel(attempt.signals.length)
    const summary = attempt.result?.summary
    const aiAssistanceRisk =
      summary && typeof summary === "object" && "aiAssistanceRisk" in summary
        ? (summary as Record<string, unknown>).aiAssistanceRisk
        : null

    return successResponse({
      attempt: {
        id: attempt.id,
        status: attempt.status,
        startedAt: attempt.startedAt,
        submittedAt: attempt.submittedAt,
        timedOutAt: attempt.timedOutAt,
        objectiveScore: attempt.objectiveScore,
        subjectiveScore: attempt.subjectiveScore,
        score: attempt.score,
        maxScore: attempt.maxScore,
        percentage: attempt.percentage,
        passed: attempt.passed,
      },
      candidate,
      employee,
      activityType: assessment.activityType,
      jobTitle: job?.jobTitle ?? null,
      assessmentTitle: assessment.title,
      invite: { sentAt: attempt.invite.sentAt, completedAt: attempt.invite.completedAt },
      riskLevel,
      aiAssistanceRisk,
      signals: attempt.signals.map((s) => ({ id: s.id, type: s.type, value: s.value, createdAt: s.createdAt })),
      questions: questionBreakdown,
    })
  } catch (error) {
    return errorResponse(error)
  }
}
