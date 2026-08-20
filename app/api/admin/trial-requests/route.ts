import { getRecruiterRequestContext } from "@/lib/server/auth-context"
import { requirePlatformAdmin } from "@/lib/server/platform-admin"
import { errorResponse, successResponse } from "@/lib/server/response"
import {
  listTrialRequestsForAdmin,
  type TrialRequestStatus,
} from "@/lib/server/services/trial-requests"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const STATUSES = ["PENDING_REVIEW", "APPROVED", "REJECTED", "EXPIRED", "CANCELLED", "ALL"] as const
const TYPES = ["RECRUITER_TRIAL", "CANDIDATE_PRACTICE", "ALL"] as const

export async function GET(request: Request) {
  try {
    const auth = await getRecruiterRequestContext(request)
    await requirePlatformAdmin(auth)

    const url = new URL(request.url)
    const statusParam = (url.searchParams.get("status") || "PENDING_REVIEW").toUpperCase()
    const typeParam = (url.searchParams.get("type") || "ALL").toUpperCase()

    const status = (STATUSES as readonly string[]).includes(statusParam)
      ? (statusParam as TrialRequestStatus | "ALL")
      : "PENDING_REVIEW"
    const requestType = (TYPES as readonly string[]).includes(typeParam)
      ? (typeParam as "RECRUITER_TRIAL" | "CANDIDATE_PRACTICE" | "ALL")
      : "ALL"

    const requests = await listTrialRequestsForAdmin({
      status,
      requestType,
      limit: Number(url.searchParams.get("limit") || 100),
    })

    const response = successResponse({ requests })
    response.headers.set("Cache-Control", "no-store")
    return response
  } catch (error) {
    return errorResponse(error)
  }
}
