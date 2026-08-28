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
