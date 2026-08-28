/**
 * Builds the question set for one interview, according to the job's interview
 * mode.
 *
 *   STANDARD        structured core comes from the job's finalized questionnaire
 *                   version (generated once per job, snapshotted per interview,
 *                   ZERO OpenAI calls per candidate) plus candidate-specific
 *                   resume questions.
 *
 *   INDIVIDUALIZED  structured core is generated for this candidate, plus
 *                   candidate-specific resume questions. Still aligned to the
 *                   same job requirements, duration, seniority and plan.
 *
 * Both modes preserve resume-anchored questions and neither touches adaptive
 * follow-ups, which remain the interview engine's responsibility at runtime.
 *
 * Role-agnostic throughout.
 */

import {
  generateResumeQuestions,
  generateStructuredQuestionnaire,
} from "@/lib/server/interview/questionnaire-generator"
import { Prisma } from "@prisma/client"

import { prisma } from "@/lib/server/prisma"
import { resolveInterviewQuestionPlan } from "@/lib/server/interview/question-plan"
import {
  appendInterviewQuestions,
  ensureFinalizedQuestionnaireVersion,
  getJobQuestionnaireContext,
  resolveInterviewMode,
  snapshotVersionToInterview,
} from "@/lib/server/services/job-questionnaire"

export type PrepareQuestionsResult = {
  mode: "STANDARD" | "INDIVIDUALIZED"
  questionnaireVersionId: string | null
  structuredQuestionCount: number
  resumeQuestionCount: number
  openAiCalls: number
  generatedQuestionnaire: boolean
}

/**
 * Copies the structured questions from this candidate's most recent earlier
 * interview for the same job, but ONLY when that interview never presented a
 * single question.
 *
 * This is the "link expired before they started, here is a new one" case: the
 * candidate has seen nothing, so there is no reason to build a different
 * interview or pay for one. Returns 0 when there is nothing safe to reuse, and
 * the caller generates instead.
 */
async function reusePriorUnexposedQuestions(params: {
  organizationId: string
  jobId: string
  interviewId: string
}) {
  const rows = await prisma.$queryRaw<Array<{ prior_interview_id: string }>>(Prisma.sql`
    select prior.interview_id::text as prior_interview_id
    from public.interviews prior
    join public.interviews current
      on current.interview_id = ${params.interviewId}::uuid
     and current.candidate_id = prior.candidate_id
    where prior.organization_id = ${params.organizationId}::uuid
      and prior.job_id = ${params.jobId}::uuid
      and prior.interview_id <> ${params.interviewId}::uuid
      and exists (
        select 1 from public.interview_questions q
        where q.interview_id = prior.interview_id
      )
      -- never presented a question on any attempt
      and not exists (
        select 1
        from public.interview_attempts ia
        join public.session_questions sq on sq.attempt_id = ia.attempt_id
        where ia.interview_id = prior.interview_id
      )
    order by prior.created_at desc
    limit 1
  `)

  const prior = rows[0]?.prior_interview_id
  if (!prior) return 0

  return prisma.$executeRaw(Prisma.sql`
    insert into public.interview_questions (
      interview_id, question_order, question_text, question_type, source_type,
      reference_context, is_dynamic, phase_hint, difficulty_level,
      is_mandatory, allow_follow_up, source_questionnaire_question_id
    )
    select
      ${params.interviewId}::uuid,
      q.question_order, q.question_text, q.question_type, q.source_type,
      coalesce(q.reference_context, '{}'::jsonb) || jsonb_build_object('reused_from_interview', ${prior}),
      q.is_dynamic, q.phase_hint, q.difficulty_level,
      q.is_mandatory, q.allow_follow_up, q.source_questionnaire_question_id
    from public.interview_questions q
    where q.interview_id = ${prior}::uuid
      and coalesce(q.source_type, '') <> 'resume'
    order by q.question_order
  `)
}

export async function prepareInterviewQuestionSet(params: {
  organizationId: string
  jobId: string
  interviewId: string
  candidateBackground?: string | null
  createdBy?: string | null
  /** Questions already shown to this candidate; used for recovery variants. */
  excludeQuestions?: string[]
}): Promise<PrepareQuestionsResult> {
  const job = await getJobQuestionnaireContext(params.organizationId, params.jobId)
  const mode = resolveInterviewMode(job.interview_mode)
  const plan = resolveInterviewQuestionPlan({
    durationMinutes: job.interview_duration_minutes,
    experienceLevel: job.experience_level_label,
    resumeQuestionsEnabled: job.resume_questions_enabled,
  })

  let openAiCalls = 0
  let questionnaireVersionId: string | null = null
  let structuredQuestionCount = 0
  let generatedQuestionnaire = false

  if (mode === "STANDARD") {
    const { version, generated, openAiCalls: generationCalls } =
      await ensureFinalizedQuestionnaireVersion({
        organizationId: params.organizationId,
        jobId: params.jobId,
        createdBy: params.createdBy,
      })

    openAiCalls += generationCalls
    generatedQuestionnaire = generated
    questionnaireVersionId = version.questionnaire_version_id

    structuredQuestionCount = await snapshotVersionToInterview({
      organizationId: params.organizationId,
      interviewId: params.interviewId,
      versionId: version.questionnaire_version_id,
    })
  } else {
    // A replacement link for a candidate who never saw any questions should
    // reuse what was already prepared. Regenerating would cost a call and give
    // them a different interview for no reason.
    const reused = await reusePriorUnexposedQuestions({
      organizationId: params.organizationId,
      jobId: params.jobId,
      interviewId: params.interviewId,
    })

    if (reused > 0) {
      structuredQuestionCount = reused
      generatedQuestionnaire = false
    } else {
      const generation = await generateStructuredQuestionnaire({
        jobTitle: job.job_title,
        jobDescription: job.job_description,
        coreSkills: job.core_skills,
        experienceLevel: job.experience_level_label,
        durationMinutes: job.interview_duration_minutes,
        resumeQuestionsEnabled: job.resume_questions_enabled,
        excludeQuestions: params.excludeQuestions,
      })

      openAiCalls += generation.openAiCalls
      generatedQuestionnaire = true

      structuredQuestionCount = await appendInterviewQuestions({
        organizationId: params.organizationId,
        interviewId: params.interviewId,
        questions: generation.questions,
      })
    }
  }

  // Candidate-specific resume questions - preserved in BOTH modes.
  let resumeQuestionCount = 0

  if (job.resume_questions_enabled && plan.resumeQuestionCount > 0) {
    const resume = await generateResumeQuestions({
      jobTitle: job.job_title,
      jobDescription: job.job_description,
      experienceLevel: job.experience_level_label,
      candidateBackground: params.candidateBackground,
      questionCount: plan.resumeQuestionCount,
      excludeQuestions: params.excludeQuestions,
    })

    openAiCalls += resume.openAiCalls

    resumeQuestionCount = await appendInterviewQuestions({
      organizationId: params.organizationId,
      interviewId: params.interviewId,
      questions: resume.questions,
    })
  }

  return {
    mode,
    questionnaireVersionId,
    structuredQuestionCount,
    resumeQuestionCount,
    openAiCalls,
    generatedQuestionnaire,
  }
}
