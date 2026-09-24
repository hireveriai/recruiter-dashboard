import { errorResponse, successResponse } from "@/lib/server/response"
import { getLiveRecordingPath } from "@/lib/server/services/live-interviews"
import { signLiveRecordingUrl } from "@/lib/server/veris-live/recording-url"
import { requireVerisLiveRecruiter } from "@/lib/server/veris-live/route-guard"

export const dynamic = "force-dynamic"

/** Returns a 10-minute signed playback URL for one org-scoped recording. */
export async function GET(request: Request, { params }: { params: Promise<{ interviewId: string; recordingId: string }> }) {
  try {
    const auth = await requireVerisLiveRecruiter(request)
    const { interviewId, recordingId } = await params
    const path = await getLiveRecordingPath({ organizationId: auth.organizationId, interviewId, recordingId })
    return successResponse({ url: await signLiveRecordingUrl(path), expiresInSeconds: 600 })
  } catch (error) {
    return errorResponse(error)
  }
}
