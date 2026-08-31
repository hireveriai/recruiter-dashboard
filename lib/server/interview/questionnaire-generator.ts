/**
 * Role-agnostic interview questionnaire generation.
 *
 * Produces the STRUCTURED CORE of an interview - the part that is shared by
 * every candidate in STANDARD mode, or generated per candidate in
 * INDIVIDUALIZED mode. Resume-anchored questions are generated separately and
 * per candidate; see generateResumeQuestions.
 *
 * GLOBAL PLATFORM REQUIREMENT
 * VerisNova serves every industry and function. This module must never assume a
 * profession. The prompt describes interview STRUCTURE and takes all subject
 * matter from recruiter-supplied job data. There are no worked examples from any
 * particular field, because examples steer the model's vocabulary.
 *
 * Variation: temperature is 0 and there is no run salt. The previous generator
 * injected `UNIQUE RUN ID: Date.now()` and explicitly asked for "fresh
 * variations", which forced a different questionnaire on every call. That is
 * removed - but note the model is still not guaranteed reproducible, so two
 * generations of the same job can differ. Consistency across candidates comes
 * from PERSISTING one finalized version and snapshotting it, never from
 * regenerating and hoping for the same output.
 */

import { openAiFetch } from "@/lib/server/ai-usage-log"
import { validateQuestionStrict } from "@/lib/server/ai/question-validator"
import {
  resolveInterviewQuestionPlan,
  type InterviewQuestionPlan,
  type InterviewQuestionSource,
} from "@/lib/server/interview/question-plan"

export const QUESTIONNAIRE_MODEL = process.env.OPENAI_QUESTION_MODEL || "gpt-4o-mini"

const OPENAI_URL = "https://api.openai.com/v1/chat/completions"
const REQUEST_TIMEOUT_MS = Number(process.env.INTERVIEW_QUESTION_TIMEOUT_MS ?? 45000)

export type GeneratedQuestion = {
  questionText: string
  sourceType: InterviewQuestionSource
  competencyLabel: string
  questionType: string
  difficultyLevel: number
  phaseHint: string
  evaluationCriteria: string
}

export type QuestionnaireGenerationInput = {
  jobTitle?: string | null
  jobDescription?: string | null
  coreSkills?: string[] | null
  experienceLevel?: string | null
  durationMinutes?: number | null
  resumeQuestionsEnabled?: boolean
  /**
   * Questions the candidate has already been exposed to. Used only for recovery
   * questionnaires, where the replacement set must avoid what was already asked.
   */
  excludeQuestions?: string[]
}

export type QuestionnaireGenerationResult = {
  questions: GeneratedQuestion[]
  plan: InterviewQuestionPlan
  model: string
  openAiCalls: number
  usedFallback: boolean
}

export class QuestionnaireGenerationError extends Error {
  // Declared as a field rather than a constructor parameter property: the
  // repo's test runner strips types without transforming, and parameter
  // properties are unsupported there.
  reason: unknown

  constructor(message: string, reason?: unknown) {
    super(message)
    this.name = "QuestionnaireGenerationError"
    this.reason = reason
  }
}

function getApiKey() {
  return (process.env.OPENAI_API_KEY ?? "").trim().replace(/^"|"$/g, "")
}

function clampDifficulty(value: unknown) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 3
  return Math.min(5, Math.max(1, Math.round(parsed)))
}

function normalizePhase(value: unknown, index: number, total: number) {
  const allowed = ["warmup", "core", "probe", "closing"]
  const raw = String(value ?? "").toLowerCase().trim()
  if (allowed.includes(raw)) return raw
  const progress = total > 0 ? (index + 1) / total : 1
  if (progress <= 0.2) return "warmup"
  if (progress <= 0.75) return "core"
  return "probe"
}

function normalizeSource(value: unknown): InterviewQuestionSource {
  const raw = String(value ?? "").toLowerCase().trim()
  if (raw === "experience" || raw === "behavioral" || raw === "resume") return raw
  return "job"
}

/**
 * The response contract. Using a JSON schema removes the parse-and-retry loop
 * the previous generator relied on, which burned extra OpenAI calls whenever the
 * model returned prose around its JSON.
 */
const RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["questions"],
  properties: {
    questions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "question_text",
          "source_type",
          "competency_label",
          "difficulty_level",
          "phase_hint",
          "evaluation_criteria",
        ],
        properties: {
          question_text: { type: "string" },
          source_type: { type: "string", enum: ["job", "experience", "behavioral"] },
          competency_label: { type: "string" },
          difficulty_level: { type: "integer" },
          phase_hint: { type: "string", enum: ["warmup", "core", "probe"] },
          evaluation_criteria: { type: "string" },
        },
      },
    },
  },
} as const

function buildSystemPrompt() {
  return [
    "You design structured interview questionnaires for hiring teams.",
    "You work across every industry, profession and job function: healthcare, education, logistics, hospitality, finance, trades, public sector, retail, manufacturing, creative, technology and any other field.",
    "",
    "CRITICAL: Infer everything about the role from the supplied job data alone.",
    "Never assume the role is technical. Never introduce vocabulary from a field the job data does not mention.",
    "Use the terminology a practitioner of THIS role would actually use.",
    "",
    "QUESTION RULES",
    "- Each question assesses exactly one competency.",
    "- 8 to 22 words. Plain, spoken language a candidate hears clearly.",
    "- Ground each question in a realistic situation someone in this role would face.",
    "- Vary the situation: time pressure, competing priorities, ambiguity, limited information, a mistake to put right, a difficult person, a quality or safety concern.",
    "- Ask about what the candidate personally did or would do.",
    "- Never quote or paraphrase the job description or the candidate's documents.",
    "- Never reference a resume, CV, application or the job advert.",
    "- No compound questions. One question mark at most.",
    "",
    "DIFFICULTY",
    "- Junior: direct execution, following process, recognising when to ask for help.",
    "- Mid: trade-offs, competing demands, working with incomplete information.",
    "- Senior: judgement under ambiguity, ownership, influencing others, systemic improvement.",
    "",
    "QUESTION SOURCES",
    '- "job": tests a requirement, skill or responsibility of the role.',
    '- "experience": tests depth of relevant prior practice at the expected level.',
    '- "behavioral": tests judgement, collaboration, ownership or handling of conflict.',
    "",
    "EVALUATION CRITERIA",
    "For each question give one sentence describing what a strong answer demonstrates.",
    "Describe observable evidence, not a score. Keep it specific to the question.",
    "",
    "Return JSON only, matching the provided schema.",
  ].join("\n")
}

function buildUserPrompt(input: QuestionnaireGenerationInput, plan: InterviewQuestionPlan) {
  const skills = (input.coreSkills ?? []).map((s) => String(s ?? "").trim()).filter(Boolean)
  const distribution = plan.distribution

  const payload: Record<string, unknown> = {
    role_title: input.jobTitle?.trim() || "Not supplied",
    job_description: input.jobDescription?.trim() || "Not supplied",
    required_skills_and_responsibilities: skills.length > 0 ? skills : "Not supplied",
    experience_level: input.experienceLevel?.trim() || "Not supplied",
    seniority_band: plan.seniority,
    interview_duration_minutes: plan.durationMinutes,
    total_questions_required: plan.structuredQuestionCount,
    questions_by_source: {
      job: distribution.job,
      experience: distribution.experience,
      behavioral: distribution.behavioral,
    },
  }

  if (input.excludeQuestions?.length) {
    payload.must_not_repeat_or_paraphrase = input.excludeQuestions.slice(0, 60)
  }

  return [
    `Produce exactly ${plan.structuredQuestionCount} questions.`,
    `Use exactly ${distribution.job} with source_type "job", ${distribution.experience} with source_type "experience", and ${distribution.behavioral} with source_type "behavioral".`,
    input.excludeQuestions?.length
      ? "The candidate has already been asked the questions listed in must_not_repeat_or_paraphrase. Cover the same competencies with genuinely different situations."
      : "",
    "",
    JSON.stringify(payload, null, 2),
  ]
    .filter(Boolean)
    .join("\n")
}

async function callOpenAi(system: string, user: string, signal: AbortSignal) {
  const apiKey = getApiKey()
  if (!apiKey) {
    throw new QuestionnaireGenerationError("OPENAI_API_KEY is not configured")
  }

  const response = await openAiFetch(OPENAI_URL, {
    aiUsage: { operation: "job.questionnaire_generation" },
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: QUESTIONNAIRE_MODEL,
      temperature: 0,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "interview_questionnaire",
          strict: true,
          schema: RESPONSE_SCHEMA,
        },
      },
    }),
  })

  if (!response.ok) {
    const body = await response.text().catch(() => "")
    throw new QuestionnaireGenerationError(
      `OpenAI request failed: ${response.status} ${body.slice(0, 400)}`
    )
  }

  const payload = await response.json()
  const content = payload?.choices?.[0]?.message?.content

  if (typeof content !== "string" || !content.trim()) {
    throw new QuestionnaireGenerationError("OpenAI returned an empty questionnaire")
  }

  try {
    return JSON.parse(content) as { questions?: unknown[] }
  } catch (error) {
    throw new QuestionnaireGenerationError("OpenAI returned malformed questionnaire JSON", error)
  }
}

function mapQuestions(raw: unknown[], plan: InterviewQuestionPlan): GeneratedQuestion[] {
  const total = raw.length
  const seen = new Set<string>()
  const mapped: GeneratedQuestion[] = []

  raw.forEach((entry, index) => {
    if (!entry || typeof entry !== "object") return
    const record = entry as Record<string, unknown>
    const questionText = String(record.question_text ?? "").replace(/\s+/g, " ").trim()

    if (!questionText) return
    if (!validateQuestionStrict(questionText).valid) return

    const dedupeKey = questionText.toLowerCase()
    if (seen.has(dedupeKey)) return
    seen.add(dedupeKey)

    const sourceType = normalizeSource(record.source_type)

    mapped.push({
      questionText,
      sourceType,
      competencyLabel:
        String(record.competency_label ?? "").replace(/\s+/g, " ").trim() || "General competency",
      questionType: sourceType === "behavioral" ? "behavioral" : "open_ended",
      difficultyLevel: clampDifficulty(record.difficulty_level),
      phaseHint: normalizePhase(record.phase_hint, index, total),
      evaluationCriteria:
        String(record.evaluation_criteria ?? "").replace(/\s+/g, " ").trim() ||
        "Answer gives a concrete, first-hand account with a clear outcome.",
    })
  })

  return mapped.slice(0, plan.structuredQuestionCount)
}

/**
 * Generates the structured core. ONE OpenAI call on the happy path; a single
 * retry only if the first response yields too few usable questions.
 */
export async function generateStructuredQuestionnaire(
  input: QuestionnaireGenerationInput
): Promise<QuestionnaireGenerationResult> {
  const plan = resolveInterviewQuestionPlan({
    durationMinutes: input.durationMinutes,
    experienceLevel: input.experienceLevel ?? input.jobTitle,
    resumeQuestionsEnabled: input.resumeQuestionsEnabled,
  })

  const system = buildSystemPrompt()
  const user = buildUserPrompt(input, plan)

  let openAiCalls = 0
  let lastError: unknown = null
  let best: GeneratedQuestion[] = []

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

    try {
      openAiCalls += 1
      const parsed = await callOpenAi(system, user, controller.signal)
      const questions = mapQuestions(
        Array.isArray(parsed.questions) ? parsed.questions : [],
        plan
      )

      if (questions.length > best.length) {
        best = questions
      }

      if (best.length >= plan.minQuestions) {
        return {
          questions: best,
          plan,
          model: QUESTIONNAIRE_MODEL,
          openAiCalls,
          usedFallback: false,
        }
      }
    } catch (error) {
      lastError = error
    } finally {
      clearTimeout(timer)
    }
  }

  if (best.length > 0) {
    return { questions: best, plan, model: QUESTIONNAIRE_MODEL, openAiCalls, usedFallback: true }
  }

  throw new QuestionnaireGenerationError(
    `Unable to generate a usable questionnaire after ${openAiCalls} attempt(s)`,
    lastError
  )
}

const RESUME_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["questions"],
  properties: {
    questions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["question_text", "competency_label", "evaluation_criteria"],
        properties: {
          question_text: { type: "string" },
          competency_label: { type: "string" },
          evaluation_criteria: { type: "string" },
        },
      },
    },
  },
} as const

/**
 * Candidate-specific questions drawn from the candidate's own background.
 *
 * This is deliberately candidate-specific and is NOT part of the shared
 * structured core - two candidates for the same job should get different
 * questions here. That is a feature of the product, not a break in
 * standardisation.
 *
 * Returns [] without calling OpenAI when disabled, when the plan allocates no
 * resume questions, or when there is no candidate background to work from.
 */
export async function generateResumeQuestions(input: {
  jobTitle?: string | null
  jobDescription?: string | null
  experienceLevel?: string | null
  candidateBackground?: string | null
  questionCount: number
  excludeQuestions?: string[]
}): Promise<{ questions: GeneratedQuestion[]; openAiCalls: number }> {
  const background = String(input.candidateBackground ?? "").trim()

  if (input.questionCount <= 0 || background.length < 40 || !getApiKey()) {
    return { questions: [], openAiCalls: 0 }
  }

  const system = [
    "You write interview questions about a candidate's own prior experience.",
    "You work across every industry and profession. Take all subject matter from the supplied material and never assume the role is technical.",
    "",
    "RULES",
    "- Each question probes something the candidate has actually done.",
    "- 8 to 22 words, plain spoken language, one competency each.",
    "- Never quote the candidate's document or mention a resume, CV or application.",
    "- Never open with phrases like 'You highlighted' or 'Your background includes'.",
    "- Ask about decisions, ownership, difficulty and outcomes rather than duties.",
    "- Only cover background that is relevant to the target role.",
    "",
    "For each question give one sentence describing what a strong answer demonstrates.",
    "Return JSON only, matching the provided schema.",
  ].join("\n")

  const user = [
    `Produce exactly ${input.questionCount} question(s).`,
    input.excludeQuestions?.length
      ? "Avoid repeating or paraphrasing anything in must_not_repeat."
      : "",
    "",
    JSON.stringify(
      {
        role_title: input.jobTitle?.trim() || "Not supplied",
        role_summary: input.jobDescription?.trim()?.slice(0, 2000) || "Not supplied",
        experience_level: input.experienceLevel?.trim() || "Not supplied",
        candidate_background: background.slice(0, 6000),
        ...(input.excludeQuestions?.length
          ? { must_not_repeat: input.excludeQuestions.slice(0, 60) }
          : {}),
      },
      null,
      2
    ),
  ]
    .filter(Boolean)
    .join("\n")

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const apiKey = getApiKey()
    const response = await openAiFetch(OPENAI_URL, {
      aiUsage: { operation: "job.resume_questions" },
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: QUESTIONNAIRE_MODEL,
        temperature: 0,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "resume_questions",
            strict: true,
            schema: RESUME_RESPONSE_SCHEMA,
          },
        },
      }),
    })

    if (!response.ok) {
      return { questions: [], openAiCalls: 1 }
    }

    const payload = await response.json()
    const content = payload?.choices?.[0]?.message?.content
    if (typeof content !== "string" || !content.trim()) {
      return { questions: [], openAiCalls: 1 }
    }

    const parsed = JSON.parse(content) as { questions?: unknown[] }
    const raw = Array.isArray(parsed.questions) ? parsed.questions : []
    const seen = new Set<string>()
    const questions: GeneratedQuestion[] = []

    for (const entry of raw) {
      if (!entry || typeof entry !== "object") continue
      const record = entry as Record<string, unknown>
      const questionText = String(record.question_text ?? "").replace(/\s+/g, " ").trim()

      if (!questionText || !validateQuestionStrict(questionText).valid) continue
      const key = questionText.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)

      questions.push({
        questionText,
        sourceType: "resume",
        competencyLabel:
          String(record.competency_label ?? "").replace(/\s+/g, " ").trim() || "Relevant experience",
        questionType: "open_ended",
        difficultyLevel: 3,
        phaseHint: "core",
        evaluationCriteria:
          String(record.evaluation_criteria ?? "").replace(/\s+/g, " ").trim() ||
          "Answer gives a specific first-hand account with a clear outcome.",
      })
    }

    return { questions: questions.slice(0, input.questionCount), openAiCalls: 1 }
  } catch {
    // Resume questions are an enhancement, never a blocker: an interview is
    // still valid with only its structured core.
    return { questions: [], openAiCalls: 1 }
  } finally {
    clearTimeout(timer)
  }
}
