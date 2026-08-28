/**
 * Question exposure ledger.
 *
 * Answers "which questions has this candidate already seen?" across EVERY
 * attempt on an interview, not just the current one.
 *
 * This did not exist before. A recovery attempt starts with no session_questions
 * of its own, so the interview engine saw an empty history and re-asked the
 * planned questions from the top - meaning an interrupted candidate was served
 * the questions they had already answered.
 *
 * Exposure is read from session_questions, which records what was actually
 * presented, rather than inferred from answer count: a question shown moments
 * before a disconnection was seen by the candidate even though no answer was
 * ever stored.
 *
 * Role-agnostic: this module only moves text and identifiers around.
 */

import { Prisma } from "@prisma/client"

import { prisma } from "@/lib/server/prisma"

export type ExposedQuestion = {
  questionText: string
  questionKind: string | null
  attemptId: string
  answered: boolean
  interviewQuestionId: string | null
}

export type InterviewExposure = {
  interviewId: string
  attemptCount: number
  exposedQuestions: ExposedQuestion[]
  /** Distinct question text the candidate has seen, in the order first shown. */
  exposedTexts: string[]
  answeredCount: number
  /** True when the candidate has seen at least one question on any attempt. */
  hasExposure: boolean
}

function normalize(value: string) {
  return value.replace(/\s+/g, " ").trim()
}

export async function getInterviewExposure(
  organizationId: string,
  interviewId: string
): Promise<InterviewExposure> {
  const rows = await prisma.$queryRaw<
    Array<{
      question_text: string
      question_kind: string | null
      attempt_id: string
      answered: boolean
      interview_question_id: string | null
    }>
  >(Prisma.sql`
    select
      sq.content as question_text,
      sq.question_kind,
      sq.attempt_id::text,
      exists (
        select 1
        from public.interview_answers ans
        where ans.session_question_id = sq.session_question_id
          and nullif(trim(coalesce(ans.answer_text, '')), '') is not null
      ) as answered,
      sq.interview_question_id::text
    from public.session_questions sq
    join public.interview_attempts ia
      on ia.attempt_id = sq.attempt_id
    join public.interviews i
      on i.interview_id = ia.interview_id
    where ia.interview_id = ${interviewId}::uuid
      and i.organization_id = ${organizationId}::uuid
      and nullif(trim(coalesce(sq.content, '')), '') is not null
    order by ia.attempt_number asc, sq.question_order asc nulls last, sq.asked_at asc
  `)

  const attemptIds = new Set<string>()
  const seenText = new Set<string>()
  const exposedTexts: string[] = []
  let answeredCount = 0

  const exposedQuestions = rows.map((row) => {
    attemptIds.add(row.attempt_id)
    if (row.answered) answeredCount += 1

    const text = normalize(row.question_text)
    const key = text.toLowerCase()
    if (text && !seenText.has(key)) {
      seenText.add(key)
      exposedTexts.push(text)
    }

    return {
      questionText: text,
      questionKind: row.question_kind,
      attemptId: row.attempt_id,
      answered: row.answered,
      interviewQuestionId: row.interview_question_id,
    }
  })

  return {
    interviewId,
    attemptCount: attemptIds.size,
    exposedQuestions,
    exposedTexts,
    answeredCount,
    hasExposure: exposedTexts.length > 0,
  }
}

/**
 * Questions this candidate has already seen for this job, including on earlier
 * interviews for the same job. Used when issuing a replacement link so a retake
 * is not a rerun.
 */
export async function getCandidateJobExposure(params: {
  organizationId: string
  jobId: string
  candidateId: string
  excludeInterviewId?: string
}) {
  const rows = await prisma.$queryRaw<Array<{ question_text: string }>>(Prisma.sql`
    select distinct sq.content as question_text
    from public.session_questions sq
    join public.interview_attempts ia on ia.attempt_id = sq.attempt_id
    join public.interviews i on i.interview_id = ia.interview_id
    where i.organization_id = ${params.organizationId}::uuid
      and i.job_id = ${params.jobId}::uuid
      and i.candidate_id = ${params.candidateId}::uuid
      ${
        params.excludeInterviewId
          ? Prisma.sql`and i.interview_id <> ${params.excludeInterviewId}::uuid`
          : Prisma.empty
      }
      and nullif(trim(coalesce(sq.content, '')), '') is not null
    limit 200
  `)

  return rows.map((row) => normalize(row.question_text)).filter(Boolean)
}
