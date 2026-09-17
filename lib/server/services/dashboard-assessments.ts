import { prisma } from "@/lib/server/prisma"

/**
 * VERIS Assessment's dashboard summary — deliberately standalone, mirroring
 * lib/server/services/assessment-credits.ts's "separate module" pattern
 * rather than folding into the interview/screening dashboard aggregate.
 * Scoped to participantType "CANDIDATE" only: Employee Activities' own
 * assessments (participantType "EMPLOYEE") are a different product surface
 * (see app/employees) and are not this widget's concern.
 */
export type DashboardAssessmentSummary = {
  totalAssessments: number
  publishedAssessments: number
  draftAssessments: number
  invitesSent: number
  completedAttempts: number
  passedCount: number
  scoredCount: number
  passRate: number | null
  recent: Array<{
    id: string
    title: string
    status: string
    createdAt: string
    invitesSent: number
    completedAttempts: number
  }>
}

const RECENT_LIMIT = 5

export async function getDashboardAssessmentSummary(organizationId: string): Promise<DashboardAssessmentSummary> {
  const [statusCounts, invitesSent, completedAttempts, passedCount, scoredCount, recentAssessments] = await Promise.all([
    prisma.assessment.groupBy({
      by: ["status"],
      where: { organizationId, participantType: "CANDIDATE" },
      _count: { _all: true },
    }),
    prisma.assessmentInvite.count({
      where: { organizationId, assessment: { participantType: "CANDIDATE" } },
    }),
    prisma.assessmentAttempt.count({
      where: { organizationId, submittedAt: { not: null }, assessment: { participantType: "CANDIDATE" } },
    }),
    prisma.assessmentResult.count({
      where: { organizationId, assessment: { participantType: "CANDIDATE" }, passed: true },
    }),
    prisma.assessmentResult.count({
      where: { organizationId, assessment: { participantType: "CANDIDATE" }, passed: { not: null } },
    }),
    prisma.assessment.findMany({
      where: { organizationId, participantType: "CANDIDATE" },
      orderBy: { createdAt: "desc" },
      take: RECENT_LIMIT,
      select: {
        id: true,
        title: true,
        status: true,
        createdAt: true,
        _count: { select: { invites: true, attempts: true } },
      },
    }),
  ])

  const totalAssessments = statusCounts.reduce((sum, row) => sum + row._count._all, 0)
  const publishedAssessments = statusCounts.find((row) => row.status === "PUBLISHED")?._count._all ?? 0
  const draftAssessments = statusCounts.find((row) => row.status === "DRAFT")?._count._all ?? 0

  return {
    totalAssessments,
    publishedAssessments,
    draftAssessments,
    invitesSent,
    completedAttempts,
    passedCount,
    scoredCount,
    passRate: scoredCount > 0 ? Math.round((passedCount / scoredCount) * 100) : null,
    recent: recentAssessments.map((assessment) => ({
      id: assessment.id,
      title: assessment.title,
      status: assessment.status,
      createdAt: assessment.createdAt.toISOString(),
      invitesSent: assessment._count.invites,
      completedAttempts: assessment._count.attempts,
    })),
  }
}
