import { NextResponse } from "next/server"

import { requireAiRouteAccess } from "@/lib/server/ai/route-access"
import { fetchSkillState, upsertSkillState } from "@/lib/server/ai/skill-state"
import {
  aggregateSkillScores,
  buildSkillUniverse,
  bucketSkill,
  computeSkillCoverage,
  mapQuestionToSkill,
  scoreAnswerForSkill,
} from "@/lib/server/ai/skills"
import { prisma } from "@/lib/server/prisma"
import { errorResponse } from "@/lib/server/response"

type IncomingQuestion = {
  id?: string
  questionId?: string
  text?: string
  question?: string
}

type IncomingAnswer = {
  questionId?: string
  question_id?: string
  questionText?: string
  text?: string
  answer?: string
  score?: number
}

async function ensureSkillProfileTable() {
  await prisma.$executeRaw`
    create table if not exists public.interview_skill_profiles (
      profile_id uuid primary key default gen_random_uuid(),
      interview_id uuid,
      attempt_id uuid,
      organization_id uuid,
      skill_scores jsonb not null,
      strengths text[] not null,
      weaknesses text[] not null,
      overall_weighted_score numeric,
      created_at timestamptz not null default now()
    )
  `

  await prisma.$executeRaw`
    create index if not exists idx_interview_skill_profiles_attempt
    on public.interview_skill_profiles (attempt_id)
  `

  await prisma.$executeRaw`
    create index if not exists idx_interview_skill_profiles_interview
    on public.interview_skill_profiles (interview_id)
  `
}

export async function POST(request: Request) {
  try {
    const body = await request.json()

    const attemptId = body.attempt_id ?? body.attemptId
    const { auth, attempt } = await requireAiRouteAccess(request, attemptId)
    const interviewId = attempt?.interviewId ?? null
    const organizationId = auth.organizationId

    const jobDescription = body.job_description ?? body.jobDescription
    const coreSkills = Array.isArray(body.core_skills) ? body.core_skills : body.coreSkills
    const resumeSkills = Array.isArray(body.resume_skills) ? body.resume_skills : body.resumeSkills

    const questions: IncomingQuestion[] = Array.isArray(body.questions) ? body.questions : []
    const answers: IncomingAnswer[] = Array.isArray(body.answers) ? body.answers : []

    const bucketWeights = typeof body.bucket_weights === "object" ? body.bucket_weights : body.bucketWeights

    const skills = buildSkillUniverse({
      jobDescription,
      coreSkills: Array.isArray(coreSkills) ? coreSkills : [],
      resumeSkills: Array.isArray(resumeSkills) ? resumeSkills : [],
    })

    const mapped = questions.map((question: IncomingQuestion) => {
      const text = String(question.text ?? question.question ?? "")
      const mapping = mapQuestionToSkill(text, skills)
      return {
        questionId: question.id ?? question.questionId ?? null,
        text,
        skill: mapping.skill,
        bucket: mapping.bucket,
      }
    })

    const coverage = computeSkillCoverage(mapped, skills)

    const scoreEntries = answers.map((answer: IncomingAnswer) => {
      const questionId = answer.questionId ?? answer.question_id
      const question = mapped.find((item) => item.questionId === questionId)
      const skill = question?.skill ?? mapQuestionToSkill(String(answer.questionText ?? ""), skills).skill
      const bucket = question?.bucket ?? bucketSkill(skill)
      const score = typeof answer.score === "number" ? answer.score : scoreAnswerForSkill(String(answer.text ?? answer.answer ?? ""), skill)

      return {
        skill,
        bucket,
        score,
      }
    })

    const profile = aggregateSkillScores(scoreEntries, bucketWeights)

    const missingSkills = coverage.remaining
    const coverageComplete = missingSkills.length === 0

    if (attemptId) {
      await upsertSkillState({
        attemptId,
        interviewId,
        organizationId,
        skillsCovered: coverage.covered,
        skillsRemaining: coverage.remaining,
      })
    }

    let stored = false
    if (body.store_profile ?? body.storeProfile) {
      await ensureSkillProfileTable()
      await prisma.$executeRaw`
        insert into public.interview_skill_profiles (
          interview_id,
          attempt_id,
          organization_id,
          skill_scores,
          strengths,
          weaknesses,
          overall_weighted_score
        )
        values (
          ${interviewId}::uuid,
          ${attemptId ?? null}::uuid,
          ${organizationId}::uuid,
          ${JSON.stringify(profile.skill_scores)}::jsonb,
          ${profile.strengths}::text[],
          ${profile.weaknesses}::text[],
          ${profile.overall_weighted_score}
        )
      `
      stored = true
    }

    return NextResponse.json({
      success: true,
      data: {
        skills,
        coverage,
        skill_scores: profile.skill_scores,
        strengths: profile.strengths,
        weaknesses: profile.weaknesses,
        overall_weighted_score: profile.overall_weighted_score,
        stored,
        warning: !coverageComplete,
        missing_skills: missingSkills,
      },
    })
  } catch (error) {
    return errorResponse(error)
  }
}
