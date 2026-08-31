import { openAiFetch } from "@/lib/server/ai-usage-log"
import { presentSkillName } from "@/lib/server/ai/skills"
import {
  evaluateCandidateResponse,
  type ResponseAnalysis,
} from "@/lib/server/ai/response-evaluation"

type SkillType =
  | "technical"
  | "functional"
  | "behavioral"
  | "analytical"
  | "strategic"
  | "operational"

type InterviewQuestion = {
  question: string
  skill: string
  skill_type?: SkillType
}

export type FollowUpResult = {
  follow_up_question: string
  intent:
    | "clarification"
    | "probe"
    | "contradiction"
    | "exploratory"
    | "simplification"
    | "difficulty_up"
}

export type FollowUpInput = {
  lastQuestion: InterviewQuestion
  candidateAnswer: string
  skillScore?: number
  fraudScore?: number
}

type NextQuestionInput = {
  lastAnswer?: string
  skillScore?: number
  fraudScore?: number
  skillsRemaining: string[]
  timeRemainingSeconds?: number
  followupCount?: number
  lastQuestion?: InterviewQuestion
  criticalSkills?: string[]
  experienceLevel?: string
  responseAnalysis?: ResponseAnalysis
  roleConfidence?: number
  adaptiveMode?: boolean
  questionMode?: string
  askedQuestions?: string[]
}

export type NextQuestionDecision = {
  intent: "followup" | "next_skill" | "contradiction" | "exploratory"
  nextSkill?: string
  followUp?: FollowUpResult
  difficulty?: ResponseAnalysis["question_difficulty"]
  updatedEvaluation?: ResponseAnalysis
}

type OpenAIResponsesOutputText = {
  output_text?: string
  output?: Array<{
    content?: Array<{
      type?: string
      text?: string
    }>
  }>
}

const OPENAI_FOLLOWUP_MODEL = "gpt-4o-mini"
const VAGUE_MARKERS = ["not sure", "maybe", "i think", "not certain", "somehow"]
const STRONG_MARKERS = ["always", "never", "definitely", "absolutely"]

function normalizeText(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim()
}

function normalizeExperienceLevel(level?: string) {
  const normalized = normalizeText(level ?? "")

  if (/\b(junior|entry|0\s*-\s*2|fresher|associate)\b/.test(normalized)) {
    return "junior"
  }

  if (/\b(senior|lead|principal|staff|architect|8\+|10\+)\b/.test(normalized)) {
    return "senior"
  }

  return "mid"
}

function extractDifficultyForExperience(level?: string): ResponseAnalysis["question_difficulty"] {
  const normalized = normalizeExperienceLevel(level)

  if (normalized === "junior") {
    return "guided"
  }

  if (normalized === "senior") {
    return "strategic"
  }

  return "scenario"
}

function detectSignals(answer: string) {
  const normalized = normalizeText(answer)
  const vague =
    normalized.length < 60 ||
    VAGUE_MARKERS.some((marker) => normalized.includes(marker))
  const strong = STRONG_MARKERS.some((marker) => normalized.includes(marker))

  return { vague, strong }
}

function deriveCriticalSkills(skills: string[]) {
  const priority = [
    "security",
    "database",
    "system design",
    "troubleshooting",
    "api",
    "performance",
    "leadership",
    "communication",
  ]
  const normalizedPriority = priority.map(normalizeText)
  const critical = skills.filter((skill) =>
    normalizedPriority.some((item) => normalizeText(skill).includes(item))
  )

  return critical.length > 0 ? critical : skills.slice(0, 2)
}

function extractStructuredOutputText(response: OpenAIResponsesOutputText) {
  if (typeof response.output_text === "string" && response.output_text.trim()) {
    return response.output_text.trim()
  }

  const textChunks = (response.output ?? [])
    .flatMap((item) => item.content ?? [])
    .filter((item) => item.type === "output_text" || item.type === "text")
    .map((item) => item.text ?? "")
    .join("")
    .trim()

  return textChunks || null
}

export function decideNextQuestion(input: NextQuestionInput): NextQuestionDecision {
  const fraudScore = input.fraudScore ?? 0
  const analysis =
    input.responseAnalysis ??
    (input.lastQuestion && input.lastAnswer
      ? evaluateCandidateResponse({
          answer: input.lastAnswer,
          skill: input.lastQuestion.skill,
          skillType: input.lastQuestion.skill_type,
          fraudScore,
          experienceLevel: input.experienceLevel,
          roleConfidence: input.roleConfidence,
          adaptiveMode: input.adaptiveMode,
        })
      : undefined)
  const skillScore = input.skillScore ?? analysis?.skill_score ?? 1
  const followupCount = input.followupCount ?? 0
  const remaining = input.skillsRemaining ?? []
  const difficulty =
    analysis?.question_difficulty ??
    extractDifficultyForExperience(input.experienceLevel)

  if ((analysis?.suspicion_score ?? fraudScore) >= 0.7 && input.lastQuestion) {
    return {
      intent: "contradiction",
      followUp: {
        follow_up_question:
          "You mentioned earlier a different detail. Can you clarify what actually happened?",
        intent: "contradiction",
      },
      difficulty,
      updatedEvaluation: analysis,
    }
  }

  if ((analysis?.role_clarity_score ?? 1) < 0.45 && followupCount < 2 && input.lastQuestion) {
    return {
      intent: "exploratory",
      followUp: generateFollowUp({
        lastQuestion: input.lastQuestion,
        candidateAnswer: input.lastAnswer ?? "",
        skillScore,
        fraudScore,
        responseAnalysis: analysis,
        experienceLevel: input.experienceLevel,
        adaptiveMode: true,
        questionMode: input.questionMode,
      }),
      difficulty,
      updatedEvaluation: analysis,
    }
  }

  if (skillScore < 0.6 && followupCount < 3 && input.lastQuestion && input.lastAnswer) {
    return {
      intent: "followup",
      followUp: generateFollowUp({
        lastQuestion: input.lastQuestion,
        candidateAnswer: input.lastAnswer,
        skillScore,
        fraudScore,
        responseAnalysis: analysis,
        experienceLevel: input.experienceLevel,
        adaptiveMode: input.adaptiveMode,
        questionMode: input.questionMode,
      }),
      difficulty,
      updatedEvaluation: analysis,
    }
  }

  if (analysis && analysis.clarity_score < 0.5 && followupCount < 3 && input.lastQuestion && input.lastAnswer) {
    return {
      intent: "followup",
      followUp: generateFollowUp({
        lastQuestion: input.lastQuestion,
        candidateAnswer: input.lastAnswer,
        skillScore,
        fraudScore,
        responseAnalysis: analysis,
        experienceLevel: input.experienceLevel,
        adaptiveMode: input.adaptiveMode,
        questionMode: input.questionMode,
      }),
      difficulty,
      updatedEvaluation: analysis,
    }
  }

  if (analysis && analysis.depth_score < 0.5 && followupCount < 3 && input.lastQuestion && input.lastAnswer) {
    return {
      intent: "followup",
      followUp: generateFollowUp({
        lastQuestion: input.lastQuestion,
        candidateAnswer: input.lastAnswer,
        skillScore,
        fraudScore,
        responseAnalysis: analysis,
        experienceLevel: input.experienceLevel,
        adaptiveMode: input.adaptiveMode,
        questionMode: input.questionMode,
      }),
      difficulty,
      updatedEvaluation: analysis,
    }
  }

  if (remaining.length === 0) {
    return { intent: "next_skill", nextSkill: undefined, difficulty, updatedEvaluation: analysis }
  }

  const timeRemaining = input.timeRemainingSeconds ?? Number.POSITIVE_INFINITY
  const critical = input.criticalSkills ?? deriveCriticalSkills(remaining)

  if (timeRemaining < remaining.length * 90 && critical.length > 0) {
    return { intent: "next_skill", nextSkill: critical[0], difficulty, updatedEvaluation: analysis }
  }

  if (analysis && analysis.confidence_score > 0.78 && analysis.depth_score > 0.6 && critical.length > 0) {
    return { intent: "next_skill", nextSkill: critical[0], difficulty, updatedEvaluation: analysis }
  }

  return { intent: "next_skill", nextSkill: remaining[0], difficulty, updatedEvaluation: analysis }
}

export function generateFollowUp(
  input: FollowUpInput & {
    responseAnalysis?: ResponseAnalysis
    experienceLevel?: string
    adaptiveMode?: boolean
    questionMode?: string
  }
): FollowUpResult {
  const answer = input.candidateAnswer ?? ""
  const signals = detectSignals(answer)
  const analysis =
    input.responseAnalysis ??
    evaluateCandidateResponse({
      answer,
      skill: input.lastQuestion.skill,
      skillType: input.lastQuestion.skill_type,
      fraudScore: input.fraudScore,
      experienceLevel: input.experienceLevel,
      adaptiveMode: input.adaptiveMode,
    })
  const fraudScore = input.fraudScore ?? 0
  const skillLabel = presentSkillName(input.lastQuestion.skill)

  if (fraudScore >= 0.7 || analysis.suspicion_score >= 0.7) {
    return {
      follow_up_question:
        "Can you walk me through that step-by-step so the timeline is clear?",
      intent: "contradiction",
    }
  }

  if (analysis.role_clarity_score < 0.45) {
    return {
      follow_up_question: `Which part of ${skillLabel} do you personally own most often, and how does it usually show up in your day-to-day work?`,
      intent: "exploratory",
    }
  }

  if (analysis.clarity_score < 0.5 || signals.vague) {
    return {
      follow_up_question:
        input.experienceLevel && normalizeExperienceLevel(input.experienceLevel) === "junior"
          ? `Could you explain that in a simpler step-by-step way using one recent example from ${skillLabel}?`
          : `Could you restate that more clearly and walk me through the sequence you followed in ${skillLabel}?`,
      intent: "simplification",
    }
  }

  if (analysis.depth_score < 0.5) {
    return {
      follow_up_question: `Can you give me one concrete example where ${skillLabel} made the outcome better or worse?`,
      intent: "clarification",
    }
  }

  if (analysis.confidence_score > 0.78 && analysis.depth_score > 0.6) {
    return {
      follow_up_question:
        normalizeExperienceLevel(input.experienceLevel) === "senior"
          ? `What ambiguity or strategic trade-off makes ${skillLabel} hard at your level, and how do you make the call?`
          : `What is an edge case where your approach to ${skillLabel} failed, and how did you recover?`,
      intent: "difficulty_up",
    }
  }

  return {
    follow_up_question: `What would you do differently next time you faced a ${skillLabel} issue?`,
    intent: "probe",
  }
}

export async function generateFollowUpWithAI(input: FollowUpInput): Promise<FollowUpResult> {
  const fallback = generateFollowUp(input)
  const apiKey = process.env.OPENAI_API_KEY

  if (!apiKey) {
    return fallback
  }

  const fraudScore = input.fraudScore ?? 0
  if (fraudScore >= 0.7) {
    return fallback
  }

  const signals = detectSignals(input.candidateAnswer ?? "")
  const model = process.env.OPENAI_FOLLOWUP_MODEL ?? OPENAI_FOLLOWUP_MODEL

  try {
    const response = await openAiFetch("https://api.openai.com/v1/responses", {
      aiUsage: { operation: "interview.adaptive_generation" },
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        input: [
          {
            role: "system",
            content: [
              {
                type: "input_text",
                text:
                  "You are generating one adaptive interview follow-up question. Be specific to the candidate answer, skill-focused, concise, and professional. Avoid job titles, locations, and generic phrases like 'tell me about a time'. Return JSON only.",
              },
            ],
          },
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: JSON.stringify({
                  last_question: input.lastQuestion.question,
                  skill: input.lastQuestion.skill,
                  skill_type: input.lastQuestion.skill_type,
                  answer: input.candidateAnswer,
                  skill_score: input.skillScore ?? null,
                  fraud_score: fraudScore,
                  signals,
                  response_analysis: fallback,
                }),
              },
            ],
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "follow_up",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                follow_up_question: { type: "string" },
                intent: {
                  type: "string",
                  enum: [
                    "clarification",
                    "probe",
                    "contradiction",
                    "exploratory",
                    "simplification",
                    "difficulty_up",
                  ],
                },
              },
              required: ["follow_up_question", "intent"],
            },
          },
        },
      }),
    })

    if (!response.ok) {
      return fallback
    }

    const payload = (await response.json()) as OpenAIResponsesOutputText
    const outputText = extractStructuredOutputText(payload)
    if (!outputText) {
      return fallback
    }

    const parsed = JSON.parse(outputText) as FollowUpResult
    if (
      !parsed ||
      typeof parsed.follow_up_question !== "string" ||
      ![
        "clarification",
        "probe",
        "contradiction",
        "exploratory",
        "simplification",
        "difficulty_up",
      ].includes(parsed.intent)
    ) {
      return fallback
    }

    const normalizedQuestion = normalizeText(parsed.follow_up_question)
    if (!normalizedQuestion || normalizedQuestion.length < 8) {
      return fallback
    }

    return parsed
  } catch (error) {
    console.error("Failed to generate AI follow-up", error)
    return fallback
  }
}
