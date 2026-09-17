import { Prisma } from "@prisma/client"

import { getRecruiterRequestContext } from "@/lib/server/auth-context"
import { assertEntitlement } from "@/lib/server/entitlements"
import { prisma } from "@/lib/server/prisma"
import { errorResponse, successResponse } from "@/lib/server/response"
import {
  prepareInterviewQuestionsWithRetry,
  sendInterviewEmailForInterview,
} from "@/lib/server/services/interview-workflow"

export const runtime = "nodejs"
export const maxDuration = 300

export async function POST(
  request: Request,
  context: { params: Promise<{ interviewId: string }> }
) {
  try {
    const auth = await getRecruiterRequestContext(request)
    await assertEntitlement(auth, "AI_INTERVIEW")
    const { interviewId } = await context.params
    const body = await request.json().catch(() => ({}))

    await prepareInterviewQuestionsWithRetry({
      organizationId: auth.organizationId,
      interviewId,
      totalQuestions: body.total_questions ?? body.totalQuestions,
      interviewDurationMinutes: body.interview_duration_minutes ?? body.interviewDurationMinutes,
      similarityThreshold: body.similarity_threshold ?? body.similarityThreshold ?? 0.8,
    })

    const emailResult = await sendInterviewEmailForInterview(auth.organizationId, interviewId)

    if (emailResult.emailSent) {
      const rows = await prisma.$queryRaw<{ job_id: string; email: string }[]>(Prisma.sql`
        select i.job_id::text, c.email
        from public.interviews i
        inner join public.candidates c on c.candidate_id = i.candidate_id
        where i.interview_id = ${interviewId}::uuid
          and i.organization_id = ${auth.organizationId}::uuid
        limit 1
      `)

      const row = rows[0]
      if (row?.job_id && row.email) {
        const { recordInterviewInviteTracking } = await import("@/lib/server/services/interview.service")
        await recordInterviewInviteTracking({
          interviewId,
          companyId: auth.organizationId,
          jobId: row.job_id,
          candidateEmail: row.email,
        })
      }
    }

    return successResponse({
      interviewId,
      status: "READY",
      questionStatus: "COMPLETED",
      emailStatus: emailResult.emailSent ? "SENT" : "FAILED",
      emailSent: emailResult.emailSent,
      emailError: emailResult.emailError,
      link: emailResult.link,
    })
  } catch (error) {
    return errorResponse(error)
  }
}
