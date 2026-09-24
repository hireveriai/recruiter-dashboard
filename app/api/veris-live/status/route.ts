import { getRecruiterRequestContext } from "@/lib/server/auth-context"
import { errorResponse, successResponse } from "@/lib/server/response"
import { isVerisLiveFlagEnabled } from "@/lib/server/veris-live/feature-flag"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  try {
    const auth = await getRecruiterRequestContext(request)
    return successResponse({ enabled: isVerisLiveFlagEnabled(auth.organizationId) })
  } catch (error) {
    return errorResponse(error)
  }
}
