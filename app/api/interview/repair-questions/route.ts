import { getRecruiterRequestContext } from "@/lib/server/auth-context"
import { assertEntitlement } from "@/lib/server/entitlements"
import { ApiError } from "@/lib/server/errors"
import { errorResponse, successResponse } from "@/lib/server/response"
import { repairInterviewQuestions } from "@/lib/server/services/interview-question-repair"

export async function POST(request: Request) {
  try {
    const auth = await getRecruiterRequestContext(request)
    await assertEntitlement(auth, "AI_INTERVIEW")
    const body = await request.json().catch(() => ({}))

    if (Array.isArray(body.questions)) {
      throw new ApiError(410, "QUESTION_REPAIR_DISABLED", "Question repair is disabled")
    }

    const interviewId = String(body.interviewId ?? body.interview_id ?? "").trim() || undefined
    const jobId = String(body.jobId ?? body.job_id ?? "").trim() || undefined
    const rawLimit = Number(body.limit ?? 50)
    const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(200, rawLimit)) : 50
    const force = body.force === undefined ? true : Boolean(body.force)

    if (interviewId && jobId) {
      throw new ApiError(400, "INVALID_REPAIR_SCOPE", "Provide either interviewId or jobId, not both")
    }

    const result = await repairInterviewQuestions({
      organizationId: auth.organizationId,
      interviewId,
      jobId,
      limit,
      force,
    })

    return successResponse(result)
  } catch (error) {
    return errorResponse(error)
  }
}
