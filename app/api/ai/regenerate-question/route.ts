import { NextResponse } from "next/server"

import { regenerateQuestionWithValidation, validateQuestionQuality } from "@/lib/server/ai/brain"
import { requireAiRouteAccess } from "@/lib/server/ai/route-access"
import { errorResponse } from "@/lib/server/response"

export async function POST(request: Request) {
  try {
    await requireAiRouteAccess(request)
    const body = await request.json()

    const questionText = String(body.generated_question ?? body.question ?? "").trim()
    const jobTitle = body.job_title ?? body.jobTitle ?? body.title
    const jobSkills = Array.isArray(body.job_skills) ? body.job_skills : body.jobSkills
    const previousQuestions = Array.isArray(body.previous_questions) ? body.previous_questions : body.previousQuestions
    const similarityThreshold = typeof body.similarity_threshold === "number" ? body.similarity_threshold : body.similarityThreshold
    const includeAttemptHistory = Boolean(body.include_attempt_history ?? body.includeAttemptHistory)

    if (!questionText) {
      return NextResponse.json(
        { success: false, message: "generated_question is required" },
        { status: 400 }
      )
    }

    const candidate = {
      id: body.id ?? "candidate-0",
      text: questionText,
      phase: body.phase ?? "MID",
      tags: Array.isArray(body.tags) ? body.tags : [],
      type: body.type ?? "TECHNICAL",
    }

    const jobSkillsList = Array.isArray(jobSkills) ? jobSkills : []
    const prevList = Array.isArray(previousQuestions) ? previousQuestions : []

    const initialQuality = validateQuestionQuality({
      question: questionText,
      jobTitle,
      jobSkills: jobSkillsList,
      previousQuestions: prevList,
      similarityThreshold,
    })

    const regeneration = regenerateQuestionWithValidation({
      question: candidate,
      jobTitle,
      jobSkills: jobSkillsList,
      previousQuestions: prevList,
      similarityThreshold,
      includeAttemptHistory,
    })

    return NextResponse.json({
      success: true,
      data: {
        question: regeneration.question.text,
        status: regeneration.status,
        reason: regeneration.reason,
        attempts: regeneration.attempts,
        history: regeneration.history,
        initial: {
          status: initialQuality.status,
          reason: initialQuality.reason,
          score: initialQuality.score,
        },
      },
    })
  } catch (error) {
    return errorResponse(error)
  }
}
