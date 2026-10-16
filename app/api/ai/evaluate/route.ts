import { NextResponse } from "next/server"

import { evaluateAnswer } from "@/lib/server/ai/brain"
import { requireAiRouteAccess } from "@/lib/server/ai/route-access"
import { errorResponse } from "@/lib/server/response"

export async function POST(request: Request) {
  try {
    await requireAiRouteAccess(request)
    const body = await request.json()

    const result = evaluateAnswer({
      questionId: body.questionId,
      question: body.question,
      questionType: body.questionType,
      answer: body.answer,
      roleType: body.roleType,
      skillTags: body.skillTags ?? [],
    })

    return NextResponse.json({
      success: true,
      data: result,
    })
  } catch (error) {
    return errorResponse(error)
  }
}
