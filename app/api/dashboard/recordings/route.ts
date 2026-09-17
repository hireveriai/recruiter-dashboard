import { NextResponse } from "next/server"

import { getRecruiterRequestContext } from "@/lib/server/auth-context"
import { assertEntitlement } from "@/lib/server/entitlements"
import { errorResponse } from "@/lib/server/response"
import { getDashboardRecordings } from "@/lib/server/services/dashboard-recordings"

function parseLimit(value: string | null) {
  const parsed = Number.parseInt(value ?? "6", 10)
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 24) : 6
}

export async function GET(request: Request) {
  const startedAt = Date.now()

  try {
    const auth = await getRecruiterRequestContext(request)
    await assertEntitlement(auth, "AI_INTERVIEW")
    const { searchParams } = new URL(request.url)
    const limit = parseLimit(searchParams.get("limit"))
    const verifyStorage = searchParams.get("verifyStorage") !== "0"
    const recordedInterviews = await getDashboardRecordings(auth.organizationId, limit, { verifyStorage })
    const durationMs = Date.now() - startedAt
    const response = NextResponse.json({
      success: true,
      data: recordedInterviews,
    })

    response.headers.set("Cache-Control", "private, max-age=30, stale-while-revalidate=120")
    response.headers.set("Server-Timing", `recordings;dur=${durationMs}`)
    return response
  } catch (error) {
    return errorResponse(error)
  }
}
