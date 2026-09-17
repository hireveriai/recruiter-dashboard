import { NextResponse } from "next/server"

import { getRecruiterRequestContext } from "@/lib/server/auth-context"
import { assertEntitlement } from "@/lib/server/entitlements"
import { errorResponse } from "@/lib/server/response"
import {
  getScreeningRunMatches,
  getScreeningRuns,
} from "@/lib/server/ai-screening/service"

export const runtime = "nodejs"

export async function GET(request: Request) {
  try {
    const auth = await getRecruiterRequestContext(request)
    await assertEntitlement(auth, "SCREENING")
    const url = new URL(request.url)
    const jobId = String(url.searchParams.get("jobId") ?? url.searchParams.get("job_id") ?? "").trim()
    const runId = String(url.searchParams.get("runId") ?? url.searchParams.get("run_id") ?? "").trim()

    const runs = jobId
      ? await getScreeningRuns({
          organizationId: auth.organizationId,
          jobId,
          limit: 5,
        })
      : []
    const matches = runId
      ? await getScreeningRunMatches({
          organizationId: auth.organizationId,
          runId,
        })
      : []

    return NextResponse.json({
      success: true,
      data: {
        runs,
        matches,
      },
    })
  } catch (error) {
    return errorResponse(error)
  }
}
