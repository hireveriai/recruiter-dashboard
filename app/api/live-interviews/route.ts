import { errorResponse, successResponse } from "@/lib/server/response"
import {
  createLiveInterview,
  listLiveInterviews,
  parseCreateLiveInterviewInput,
  type LiveBucket,
} from "@/lib/server/services/live-interviews"
import { requireVerisLiveRecruiter } from "@/lib/server/veris-live/route-guard"

export const dynamic = "force-dynamic"

const BUCKETS: LiveBucket[] = ["upcoming", "in_progress", "completed"]

export async function GET(request: Request) {
  try {
    const auth = await requireVerisLiveRecruiter(request)
    const requested = new URL(request.url).searchParams.get("bucket") as LiveBucket | null
    const bucket = requested && BUCKETS.includes(requested) ? requested : "upcoming"
    const interviews = await listLiveInterviews({ organizationId: auth.organizationId, bucket })
    return successResponse({ bucket, interviews })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireVerisLiveRecruiter(request)
    const input = parseCreateLiveInterviewInput(await request.json().catch(() => null))
    const result = await createLiveInterview({ organizationId: auth.organizationId, userId: auth.userId, input })
    return successResponse(result, 201)
  } catch (error) {
    return errorResponse(error)
  }
}
