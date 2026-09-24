import { errorResponse, successResponse } from "@/lib/server/response"
import { listEligibleInterviewers } from "@/lib/server/services/live-interviews"
import { requireVerisLiveRecruiter } from "@/lib/server/veris-live/route-guard"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  try {
    const auth = await requireVerisLiveRecruiter(request)
    return successResponse({ interviewers: await listEligibleInterviewers(auth.organizationId) })
  } catch (error) {
    return errorResponse(error)
  }
}
