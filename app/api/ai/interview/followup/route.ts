import { NextResponse } from "next/server"

import { generateFollowUp, generateFollowUpWithAI } from "@/lib/server/ai/adaptive-interview"
import { requireAiRouteAccess } from "@/lib/server/ai/route-access"
import { errorResponse } from "@/lib/server/response"

export async function POST(request: Request) {
  try {
    await requireAiRouteAccess(request)
    const body = await request.json()

    const lastQuestion = body.last_question ?? body.lastQuestion
    const candidateAnswer = body.candidate_answer ?? body.candidateAnswer ?? ""

    if (!lastQuestion) {
      return NextResponse.json(
        { success: false, message: "last_question is required" },
        { status: 400 }
      )
    }

    const useAiFollowup =
      body.use_ai_followup ?? body.useAiFollowup ?? body.use_ai ?? body.useAi ?? true

    const followUp = useAiFollowup
      ? await generateFollowUpWithAI({
          lastQuestion,
          candidateAnswer,
          skillScore: body.skill_score ?? body.skillScore,
          fraudScore: body.fraud_score ?? body.fraudScore,
        })
      : generateFollowUp({
          lastQuestion,
          candidateAnswer,
          skillScore: body.skill_score ?? body.skillScore,
          fraudScore: body.fraud_score ?? body.fraudScore,
          responseAnalysis: body.response_analysis ?? body.responseAnalysis,
          experienceLevel: body.experience_level ?? body.experienceLevel,
          adaptiveMode: body.adaptive_mode ?? body.adaptiveMode,
          questionMode: body.question_mode ?? body.questionMode,
        })

    return NextResponse.json({ success: true, data: followUp })
  } catch (error) {
    return errorResponse(error)
  }
}
