import { NextResponse } from "next/server"

import { getRecruiterRequestContext } from "@/lib/server/auth-context"
import { assertEntitlement } from "@/lib/server/entitlements"
import { errorResponse } from "@/lib/server/response"
import { getDashboardPipelineData } from "@/lib/server/services/dashboard-pipeline"
import { getDashboardRecordings } from "@/lib/server/services/dashboard-recordings"

function parseLimit(value: string | null): number | "all" {
  if (value === "all") {
    return "all"
  }

  const parsed = Number.parseInt(value ?? "5", 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 5
}

export async function GET(request: Request) {
  try {
    const auth = await getRecruiterRequestContext(request)
    await assertEntitlement(auth, "AI_INTERVIEW")
    const { searchParams } = new URL(request.url)
    const limit = parseLimit(searchParams.get("limit"))
    const includeRecordings =
      searchParams.get("includeRecordings") === "1" ||
      searchParams.get("includeRecordings") === "true"
    const [pipelineData, recordedInterviews] = await Promise.all([
      getDashboardPipelineData({
        organizationId: auth.organizationId,
        limit,
        finalizeStale: false,
        ensureRecoverySchema: false,
      }),
      includeRecordings ? getDashboardRecordings(auth.organizationId) : Promise.resolve([]),
    ])

    return NextResponse.json({
      success: true,
      data: {
        pipeline: pipelineData.pipeline,
        pendingInterviews: pipelineData.pendingInterviews,
        pendingTotal: pipelineData.pendingTotal,
        recordedInterviews,
      },
    })
  } catch (error) {
    return errorResponse(error)
  }
}
