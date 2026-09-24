import { errorResponse, successResponse } from "@/lib/server/response"
import { cancelLiveInterview } from "@/lib/server/services/live-interviews"
import { requireVerisLiveRecruiter } from "@/lib/server/veris-live/route-guard"

export const dynamic = "force-dynamic"

export async function POST(request: Request, { params }: { params: Promise<{ interviewId: string }> }) {
  try {
    const auth = await requireVerisLiveRecruiter(request)
    const { interviewId } = await params
    await cancelLiveInterview({ organizationId: auth.organizationId, interviewId })
    return successResponse({ cancelled: true })
  } catch (error) {
    return errorResponse(error)
  }
}
