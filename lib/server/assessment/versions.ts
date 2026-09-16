import { Prisma } from "@prisma/client"

import { ApiError } from "@/lib/server/errors"
import { prisma } from "@/lib/server/prisma"
import {
  DEFAULT_AI_GENERATION_LIMIT,
  generationLimitInfo,
  generationLimitReachedError,
  type GenerationLimitInfo,
} from "@/lib/server/ai-generation-limit"

type QueryClient = typeof prisma | Prisma.TransactionClient

/**
 * Loads (or creates) the DRAFT version of an assessment that question-editing
 * endpoints should write into.
 *
 * Copy-on-write rule: once an assessment has been published, its FINALIZED
 * version must never be mutated (a candidate may already hold an invite/
 * attempt against it). The first edit after publish instead clones the
 * finalized version's questions+options into a brand new DRAFT version
 * (version_number + 1), which subsequent edits target until it too is
 * published.
 */
export async function getOrCreateDraftVersion(
  assessmentId: string,
  client: QueryClient = prisma
) {
  const existingDraft = await client.assessmentVersion.findFirst({
    where: { assessmentId, status: "DRAFT" },
    orderBy: { versionNumber: "desc" },
  })

  if (existingDraft) {
    return existingDraft
  }

  const latest = await client.assessmentVersion.findFirst({
    where: { assessmentId },
    orderBy: { versionNumber: "desc" },
    include: { questions: { include: { options: true }, orderBy: { orderIndex: "asc" } } },
  })

  const nextVersionNumber = (latest?.versionNumber ?? 0) + 1

  const newDraft = await client.assessmentVersion.create({
    data: {
      assessmentId,
      versionNumber: nextVersionNumber,
      status: "DRAFT",
    },
  })

  // Clone questions from the most recent (finalized) version, if any, so
  // editing after publish starts from what the recruiter already reviewed
  // rather than an empty version.
  if (latest && latest.questions.length > 0) {
    for (const question of latest.questions) {
      const clonedQuestion = await client.assessmentQuestion.create({
        data: {
          versionId: newDraft.id,
          questionType: question.questionType,
          questionText: question.questionText,
          points: question.points,
          orderIndex: question.orderIndex,
          required: question.required,
          rubric: question.rubric ?? Prisma.JsonNull,
          explanation: question.explanation,
          origin: question.origin,
        },
      })

      if (question.options.length > 0) {
        await client.assessmentQuestionOption.createMany({
          data: question.options.map((option) => ({
            questionId: clonedQuestion.id,
            optionText: option.optionText,
            optionOrder: option.optionOrder,
            isCorrect: option.isCorrect,
          })),
        })
      }
    }
  }

  return newDraft
}

/**
 * Reserves one AI generation attempt against the assessment's current DRAFT
 * (max 3, see lib/server/ai-generation-limit.ts). Forks a fresh DRAFT first
 * if none exists - that new draft/version starts its own allowance, since it
 * is not a continuation of a previously finalized version's count.
 *
 * The conditional `updateMany` (WHERE generationAttempts < limit) is the
 * atomic, race-safe gate: two concurrent requests can each only succeed here
 * if a slot is actually available, so at most 3 successful attempts are ever
 * authorized for one draft. Must be called BEFORE the OpenAI round trip;
 * callers must invoke releaseAssessmentGenerationAttempt if generation then
 * fails, so a provider outage does not cost the recruiter a real attempt.
 */
export async function reserveAssessmentGenerationAttempt(
  assessmentId: string
): Promise<{ versionId: string; info: GenerationLimitInfo }> {
  return prisma.$transaction(async (tx) => {
    const draft = await getOrCreateDraftVersion(assessmentId, tx)

    const updated = await tx.assessmentVersion.updateMany({
      where: { id: draft.id, generationAttempts: { lt: DEFAULT_AI_GENERATION_LIMIT } },
      data: { generationAttempts: { increment: 1 } },
    })

    if (updated.count === 0) {
      const latest = await tx.assessmentVersion.findUnique({ where: { id: draft.id } })
      throw generationLimitReachedError(latest?.generationAttempts ?? DEFAULT_AI_GENERATION_LIMIT)
    }

    const refreshed = await tx.assessmentVersion.findUniqueOrThrow({ where: { id: draft.id } })
    return { versionId: draft.id, info: generationLimitInfo(refreshed.generationAttempts) }
  })
}

/** Compensating decrement for a reserved attempt whose generation call failed before producing questions. */
export async function releaseAssessmentGenerationAttempt(versionId: string) {
  await prisma.assessmentVersion.updateMany({
    where: { id: versionId, generationAttempts: { gt: 0 } },
    data: { generationAttempts: { decrement: 1 } },
  })
}

/**
 * Resolves the DRAFT version that a question-editing request must target.
 * Throws if the given questionId/version does not belong to a DRAFT version
 * of this assessment - editing a FINALIZED version directly is never allowed.
 */
export async function requireDraftVersionForAssessment(
  assessmentId: string,
  client: QueryClient = prisma
) {
  const draft = await client.assessmentVersion.findFirst({
    where: { assessmentId, status: "DRAFT" },
    orderBy: { versionNumber: "desc" },
  })

  if (!draft) {
    throw new ApiError(
      409,
      "NO_DRAFT_VERSION",
      "This assessment has no draft version to edit. Generate or add a question first."
    )
  }

  return draft
}

/**
 * Computes a recruiter-facing integrity risk label from AssessmentSignal
 * counts for an attempt. Only ever LOW/MODERATE/HIGH RISK or REVIEW
 * RECOMMENDED - never language implying proven cheating, since signals are
 * heuristic (tab-blur counts, paste events, face-detection flags, etc.).
 */
export function computeRiskLevel(signalCount: number, highSeverityCount = 0): string {
  if (highSeverityCount > 0 || signalCount >= 8) {
    return "REVIEW RECOMMENDED"
  }

  if (signalCount >= 4) {
    return "HIGH RISK"
  }

  if (signalCount >= 1) {
    return "MODERATE RISK"
  }

  return "LOW RISK"
}
