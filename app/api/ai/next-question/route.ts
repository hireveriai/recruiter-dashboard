import { NextResponse } from "next/server"

import { generateQuestions } from "@/lib/server/ai/brain"
import { requireAiRouteAccess } from "@/lib/server/ai/route-access"
import { fetchSkillState } from "@/lib/server/ai/skill-state"
import { errorResponse } from "@/lib/server/response"

export async function POST(request: Request) {
  try {
    const body = await request.json()

    const attemptId = body.attempt_id ?? body.attemptId
    await requireAiRouteAccess(request, attemptId)
    const skillsRemainingInput = body.skillsRemaining ?? body.skills_remaining

    let skillsRemaining = Array.isArray(skillsRemainingInput) ? skillsRemainingInput : null

    if (!skillsRemaining && attemptId) {
      const state = await fetchSkillState(attemptId)
      if (state?.skills_remaining) {
        skillsRemaining = state.skills_remaining
      }
    }

    const data = generateQuestions({
      roleType: body.roleType,
      totalQuestions: body.totalQuestions ?? 10,
      skillTags: body.skillTags ?? [],
      baseQuestions: body.baseQuestions ?? [],
      behavioralBank: body.behavioralBank ?? [],
      jobTitle: body.jobTitle ?? body.roleTitle ?? body.title,
      previousQuestions: body.previousQuestions ?? body.previous_questions ?? [],
      similarityThreshold: body.similarityThreshold ?? body.similarity_threshold,
      jobDescription: body.jobDescription ?? body.job_description,
      coreSkills: body.coreSkills ?? body.core_skills,
      resumeSkills: body.resumeSkills ?? body.resume_skills,
      skillsRemaining: skillsRemaining ?? undefined,
    })

    return NextResponse.json({
      success: true,
      data,
    })
  } catch (error) {
    return errorResponse(error)
  }
}
