import { NextResponse } from "next/server"

import { getRecruiterRequestContext } from "@/lib/server/auth-context"
import { assertEntitlement } from "@/lib/server/entitlements"
import { errorResponse } from "@/lib/server/response"
import { getJobsScreenData } from "@/lib/server/services/recruiter-screen-data"

export async function GET(request: Request) {
  try {
    const auth = await getRecruiterRequestContext(request)
    await assertEntitlement(auth, "AI_INTERVIEW")
    const url = new URL(request.url)
    const view = url.searchParams.get("view") || url.searchParams.get("fields")
    const includeInactive =
      url.searchParams.get("includeInactive") === "1" ||
      url.searchParams.get("include_inactive") === "1" ||
      url.searchParams.get("includeInactive") === "true" ||
      url.searchParams.get("include_inactive") === "true"
    const data = await getJobsScreenData(auth, {
      includeInactive,
      view,
    })

    const response = NextResponse.json({
      success: true,
      jobs: data.jobs,
      meta: data.meta,
    })
    response.headers.set("Cache-Control", "private, max-age=30, stale-while-revalidate=60")
    return response
  } catch (error) {
    return errorResponse(error)
  }
}
