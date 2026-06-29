import { NextResponse } from "next/server"
import { z } from "zod"

import { getRecruiterRequestContext } from "@/lib/server/auth-context"
import { errorResponse } from "@/lib/server/response"
import { getDashboardAlerts, markDashboardAlertsRead } from "@/lib/server/services/dashboard-alerts"

const markAlertsReadSchema = z.object({
  alertIds: z.array(z.string().trim().min(1)).min(1),
})

export async function GET(request: Request) {
  try {
    const auth = await getRecruiterRequestContext(request)
    const { searchParams } = new URL(request.url)
    const requestedLimit = searchParams.get("limit")
    const limit = requestedLimit
      ? Math.max(1, Math.floor(Number(requestedLimit) || 0))
      : "all"
    const alerts = await getDashboardAlerts(auth.organizationId, limit, auth.userId)

    return NextResponse.json({
      success: true,
      data: alerts,
    })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function POST(request: Request) {
  try {
    const auth = await getRecruiterRequestContext(request)
    const body = await request.json().catch(() => ({}))
    const input = markAlertsReadSchema.parse(body)
    const result = await markDashboardAlertsRead({
      organizationId: auth.organizationId,
      userId: auth.userId,
      alertIds: input.alertIds,
    })

    return NextResponse.json({
      success: true,
      data: result,
    })
  } catch (error) {
    return errorResponse(error)
  }
}
