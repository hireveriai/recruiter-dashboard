import { getRecruiterRequestContext } from "@/lib/server/auth-context"
import { errorResponse, successResponse } from "@/lib/server/response"
import { ApiError } from "@/lib/server/errors"
import { sendCandidateFeedback } from "@/lib/server/services/candidate-feedback"

type RouteContext = {
  params: Promise<{
    interviewId: string
  }>
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const auth = await getRecruiterRequestContext(request)
    const { interviewId } = await context.params
    const body = await request.json().catch(() => ({}))
    const text = typeof body?.text === "string" ? body.text : ""
    const to = typeof body?.to === "string" ? body.to : undefined
    const cc = Array.isArray(body?.cc) ? body.cc.filter((value: unknown): value is string => typeof value === "string") : undefined
    const hiringDecision = body?.hiringDecision
    const includeSignature = Boolean(body?.includeSignature)

    if (!text.trim()) {
      throw new ApiError(400, "FEEDBACK_TEXT_REQUIRED", "Feedback text is required.")
    }

    const result = await sendCandidateFeedback(
      auth.organizationId,
      String(interviewId ?? "").trim(),
      text,
      { to, cc, hiringDecision, includeSignature }
    )

    return successResponse(result)
  } catch (error) {
    return errorResponse(error)
  }
}
