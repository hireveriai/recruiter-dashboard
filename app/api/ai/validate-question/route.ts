import { NextResponse } from "next/server"

import { validateQuestionQuality } from "@/lib/server/ai/brain"
import { requireAiRouteAccess } from "@/lib/server/ai/route-access"
import { errorResponse } from "@/lib/server/response"

export async function POST(request: Request) {
  try {
    await requireAiRouteAccess(request)
    const body = await request.json()

    const question = String(body.generated_question ?? body.question ?? "").trim()
    const jobTitle = body.job_title ?? body.jobTitle ?? body.title
    const jobSkills = Array.isArray(body.job_skills) ? body.job_skills : body.jobSkills
    const previousQuestions = Array.isArray(body.previous_questions) ? body.previous_questions : body.previousQuestions

    if (!question) {
      return NextResponse.json(
        { success: false, message: "generated_question is required" },
        { status: 400 }
      )
    }

    const result = validateQuestionQuality({
      question,
      jobTitle,
      jobSkills: Array.isArray(jobSkills) ? jobSkills : [],
      previousQuestions: Array.isArray(previousQuestions) ? previousQuestions : [],
    })

    return NextResponse.json({
      success: true,
      data: {
        question,
        status: result.status,
        reason: result.reason,
        score: result.score,
      },
    })
  } catch (error) {
    return errorResponse(error)
  }
}
