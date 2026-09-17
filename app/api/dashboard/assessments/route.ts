import { NextResponse } from "next/server"

import { getRecruiterRequestContext } from "@/lib/server/auth-context"
import { assertEntitlement } from "@/lib/server/entitlements"
import { errorResponse } from "@/lib/server/response"
import { getDashboardAssessmentSummary } from "@/lib/server/services/dashboard-assessments"

export async function GET(request: Request) {
  try {
    const auth = await getRecruiterRequestContext(request)
    await assertEntitlement(auth, "ASSESSMENT")

    const summary = await getDashboardAssessmentSummary(auth.organizationId)

    const response = NextResponse.json({
      success: true,
      data: summary,
    })
    response.headers.set("Cache-Control", "private, max-age=10, stale-while-revalidate=30")
    return response
  } catch (error) {
    return errorResponse(error)
  }
}
