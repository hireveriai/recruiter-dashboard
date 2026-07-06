import { NextResponse } from "next/server"

import { decideNextQuestion, generateFollowUpWithAI } from "@/lib/server/ai/adaptive-interview"
import { fetchSkillState, upsertSkillState } from "@/lib/server/ai/skill-state"
import { errorResponse } from "@/lib/server/response"

export async function POST(request: Request) {
  try {
    const body = await request.json()

    const attemptId = body.attempt_id ?? body.attemptId
    const state = attemptId ? await fetchSkillState(attemptId) : null
    let skillsRemaining = body.skills_remaining ?? body.skillsRemaining

    if ((!skillsRemaining || skillsRemaining.length === 0) && state) {
      skillsRemaining = state?.skills_remaining ?? []
    }

    const decision = decideNextQuestion({
      lastAnswer: body.last_answer ?? body.lastAnswer,
      skillScore: body.skill_score ?? body.skillScore,
      fraudScore: body.fraud_score ?? body.fraudScore,
      skillsRemaining: skillsRemaining ?? [],
      timeRemainingSeconds: body.time_remaining ?? body.timeRemaining,
      followupCount: body.followup_count ?? body.followupCount ?? state?.followup_count ?? 0,
      lastQuestion: body.last_question ?? body.lastQuestion ?? state?.last_question ?? undefined,
      criticalSkills: body.critical_skills ?? body.criticalSkills,
      experienceLevel: body.experience_level ?? body.experienceLevel,
      responseAnalysis: body.response_analysis ?? body.responseAnalysis ?? state?.response_metrics ?? undefined,
      roleConfidence:
        body.role_confidence ??
        body.roleConfidence ??
        (typeof state?.role_confidence === "number" ? state.role_confidence : undefined),
      adaptiveMode:
        body.adaptive_mode ??
        body.adaptiveMode ??
        (typeof state?.adaptive_mode === "boolean" ? state.adaptive_mode : undefined),
      questionMode: body.question_mode ?? body.questionMode,
      askedQuestions: Array.isArray(state?.asked_questions) ? (state?.asked_questions as string[]) : undefined,
    })

    const useAiFollowup =
      body.use_ai_followup ?? body.useAiFollowup ?? body.use_ai ?? body.useAi ?? true

    if (
      useAiFollowup &&
      (decision.intent === "followup" || decision.intent === "exploratory") &&
      decision.followUp &&
      (body.last_question ?? body.lastQuestion ?? state?.last_question) &&
      (body.last_answer ?? body.lastAnswer)
    ) {
      decision.followUp = await generateFollowUpWithAI({
        lastQuestion: body.last_question ?? body.lastQuestion ?? state?.last_question,
        candidateAnswer: body.last_answer ?? body.lastAnswer,
        skillScore: body.skill_score ?? body.skillScore,
        fraudScore: body.fraud_score ?? body.fraudScore,
      })
    }

    if (attemptId && state) {
      await upsertSkillState({
        attemptId,
        interviewId: state.interview_id,
        organizationId: state.organization_id,
        skillsCovered: state.skills_covered,
        skillsRemaining: skillsRemaining ?? [],
        responseMetrics: decision.updatedEvaluation ?? state.response_metrics,
        askedQuestions: state.asked_questions,
        answers: state.answers,
        followupCount:
          decision.intent === "followup" || decision.intent === "exploratory"
            ? (state.followup_count ?? 0) + 1
            : 0,
        lastQuestion: body.last_question ?? body.lastQuestion ?? state.last_question,
        roleConfidence:
          body.role_confidence ??
          body.roleConfidence ??
          state.role_confidence,
        adaptiveMode:
          body.adaptive_mode ??
          body.adaptiveMode ??
          state.adaptive_mode,
      })
    }

    return NextResponse.json({ success: true, data: decision })
  } catch (error) {
    return errorResponse(error)
  }
}
