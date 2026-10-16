import { NextResponse } from "next/server"

import { requireAiRouteAccess } from "@/lib/server/ai/route-access"
import { upsertSkillState } from "@/lib/server/ai/skill-state"
import { errorResponse } from "@/lib/server/response"

export async function POST(request: Request) {
  try {
    const body = await request.json()

    const attemptId = body.attempt_id ?? body.attemptId
    const skillsCovered = Array.isArray(body.skills_covered) ? body.skills_covered : body.skillsCovered
    const skillsRemaining = Array.isArray(body.skills_remaining) ? body.skills_remaining : body.skillsRemaining

    if (!attemptId) {
      return NextResponse.json(
        { success: false, message: "attemptId is required" },
        { status: 400 }
      )
    }

    const { auth, attempt } = await requireAiRouteAccess(request, attemptId)

    await upsertSkillState({
      attemptId,
      interviewId: attempt?.interviewId ?? null,
      organizationId: auth.organizationId,
      skillsCovered: Array.isArray(skillsCovered) ? skillsCovered : [],
      skillsRemaining: Array.isArray(skillsRemaining) ? skillsRemaining : [],
    })

    return NextResponse.json({
      success: true,
      data: {
        attempt_id: attemptId,
        skills_covered: Array.isArray(skillsCovered) ? skillsCovered : [],
        skills_remaining: Array.isArray(skillsRemaining) ? skillsRemaining : [],
      },
    })
  } catch (error) {
    return errorResponse(error)
  }
}
