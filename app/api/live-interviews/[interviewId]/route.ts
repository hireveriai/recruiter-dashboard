import { errorResponse, successResponse } from "@/lib/server/response"
import { getLiveInterviewDetail } from "@/lib/server/services/live-interviews"
import { requireVerisLiveRecruiter } from "@/lib/server/veris-live/route-guard"

export const dynamic = "force-dynamic"

export async function GET(request: Request, { params }: { params: Promise<{ interviewId: string }> }) {
  try {
    const auth = await requireVerisLiveRecruiter(request)
    const { interviewId } = await params
    return successResponse(await getLiveInterviewDetail({ organizationId: auth.organizationId, interviewId }))
  } catch (error) {
    return errorResponse(error)
  }
}
