import { Prisma } from "@prisma/client"

import { getRecruiterRequestContext } from "@/lib/server/auth-context"
import { assertEntitlement } from "@/lib/server/entitlements"
import { prisma } from "@/lib/server/prisma"
import { errorResponse, successResponse } from "@/lib/server/response"
import { sendInterviewEmailForInterview } from "@/lib/server/services/interview-workflow"
import { recordInterviewInviteTracking } from "@/lib/server/services/interview.service"

export const runtime = "nodejs"

export async function POST(
  request: Request,
  context: { params: Promise<{ interviewId: string }> }
) {
  try {
    const auth = await getRecruiterRequestContext(request)
    await assertEntitlement(auth, "AI_INTERVIEW")
    const { interviewId } = await context.params
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
      emailStatus: emailResult.emailSent ? "SENT" : "FAILED",
      emailSent: emailResult.emailSent,
      emailError: emailResult.emailError,
      link: emailResult.link,
    })
  } catch (error) {
    return errorResponse(error)
  }
}
