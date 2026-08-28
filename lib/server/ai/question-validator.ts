export type ValidationResult = {
  valid: boolean
  reason?: string
}

/**
 * Role-agnostic interview question validation.
 *
 * VerisNova interviews span every industry and function, so this validator must
 * never encode assumptions about a profession. It checks the SHAPE of a
 * question (length, single focus, interview-appropriate phrasing) and never its
 * subject matter.
 *
 * Previously this file rejected anything not starting with a coding verb and
 * blocklisted specific data-engineering phrases, which silently discarded valid
 * questions for most of the roles the platform serves.
 */

/** Openings that read as a genuine interview question, in any field. */
const QUESTION_OPENINGS = [
  "how",
  "what",
  "why",
  "when",
  "where",
  "which",
  "who",
  "walk",
  // Auxiliary-verb question forms. Natural interviewer phrasing across every
  // field, e.g. "Can you describe...", "Have you had to...".
  "can you",
  "could you",
  "would you",
  "will you",
  "do you",
  "does the",
  "did you",
  "have you",
  "has there",
  "are there",
  "is there",
  "should you",
  "describe",
  "tell",
  "explain",
  "share",
  "give",
  "talk",
  "outline",
  "suppose",
  "imagine",
  "consider",
  "think",
  "in a situation",
  "if a",
  "if you",
  "your team",
  // Task-style openings for roles assessed by doing rather than describing.
  "write",
  "draft",
  "prepare",
  "calculate",
  "design",
  "plan",
  "build",
  "create",
  "implement",
  "review",
  "assess",
  "handle",
  "respond",
]

/**
 * Phrasing that leaks the source document into the question. Kept generic:
 * these are references to the candidate's paperwork, not to any field of work.
 */
const SOURCE_LEAK_PATTERNS = [
  /\byou highlighted\b/i,
  /\byour (resume|cv|profile|application)\b/i,
  /\bas (mentioned|stated|listed|noted) (in|on) your\b/i,
  /\byour background includes\b/i,
  /\byour experience includes\b/i,
  /\baccording to your\b/i,
  /\bthe job description (says|states|mentions)\b/i,
  /\bper the (jd|job description)\b/i,
]

/**
 * Filler that produces an unanswerable or unscoreable question. All are
 * content-free phrases, not domain terms.
 */
const VAGUE_PATTERNS = [
  /\bin this role\b/i,
  /\bin general\b/i,
  /\bgenerally speaking\b/i,
  /\bas a professional\b/i,
  /\btell me about yourself\b/i,
  /\bwhat are your (strengths|weaknesses)\b/i,
]

const MIN_WORDS = 6
const MAX_WORDS = 26
const MAX_CLAUSES = 3

function wordCount(value: string) {
  return value.trim().split(/\s+/).filter(Boolean).length
}

export function validateQuestionStrict(q: string): ValidationResult {
  const text = String(q ?? "").trim()

  if (!text) {
    return { valid: false, reason: "empty" }
  }

  const words = wordCount(text)
  if (words < MIN_WORDS) return { valid: false, reason: "too_short" }
  if (words > MAX_WORDS) return { valid: false, reason: "too_long" }

  const lower = text.toLowerCase()

  for (const pattern of SOURCE_LEAK_PATTERNS) {
    if (pattern.test(text)) {
      return { valid: false, reason: "source_leak" }
    }
  }

  for (const pattern of VAGUE_PATTERNS) {
    if (pattern.test(text)) {
      return { valid: false, reason: "vague" }
    }
  }

  // A question should ask one thing. Count commas as a proxy for stacked
  // clauses, but allow a couple so natural phrasing with a short scenario
  // preamble is not thrown away.
  if (text.split(",").length - 1 >= MAX_CLAUSES) {
    return { valid: false, reason: "multi_clause" }
  }

  // Reject genuinely multi-question prompts.
  if ((text.match(/\?/g) ?? []).length > 1) {
    return { valid: false, reason: "multi_question" }
  }

  const opensAsQuestion = QUESTION_OPENINGS.some((opening) => lower.startsWith(opening))
  if (!opensAsQuestion) {
    return { valid: false, reason: "bad_format" }
  }

  return { valid: true }
}
