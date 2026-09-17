import { Prisma } from "@prisma/client"

import { ApiError } from "@/lib/server/errors"
import { prisma } from "@/lib/server/prisma"

/**
 * VERIS Assessment credits — a deliberately standalone module, separate from
 * lib/server/services/trial-credits.ts (INTERVIEW/SCREENING). It reuses the
 * same tables/columns (`verisnova_user_subscriptions.assessmentCredits`,
 * `workspace_trial_credits.assessment_credits_remaining`) and the same
 * atomic-conditional-UPDATE concurrency pattern, but does not modify or share
 * code with the existing interview/screening credit paths, so their behavior
 * is unaffected by this feature.
 */

type QueryClient = typeof prisma | Prisma.TransactionClient

export type AssessmentCreditSnapshot = {
  organizationId: string
  assessmentCreditsRemaining: number
  canRunAssessment: boolean
  source: "trial" | "subscription"
  subscriptionId?: string | null
}

function normalizeCount(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0
}

async function getActiveSubscriptionAssessmentCredits(
  organizationId: string,
  client: QueryClient = prisma,
): Promise<AssessmentCreditSnapshot | null> {
  const rows = await client.$queryRaw<
    { id: string; assessment_credits_remaining: number }[]
  >(Prisma.sql`
    select id, "assessmentCredits" as assessment_credits_remaining
    from public.verisnova_user_subscriptions
    where "organizationId" = ${organizationId}::uuid
      and lower(coalesce(status, '')) = 'active'
    order by "activatedAt" desc nulls last, "updatedAt" desc nulls last
    limit 1
  `).catch((error) => {
    console.warn("Assessment subscription credit read skipped", error)
    return [] as { id: string; assessment_credits_remaining: number }[]
  })

  const row = rows[0]
  if (!row) return null

  const assessmentCreditsRemaining = normalizeCount(row.assessment_credits_remaining)
  return {
    organizationId,
    assessmentCreditsRemaining,
    canRunAssessment: assessmentCreditsRemaining > 0,
    source: "subscription",
    subscriptionId: row.id,
  }
}

async function getTrialAssessmentCredits(
  organizationId: string,
  client: QueryClient = prisma,
): Promise<AssessmentCreditSnapshot> {
  const rows = await client.$queryRaw<
    { assessment_credits_remaining: number; trial_status: string | null }[]
  >(Prisma.sql`
    select assessment_credits_remaining, trial_status
    from public.workspace_trial_credits
    where organization_id = ${organizationId}::uuid
    limit 1
  `).catch((error) => {
    console.warn("Assessment trial credit read skipped", error)
    return [] as { assessment_credits_remaining: number; trial_status: string | null }[]
  })

  const row = rows[0]
  const remaining = row ? normalizeCount(row.assessment_credits_remaining) : 0
  const active = row?.trial_status === "APPROVED"

  return {
    organizationId,
    assessmentCreditsRemaining: remaining,
    canRunAssessment: active && remaining > 0,
    source: "trial",
  }
}

/** Read-only balance check — used for the recruiter-facing "credits remaining" display and the soft pre-send warning. */
export async function getAssessmentCreditSnapshot(
  organizationId: string,
  client: QueryClient = prisma,
): Promise<AssessmentCreditSnapshot> {
  const subscriptionCredits = await getActiveSubscriptionAssessmentCredits(organizationId, client)
  if (subscriptionCredits) return subscriptionCredits
  return getTrialAssessmentCredits(organizationId, client)
}

export async function assertAssessmentCreditAvailable(organizationId: string) {
  const snapshot = await getAssessmentCreditSnapshot(organizationId)
  if (!snapshot.canRunAssessment) {
    throw new ApiError(
      402,
      "ASSESSMENT_CREDITS_EXHAUSTED",
      "No VERIS Assessment credits remaining for this workspace.",
    )
  }
  return snapshot
}

/**
 * Deducts exactly one Assessment credit. Must be called only once per
 * completed attempt, guarded by the caller transitioning
 * assessment_attempts.status atomically (IN_PROGRESS -> SUBMITTED) in the
 * same transaction, so a duplicate submit never double-charges.
 */
export async function deductAssessmentCredit(input: {
  organizationId: string
  amount?: number
  source?: string | null
  sourceId?: string | null
}) {
  const amount = input.amount ?? 1

  return prisma.$transaction(async (tx) => {
    const subscriptionRows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
      update public.verisnova_user_subscriptions
      set
        "assessmentCredits" = "assessmentCredits" - ${amount},
        "updatedAt" = now()
      where "organizationId" = ${input.organizationId}::uuid
        and lower(coalesce(status, '')) = 'active'
        and "assessmentCredits" >= ${amount}
      returning id
    `)

    let deductedFrom: "subscription" | "trial" | null = subscriptionRows[0] ? "subscription" : null

    if (!deductedFrom) {
      const trialRows = await tx.$queryRaw<{ organization_id: string }[]>(Prisma.sql`
        update public.workspace_trial_credits
        set
          assessment_credits_remaining = assessment_credits_remaining - ${amount},
          updated_at = now()
        where organization_id = ${input.organizationId}::uuid
          and trial_status = 'APPROVED'
          and assessment_credits_remaining >= ${amount}
        returning organization_id::text
      `)
      if (trialRows[0]) deductedFrom = "trial"
    }

    if (!deductedFrom) {
      throw new ApiError(
        402,
        "ASSESSMENT_CREDITS_EXHAUSTED",
        "No VERIS Assessment credits remaining for this workspace.",
      )
    }

    await tx.$executeRaw(Prisma.sql`
      insert into public.assessment_credit_events (
        organization_id, kind, amount, source, source_id, metadata
      )
      values (
        ${input.organizationId}::uuid,
        'ASSESSMENT',
        ${amount},
        ${input.source ?? null},
        ${input.sourceId ?? null},
        jsonb_build_object('deductedFrom', ${deductedFrom})
      )
    `)

    return { deductedFrom }
  })
}
