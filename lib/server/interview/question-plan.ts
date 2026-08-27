/**
 * Authoritative interview question plan.
 *
 * This module is the SINGLE SOURCE OF TRUTH for how many structured questions
 * an interview contains and how they are distributed. Before this existed, four
 * separate formulas disagreed (the recruiter generator, a hardcoded 10 in the
 * bulk-send route, a Postgres seeding function, and the runtime budget), so the
 * recruiter side generated questions the interview engine never asked.
 *
 * The numbers here intentionally match the interview engine's own budget
 * (calm-room `buildDeterministicInterviewBudget`), because the engine is what
 * actually governs pacing at runtime. Generating more than the engine will ask
 * is wasted AI spend.
 *
 * ROLE-AGNOSTIC. Nothing here assumes an industry, function or profession.
 * "experience", "job" and "behavioral" are generic interview constructs;
 * "resume" means candidate-supplied background, whatever the field.
 *
 * Pure functions only - no I/O, no Prisma - so this stays unit-testable.
 */

export type InterviewQuestionSource = "job" | "experience" | "behavioral" | "resume"

export type SeniorityBand = "junior" | "mid" | "senior"

export type InterviewQuestionBudget = {
  /** Structured/core questions the interview should contain. */
  totalQuestions: number
  /** Floor below which the interview is considered under-built. */
  minQuestions: number
  /** Adaptive follow-ups allowed per structured question. */
  maxFollowUpsPerQuestion: number
  /** Follow-ups the interview should aim to ask overall. */
  requiredFollowUps: number
  /** Absolute ceiling on total question interactions, including follow-ups. */
  hardTotalInteractionCap: number
}

export type InterviewQuestionDistribution = Record<InterviewQuestionSource, number>

export type InterviewQuestionPlan = InterviewQuestionBudget & {
  durationMinutes: number
  seniority: SeniorityBand
  resumeQuestionsEnabled: boolean
  distribution: InterviewQuestionDistribution
  /**
   * Questions that belong to the shared, standardised part of the interview.
   * In STANDARD mode this is what every candidate for the job receives.
   */
  structuredQuestionCount: number
  /**
   * Candidate-specific questions generated per interview from the candidate's
   * own background. Zero when resume questions are disabled for the job.
   */
  resumeQuestionCount: number
}

type BudgetRow = InterviewQuestionBudget & { minDurationMinutes: number }

/**
 * Duration -> budget. Ordered longest first; the first row whose
 * minDurationMinutes is satisfied wins.
 */
const BUDGET_TABLE: readonly BudgetRow[] = [
  { minDurationMinutes: 60, totalQuestions: 15, minQuestions: 12, maxFollowUpsPerQuestion: 2, requiredFollowUps: 3, hardTotalInteractionCap: 40 },
  { minDurationMinutes: 45, totalQuestions: 12, minQuestions: 10, maxFollowUpsPerQuestion: 2, requiredFollowUps: 3, hardTotalInteractionCap: 30 },
  { minDurationMinutes: 30, totalQuestions: 8, minQuestions: 6, maxFollowUpsPerQuestion: 2, requiredFollowUps: 2, hardTotalInteractionCap: 22 },
  { minDurationMinutes: 10, totalQuestions: 4, minQuestions: 3, maxFollowUpsPerQuestion: 2, requiredFollowUps: 2, hardTotalInteractionCap: 10 },
]

const FALLBACK_BUDGET: InterviewQuestionBudget = {
  totalQuestions: 4,
  minQuestions: 2,
  maxFollowUpsPerQuestion: 1,
  requiredFollowUps: 1,
  hardTotalInteractionCap: 8,
}

export const DEFAULT_INTERVIEW_DURATION_MINUTES = 30

/**
 * Weighting of the structured interview by seniority. Senior interviews lean
 * further into judgement and ownership; junior interviews lean further into
 * direct experience. These are interview-design weights, not role categories.
 */
const DISTRIBUTION_WEIGHTS: Record<SeniorityBand, Record<InterviewQuestionSource, number>> = {
  junior: { job: 0.40, experience: 0.20, behavioral: 0.20, resume: 0.20 },
  mid:    { job: 0.45, experience: 0.15, behavioral: 0.25, resume: 0.15 },
  senior: { job: 0.45, experience: 0.10, behavioral: 0.30, resume: 0.15 },
}

/** Resume-anchored questions are capped so the shared core stays dominant. */
const MAX_RESUME_QUESTIONS = 2

export function normalizeDurationMinutes(value: unknown): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_INTERVIEW_DURATION_MINUTES
  }
  return Math.floor(parsed)
}

export function resolveSeniorityBand(value: unknown): SeniorityBand {
  const normalized = String(value ?? "").toLowerCase().trim()
  if (!normalized) return "mid"
  if (/\b(senior|sr|lead|principal|staff|head|director|chief|vp|architect|manager)\b/.test(normalized)) {
    return "senior"
  }
  if (/\b(junior|jr|entry|entry-level|associate|graduate|fresher|intern|trainee|apprentice)\b/.test(normalized)) {
    return "junior"
  }
  return "mid"
}

export function resolveQuestionBudget(durationMinutes: unknown): InterviewQuestionBudget {
  const duration = normalizeDurationMinutes(durationMinutes)
  const row = BUDGET_TABLE.find((entry) => duration >= entry.minDurationMinutes)

  if (!row) {
    return { ...FALLBACK_BUDGET }
  }

  const { minDurationMinutes: _ignored, ...budget } = row
  return { ...budget }
}

/**
 * Distributes a total across sources using the seniority weights, giving any
 * rounding remainder to the largest fractional parts so the counts always sum
 * back to the total exactly.
 */
export function resolveQuestionDistribution(input: {
  totalQuestions: number
  seniority: SeniorityBand
  resumeQuestionsEnabled: boolean
}): InterviewQuestionDistribution {
  const total = Math.max(0, Math.floor(input.totalQuestions))
  const empty: InterviewQuestionDistribution = { job: 0, experience: 0, behavioral: 0, resume: 0 }

  if (total === 0) return empty

  const weights = { ...DISTRIBUTION_WEIGHTS[input.seniority] }

  if (!input.resumeQuestionsEnabled) {
    // Redistribute the resume share proportionally across the shared core.
    const resumeShare = weights.resume
    weights.resume = 0
    const remaining = weights.job + weights.experience + weights.behavioral
    if (remaining > 0) {
      weights.job += (resumeShare * weights.job) / remaining
      weights.experience += (resumeShare * weights.experience) / remaining
      weights.behavioral += (resumeShare * weights.behavioral) / remaining
    }
  }

  const sources: InterviewQuestionSource[] = ["job", "experience", "behavioral", "resume"]
  const exact = sources.map((source) => ({ source, value: total * weights[source] }))
  const counts: InterviewQuestionDistribution = { ...empty }

  for (const entry of exact) {
    counts[entry.source] = Math.floor(entry.value)
  }

  if (input.resumeQuestionsEnabled) {
    counts.resume = Math.min(counts.resume, MAX_RESUME_QUESTIONS)
  }

  let assigned = sources.reduce((sum, source) => sum + counts[source], 0)

  const byRemainder = [...exact]
    .map((entry) => ({ source: entry.source, remainder: entry.value - Math.floor(entry.value) }))
    .sort((a, b) => b.remainder - a.remainder)

  let cursor = 0
  while (assigned < total) {
    const candidate = byRemainder[cursor % byRemainder.length].source
    cursor += 1

    // Never let rounding push resume questions past their cap, and never
    // allocate resume questions when they are disabled.
    if (candidate === "resume" && (!input.resumeQuestionsEnabled || counts.resume >= MAX_RESUME_QUESTIONS)) {
      if (cursor > byRemainder.length * 2) {
        counts.job += total - assigned
        assigned = total
        break
      }
      continue
    }

    counts[candidate] += 1
    assigned += 1
  }

  return counts
}

/**
 * The one call every other part of the platform should use.
 */
export function resolveInterviewQuestionPlan(input: {
  durationMinutes?: unknown
  experienceLevel?: unknown
  resumeQuestionsEnabled?: boolean
}): InterviewQuestionPlan {
  const durationMinutes = normalizeDurationMinutes(input.durationMinutes)
  const seniority = resolveSeniorityBand(input.experienceLevel)
  const resumeQuestionsEnabled = input.resumeQuestionsEnabled !== false
  const budget = resolveQuestionBudget(durationMinutes)
  const distribution = resolveQuestionDistribution({
    totalQuestions: budget.totalQuestions,
    seniority,
    resumeQuestionsEnabled,
  })

  return {
    ...budget,
    durationMinutes,
    seniority,
    resumeQuestionsEnabled,
    distribution,
    structuredQuestionCount: distribution.job + distribution.experience + distribution.behavioral,
    resumeQuestionCount: distribution.resume,
  }
}
