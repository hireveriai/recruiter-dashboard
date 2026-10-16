import { NextResponse } from "next/server"

import { evaluateCandidateResponse, updateSkillState } from "@/lib/server/ai/response-evaluation"
import { requireAiRouteAccess } from "@/lib/server/ai/route-access"
import { fetchSkillState, upsertSkillState } from "@/lib/server/ai/skill-state"
import { errorResponse } from "@/lib/server/response"

export async function POST(request: Request) {
  try {
    const body = await request.json()

    const attemptId = body.attempt_id ?? body.attemptId
    const skill = body.skill
    const answer = body.answer ?? ""
    const lastQuestion = body.last_question ?? body.lastQuestion
    const fraudScore = body.fraud_score ?? body.fraudScore
    const experienceLevel = body.experience_level ?? body.experienceLevel

    if (!attemptId || !skill) {
      return NextResponse.json(
        { success: false, message: "attemptId and skill are required" },
        { status: 400 }
      )
    }

    const { auth, attempt } = await requireAiRouteAccess(request, attemptId)
    const interviewId = attempt?.interviewId ?? null
    const organizationId = auth.organizationId

    const state = await fetchSkillState(attemptId)
    const skillsCovered = state?.skills_covered ?? []
    const skillsRemaining = state?.skills_remaining ?? []
    const askedQuestions = Array.isArray(state?.asked_questions) ? (state?.asked_questions as unknown[]) : []
    const answers = Array.isArray(state?.answers) ? (state?.answers as unknown[]) : []

    const updated = updateSkillState({
      skill,
      skillsCovered,
      skillsRemaining,
    })

    const responseAnalysis = evaluateCandidateResponse({
      skill,
      answer,
      skillType: lastQuestion?.skill_type,
      fraudScore,
      experienceLevel,
      roleConfidence: typeof state?.role_confidence === "number" ? state.role_confidence : undefined,
      adaptiveMode: typeof state?.adaptive_mode === "boolean" ? state.adaptive_mode : undefined,
    })

    const nextAskedQuestions =
      lastQuestion && typeof lastQuestion.question === "string"
        ? [...askedQuestions, lastQuestion.question].slice(-25)
        : askedQuestions

    const nextAnswers =
      answer && typeof answer === "string"
        ? [...answers, { skill, answer, analysis: responseAnalysis }].slice(-25)
        : answers

    await upsertSkillState({
      attemptId,
      interviewId,
      organizationId,
      skillsCovered: updated.skills_covered,
      skillsRemaining: updated.skills_remaining,
      responseMetrics: responseAnalysis,
      askedQuestions: nextAskedQuestions,
      answers: nextAnswers,
      followupCount: 0,
      lastQuestion: lastQuestion ?? state?.last_question ?? null,
      roleConfidence: state?.role_confidence,
      adaptiveMode: state?.adaptive_mode,
    })

    return NextResponse.json({
      success: true,
      data: {
        skill,
        skill_score: responseAnalysis.skill_score,
        response_analysis: responseAnalysis,
        skills_covered: updated.skills_covered,
        skills_remaining: updated.skills_remaining,
      },
    })
  } catch (error) {
    return errorResponse(error)
  }
}
