/**
 * Recovery questionnaires.
 *
 * When an interview is legitimately interrupted AFTER the candidate has already
 * seen questions, replaying those same questions is unfair - they have had time
 * to prepare. This builds a candidate-specific alternate set.
 *
 * Rules this implements:
 *   - Candidate never saw a question  -> reuse the existing questionnaire,
 *                                        generate nothing, spend nothing.
 *   - Candidate was exposed           -> generate an alternate that avoids what
 *                                        they saw, while keeping the same
 *                                        competencies, coverage, difficulty,
 *                                        duration and evaluation framework.
 *   - Generated at most once per interview. A second recovery reuses the
 *     alternate already produced rather than generating again.
 *
 * The alternate is per candidate, not a shared "v2" - two interrupted
 * candidates were exposed to different questions and need different
 * replacements.
 *
 * Role-agnostic throughout.
 */

import { Prisma } from "@prisma/client"

import { prisma } from "@/lib/server/prisma"
import { getInterviewExposure } from "@/lib/server/interview/question-exposure"
import { generateStructuredQuestionnaire } from "@/lib/server/interview/questionnaire-generator"
import { appendInterviewQuestions } from "@/lib/server/services/job-questionnaire"

const RECOVERY_SOURCE = "recovery_alternate"

export type RecoveryQuestionnaireResult = {
  outcome:
    | "REUSED_NO_EXPOSURE"
    | "REUSED_EXISTING_ALTERNATE"
    | "GENERATED_ALTERNATE"
    | "SKIPPED_GENERATION_FAILED"
  exposedQuestionCount: number
  replacedQuestionCount: number
  openAiCalls: number
}

type InterviewJobContext = {
  interview_id: string
  job_id: string
  job_title: string | null
  job_description: string | null
  core_skills: string[] | null
  experience_level_label: string | null
  interview_duration_minutes: number | null
  resume_questions_enabled: boolean
}

async function getContext(organizationId: string, interviewId: string) {
  const rows = await prisma.$queryRaw<InterviewJobContext[]>(Prisma.sql`
    select
      i.interview_id::text,
      i.job_id::text,
      jp.job_title,
      jp.job_description,
      jp.core_skills,
      elp.label as experience_level_label,
      jp.interview_duration_minutes,
      jp.resume_questions_enabled
    from public.interviews i
    join public.job_positions jp on jp.job_id = i.job_id
    left join public.experience_level_pool elp
      on elp.experience_level_id = jp.experience_level_id
    where i.interview_id = ${interviewId}::uuid
      and i.organization_id = ${organizationId}::uuid
    limit 1
  `)

  return rows[0] ?? null
}

async function hasExistingAlternate(interviewId: string) {
  const rows = await prisma.$queryRaw<{ n: number }[]>(Prisma.sql`
    select count(*)::int as n
    from public.interview_questions
    where interview_id = ${interviewId}::uuid
      and reference_context->>'source' = ${RECOVERY_SOURCE}
  `)

  return (rows[0]?.n ?? 0) > 0
}

/**
 * Prepares the question set an interrupted candidate should receive on their
 * recovery attempt.
 *
 * Deliberately non-throwing: recovery access must not be blocked because a
 * generation call failed. If the alternate cannot be produced, the candidate
 * keeps the original questionnaire, which is the current behaviour and is far
 * better than being locked out.
 */
export async function prepareRecoveryQuestionnaire(params: {
  organizationId: string
  interviewId: string
}): Promise<RecoveryQuestionnaireResult> {
  const exposure = await getInterviewExposure(params.organizationId, params.interviewId)

  // Scenario: candidate never started, or started but never saw a question.
  // There is nothing to protect against, so reuse and spend nothing.
  if (!exposure.hasExposure) {
    return {
      outcome: "REUSED_NO_EXPOSURE",
      exposedQuestionCount: 0,
      replacedQuestionCount: 0,
      openAiCalls: 0,
    }
  }

  if (await hasExistingAlternate(params.interviewId)) {
    return {
      outcome: "REUSED_EXISTING_ALTERNATE",
      exposedQuestionCount: exposure.exposedTexts.length,
      replacedQuestionCount: 0,
      openAiCalls: 0,
    }
  }

  const context = await getContext(params.organizationId, params.interviewId)
  if (!context) {
    return {
      outcome: "SKIPPED_GENERATION_FAILED",
      exposedQuestionCount: exposure.exposedTexts.length,
      replacedQuestionCount: 0,
      openAiCalls: 0,
    }
  }

  try {
    const generated = await generateStructuredQuestionnaire({
      jobTitle: context.job_title,
      jobDescription: context.job_description,
      coreSkills: context.core_skills,
      experienceLevel: context.experience_level_label,
      durationMinutes: context.interview_duration_minutes,
      resumeQuestionsEnabled: context.resume_questions_enabled,
      // Same job, same competencies, same duration and level - only the
      // situations differ, because these must not be repeated.
      excludeQuestions: exposure.exposedTexts,
    })

    if (generated.questions.length === 0) {
      return {
        outcome: "SKIPPED_GENERATION_FAILED",
        exposedQuestionCount: exposure.exposedTexts.length,
        replacedQuestionCount: 0,
        openAiCalls: generated.openAiCalls,
      }
    }

    const replaced = await prisma.$transaction(async (tx) => {
      // Remove the unasked remainder of the STRUCTURED plan only.
      //
      // Two things are deliberately kept:
      //   - questions the candidate already saw, so the record of what they
      //     were actually asked stays intact for reporting;
      //   - resume-anchored questions, which are candidate-specific and were
      //     never compromised by the interruption. Deleting them would strip
      //     the personalised part of the interview, and recovery does not
      //     regenerate them.
      const exposedTexts = exposure.exposedTexts
      await tx.$executeRaw(Prisma.sql`
        delete from public.interview_questions
        where interview_id = ${params.interviewId}::uuid
          and coalesce(source_type, '') <> 'resume'
          and lower(regexp_replace(coalesce(question_text, ''), '\\s+', ' ', 'g')) <> all(
            ${exposedTexts.map((t) => t.toLowerCase())}::text[]
          )
      `)
      return true
    })

    const written = replaced
      ? await appendInterviewQuestions({
          organizationId: params.organizationId,
          interviewId: params.interviewId,
          questions: generated.questions.map((q) => ({
            ...q,
            competencyLabel: q.competencyLabel,
          })),
        })
      : 0

    // Tag the new rows so a second recovery reuses them instead of regenerating.
    await prisma.$executeRaw(Prisma.sql`
      update public.interview_questions
      set reference_context = jsonb_set(
        coalesce(reference_context, '{}'::jsonb),
        '{source}',
        ${JSON.stringify(RECOVERY_SOURCE)}::jsonb
      )
      where interview_id = ${params.interviewId}::uuid
        and reference_context->>'source' = 'generated'
    `)

    return {
      outcome: "GENERATED_ALTERNATE",
      exposedQuestionCount: exposure.exposedTexts.length,
      replacedQuestionCount: written,
      openAiCalls: generated.openAiCalls,
    }
  } catch (error) {
    console.error("Recovery questionnaire generation failed; keeping original questions", {
      interviewId: params.interviewId,
      error: error instanceof Error ? error.message : error,
    })

    return {
      outcome: "SKIPPED_GENERATION_FAILED",
      exposedQuestionCount: exposure.exposedTexts.length,
      replacedQuestionCount: 0,
      openAiCalls: 0,
    }
  }
}
