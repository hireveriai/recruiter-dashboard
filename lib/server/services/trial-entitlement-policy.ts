/**
 * Pure entitlement policy.
 *
 * Deliberately dependency-free (no Prisma, no env, no I/O) so that the rules
 * deciding whether a workspace may spend a free credit can be unit tested
 * directly, and so that the same rules cannot drift between call sites.
 */

export const FREE_TRIAL_INTERVIEW_CREDITS = 10
export const FREE_TRIAL_SCREENING_CREDITS = 25

export const FREE_TRIAL_LIMIT_MESSAGE =
  "You’ve reached your free trial limit. Upgrade your workspace to continue conducting interviews and screenings."
export const FREE_TRIAL_NOT_ACTIVE_MESSAGE =
  "Your free trial is not active yet. We’re raising your request for 10 AI Interviews + 25 VERIS Screenings — it needs VerisNova admin approval before credits are issued."
export const FREE_TRIAL_PENDING_MESSAGE =
  "Your free trial request is waiting for VerisNova admin approval. We’ll email you and activate your 10 AI Interviews + 25 VERIS Screenings as soon as it is approved."

export type CreditBalanceSource = "trial" | "subscription"

export type RecruiterTrialStatus =
  | "NOT_REQUESTED"
  | "PENDING_REVIEW"
  | "APPROVED"
  | "REJECTED"
  | "EXPIRED"
  | "COMPLETED"

export const TRIAL_STATUSES: RecruiterTrialStatus[] = [
  "NOT_REQUESTED",
  "PENDING_REVIEW",
  "APPROVED",
  "REJECTED",
  "EXPIRED",
  "COMPLETED",
]

export function normalizeTrialStatus(value: unknown): RecruiterTrialStatus {
  const candidate = String(value ?? "").toUpperCase()
  return (TRIAL_STATUSES as string[]).includes(candidate)
    ? (candidate as RecruiterTrialStatus)
    : "NOT_REQUESTED"
}

export function normalizeCreditCount(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0
}

export type EntitlementGate =
  | { allowed: true }
  | { allowed: false; status: number; code: string; message: string }

/**
 * Only an APPROVED trial (or a paid subscription) may spend credits. A stored
 * balance on a workspace whose trial is not approved is not spendable — that
 * is the whole point of the request/review flow.
 */
export function evaluateEntitlementGate(input: {
  source: CreditBalanceSource
  trialStatus: RecruiterTrialStatus
}): EntitlementGate {
  if (input.source === "subscription" || input.trialStatus === "APPROVED") {
    return { allowed: true }
  }

  if (input.trialStatus === "PENDING_REVIEW") {
    return {
      allowed: false,
      status: 403,
      code: "FREE_TRIAL_PENDING_REVIEW",
      message: FREE_TRIAL_PENDING_MESSAGE,
    }
  }

  return {
    allowed: false,
    status: 403,
    code: "FREE_TRIAL_NOT_ACTIVE",
    message: FREE_TRIAL_NOT_ACTIVE_MESSAGE,
  }
}

/**
 * Credits visible to the client. An inactive trial reports zero regardless of
 * the stored balance, so the UI can never advertise credits that the backend
 * would refuse to spend.
 */
export function resolveVisibleCredits(input: {
  source: CreditBalanceSource
  trialStatus: RecruiterTrialStatus
  interviewCreditsRemaining: unknown
  screeningCreditsRemaining: unknown
}) {
  const active = evaluateEntitlementGate(input).allowed
  const interviewCreditsRemaining = active ? normalizeCreditCount(input.interviewCreditsRemaining) : 0
  const screeningCreditsRemaining = active ? normalizeCreditCount(input.screeningCreditsRemaining) : 0

  return {
    trialActive: active,
    interviewCreditsRemaining,
    screeningCreditsRemaining,
    canSendInterview: active && interviewCreditsRemaining > 0,
    canStartScreening: active && screeningCreditsRemaining > 0,
  }
}
