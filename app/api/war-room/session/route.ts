import { NextResponse } from "next/server"

import { getAuthTokenFromRequest, getVerisnovaSessionFromRequest, getRecruiterRequestContext } from "@/lib/server/auth-context"
import { assertEntitlement } from "@/lib/server/entitlements"
import { errorResponse } from "@/lib/server/response"

export async function GET(request: Request) {
  try {
    const auth = await getRecruiterRequestContext(request)
    await assertEntitlement(auth, "AI_INTERVIEW")
    const token = getAuthTokenFromRequest(request)
    const verisnovaSession = getVerisnovaSessionFromRequest(request)

    if (!token && !verisnovaSession) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "AUTH_HANDOFF_MISSING",
            message: "Authenticated session is not available for War Room handoff",
          },
        },
        { status: 401 }
      )
    }

    return NextResponse.json({
      success: true,
      data: {
        authToken: token,
        verisnovaSession,
        organizationId: auth.organizationId,
      },
    })
  } catch (error) {
    return errorResponse(error)
  }
}
