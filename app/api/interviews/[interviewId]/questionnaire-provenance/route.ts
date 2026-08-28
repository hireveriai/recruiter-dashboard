import { Prisma } from "@prisma/client"

import { getRecruiterRequestContext } from "@/lib/server/auth-context"
import { ApiError } from "@/lib/server/errors"
import { getInterviewExposure } from "@/lib/server/interview/question-exposure"
import { prisma } from "@/lib/server/prisma"
import { errorResponse, successResponse } from "@/lib/server/response"

type Params = { params: Promise<{ interviewId: string }> }

/**
 * Questionnaire provenance for one interview.
 *
 * Answers, for audit and reporting: which questionnaire version was used, what
 * the candidate was actually asked across every attempt, which of those they
 * answered, and whether a recovery alternate was involved.
 *
 * This stays correct after a recruiter edits the job questionnaire, because an
 * interview holds a snapshot rather than a reference to the live version.
 */
export async function GET(request: Request, context: Params) {
  try {
    const auth = await getRecruiterRequestContext(request)
    const { interviewId } = await context.params

    const rows = await prisma.$queryRaw<
      Array<{
        interview_id: string
        job_id: string
        job_title: string | null
        interview_mode: string | null
        questionnaire_version_id: string | null
        questionnaire_snapshot_at: Date | null
        version_number: number | null
        version_status: string | null
        generated_by: string | null
      }>
    >(Prisma.sql`
      select
        i.interview_id::text,
        i.job_id::text,
        jp.job_title,
        jp.interview_mode,
        i.questionnaire_version_id::text,
        i.questionnaire_snapshot_at,
        v.version_number,
        v.status as version_status,
        v.generated_by
      from public.interviews i
      join public.job_positions jp on jp.job_id = i.job_id
      left join public.job_questionnaire_versions v
        on v.questionnaire_version_id = i.questionnaire_version_id
      where i.interview_id = ${interviewId}::uuid
        and i.organization_id = ${auth.organizationId}::uuid
      limit 1
    `)

    const interview = rows[0]
    if (!interview) {
      throw new ApiError(404, "INTERVIEW_NOT_FOUND", "Interview not found for this organization")
    }

    const planned = await prisma.$queryRaw<
      Array<{
        interview_question_id: string
        question_order: number
        question_text: string | null
        source_type: string | null
        origin_source: string | null
      }>
    >(Prisma.sql`
      select
        interview_question_id::text,
        question_order,
        question_text,
        source_type,
        reference_context->>'source' as origin_source
      from public.interview_questions
      where interview_id = ${interviewId}::uuid
      order by question_order
    `)

    const exposure = await getInterviewExposure(auth.organizationId, interviewId)

    const recoveryEvents = await prisma.$queryRaw<
      Array<{ event_type: string; reason: string | null; occurred_at: Date }>
    >(Prisma.sql`
      select event_type, reason, occurred_at
      from public.interview_recovery_events
      where interview_id = ${interviewId}::uuid
      order by occurred_at asc
    `)

    return successResponse({
      interviewId: interview.interview_id,
      jobId: interview.job_id,
      jobTitle: interview.job_title,
      interviewMode: interview.interview_mode,
      questionnaire: interview.questionnaire_version_id
        ? {
            questionnaireVersionId: interview.questionnaire_version_id,
            versionNumber: interview.version_number,
            versionStatus: interview.version_status,
            generatedBy: interview.generated_by,
            snapshotAt: interview.questionnaire_snapshot_at,
          }
        : null,
      usedRecoveryAlternate: planned.some((q) => q.origin_source === "recovery_alternate"),
      plannedQuestions: planned.map((q) => ({
        interviewQuestionId: q.interview_question_id,
        questionOrder: q.question_order,
        questionText: q.question_text,
        sourceType: q.source_type,
        originSource: q.origin_source,
      })),
      exposure: {
        attemptCount: exposure.attemptCount,
        presentedCount: exposure.exposedQuestions.length,
        distinctPresentedCount: exposure.exposedTexts.length,
        answeredCount: exposure.answeredCount,
        presented: exposure.exposedQuestions,
      },
      recoveryEvents,
    })
  } catch (error) {
    return errorResponse(error)
  }
}
