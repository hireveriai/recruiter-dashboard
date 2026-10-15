import { NextResponse } from "next/server"

import { requireAiRouteAccess } from "@/lib/server/ai/route-access"
import { fetchSkillState } from "@/lib/server/ai/skill-state"
import { errorResponse } from "@/lib/server/response"

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const attemptId = url.searchParams.get("attemptId") ?? url.searchParams.get("attempt_id")

    if (!attemptId) {
      return NextResponse.json(
        { success: false, message: "attemptId is required" },
        { status: 400 }
      )
    }

    await requireAiRouteAccess(request, attemptId)

    const state = await fetchSkillState(attemptId)

    return NextResponse.json({
      success: true,
      data: state,
    })
  } catch (error) {
    return errorResponse(error)
  }
}
