import { getRecruiterRequestContext } from "@/lib/server/auth-context"
import { assertCanAssessment } from "@/lib/server/assessment/auth"
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
    await assertCanAssessment(auth, "assessments.view_results")
    const { id, attemptId } = await context.params

    const assessment = await prisma.assessment.findFirst({
      where: { id, organizationId: auth.organizationId },
    })
    if (!assessment) {
      throw new ApiError(404, "ASSESSMENT_NOT_FOUND", "Assessment not found")
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

    const [candidate, job] = await Promise.all([
      prisma.candidate.findUnique({
        where: { candidateId: attempt.candidateId },
        select: { candidateId: true, fullName: true, email: true },
      }),
      prisma.jobPosition.findUnique({
        where: { jobId: attempt.jobId },
        select: { jobId: true, jobTitle: true },
      }),
    ])

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
        // assessments.view_results (recruiter-only), never exposed to a
        // candidate.
        options: isObjective
          ? question.options.map((o) => ({ id: o.id, optionText: o.optionText, isCorrect: o.isCorrect }))
          : [],
        rubric: !isObjective ? question.rubric : null,
        candidateAnswer: answer?.answer ?? null,
        answeredAt: answer?.answeredAt ?? null,
        evaluation: answer?.evaluation
          ? {
              score: answer.evaluation.score,
              maxScore: answer.evaluation.maxScore,
              feedback: answer.evaluation.feedback,
              status: answer.evaluation.status,
            }
          : null,
      }
    })

    const riskLevel = attempt.result?.riskLevel ?? computeRiskLevel(attempt.signals.length)

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
      jobTitle: job?.jobTitle ?? null,
      assessmentTitle: assessment.title,
      invite: { sentAt: attempt.invite.sentAt, completedAt: attempt.invite.completedAt },
      riskLevel,
      signals: attempt.signals.map((s) => ({ id: s.id, type: s.type, value: s.value, createdAt: s.createdAt })),
      questions: questionBreakdown,
    })
  } catch (error) {
    return errorResponse(error)
  }
}
