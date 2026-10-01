import { errorResponse, successResponse } from "@/lib/server/response"
import { generateLiveDebrief, getLiveDebrief } from "@/lib/server/services/live-debrief"
import { requireVerisLiveRecruiter } from "@/lib/server/veris-live/route-guard"

export const dynamic = "force-dynamic"
export const maxDuration = 90

/** The VERIS Debrief for a Live interview (evidence, stored AI summary, the viewer's own notes, decision). */
export async function GET(request: Request, { params }: { params: Promise<{ interviewId: string }> }) {
  try {
    const auth = await requireVerisLiveRecruiter(request)
    const { interviewId } = await params
    return successResponse(await getLiveDebrief({ organizationId: auth.organizationId, interviewId, userId: auth.userId }))
  } catch (error) {
    return errorResponse(error)
  }
}

/** Generates (or refreshes) the AI-assisted summary from the transcript. */
export async function POST(request: Request, { params }: { params: Promise<{ interviewId: string }> }) {
  try {
    const auth = await requireVerisLiveRecruiter(request)
    const { interviewId } = await params
    return successResponse(await generateLiveDebrief({ organizationId: auth.organizationId, interviewId, userId: auth.userId }))
  } catch (error) {
    return errorResponse(error)
  }
}
