/**
 * Server-enforced usage limit on AI question generation for VERIS AI
 * Interview questionnaires and VERIS Assessments.
 *
 * This is a resource-consumption guard, not a credit/billing concept: it is
 * fully separate from interview/assessment/screening credits. Manual editing,
 * publishing, and everything else stays unlimited - only the AI
 * generate/regenerate call itself is gated.
 *
 * The limit lives on the DRAFT/version row being generated into
 * (job_questionnaire_versions.generation_attempts,
 * assessment_versions.generation_attempts), so a new draft forked after a
 * version is finalized gets its own fresh allowance - this is deliberately
 * not a lifetime or per-recruiter limit.
 */

import { Prisma } from "@prisma/client"

import { ApiError } from "@/lib/server/errors"
import { prisma } from "@/lib/server/prisma"

export const DEFAULT_AI_GENERATION_LIMIT = 3
export const DEFAULT_AI_FEEDBACK_GENERATION_LIMIT = 3

export type GenerationLimitInfo = {
  generationLimit: number
  generationAttempts: number
  remainingGenerations: number
  canGenerate: boolean
}

export function generationLimitInfo(attempts: number, limit = DEFAULT_AI_GENERATION_LIMIT): GenerationLimitInfo {
  return {
    generationLimit: limit,
    generationAttempts: attempts,
    remainingGenerations: Math.max(0, limit - attempts),
    canGenerate: attempts < limit,
  }
}

export function generationLimitReachedError(attempts: number, limit = DEFAULT_AI_GENERATION_LIMIT) {
  return new ApiError(
    409,
    "AI_GENERATION_LIMIT_REACHED",
    `You have used all ${limit} AI question generation attempts for this draft. You can continue editing the questions manually.`,
    generationLimitInfo(attempts, limit)
  )
}

export type FeedbackGenerationLimitInfo = {
  feedbackGenerationLimit: number
  feedbackGenerationAttempts: number
  remainingFeedbackGenerations: number
  canRegenerateFeedback: boolean
}

export function feedbackGenerationLimitInfo(
  attempts: number,
  limit = DEFAULT_AI_FEEDBACK_GENERATION_LIMIT
): FeedbackGenerationLimitInfo {
  return {
    feedbackGenerationLimit: limit,
    feedbackGenerationAttempts: attempts,
    remainingFeedbackGenerations: Math.max(0, limit - attempts),
    canRegenerateFeedback: attempts < limit,
  }
}

export function feedbackGenerationLimitReachedError(
  attempts: number,
  limit = DEFAULT_AI_FEEDBACK_GENERATION_LIMIT
) {
  return new ApiError(
    409,
    "AI_FEEDBACK_GENERATION_LIMIT_REACHED",
    `You've used all ${limit} AI feedback generation attempts for this interview. You can continue reviewing the existing feedback and adding recruiter notes.`,
    feedbackGenerationLimitInfo(attempts, limit)
  )
}

type IdempotencyEntityType = "job_questionnaire" | "assessment" | "candidate_feedback"

/**
 * Looks up a previously-cached result for this exact (entity, idempotency
 * key) pair. A retried request (double-click, browser/network retry) replays
 * the original response instead of generating again or re-touching the
 * attempt counter.
 */
export async function findIdempotentGenerationResult<T = unknown>(
  entityType: IdempotencyEntityType,
  entityId: string,
  idempotencyKey: string | null | undefined
): Promise<T | null> {
  if (!idempotencyKey) return null

  const rows = await prisma.$queryRaw<{ result: T }[]>(Prisma.sql`
    select result
    from public.ai_generation_idempotency
    where entity_type = ${entityType}
      and entity_id = ${entityId}::uuid
      and idempotency_key = ${idempotencyKey}
    limit 1
  `)

  return rows[0]?.result ?? null
}

/** Caches a generation result so a retry with the same idempotency key can replay it. */
export async function storeIdempotentGenerationResult(
  entityType: IdempotencyEntityType,
  entityId: string,
  idempotencyKey: string | null | undefined,
  result: unknown
) {
  if (!idempotencyKey) return

  await prisma.$executeRaw(Prisma.sql`
    insert into public.ai_generation_idempotency (entity_type, entity_id, idempotency_key, result)
    values (${entityType}::text, ${entityId}::uuid, ${idempotencyKey}, ${JSON.stringify(result)}::jsonb)
    on conflict (entity_type, entity_id, idempotency_key) do nothing
  `)
}
