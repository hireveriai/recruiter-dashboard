/**
 * AI generation for VERIS Assessment questions. Modeled on
 * lib/server/interview/questionnaire-generator.ts's pattern (raw fetch to the
 * OpenAI chat completions endpoint, strict json_schema response_format,
 * gpt-4o-mini by default) but produces assessment-shaped output instead of
 * interview questions:
 *
 * - SINGLE_CHOICE / MULTI_SELECT -> options with is_correct flags.
 * - SHORT_ANSWER / SCENARIO -> a grading rubric (criteria + model answer
 *   notes) for the subjective-answer evaluator to use later.
 * - CODING -> a language + starter code + runnable stdin/stdout test cases,
 *   graded later by actually executing the candidate's code (see the
 *   assessment app's lib/server/coding-scoring.ts) rather than AI judgment.
 *
 * GLOBAL PLATFORM REQUIREMENT (same as the interview generator): VerisNova
 * serves every industry and function. This module infers all subject matter
 * from the recruiter-supplied job data and must never assume a profession.
 * CODING questions are only requested when the job itself has a coding
 * assessment enabled (see generate-questions/route.ts) — a marketing role's
 * assessment will never include one.
 */

import { openAiFetch } from "@/lib/server/ai-usage-log"

export const ASSESSMENT_QUESTION_MODEL = process.env.OPENAI_QUESTION_MODEL || "gpt-4o-mini"

const OPENAI_URL = "https://api.openai.com/v1/chat/completions"
const REQUEST_TIMEOUT_MS = Number(process.env.ASSESSMENT_QUESTION_TIMEOUT_MS ?? 45000)

export type GeneratedCodingTestCase = { input: string; expectedOutput: string; hidden: boolean }

export type GeneratedCodingSpec = {
  language: string
  starterCode: string
  testCases: GeneratedCodingTestCase[]
}

export type GeneratedAssessmentQuestion = {
  questionText: string
  questionType: "SINGLE_CHOICE" | "MULTI_SELECT" | "SHORT_ANSWER" | "SCENARIO" | "CODING"
  options: { text: string; isCorrect: boolean }[]
  rubric: { criteria: string[]; modelAnswerNotes: string } | null
  codingSpec: GeneratedCodingSpec | null
  explanation: string | null
}

export type AssessmentQuestionGenerationInput = {
  jobTitle?: string | null
  jobDescription?: string | null
  coreSkills?: string[] | null
  difficultyProfile?: string | null
  questionCount: number
  questionTypes: string[]
  entityId?: string | null
  /** Only set when the job has coding enabled — see jobPositionsSupportCodingConfig(). */
  codingLanguages?: string[] | null
}

export class AssessmentQuestionGenerationError extends Error {
  reason: unknown

  constructor(message: string, reason?: unknown) {
    super(message)
    this.name = "AssessmentQuestionGenerationError"
    this.reason = reason
  }
}

function getApiKey() {
  return (process.env.OPENAI_API_KEY ?? "").trim().replace(/^"|"$/g, "")
}

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
        required: ["question_text", "question_type", "options", "rubric", "coding_spec", "explanation"],
        properties: {
          question_text: { type: "string" },
          question_type: {
            type: "string",
            enum: ["SINGLE_CHOICE", "MULTI_SELECT", "SHORT_ANSWER", "SCENARIO", "CODING"],
          },
          // Populated for SINGLE_CHOICE/MULTI_SELECT, empty array otherwise.
          options: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["text", "is_correct"],
              properties: {
                text: { type: "string" },
                is_correct: { type: "boolean" },
              },
            },
          },
          // Populated for SHORT_ANSWER/SCENARIO, null otherwise.
          rubric: {
            type: ["object", "null"],
            additionalProperties: false,
            required: ["criteria", "model_answer_notes"],
            properties: {
              criteria: { type: "array", items: { type: "string" } },
              model_answer_notes: { type: "string" },
            },
          },
          // Populated for CODING only, null otherwise. Test cases must be
          // runnable via stdin/stdout — the candidate's code reads input()
          // /stdin and the grader compares trimmed stdout exactly.
          coding_spec: {
            type: ["object", "null"],
            additionalProperties: false,
            required: ["language", "starter_code", "test_cases"],
            properties: {
              language: { type: "string" },
              starter_code: { type: "string" },
              test_cases: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["input", "expected_output", "hidden"],
                  properties: {
                    input: { type: "string" },
                    expected_output: { type: "string" },
                    hidden: { type: "boolean" },
                  },
                },
              },
            },
          },
          explanation: { type: "string" },
        },
      },
    },
  },
} as const

function buildSystemPrompt(includeCoding: boolean) {
  return [
    "You write assessment questions for a pre-hire skills test.",
    "You work across every industry and profession. Infer everything about the role from the supplied job data alone. Never assume the role is technical.",
    "",
    "QUESTION TYPES",
    "- SINGLE_CHOICE: one correct option among 3-5 plausible options.",
    "- MULTI_SELECT: two or more correct options among 4-6 plausible options.",
    "- SHORT_ANSWER: a free-text answer graded against a rubric.",
    "- SCENARIO: a short situational prompt graded against a rubric.",
    ...(includeCoding
      ? [
          "- CODING: a self-contained coding exercise, solvable by reading input from stdin and printing output to stdout, in one of the allowed_coding_languages.",
        ]
      : []),
    "",
    "For SINGLE_CHOICE/MULTI_SELECT, provide the `options` array with exactly one true is_correct set matching the type (exactly one true for SINGLE_CHOICE, two or more true for MULTI_SELECT), and leave `rubric`/`coding_spec` null.",
    "For SHORT_ANSWER/SCENARIO, leave `options` as an empty array, leave `coding_spec` null, and provide `rubric` with 2-5 concrete grading criteria plus brief model_answer_notes.",
    ...(includeCoding
      ? [
          "For CODING, leave `options` and `rubric` null/empty, and provide `coding_spec`:",
          "  - language: exactly one of allowed_coding_languages.",
          "  - starter_code: a minimal function/read-input stub in that language — never the solution.",
          "  - test_cases: 4-6 cases, each with exact `input` (stdin, empty string if none) and `expected_output` (exact stdout, trimmed). At least 2 must have hidden=true (used for grading but never shown to the candidate); the rest hidden=false (shown as examples).",
          "  - The problem must be fully solvable from question_text alone using only stdin/stdout — no file I/O, no network, no external packages.",
        ]
      : []),
    "",
    "RULES",
    "- Each question tests one clear skill or competency from the job data.",
    "- Plain, unambiguous language. No trick questions.",
    "- Never quote or reference a resume, CV, application, or the word 'job description'.",
    "- `explanation` is one sentence explaining the correct answer or what a strong answer/solution covers; always provide it.",
    "",
    "Return JSON only, matching the provided schema.",
  ].join("\n")
}

function buildUserPrompt(input: AssessmentQuestionGenerationInput) {
  const skills = (input.coreSkills ?? []).map((s) => String(s ?? "").trim()).filter(Boolean)
  const types = input.questionTypes.length > 0 ? input.questionTypes : ["SINGLE_CHOICE", "SHORT_ANSWER"]
  const codingLanguages = (input.codingLanguages ?? []).map((l) => String(l ?? "").trim()).filter(Boolean)

  const payload = {
    role_title: input.jobTitle?.trim() || "Not supplied",
    job_description: input.jobDescription?.trim()?.slice(0, 4000) || "Not supplied",
    required_skills: skills.length > 0 ? skills : "Not supplied",
    difficulty: input.difficultyProfile?.trim() || "MID",
    allowed_question_types: types,
    total_questions_required: input.questionCount,
    ...(types.includes("CODING") ? { allowed_coding_languages: codingLanguages.length > 0 ? codingLanguages : ["python"] } : {}),
  }

  return [
    `Produce exactly ${input.questionCount} question(s), each using one of the allowed_question_types (distribute across them reasonably).`,
    "",
    JSON.stringify(payload, null, 2),
  ].join("\n")
}

async function callOpenAi(system: string, user: string, signal: AbortSignal, entityId?: string | null) {
  const apiKey = getApiKey()
  if (!apiKey) {
    throw new AssessmentQuestionGenerationError("OPENAI_API_KEY is not configured")
  }

  const response = await openAiFetch(OPENAI_URL, {
    aiUsage: { operation: "assessment.question_generation", entityType: "assessment", entityId: entityId ?? null },
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: ASSESSMENT_QUESTION_MODEL,
      temperature: 0,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "assessment_questions",
          strict: true,
          schema: RESPONSE_SCHEMA,
        },
      },
    }),
  })

  if (!response.ok) {
    const body = await response.text().catch(() => "")
    throw new AssessmentQuestionGenerationError(
      `OpenAI request failed: ${response.status} ${body.slice(0, 400)}`
    )
  }

  const payload = await response.json()
  const content = payload?.choices?.[0]?.message?.content

  if (typeof content !== "string" || !content.trim()) {
    throw new AssessmentQuestionGenerationError("OpenAI returned an empty question set")
  }

  try {
    return JSON.parse(content) as { questions?: unknown[] }
  } catch (error) {
    throw new AssessmentQuestionGenerationError("OpenAI returned malformed question JSON", error)
  }
}

function mapQuestions(raw: unknown[]): GeneratedAssessmentQuestion[] {
  const mapped: GeneratedAssessmentQuestion[] = []

  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue
    const record = entry as Record<string, unknown>
    const questionText = String(record.question_text ?? "").replace(/\s+/g, " ").trim()
    const questionType = String(record.question_type ?? "").toUpperCase()

    if (!questionText) continue
    if (!["SINGLE_CHOICE", "MULTI_SELECT", "SHORT_ANSWER", "SCENARIO", "CODING"].includes(questionType)) continue

    const rawOptions = Array.isArray(record.options) ? record.options : []
    const options = rawOptions
      .map((option) => {
        if (!option || typeof option !== "object") return null
        const optionRecord = option as Record<string, unknown>
        const text = String(optionRecord.text ?? "").trim()
        if (!text) return null
        return { text, isCorrect: Boolean(optionRecord.is_correct) }
      })
      .filter((o): o is { text: string; isCorrect: boolean } => Boolean(o))

    const rawRubric = record.rubric && typeof record.rubric === "object" ? (record.rubric as Record<string, unknown>) : null
    const rubric = rawRubric
      ? {
          criteria: Array.isArray(rawRubric.criteria)
            ? rawRubric.criteria.map((c) => String(c).trim()).filter(Boolean)
            : [],
          modelAnswerNotes: String(rawRubric.model_answer_notes ?? "").trim(),
        }
      : null

    const rawCodingSpec =
      record.coding_spec && typeof record.coding_spec === "object" ? (record.coding_spec as Record<string, unknown>) : null
    const codingSpec: GeneratedCodingSpec | null = rawCodingSpec
      ? {
          language: String(rawCodingSpec.language ?? "").trim().toLowerCase(),
          starterCode: String(rawCodingSpec.starter_code ?? ""),
          testCases: (Array.isArray(rawCodingSpec.test_cases) ? rawCodingSpec.test_cases : [])
            .map((tc) => {
              if (!tc || typeof tc !== "object") return null
              const tcRecord = tc as Record<string, unknown>
              return {
                input: String(tcRecord.input ?? ""),
                expectedOutput: String(tcRecord.expected_output ?? "").trim(),
                hidden: Boolean(tcRecord.hidden),
              }
            })
            .filter((tc): tc is GeneratedCodingTestCase => tc !== null && tc.expectedOutput.length > 0),
        }
      : null

    const isObjective = questionType === "SINGLE_CHOICE" || questionType === "MULTI_SELECT"
    const isCoding = questionType === "CODING"

    if (isObjective && options.length < 2) continue
    if (!isObjective && !isCoding && (!rubric || rubric.criteria.length === 0)) continue
    if (isCoding && (!codingSpec || !codingSpec.language || codingSpec.testCases.length === 0)) continue

    mapped.push({
      questionText,
      questionType: questionType as GeneratedAssessmentQuestion["questionType"],
      options: isObjective ? options : [],
      rubric: !isObjective && !isCoding ? rubric : null,
      codingSpec: isCoding ? codingSpec : null,
      explanation: String(record.explanation ?? "").trim() || null,
    })
  }

  return mapped
}

export async function generateAssessmentQuestions(
  input: AssessmentQuestionGenerationInput
): Promise<{ questions: GeneratedAssessmentQuestion[]; model: string }> {
  const system = buildSystemPrompt(input.questionTypes.includes("CODING"))
  const user = buildUserPrompt(input)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const parsed = await callOpenAi(system, user, controller.signal, input.entityId)
    const questions = mapQuestions(Array.isArray(parsed.questions) ? parsed.questions : [])

    if (questions.length === 0) {
      throw new AssessmentQuestionGenerationError("Unable to generate any usable questions")
    }

    return { questions: questions.slice(0, input.questionCount), model: ASSESSMENT_QUESTION_MODEL }
  } finally {
    clearTimeout(timer)
  }
}
