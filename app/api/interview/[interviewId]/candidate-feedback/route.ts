import { getRecruiterRequestContext } from "@/lib/server/auth-context"
import { errorResponse, successResponse } from "@/lib/server/response"
import { generateCandidateFeedback } from "@/lib/server/services/candidate-feedback"

type RouteContext = {
  params: Promise<{
    interviewId: string
  }>
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const auth = await getRecruiterRequestContext(request)
    const { interviewId } = await context.params

    const result = await generateCandidateFeedback(auth.organizationId, String(interviewId ?? "").trim())

    return successResponse(result)
  } catch (error) {
    return errorResponse(error)
  }
}
