import { Question } from "@/lib/server/ai/behavioral"
import { regenerateQuestionWithValidation, validateQuestionQuality } from "@/lib/server/ai/brain"
import { generateRoleAwareQuestions } from "./role-aware-generator"
import { validateQuestionStrict } from "./question-validator"
import {
  assignSkillsToQuestions,
  buildSkillUniverse,
  bucketSkill,
  classifySkillType,
  computeSkillCoverage,
  deriveSkillsFromText,
  getFallbackSkillsForRoleFamily,
  inferRoleIntelligence,
  mapQuestionToSkill,
  normalizeSkillName,
  presentSkillName,
  sanitizeSkillList,
  RoleIntelligence,
  scoreAnswerForSkill,
} from "@/lib/server/ai/skills"
import {
  classifyInterviewQuestion,
  getQuestionRenderingMode,
  InterviewQuestionType,
} from "@/lib/server/ai/interview-question-types"

export type BaseGenerationInput = {
  jobDescription?: string
  coreSkills?: string[]
  candidateResumeText?: string
  candidateResumeSkills?: string[]
  candidateId?: string
  jobId?: string
  experienceLevel?: string
  totalQuestions?: number
  interviewDurationMinutes?: number
  jobTitle?: string
  previousQuestions?: string[]
  similarityThreshold?: number
  codingRequired?: string | null
  codingRecommended?: boolean | null
  codingAssessmentType?: string | null
  codingDifficulty?: string | null
  codingDurationMinutes?: number | null
  codingLanguages?: string[] | null
}

export type InterviewQuestion = {
  id: string
  question: string
  skill: string
  skill_type: "technical" | "functional" | "behavioral" | "analytical" | "strategic" | "operational"
  skill_bucket?: string
  source_type?: "resume" | "job" | "behavioral" | "adaptive"
  reference_context?: {
    anchor: string
    source?: string
  }
  is_dynamic?: boolean
  allow_followups?: boolean
  question_type?: InterviewQuestionType
  classifier_confidence?: number
  recruiter_override?: boolean
  rendering_mode?: string
  phase_hint?: "warmup" | "core" | "probe" | "closing"
}

type EnrichedGeneratedQuestion = Question & {
  skill?: string
  skillBucket?: string
}

export type BaseGenerationOutput = {
  questions: InterviewQuestion[]
  skills_covered: string[]
  skills_remaining: string[]
  meta?: {
    role_family: string
    role_subfamily?: string
    role_confidence: number
    adaptive_mode: boolean
    question_mode: string
  }
}

export async function generateQuestions(input: any) {
  const result = await generateRoleAwareQuestions(input)

  if (!result || !result.questions) {
    throw new Error("Generation failed")
  }

  const finalQuestions = result.questions.filter((q) =>
    validateQuestionStrict(q).valid
  )

  if (finalQuestions.length < 5) {
    throw new Error("All questions rejected")
  }

  return finalQuestions.map((q, i) => ({
    id: `q-${i}`,
    question: q,
    skill: result.question_skills?.[i] ?? result.skills[i % result.skills.length],
    source_type: result.question_sources?.[i] === "resume" ? "resume" as const : "job" as const,
  }))
}

export type BaseGenerationOutputWithError = BaseGenerationOutput & {
  error_message?: string
}

export type NextQuestionInput = {
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
  difficulty?: "guided" | "scenario" | "strategic"
  updatedEvaluation?: ResponseAnalysis
}

export type FollowUpInput = {
  lastQuestion: InterviewQuestion
  candidateAnswer: string
  skillScore?: number
  fraudScore?: number
}

export type FollowUpResult = {
  follow_up_question: string
  intent: "clarification" | "probe" | "contradiction" | "exploratory" | "simplification" | "difficulty_up"
}

export type ResponseAnalysis = {
  clarity_score: number
  confidence_score: number
  depth_score: number
  suspicion_score: number
  skill_score: number
  role_clarity_score: number
  question_difficulty: "guided" | "scenario" | "strategic"
  signals: string[]
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
const OPENAI_QUESTION_MODEL = "gpt-4o-mini"

const DEFAULT_TOTAL = 7
const MIN_BASE_QUESTIONS = 5
const MAX_BASE_QUESTIONS = 10
const STRICT_MAX_QUESTIONS = 15
const RESUME_RATIO = 0.3
const JOB_RATIO = 0.5
const BEHAVIORAL_RATIO = 0.2
const MIN_SKILL_KEYWORD_RATIO = 1

const VAGUE_MARKERS = ["not sure", "maybe", "i think", "not certain", "somehow"]
const STRONG_MARKERS = ["always", "never", "definitely", "absolutely"]

const QUESTION_STARTERS = [
  "How do you handle",
  "What would you check if",
  "Can you walk me through",
]

const SCENARIO_KEYS = [
  "production incident",
  "latency spike",
  "deployment failure",
  "data migration",
  "security audit",
  "customer escalation",
  "system outage",
  "performance regression",
  "schedule conflict",
  "resource shortage",
  "part shortage",
  "service delay",
  "missed visit",
  "sla breach",
]

const TOOL_KEYS = [
  "monitoring dashboard",
  "query analyzer",
  "logs",
  "tracing",
  "index diagnostics",
  "backup restore",
]

const DECISION_KEYS = [
  "trade-off",
  "prioritize",
  "rollback",
  "risk mitigation",
  "capacity planning",
]

const EXPERIENCE_KEYS = [
  "recent project",
  "past incident",
  "migration",
  "optimization",
]

const AI_BAD_PREFIXES = [
  "you highlighted",
  "your background includes",
  "worked as",
  "awarded as",
  "when aug",
  "when sep",
  "when oct",
  "when nov",
  "when dec",
  "when jan",
  "when feb",
  "when mar",
  "when apr",
  "when may",
  "when jun",
  "when jul",
]

const NON_TECHNICAL_FORBIDDEN_PHRASES = [
  "troubleshoot",
  "production",
  "deployment",
  "latency",
  "rollback",
  "regression",
  "database",
  "dba",
  "debug",
  "patching",
]
const TECHNICAL_LANGUAGE_MARKERS = [
  "api",
  "database",
  "query",
  "performance",
  "latency",
  "deployment",
  "rollback",
  "incident",
  "system",
  "service",
  "monitoring",
  "logging",
  "security",
  "architecture",
  "debug",
  "root cause",
  "scal",
  "backup",
  "restore",
]
const NON_TECHNICAL_LANGUAGE_MARKERS = [
  "schedule",
  "scheduling",
  "customer",
  "stakeholder",
  "coordination",
  "resource",
  "priority",
  "sla",
  "service level",
  "planning",
  "reschedule",
  "allocation",
  "workflow",
  "communication",
  "delivery",
  "parts",
  "supply chain",
  "visit",
]
const QUESTION_VARIATION_STARTERS = ["How do you", "Walk me through", "Tell me about a time when", "What signals tell you"]

type QuestionIntent =
  | "troubleshooting"
  | "optimization"
  | "execution"
  | "behavioral"
  | "prioritization"
  | "coordination"
  | "judgment"
  | "analysis"

type RoleQuestionPlan = {
  roleIntelligence: RoleIntelligence
  jobSkills: string[]
  rawResumeSkills: string[]
  resumeSkills: string[]
  rawSkillUniverse: string[]
  roleFallbackSkills: string[]
  skillUniverse: string[]
  commonSkills: string[]
  missingSkills: string[]
  jobCoverageSkills: string[]
  prioritizedSkills: string[]
}

const EXPERIENCE_CRITICAL_SKILLS = {
  technical: {
    junior: ["testing", "debugging", "api", "database", "security"],
    mid: ["performance", "security", "operations", "database", "api"],
    senior: ["architecture", "scalability", "security", "performance", "compliance"],
  },
  operations: {
    junior: ["scheduling", "service delivery", "customer urgency", "rescheduling", "coordination"],
    mid: ["resource allocation", "capacity planning", "sla management", "service delivery", "supply chain coordination"],
    senior: ["capacity planning", "resource allocation", "contract execution", "service delivery", "stakeholder management"],
  },
  sales: {
    junior: ["prospecting", "lead management", "crm management", "communication", "negotiation"],
    mid: ["sales pipeline management", "negotiation", "account management", "forecasting", "deal closing"],
    senior: ["account planning", "deal closing", "forecasting", "stakeholder management", "strategy"],
  },
  customer_success: {
    junior: ["customer onboarding", "customer support", "communication", "crm management", "customer retention"],
    mid: ["customer success management", "renewal management", "stakeholder management", "customer retention", "reporting"],
    senior: ["customer retention", "renewal management", "stakeholder management", "strategy", "service levels"],
  },
  hr: {
    junior: ["candidate sourcing", "candidate screening", "communication", "coordination", "interview management"],
    mid: ["talent acquisition", "candidate sourcing", "stakeholder management", "reporting", "employee relations"],
    senior: ["workforce planning", "talent acquisition", "employee relations", "stakeholder management", "strategy"],
  },
  finance: {
    junior: ["accounts payable", "accounts receivable", "invoice management", "accuracy", "reporting"],
    mid: ["financial reporting", "budgeting", "financial forecasting", "variance analysis", "controls"],
    senior: ["financial planning analysis", "budgeting", "forecasting", "compliance", "stakeholder management"],
  },
  procurement: {
    junior: ["vendor management", "purchase order management", "inventory management", "coordination", "accuracy"],
    mid: ["procurement management", "supplier management", "vendor management", "inventory management", "cost control"],
    senior: ["procurement management", "supplier sourcing", "vendor management", "cost control", "strategy"],
  },
  marketing: {
    junior: ["campaign management", "content strategy", "crm management", "communication", "reporting"],
    mid: ["campaign management", "demand generation", "brand management", "analytics", "seo"],
    senior: ["product positioning", "brand management", "demand generation", "strategy", "go to market"],
  },
  manufacturing_industrial: {
    junior: ["production planning", "quality control", "safety compliance", "equipment maintenance", "coordination"],
    mid: ["process improvement", "quality control", "safety compliance", "production planning", "reporting"],
    senior: ["process improvement", "capacity planning", "safety compliance", "leadership", "strategy"],
  },
  construction_site: {
    junior: ["site coordination", "timeline management", "safety compliance", "resource allocation", "communication"],
    mid: ["site coordination", "resource allocation", "contract execution", "timeline management", "risk"],
    senior: ["contract execution", "resource allocation", "safety compliance", "stakeholder management", "strategy"],
  },
  legal_compliance: {
    junior: ["policy review", "contract review", "regulatory compliance", "communication", "documentation"],
    mid: ["risk assessment", "regulatory compliance", "contract review", "policy review", "judgment"],
    senior: ["risk assessment", "governance", "regulatory compliance", "stakeholder management", "strategy"],
  },
  healthcare: {
    junior: ["patient coordination", "clinical documentation", "communication", "care quality", "compliance"],
    mid: ["care quality", "clinical documentation", "patient coordination", "compliance", "judgment"],
    senior: ["care quality", "stakeholder management", "compliance", "communication", "strategy"],
  },
  education_training: {
    junior: ["instruction delivery", "learner engagement", "assessment design", "communication", "training coordination"],
    mid: ["curriculum planning", "assessment design", "learner engagement", "reporting", "stakeholder management"],
    senior: ["curriculum planning", "strategy", "stakeholder management", "learner engagement", "leadership"],
  },
  logistics_warehouse_fleet: {
    junior: ["dispatch coordination", "inventory management", "route planning", "communication", "coordination"],
    mid: ["warehouse operations", "fleet coordination", "inventory management", "route planning", "sla management"],
    senior: ["warehouse operations", "fleet coordination", "cost control", "stakeholder management", "strategy"],
  },
  creative_design_content: {
    junior: ["content strategy", "design reasoning", "communication", "brand management", "feedback"],
    mid: ["creative strategy", "content strategy", "design reasoning", "stakeholder management", "brand management"],
    senior: ["creative strategy", "brand management", "product positioning", "stakeholder management", "strategy"],
  },
  bpo_call_center: {
    junior: ["customer support", "communication", "ticket handling", "de escalation", "sla management"],
    mid: ["customer support", "sla management", "de escalation", "reporting", "quality"],
    senior: ["stakeholder management", "service levels", "de escalation", "reporting", "leadership"],
  },
  banking_financial_services: {
    junior: ["kyc compliance", "customer advisory", "communication", "documentation", "accuracy"],
    mid: ["risk assessment", "credit evaluation", "financial reporting", "kyc compliance", "judgment"],
    senior: ["risk assessment", "stakeholder management", "compliance", "strategy", "financial reporting"],
  },
  leadership_management: {
    junior: ["team leadership", "communication", "coordination", "decision making", "ownership"],
    mid: ["team leadership", "stakeholder management", "performance management", "decision making", "planning"],
    senior: ["strategy", "team leadership", "stakeholder management", "performance management", "decision making"],
  },
  general_business: {
    junior: ["workflow", "communication", "prioritization", "coordination", "reporting"],
    mid: ["stakeholder management", "prioritization", "reporting", "planning", "decision making"],
    senior: ["strategy", "stakeholder management", "planning", "reporting", "leadership"],
  },
} as const

const ROLE_FAMILY_INTENTS: Record<RoleIntelligence["family"], QuestionIntent[]> = {
  technical: ["execution", "troubleshooting", "optimization", "analysis", "judgment"],
  operations: ["prioritization", "coordination", "execution", "optimization", "behavioral"],
  sales: ["coordination", "judgment", "behavioral", "analysis", "execution"],
  customer_success: ["coordination", "behavioral", "prioritization", "analysis", "execution"],
  hr: ["behavioral", "coordination", "judgment", "execution", "analysis"],
  finance: ["analysis", "judgment", "execution", "coordination", "behavioral"],
  procurement: ["coordination", "judgment", "analysis", "execution", "prioritization"],
  marketing: ["analysis", "execution", "judgment", "coordination", "behavioral"],
  manufacturing_industrial: ["execution", "optimization", "prioritization", "coordination", "judgment"],
  construction_site: ["execution", "prioritization", "coordination", "judgment", "behavioral"],
  legal_compliance: ["judgment", "analysis", "coordination", "execution", "behavioral"],
  healthcare: ["execution", "judgment", "coordination", "behavioral", "analysis"],
  education_training: ["execution", "behavioral", "coordination", "analysis", "judgment"],
  logistics_warehouse_fleet: ["prioritization", "coordination", "execution", "optimization", "behavioral"],
  creative_design_content: ["execution", "judgment", "behavioral", "analysis", "coordination"],
  bpo_call_center: ["behavioral", "coordination", "prioritization", "execution", "analysis"],
  banking_financial_services: ["judgment", "analysis", "execution", "coordination", "behavioral"],
  leadership_management: ["judgment", "coordination", "analysis", "behavioral", "execution"],
  general_business: ["execution", "coordination", "prioritization", "behavioral", "analysis"],
}

function normalizeText(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim()
}

function isTechnicalBucket(bucket?: string) {
  return ["database", "performance", "security", "backend", "frontend", "data"].includes(String(bucket ?? ""))
}

function isNonTechnicalRoleFamily(family?: RoleIntelligence["family"]) {
  return family !== "technical"
}

function isTechnicalSkillForNonTechnicalRole(skill: string) {
  const normalizedSkill = normalizeText(skill)

  return (
    /\b(api|backend|frontend|coding|debug|deployment|devops|docker|kubernetes|latency|logging|monitoring|patching|programming|rollback|sre|system|troubleshoot)\b/.test(normalizedSkill) ||
    /\b(database|dba|etl|mysql|postgres|postgresql|query|redis|sql)\b/.test(normalizedSkill) ||
    /\b(aws|azure|gcp|java|javascript|node|python|react|typescript)\b/.test(normalizedSkill)
  )
}

function filterSkillsForRoleFamily(
  skills: string[],
  roleIntelligence: RoleIntelligence,
  jobSkills: string[],
  resumeSkills: string[]
) {
  const normalizedJob = new Set(jobSkills.map(normalizeText))
  const normalizedResume = new Set(resumeSkills.map(normalizeText))

  if (!isNonTechnicalRoleFamily(roleIntelligence.family)) {
    return skills
  }

  const filtered = skills.filter((skill) => {
    const normalizedSkill = normalizeText(skill)
    if (normalizedJob.has(normalizedSkill)) {
      return true
    }

    const skillType = classifySkillType(skill)
    const bucket = bucketSkill(skill)

    if (isTechnicalSkillForNonTechnicalRole(skill) && !normalizedJob.has(normalizedSkill)) {
      return false
    }

    if (skillType !== "technical" && !isTechnicalBucket(bucket)) {
      return true
    }

    // Keep resume-derived non-technical skills even if the JD is thin.
    return normalizedResume.has(normalizedSkill) && skillType !== "technical"
  })

  return filtered.length >= 3 ? filtered : skills
}

function mergeUniqueSkills(...groups: string[][]) {
  const merged: string[] = []
  const seen = new Set<string>()

  groups.flat().forEach((skill) => {
    const normalizedSkill = normalizeText(skill)
    if (!normalizedSkill || seen.has(normalizedSkill)) {
      return
    }

    seen.add(normalizedSkill)
    merged.push(skill)
  })

  return merged
}

function createStableHash(value: string) {
  let hash = 2166136261

  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }

  return (hash >>> 0).toString(16)
}

function seededIndex(length: number, seed: string) {
  if (length <= 0) {
    return 0
  }

  const hash = parseInt(createStableHash(seed).slice(0, 8), 16)
  return Number.isFinite(hash) ? hash % length : 0
}

function filterResumeSkillsForRoleContext(
  resumeSkills: string[],
  roleIntelligence: RoleIntelligence,
  jobSkills: string[],
  roleFallbackSkills: string[]
) {
  if (!isNonTechnicalRoleFamily(roleIntelligence.family)) {
    return resumeSkills
  }

  const normalizedJob = new Set(jobSkills.map(normalizeText))
  const normalizedFallback = new Set(roleFallbackSkills.map(normalizeText))

  const filtered = resumeSkills.filter((skill) => {
    const normalizedSkill = normalizeText(skill)
    const skillType = classifySkillType(skill)
    const bucket = bucketSkill(skill)

    if (normalizedJob.has(normalizedSkill) || normalizedFallback.has(normalizedSkill)) {
      return true
    }

    if (isTechnicalSkillForNonTechnicalRole(skill)) {
      return false
    }

    if (skillType === "technical" || isTechnicalBucket(bucket)) {
      return false
    }

    return true
  })

  return filtered.length > 0 ? filtered : resumeSkills.filter((skill) => classifySkillType(skill) !== "technical")
}

function normalizeQuestionSignature(question: string) {
  return normalizeText(question)
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b(how do you|walk me through|tell me about a time when|what signals tell you|can you walk me through|what would you check if)\b/g, "")
    .replace(/\b(a|an|the|to|of|in|for|on|at|with|when|where|that|this|your|you|it|is|are)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function dedupeInterviewQuestions(questions: InterviewQuestion[]) {
  const accepted: InterviewQuestion[] = []
  const seenText = new Set<string>()
  const seenSignatures = new Set<string>()
  const seenAnchorSource = new Set<string>()
  const seenHashes = new Set<string>()

  for (const question of questions) {
    const normalizedText = normalizeText(question.question)
    const signature = normalizeQuestionSignature(question.question)
    const anchor = normalizeText(question.reference_context?.anchor ?? question.skill)
    const source = question.source_type ?? "job"
    const anchorSourceKey = `${source}:${anchor}`
    const questionHash = createStableHash(signature || normalizedText)

    if (!normalizedText || seenText.has(normalizedText) || seenHashes.has(questionHash)) {
      continue
    }

    if (signature && seenSignatures.has(signature)) {
      continue
    }

    if (anchor && seenAnchorSource.has(anchorSourceKey)) {
      continue
    }

    seenText.add(normalizedText)
    seenHashes.add(questionHash)
    if (signature) {
      seenSignatures.add(signature)
    }
    if (anchor) {
      seenAnchorSource.add(anchorSourceKey)
    }

    accepted.push(question)
  }

  return accepted
}

function buildVariationSeed(input: BaseGenerationInput) {
  return [
    input.candidateId ?? "",
    input.jobId ?? "",
    input.jobTitle ?? "",
    input.interviewDurationMinutes ?? "",
    normalizeExperienceLevel(input.experienceLevel),
  ].join("|")
}

function questionMentionsSkill(question: string, skill: string) {
  const normalizedQuestion = normalizeText(question)
  const displaySkill = presentSkillName(skill)
  const normalizedSkill = normalizeText(displaySkill)

  if (!normalizedQuestion || !normalizedSkill) {
    return false
  }

  if (normalizedQuestion.includes(normalizedSkill)) {
    return true
  }

  const meaningfulTokens = normalizedSkill
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !["and", "for", "the", "with"].includes(token))

  return meaningfulTokens.some((token) => normalizedQuestion.includes(token))
}

function hasGoodQuestionLength(question: string) {
  const words = normalizeText(question).split(/\s+/).filter(Boolean)
  return words.length >= 10 && words.length <= 26
}

function isTooGenericSkillQuestion(question: string, skill: string) {
  const normalizedQuestion = normalizeText(question)
  const normalizedSkill = normalizeText(presentSkillName(skill))

  if (!normalizedQuestion || !normalizedSkill) {
    return true
  }

  const stripped = normalizedQuestion
    .replace(new RegExp(`\\b${normalizedSkill.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g"), " ")
    .replace(/\b(how do you|how would you|what would you do if|walk me through|tell me about)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim()

  const genericPhrases = [
    "troubleshoot issues",
    "optimize performance",
    "handle production",
    "improve outcomes",
    "solve problems",
    "manage work",
    "deal with pressure",
    "make decisions",
    "how would you use",
    "how do you use",
    "in this role",
  ]

  if (genericPhrases.some((phrase) => normalizedQuestion.includes(phrase))) {
    return true
  }

  const strippedTokens = stripped.split(/\s+/).filter(Boolean)
  return strippedTokens.length < 3
}

function normalizeExperienceLevel(level?: string) {
  const normalized = normalizeText(level ?? "")
  if (!normalized) {
    return "mid"
  }

  if (normalized.includes("junior") || normalized.includes("fresher") || normalized.includes("entry")) {
    return "junior"
  }

  if (normalized.includes("senior") || normalized.includes("lead") || normalized.includes("principal")) {
    return "senior"
  }

  return "mid"
}

function resolveBaseQuestionCount(input: BaseGenerationInput) {
  const duration = input.interviewDurationMinutes ?? 30
  const durationMinimum =
    duration >= 60
      ? 15
      : duration >= 45
        ? 12
        : duration >= 30
          ? 10
          : 4

  if (typeof input.totalQuestions === "number" && input.totalQuestions > 0) {
    return Math.max(input.totalQuestions, durationMinimum)
  }

  if (duration >= 60) {
    return 15
  }
  if (duration >= 45) {
    return 12
  }
  if (duration >= 30) {
    return 10
  }
  return 4
}

function prioritizeSkillsByExperience(skills: string[], input: BaseGenerationInput) {
  const level = normalizeExperienceLevel(input.experienceLevel)
  const roleIntelligence = inferRoleIntelligence({
    jobTitle: input.jobTitle,
    jobDescription: input.jobDescription,
    coreSkills: input.coreSkills,
    resumeSkills: input.candidateResumeSkills,
    resumeText: input.candidateResumeText,
  })
  const familyCritical = EXPERIENCE_CRITICAL_SKILLS[roleIntelligence.family] ?? EXPERIENCE_CRITICAL_SKILLS.general_business
  const critical = level === "junior" ? familyCritical.junior : level === "senior" ? familyCritical.senior : familyCritical.mid

  const normalizedCritical = critical.map((skill: string) => normalizeText(skill))
  return [...skills].sort((a, b) => {
    const aHit = normalizedCritical.some((crit: string) => normalizeText(presentSkillName(a)).includes(crit))
    const bHit = normalizedCritical.some((crit: string) => normalizeText(presentSkillName(b)).includes(crit))
    if (aHit === bHit) {
      return 0
    }
    return aHit ? -1 : 1
  })
}

function deriveCriticalSkills(skills: string[], input: BaseGenerationInput) {
  const ordered = prioritizeSkillsByExperience(skills, input)
  return ordered.slice(0, Math.min(5, ordered.length))
}

function shuffleWithSeed<T>(items: T[], seed: string) {
  const output = [...items]
  let hash = 0
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) % 100000
  }

  for (let i = output.length - 1; i > 0; i -= 1) {
    hash = (hash * 16807) % 2147483647
    const j = hash % (i + 1)
    const temp = output[i]
    output[i] = output[j]
    output[j] = temp
  }

  return output
}

function pickQuestionTemplate(index: number, skill: string) {
  const scenario = SCENARIO_KEYS[index % SCENARIO_KEYS.length]
  const tool = TOOL_KEYS[index % TOOL_KEYS.length]
  const decision = DECISION_KEYS[index % DECISION_KEYS.length]
  const experience = EXPERIENCE_KEYS[index % EXPERIENCE_KEYS.length]

  const templates = [
    `${QUESTION_STARTERS[0]} a ${scenario} involving ${skill}?`,
    `${QUESTION_STARTERS[1]} ${skill} caused a ${scenario} and you only had ${tool} available?`,
    `${QUESTION_STARTERS[2]} how you make a ${decision} when working with ${skill}?`,
    `${QUESTION_STARTERS[2]} a ${experience} where you improved ${skill} outcomes?`,
  ]

  return templates[index % templates.length]
}

function looksLikeResumeLine(question: string) {
  const normalized = normalizeText(question)
  if (!normalized) {
    return false
  }

  if (AI_BAD_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
    return true
  }

  if (question.includes(" · ")) {
    return true
  }

  if (/\b(19|20)\d{2}\b/.test(question) && /(worked as|award|awarded|employee of the month|from .* to)/i.test(question)) {
    return true
  }

  return false
}

function containsForbiddenNonTechnicalPhrase(question: string) {
  const normalized = normalizeText(question)
  return NON_TECHNICAL_FORBIDDEN_PHRASES.some((phrase) => normalized.includes(phrase))
}

function containsTechnicalLanguage(question: string) {
  const normalized = normalizeText(question)
  return TECHNICAL_LANGUAGE_MARKERS.some((marker) => normalized.includes(marker))
}

function containsNonTechnicalLanguage(question: string) {
  const normalized = normalizeText(question)
  return NON_TECHNICAL_LANGUAGE_MARKERS.some((marker) => normalized.includes(marker))
}

function questionMatchesRoleStyle(params: {
  question: string
  roleIntelligence?: RoleIntelligence
  skillType: ReturnType<typeof classifySkillType>
}) {
  const { question, roleIntelligence, skillType } = params
  const family = roleIntelligence?.family

  if (!family) {
    return true
  }

  if (family === "technical") {
    if (skillType === "behavioral") {
      return true
    }

    return containsTechnicalLanguage(question) || skillType === "technical"
  }

  return !containsForbiddenNonTechnicalPhrase(question)
}

function cleanQuestionText(question: string) {
  return question
    .replace(/[Â·•]/g, " ")
    .replace(/_/g, " ")
    .replace(/\bcannot be ignored\b/gi, "is important")
    .replace(/\bstill matters\b/gi, "remains important")
    .replace(/\bstarts affecting outcomes\b/gi, "starts affecting results")
    .replace(/\bis central to the outcome\b/gi, "directly affects results")
    .replace(/\bis a key part of the work\b/gi, "is important in this role")
    .replace(/\s+/g, " ")
    .replace(/[?!]{2,}/g, "?")
    .replace(/\s+([?.!,])/g, "$1")
    .trim()
}

function ensureQuestionSentence(question: string) {
  const cleaned = cleanQuestionText(question)
  if (!cleaned) {
    return ""
  }

  const withoutTrailing = cleaned.replace(/[.?!]+$/g, "")
  const capitalized = withoutTrailing.charAt(0).toUpperCase() + withoutTrailing.slice(1)
  return `${capitalized}?`
}

function humanizeQuestion(question: string, skillType: InterviewQuestion["skill_type"]) {
  let next = ensureQuestionSentence(question)
    .replace(/\bHow do you handle production\b/gi, "How do you handle unexpected operational pressure")
    .replace(/\bHow do you handle latency\b/gi, "How do you handle delays or slowdowns")
    .replace(/\bmonitoring is central to the outcome\b/gi, "monitoring matters to the outcome")
    .replace(/\bis a key part of the work\b/gi, "matters in the role")
    .replace(/\bis central to the outcome\b/gi, "has a direct impact on the outcome")
    .replace(/\bkey part of the work\b/gi, "role")
    .replace(/\bHow would you use ([^?]+) in this role\b/gi, "How would you apply $1 in a real scenario")
    .replace(/\bHow do you use ([^?]+) in this role\b/gi, "How do you apply $1 in real work situations")
    .replace(/\s+when when\b/gi, " when")
    .replace(/\s{2,}/g, " ")
    .trim()

  if (skillType !== "technical") {
    next = next
      .replace(/\bproduction\b/gi, "day-to-day delivery")
      .replace(/\blatency\b/gi, "delay")
      .replace(/\bdeployment\b/gi, "rollout")
      .replace(/\brollback\b/gi, "reversal")
      .replace(/\bmonitoring\b/gi, "tracking")
      .replace(/\bsystem\b/gi, "process")
  }

  return ensureQuestionSentence(next)
}

function normalizeVariablePhrase(value: string) {
  return cleanQuestionText(
    value
      .replace(/\bcannot be ignored\b/gi, "is important")
      .replace(/\bstill matters\b/gi, "remains important")
      .replace(/\bstill needs to be\b/gi, "needs to be")
      .replace(/\bstarts affecting outcomes\b/gi, "starts affecting results")
      .replace(/\bincomplete at first\b/gi, "incomplete")
  )
}

function buildEffectiveSkills(params: {
  listedSkills?: string[]
  text?: string
  jobTitle?: string
  jobDescription?: string
}) {
  return mergeUniqueSkills(
    sanitizeSkillList(params.listedSkills, {
      jobTitle: params.jobTitle,
      jobDescription: params.jobDescription,
    }),
    deriveSkillsFromText(params.text)
  )
}

function buildContextSnippet(text?: string) {
  const cleaned = (text ?? "")
    .replace(/\s+/g, " ")
    .replace(/[•·]/g, " ")
    .trim()

  if (!cleaned) {
    return ""
  }

  const parts = cleaned
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 2)

  return parts.join(" ").slice(0, 320)
}

function buildRoleQuestionPlan(input: BaseGenerationInput): RoleQuestionPlan {
  const roleIntelligence = inferRoleIntelligence({
    jobTitle: input.jobTitle,
    jobDescription: input.jobDescription,
    coreSkills: input.coreSkills,
    resumeSkills: input.candidateResumeSkills,
    resumeText: input.candidateResumeText,
  })

  const jobSkills = buildEffectiveSkills({
    listedSkills: input.coreSkills,
    text: input.jobDescription,
    jobTitle: input.jobTitle,
    jobDescription: input.jobDescription,
  })

  const rawResumeSkills = buildEffectiveSkills({
    listedSkills: input.candidateResumeSkills,
    text: input.candidateResumeText,
    jobTitle: input.jobTitle,
    jobDescription: input.jobDescription,
  })

  const rawSkillUniverse = buildSkillUniverse({
    jobTitle: input.jobTitle,
    jobDescription: input.jobDescription,
    coreSkills: jobSkills,
    resumeSkills: rawResumeSkills,
    resumeText: input.candidateResumeText,
  })

  const roleFallbackSkills = getFallbackSkillsForRoleFamily({
    jobTitle: input.jobTitle,
    jobDescription: input.jobDescription,
    coreSkills: input.coreSkills,
    resumeSkills: rawResumeSkills,
    resumeText: input.candidateResumeText,
  })

  const resumeSkills = filterResumeSkillsForRoleContext(rawResumeSkills, roleIntelligence, jobSkills, roleFallbackSkills)
  const skillUniverse = mergeUniqueSkills(
    filterSkillsForRoleFamily(rawSkillUniverse, roleIntelligence, jobSkills, resumeSkills),
    filterSkillsForRoleFamily(roleFallbackSkills, roleIntelligence, jobSkills, resumeSkills)
  )

  if (skillUniverse.length === 0) {
    skillUniverse.push("general workflow")
  }

  const normalizedJob = new Set(jobSkills.map(normalizeText))
  const normalizedResume = new Set(resumeSkills.map(normalizeText))

  const commonSkills = skillUniverse.filter(
    (skill) => normalizedJob.has(normalizeText(skill)) && normalizedResume.has(normalizeText(skill))
  )
  const missingSkills = jobSkills.filter((skill) => !normalizedResume.has(normalizeText(skill)))
  const jobCoverageSkills = jobSkills.filter((skill) => normalizedResume.has(normalizeText(skill)))
  const prioritizedSkills = prioritizeSkillsByExperience(skillUniverse, input)

  return {
    roleIntelligence,
    jobSkills,
    rawResumeSkills,
    resumeSkills,
    rawSkillUniverse,
    roleFallbackSkills,
    skillUniverse,
    commonSkills,
    missingSkills,
    jobCoverageSkills,
    prioritizedSkills,
  }
}

function selectTargetSkillsForInterview(plan: RoleQuestionPlan, total: number) {
  const anchorCount = Math.min(total, Math.max(5, Math.min(8, total)))
  const used = new Set<string>()
  const jobPriorityPool = mergeUniqueSkills(
    plan.commonSkills,
    plan.missingSkills,
    plan.jobCoverageSkills,
    plan.jobSkills
  )
  const resumeOnlyPool = filterSpecificSkillAnchors(plan.resumeSkills, plan.roleIntelligence).filter(
    (skill) => !plan.jobSkills.some((jobSkill) => normalizeText(jobSkill) === normalizeText(skill))
  )
  const fallbackPool = buildJobFirstSkillPool(plan)

  const minimumJobAnchors = Math.min(
    anchorCount,
    Math.max(1, Math.ceil(anchorCount * 0.7))
  )
  const maximumResumeAnchors = Math.max(0, anchorCount - minimumJobAnchors)

  const anchors = [
    ...pickUniqueSkills(jobPriorityPool, minimumJobAnchors, used),
    ...pickUniqueSkills(resumeOnlyPool, maximumResumeAnchors, used),
  ]

  if (anchors.length < anchorCount) {
    anchors.push(...pickUniqueSkills(fallbackPool, anchorCount - anchors.length, used))
  }

  const remainingPool = mergeUniqueSkills(plan.prioritizedSkills, plan.skillUniverse, plan.roleFallbackSkills).filter(
    (skill) => !anchors.map(normalizeText).includes(normalizeText(skill))
  )

  return {
    anchorSkills: anchors,
    remainingPool,
  }
}

function buildPhaseHint(index: number, total: number): InterviewQuestion["phase_hint"] {
  if (index === 0) {
    return "warmup"
  }

  if (index >= Math.max(1, total - 1)) {
    return "closing"
  }

  if (index >= Math.max(2, total - 3)) {
    return "probe"
  }

  return "core"
}

function buildQuestionMetadata(params: {
  id: string
  skill: string
  skillType: InterviewQuestion["skill_type"]
  total: number
  index: number
  roleIntelligence?: RoleIntelligence
  resumeSkillSet?: Set<string>
  jobSkillSet?: Set<string>
}) {
  const normalizedSkill = normalizeText(params.skill)
  const sourceType: InterviewQuestion["source_type"] = params.id.startsWith("adaptive-")
    ? "adaptive"
    : params.id.startsWith("behavioral-") || params.skillType === "behavioral"
      ? "behavioral"
      : params.jobSkillSet?.has(normalizedSkill)
        ? "job"
        : params.resumeSkillSet?.has(normalizedSkill)
          ? "resume"
          : params.roleIntelligence?.adaptiveMode
            ? "adaptive"
            : "job"

  return {
    source_type: sourceType,
    reference_context: {
      anchor: presentSkillName(params.skill),
      source: sourceType,
    },
    is_dynamic: true,
    allow_followups: true,
    question_type:
      params.skillType === "behavioral"
        ? InterviewQuestionType.BEHAVIORAL
        : InterviewQuestionType.TECHNICAL_DISCUSSION,
    classifier_confidence: params.skillType === "behavioral" ? 0.86 : 0.72,
    recruiter_override: false,
    rendering_mode: getQuestionRenderingMode(
      params.skillType === "behavioral"
        ? InterviewQuestionType.BEHAVIORAL
        : InterviewQuestionType.TECHNICAL_DISCUSSION
    ),
    phase_hint: buildPhaseHint(params.index, params.total),
  } satisfies Pick<
    InterviewQuestion,
    "source_type" | "reference_context" | "is_dynamic" | "allow_followups" | "question_type" | "classifier_confidence" | "recruiter_override" | "rendering_mode" | "phase_hint"
  >
}

function inferQuestionIntent(skill: string, skillType: ReturnType<typeof classifySkillType>, roleIntelligence?: RoleIntelligence): QuestionIntent {
  const normalizedSkill = normalizeText(skill)

  if (skillType === "behavioral") {
    return "behavioral"
  }

  if (roleIntelligence?.family === "technical") {
    if (/(azure data factory|adf|databricks|spark|pyspark|delta lake|data lake|etl pipeline|data pipeline|data warehouse|big data)/.test(normalizedSkill)) {
      if (/(spark|databricks|performance|optimization)/.test(normalizedSkill)) {
        return "optimization"
      }
      if (/(sql|query|database)/.test(normalizedSkill)) {
        return "troubleshooting"
      }
      return "execution"
    }
    if (/(monitoring|logging|alert|incident|on-call|sre|operations)/.test(normalizedSkill)) {
      return "troubleshooting"
    }

    if (/(database|sql|postgresql|mysql|query|index|backup|replication|security|auth|encryption|api|backend|frontend|architecture|testing)/.test(normalizedSkill)) {
      return "execution"
    }
  }

  if (roleIntelligence?.family === "operations" && roleIntelligence.subfamily === "field_service") {
    if (/(scheduling|schedule|dispatch|rescheduling|allocation|capacity)/.test(normalizedSkill)) {
      return "prioritization"
    }
    if (/(coordination|service delivery|field|supply chain|parts|sla)/.test(normalizedSkill)) {
      return "coordination"
    }
  }

  if (/(optimi|improv|efficien|capacity|performance)/.test(normalizedSkill)) {
    return "optimization"
  }

  if (/(troubleshoot|incident|failure|problem|issue|debug|root cause)/.test(normalizedSkill)) {
    return "troubleshooting"
  }

  if (/(schedule|dispatch|allocation|priorit|queue|timeline|deadline)/.test(normalizedSkill)) {
    return "prioritization"
  }

  if (/(coordination|stakeholder|communication|service delivery|customer|support|field)/.test(normalizedSkill)) {
    return "coordination"
  }

  if (/(risk|compliance|judgment|policy|governance|decision)/.test(normalizedSkill)) {
    return "judgment"
  }

  if (/(^|[\s_])(metric|metrics|analysis|forecast|report|reporting|trend|kpi|analytics|forecasting)([\s_]|$)/.test(normalizedSkill)) {
    return "analysis"
  }

  return skillType === "technical" ? "troubleshooting" : "execution"
}

function clampIntentToRoleFamily(intent: QuestionIntent, roleIntelligence?: RoleIntelligence) {
  if (!roleIntelligence) {
    return intent
  }

  const allowed = ROLE_FAMILY_INTENTS[roleIntelligence.family] ?? ROLE_FAMILY_INTENTS.general_business
  return allowed.includes(intent) ? intent : allowed[0]
}

function buildSkillAnchoredFallbackQuestion(
  displaySkill: string,
  intent: QuestionIntent,
  roleIntelligence?: RoleIntelligence
) {
  const family = roleIntelligence?.family ?? "general_business"

  if (family === "technical") {
    if (/(azure data factory|adf|etl pipeline|data pipeline)/i.test(displaySkill)) {
      return `How would you design ${displaySkill} to handle failures and downstream dependencies?`
    }
    if (/(databricks|spark|pyspark)/i.test(displaySkill)) {
      return intent === "optimization"
        ? `How do you optimize ${displaySkill} for large datasets?`
        : `How would you use ${displaySkill} to build reliable data processing workflows?`
    }
    if (/(data lake|delta lake)/i.test(displaySkill)) {
      return `How would you structure ${displaySkill} for reliable querying and downstream use?`
    }
    if (/(sql|mysql|postgresql)/i.test(displaySkill)) {
      return intent === "troubleshooting"
        ? `How do you troubleshoot slow ${displaySkill} queries on large datasets?`
        : `How do you optimize ${displaySkill} queries for large datasets?`
    }
    if (intent === "troubleshooting") {
      return `How do you troubleshoot recurring issues in ${displaySkill}?`
    }
    if (intent === "optimization") {
      return `How do you optimize ${displaySkill} under heavy load constraints?`
    }
    if (intent === "analysis") {
      return `How do you interpret signals from ${displaySkill} before choosing the next technical action?`
    }
    return `How would you design and implement ${displaySkill} for production reliability?`
  }

  if (family === "operations") {
    if (intent === "prioritization") {
      return `How do you prioritize work when ${displaySkill} is under pressure?`
    }
    if (intent === "coordination") {
      return `How would you keep ${displaySkill} aligned across teams?`
    }
    return `How do you handle change when ${displaySkill} is central to the work?`
  }

  if (intent === "behavioral") {
    return `Tell me about a time when ${displaySkill} was critical to your work.`
  }

  if (intent === "analysis") {
    return `How do you interpret data from ${displaySkill} to make a clear decision?`
  }

  return `How would you solve a practical problem using ${displaySkill}?`
}

function buildIntentQuestion(
  displaySkill: string,
  intent: QuestionIntent,
  index: number,
  roleIntelligence?: RoleIntelligence,
  experienceLevel?: string,
  variationSeed?: string
) {
  void index
  void experienceLevel
  void variationSeed
  const normalizedIntent = clampIntentToRoleFamily(intent, roleIntelligence)
  const skillType = normalizeInterviewSkillType(classifySkillType(displaySkill))

  const fallback = humanizeQuestion(
    buildSkillAnchoredFallbackQuestion(displaySkill, normalizedIntent, roleIntelligence),
    skillType
  )

  return isTooGenericSkillQuestion(fallback, displaySkill)
    ? `How would you solve a real scenario using ${displaySkill} under constraints?`
    : fallback
}

function buildQuestionsForSkills(
  skills: string[],
  offset: number,
  roleIntelligence?: RoleIntelligence,
  experienceLevel?: string,
  variationSeed?: string
) {
  return skills.map((skill, idx) => {
    const skillType = classifySkillType(skill)
    const displaySkill = presentSkillName(skill)
    const intent = clampIntentToRoleFamily(inferQuestionIntent(skill, skillType, roleIntelligence), roleIntelligence)
    const questionType: "BEHAVIORAL" | "TECHNICAL" =
      skillType === "behavioral" ? "BEHAVIORAL" : "TECHNICAL"

    return {
      id: `q-${offset + idx}-${skill.replace(/\s+/g, "-")}`,
      text: buildIntentQuestion(
        displaySkill,
        intent,
        offset + idx,
        roleIntelligence,
        experienceLevel,
        variationSeed
      ),
      phase: "MID" as const,
      tags: [skill],
      type: questionType,
    }
  })
}

function ensureQuestionCount(params: {
  questions: InterviewQuestion[]
  total: number
  roleIntelligence: RoleIntelligence
  experienceLevel?: string
  skillPool: string[]
  anchorSkills?: string[]
  variationSeed?: string
  resumeSkillSet: Set<string>
  jobSkillSet: Set<string>
}) {
  let output = [...params.questions]
  const prioritizedPool = mergeUniqueSkills(params.anchorSkills ?? [], params.skillPool)
  const pool = prioritizedPool.length > 0 ? prioritizedPool : ["workflow"]
  const intents = ROLE_FAMILY_INTENTS[params.roleIntelligence.family] ?? ROLE_FAMILY_INTENTS.general_business

  let attempts = 0
  while (output.length < params.total && attempts < params.total * 12) {
    const skill = pool[attempts % pool.length] ?? "workflow"
    const displaySkill = presentSkillName(skill)
    const intent = intents[attempts % intents.length] ?? "execution"
    const skillType = normalizeInterviewSkillType(classifySkillType(skill))
    const id = buildInterviewQuestionId("fill", output.length + attempts, skill)
    const candidate: InterviewQuestion = {
      id,
      question: buildIntentQuestion(
        displaySkill,
        intent,
        output.length + attempts + 1000,
        params.roleIntelligence,
        params.experienceLevel,
        params.variationSeed
      ),
      skill: displaySkill,
      skill_type: skillType,
      skill_bucket: bucketSkill(skill),
      ...buildQuestionMetadata({
        id,
        skill,
        skillType,
        total: params.total,
        index: output.length,
        roleIntelligence: params.roleIntelligence,
        resumeSkillSet: params.resumeSkillSet,
        jobSkillSet: params.jobSkillSet,
      }),
    }

    if (
      questionMatchesRoleStyle({
        question: candidate.question,
        roleIntelligence: params.roleIntelligence,
        skillType: classifySkillType(skill),
      })
      && questionMentionsSkill(candidate.question, candidate.skill)
      && !isTooGenericSkillQuestion(candidate.question, candidate.skill)
    ) {
      const deduped = dedupeInterviewQuestions([...output, candidate])
      if (deduped.length > output.length) {
        output = deduped
      }
    }

    attempts += 1
  }

  return output.slice(0, params.total)
}

function ensureSkillCoverageQuestionSet(params: {
  questions: InterviewQuestion[]
  total: number
  anchorSkills: string[]
  roleIntelligence: RoleIntelligence
  experienceLevel?: string
  skillPool: string[]
  variationSeed?: string
  resumeSkillSet: Set<string>
  jobSkillSet: Set<string>
}) {
  const desiredAnchorSkills = pickUniqueSkills(
    params.anchorSkills,
    Math.min(params.total, params.anchorSkills.length),
    new Set<string>()
  )

  const validExisting = dedupeInterviewQuestions(
    params.questions.filter((question) =>
      questionMatchesRoleStyle({
        question: question.question,
        roleIntelligence: params.roleIntelligence,
        skillType: classifySkillType(question.skill),
      }) && questionMentionsSkill(question.question, question.skill)
        && !isTooGenericSkillQuestion(question.question, question.skill)
    )
  )

  const selected: InterviewQuestion[] = []
  const selectedSkills = new Set<string>()

  for (const anchorSkill of desiredAnchorSkills) {
    const normalizedAnchor = normalizeText(anchorSkill)
    const existing = validExisting.find((question) => normalizeText(question.skill) === normalizedAnchor)
    if (existing && !selectedSkills.has(normalizedAnchor)) {
      selected.push(existing)
      selectedSkills.add(normalizedAnchor)
      continue
    }

    const displaySkill = presentSkillName(anchorSkill)
    const skillType = normalizeInterviewSkillType(classifySkillType(anchorSkill))
    const id = buildInterviewQuestionId("anchor", selected.length, anchorSkill)
    selected.push({
      id,
      question: buildIntentQuestion(
        displaySkill,
        clampIntentToRoleFamily(
          inferQuestionIntent(anchorSkill, classifySkillType(anchorSkill), params.roleIntelligence),
          params.roleIntelligence
        ),
        selected.length + 500,
        params.roleIntelligence,
        params.experienceLevel,
        params.variationSeed
      ),
      skill: displaySkill,
      skill_type: skillType,
      skill_bucket: bucketSkill(anchorSkill),
      ...buildQuestionMetadata({
        id,
        skill: anchorSkill,
        skillType,
        total: params.total,
        index: selected.length,
        roleIntelligence: params.roleIntelligence,
        resumeSkillSet: params.resumeSkillSet,
        jobSkillSet: params.jobSkillSet,
      }),
    })
    selectedSkills.add(normalizedAnchor)
  }

  for (const question of validExisting) {
    if (selected.length >= params.total) {
      break
    }
    const normalizedSkill = normalizeText(question.skill)
    if (!normalizedSkill || selectedSkills.has(normalizedSkill)) {
      continue
    }
    selected.push(question)
    selectedSkills.add(normalizedSkill)
  }

  let output = dedupeInterviewQuestions(selected).slice(0, params.total)

  output = ensureQuestionCount({
    questions: output,
    total: params.total,
    roleIntelligence: params.roleIntelligence,
    experienceLevel: params.experienceLevel,
    skillPool: params.skillPool,
    anchorSkills: desiredAnchorSkills,
    variationSeed: params.variationSeed,
    resumeSkillSet: params.resumeSkillSet,
    jobSkillSet: params.jobSkillSet,
  })

  const minimumSkillQuestions = Math.max(1, Math.ceil(params.total * MIN_SKILL_KEYWORD_RATIO))
  const skillKeywordQuestions = output.filter((question) => questionMentionsSkill(question.question, question.skill)).length

  if (skillKeywordQuestions < minimumSkillQuestions) {
    const refillPool = mergeUniqueSkills(desiredAnchorSkills, params.skillPool).filter(
      (skill) => !output.some((question) => normalizeText(question.skill) === normalizeText(skill))
    )
    const refillQuestions = buildQuestionsForSkills(
      refillPool.slice(0, minimumSkillQuestions - skillKeywordQuestions),
      output.length,
      params.roleIntelligence,
      params.experienceLevel,
      params.variationSeed
    )
    const refillOutput: InterviewQuestion[] = assignSkillsToQuestions(refillQuestions, mergeUniqueSkills(params.anchorSkills, params.skillPool)).map(
      (question, index) => {
        const mappedSkill = question.skill ?? params.anchorSkills[index] ?? params.skillPool[index] ?? "workflow"
        const skillType = normalizeInterviewSkillType(classifySkillType(mappedSkill))

        return {
          id: question.id,
          question: humanizeQuestion(question.text, skillType),
          skill: presentSkillName(mappedSkill),
          skill_type: skillType,
          skill_bucket: question.skillBucket,
          ...buildQuestionMetadata({
            id: question.id,
            skill: mappedSkill,
            skillType,
            total: params.total,
            index: output.length + index,
            roleIntelligence: params.roleIntelligence,
            resumeSkillSet: params.resumeSkillSet,
            jobSkillSet: params.jobSkillSet,
          }),
        }
      }
    ).filter((question) =>
      questionMentionsSkill(question.question, question.skill)
      && !isTooGenericSkillQuestion(question.question, question.skill)
    )

    output = dedupeInterviewQuestions([...output, ...refillOutput]).slice(0, params.total)
  }

  return output
}

function rebalanceQuestionSources(params: {
  questions: InterviewQuestion[]
  total: number
  roleIntelligence: RoleIntelligence
  experienceLevel?: string
  anchorSkills: string[]
  plan: RoleQuestionPlan
  variationSeed?: string
  resumeSkillSet: Set<string>
  jobSkillSet: Set<string>
}) {
  const maxResumeQuestions = Math.max(1, Math.floor(params.total * 0.35))
  const jobFirstPool = buildJobFirstSkillPool(params.plan)
  let output = [...params.questions]

  const countResumeOnly = () =>
    output.filter((question) => {
      const normalizedSkill = normalizeText(question.skill)
      return params.resumeSkillSet.has(normalizedSkill) && !params.jobSkillSet.has(normalizedSkill)
    }).length

  let resumeCount = countResumeOnly()
  if (resumeCount <= maxResumeQuestions) {
    return output.slice(0, params.total)
  }

  const replacementPool = jobFirstPool.filter(
    (skill) =>
      params.jobSkillSet.has(normalizeText(skill))
      && !output.some((question) => normalizeText(question.skill) === normalizeText(skill))
  )

  for (const skill of replacementPool) {
    if (resumeCount <= maxResumeQuestions) {
      break
    }

    const replaceIndex = output.findIndex((question) => {
      const normalizedSkill = normalizeText(question.skill)
      return params.resumeSkillSet.has(normalizedSkill) && !params.jobSkillSet.has(normalizedSkill)
    })

    if (replaceIndex === -1) {
      break
    }

    const displaySkill = presentSkillName(skill)
    const skillType = normalizeInterviewSkillType(classifySkillType(skill))
    const id = buildInterviewQuestionId("rebalance", replaceIndex, skill)
    const replacement: InterviewQuestion = {
      id,
      question: buildIntentQuestion(
        displaySkill,
        clampIntentToRoleFamily(
          inferQuestionIntent(skill, classifySkillType(skill), params.roleIntelligence),
          params.roleIntelligence
        ),
        replaceIndex + 3000,
        params.roleIntelligence,
        params.experienceLevel,
        params.variationSeed
      ),
      skill: displaySkill,
      skill_type: skillType,
      skill_bucket: bucketSkill(skill),
      ...buildQuestionMetadata({
        id,
        skill,
        skillType,
        total: params.total,
        index: replaceIndex,
        roleIntelligence: params.roleIntelligence,
        resumeSkillSet: params.resumeSkillSet,
        jobSkillSet: params.jobSkillSet,
      }),
    }

    if (
      questionMatchesRoleStyle({
        question: replacement.question,
        roleIntelligence: params.roleIntelligence,
        skillType: classifySkillType(skill),
      })
      && questionMentionsSkill(replacement.question, replacement.skill)
      && !isTooGenericSkillQuestion(replacement.question, replacement.skill)
    ) {
      output[replaceIndex] = replacement
      output = dedupeInterviewQuestions(output)
      output = ensureQuestionCount({
        questions: output,
        total: params.total,
        roleIntelligence: params.roleIntelligence,
        experienceLevel: params.experienceLevel,
        skillPool: jobFirstPool,
        anchorSkills: params.anchorSkills,
        variationSeed: params.variationSeed,
        resumeSkillSet: params.resumeSkillSet,
        jobSkillSet: params.jobSkillSet,
      })
      resumeCount = countResumeOnly()
    }
  }

  return output.slice(0, params.total)
}

function deriveBehavioralQuestions(
  count: number,
  skills: string[],
  offset: number,
  experienceLevel?: string
) {
  const pool = skills.length ? skills : ["leadership", "communication"]
  const behavioral: Question[] = []

  for (let i = 0; i < count; i += 1) {
    const skill = pool[(offset + i) % pool.length]
    const displaySkill = presentSkillName(skill)
    behavioral.push({
      id: `behavioral-${offset + i}`,
      text: cleanQuestionText(
        buildIntentQuestion(
          displaySkill,
          "behavioral",
          offset + i,
          undefined,
          experienceLevel
        )
      ),
      phase: "MID",
      tags: [skill],
      type: "BEHAVIORAL",
    })
  }

  return behavioral
}

function buildAdaptiveQuestions(
  role: RoleIntelligence,
  skills: string[],
  offset: number,
  experienceLevel?: string
) {
  const primarySkill = presentSkillName(skills[0] ?? "workflow")
  const secondarySkill = presentSkillName(skills[1] ?? skills[0] ?? "communication")

  const byMode: Record<RoleIntelligence["questionMode"], Array<(skillA: string, skillB: string) => string>> = {
    technical_problem_solving: [
      (skillA) => `When a problem lands outside the usual pattern, how do you decide what to check first in ${skillA}?`,
      (skillA, skillB) => `Which part of your work needs deeper judgment: ${skillA} or ${skillB}, and why?`,
    ],
    sales_objection_handling: [
      (skillA) => `When a prospect hesitates, how do you figure out whether the issue is timing, value, or fit in ${skillA}?`,
      (skillA, skillB) => `Which part of your sales work depends more on judgment: ${skillA} or ${skillB}, and how do you handle it?`,
    ],
    behavioral_people_judgment: [
      (skillA) => `Which part of this role depends most on people judgment, and how do you usually approach it through ${skillA}?`,
      (skillA, skillB) => `When expectations conflict, how do you decide where to focus first between ${skillA} and ${skillB}?`,
    ],
    operational_scenarios: [
      (skillA) => `When the day changes suddenly, how do you decide what to reprioritize first in ${skillA}?`,
      (skillA, skillB) => `Which part of your role is most sensitive to timing: ${skillA} or ${skillB}, and how do you keep it stable?`,
    ],
    legal_judgment: [
      (skillA) => `When the safest answer is not obvious, how do you frame the judgment call in ${skillA}?`,
      (skillA, skillB) => `Which carries more risk in your work, ${skillA} or ${skillB}, and how do you evaluate that?`,
    ],
    creative_reasoning: [
      (skillA) => `When feedback pulls in different directions, how do you decide what to keep or change in ${skillA}?`,
      (skillA, skillB) => `How do you balance originality with business fit between ${skillA} and ${skillB}?`,
    ],
    communication_service: [
      (skillA) => `When a conversation starts going off track, how do you bring it back using ${skillA}?`,
      (skillA, skillB) => `Which matters more in your day-to-day work, clarity in ${skillA} or calm under pressure in ${skillB}?`,
    ],
    analytical_business: [
      (skillA) => `When the numbers and the situation do not tell the same story, how do you investigate ${skillA}?`,
      (skillA, skillB) => `Which decisions in your role rely more on pattern-reading: ${skillA} or ${skillB}?`,
    ],
    leadership_decision_making: [
      (skillA) => `When the team needs direction but the data is incomplete, how do you decide the next move in ${skillA}?`,
      (skillA, skillB) => `How do you balance short-term pressure with long-term ownership across ${skillA} and ${skillB}?`,
    ],
  }

  const templates = byMode[role.questionMode] ?? byMode.analytical_business
  const difficulty = extractDifficultyForExperience(experienceLevel)

  const orderedTemplates = shuffleWithSeed(templates, `${role.family}|${role.subfamily ?? ""}|${difficulty}`)

  return orderedTemplates.map((template, index) => ({
    id: `adaptive-${offset + index}`,
    text:
      difficulty === "guided"
        ? `To help us understand your background better, ${template(primarySkill, secondarySkill).charAt(0).toLowerCase()}${template(primarySkill, secondarySkill).slice(1)}`
        : template(primarySkill, secondarySkill),
    phase: "MID" as const,
    tags: [skills[index] ?? skills[0] ?? "workflow"],
    type: "BEHAVIORAL" as const,
  }))
}

function mapSkillType(bucket: string, type: Question["type"]) {
  if (type === "BEHAVIORAL") {
    return "behavioral"
  }

  if (bucket === "backend" || bucket === "frontend" || bucket === "data") {
    return "technical"
  }

  if (bucket === "performance" || bucket === "database" || bucket === "security") {
    return "technical"
  }

  return "functional"
}

function normalizeInterviewSkillType(
  value: "technical" | "functional" | "behavioral" | string
): InterviewQuestion["skill_type"] {
  if (value === "behavioral" || value === "functional" || value === "technical") {
    return value
  }

  const normalized = normalizeText(value)
  if (normalized === "analytical" || normalized === "strategic" || normalized === "operational") {
    return "functional"
  }

  return "technical"
}

function detectSignals(answer: string) {
  const normalized = normalizeText(answer)
  const vague = normalized.length < 60 || VAGUE_MARKERS.some((marker) => normalized.includes(marker))
  const strong = STRONG_MARKERS.some((marker) => normalized.includes(marker))
  return { vague, strong }
}

function clampScore(value: number) {
  return Number(Math.max(0, Math.min(1, value)).toFixed(2))
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

function detectDepthMarkers(answer: string) {
  const normalized = normalizeText(answer)
  const markers = ["because", "so that", "for example", "for instance", "first", "then", "after", "trade off", "trade-off", "decided", "measured"]
  return markers.filter((marker) => normalized.includes(marker))
}

function detectSuspicionMarkers(answer: string) {
  const normalized = normalizeText(answer)
  const markers = ["honestly", "basically", "trust me", "obviously", "as i said", "i already told", "not sure", "maybe", "kind of"]
  return markers.filter((marker) => normalized.includes(marker))
}

export function analyzeCandidateResponse(params: {
  answer: string
  skill: string
  skillType?: InterviewQuestion["skill_type"]
  fraudScore?: number
  experienceLevel?: string
  roleConfidence?: number
  adaptiveMode?: boolean
}) : ResponseAnalysis {
  const answer = params.answer ?? ""
  const normalized = normalizeText(answer)
  const words = normalized ? normalized.split(" ").filter(Boolean) : []
  const signalFlags: string[] = []

  const clarityBase =
    words.length >= 80 ? 0.92 : words.length >= 45 ? 0.78 : words.length >= 24 ? 0.62 : words.length >= 12 ? 0.44 : 0.24
  const fillerPenalty = VAGUE_MARKERS.filter((marker) => normalized.includes(marker)).length * 0.08
  const clarityScore = clampScore(clarityBase - fillerPenalty)
  if (clarityScore < 0.5) {
    signalFlags.push("low_clarity")
  }

  const depthMarkers = detectDepthMarkers(answer)
  const depthScore = clampScore(
    (words.length >= 120 ? 0.8 : words.length >= 60 ? 0.62 : words.length >= 30 ? 0.42 : 0.2) +
      Math.min(0.25, depthMarkers.length * 0.06)
  )
  if (depthScore < 0.5) {
    signalFlags.push("low_depth")
  }

  const confidenceBoost = STRONG_MARKERS.filter((marker) => normalized.includes(marker)).length * 0.06
  const confidenceScore = clampScore(
    (clarityScore * 0.45 + depthScore * 0.35 + Math.min(0.2, confidenceBoost + (normalized.includes("i ") ? 0.08 : 0))) -
      Math.max(0, fillerPenalty * 0.5)
  )
  if (confidenceScore > 0.75) {
    signalFlags.push("high_confidence")
  }

  const suspicionMarkers = detectSuspicionMarkers(answer)
  const suspicionScore = clampScore(
    (params.fraudScore ?? 0) * 0.55 +
      suspicionMarkers.length * 0.08 +
      (clarityScore < 0.35 ? 0.08 : 0) +
      (confidenceScore > 0.85 && depthScore < 0.35 ? 0.14 : 0)
  )
  if (suspicionScore > 0.55) {
    signalFlags.push("high_suspicion")
  }

  const roleClarityScore = clampScore(
    params.adaptiveMode ? ((params.roleConfidence ?? 0.35) * 0.7 + (depthScore + clarityScore) * 0.15) : Math.max(params.roleConfidence ?? 0.65, 0.65)
  )
  if (roleClarityScore < 0.45) {
    signalFlags.push("role_unclear")
  }

  const skillScore = clampScore(scoreAnswerForSkill(answer, params.skill) / 5)
  const questionDifficulty = extractDifficultyForExperience(params.experienceLevel)

  return {
    clarity_score: clarityScore,
    confidence_score: confidenceScore,
    depth_score: depthScore,
    suspicion_score: suspicionScore,
    skill_score: skillScore,
    role_clarity_score: roleClarityScore,
    question_difficulty: questionDifficulty,
    signals: signalFlags,
  }
}

function pickUniqueSkills(pool: string[], count: number, used: Set<string>) {
  const selected: string[] = []
  for (const skill of pool) {
    if (selected.length >= count) {
      break
    }
    const normalized = normalizeText(skill)
    if (used.has(normalized)) {
      continue
    }
    used.add(normalized)
    selected.push(skill)
  }

  return selected
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

function buildInterviewQuestionId(prefix: string, index: number, skill: string) {
  const normalizedSkill = skill.replace(/\s+/g, "-").toLowerCase()
  return `${prefix}-${index}-${normalizedSkill}`
}

function normalizeSkillMatch(skill: string, candidates: string[]) {
  const normalized = normalizeText(skill)
  if (!normalized) {
    return null
  }

  const direct = candidates.find((candidate) => normalizeText(candidate) === normalized)
  if (direct) {
    return direct
  }

  const includes = candidates.find((candidate) => normalizeText(candidate).includes(normalized))
  if (includes) {
    return includes
  }

  const partial = candidates.find((candidate) => normalized.includes(normalizeText(candidate)))
  return partial ?? null
}

type SelectedInterviewSkill = {
  skill: string
  source: "job" | "resume"
}

function isDataEngineeringRole(plan: RoleQuestionPlan, input?: BaseGenerationInput) {
  const title = normalizeText(input?.jobTitle ?? "")
  if (title.includes("data engineer")) {
    return true
  }

  return mergeUniqueSkills(plan.jobSkills, plan.resumeSkills).some(isDataEngineeringAnchor)
}

function buildSelectedInterviewSkills(
  plan: RoleQuestionPlan,
  input: BaseGenerationInput,
  total: number
): SelectedInterviewSkill[] {
  const jobSpecific = prioritizeDomainSpecificJobSkills(
    filterSpecificSkillAnchors(plan.jobSkills, plan.roleIntelligence)
  )
  const resumeSpecific = prioritizeDomainSpecificJobSkills(
    filterSpecificSkillAnchors(plan.resumeSkills, plan.roleIntelligence)
  )

  const common = jobSpecific.filter((skill) =>
    resumeSpecific.some((resumeSkill) => normalizeText(resumeSkill) === normalizeText(skill))
  )
  const jobOnly = jobSpecific.filter(
    (skill) => !resumeSpecific.some((resumeSkill) => normalizeText(resumeSkill) === normalizeText(skill))
  )
  const resumeOnly = resumeSpecific.filter(
    (skill) => !jobSpecific.some((jobSkill) => normalizeText(jobSkill) === normalizeText(skill))
  )

  const selected: SelectedInterviewSkill[] = []
  const used = new Set<string>()
  const pushSkills = (skills: string[], source: "job" | "resume", limit?: number) => {
    let added = 0
    for (const skill of skills) {
      const normalized = normalizeText(skill)
      if (!normalized || used.has(normalized)) {
        continue
      }
      selected.push({ skill, source })
      used.add(normalized)
      added += 1
      if (typeof limit === "number" && added >= limit) {
        break
      }
      if (selected.length >= total) {
        break
      }
    }
  }

  pushSkills(common, "job")
  pushSkills(jobOnly, "job")
  pushSkills(resumeOnly, "resume", Math.max(1, Math.floor(total * 0.25)))

  if (selected.length < total) {
    pushSkills(
      buildJobFirstSkillPool(plan),
      "job"
    )
  }

  if (selected.length < total) {
    pushSkills(
      prioritizeDomainSpecificJobSkills(
        filterSpecificSkillAnchors(plan.roleFallbackSkills, plan.roleIntelligence)
      ),
      "job"
    )
  }

  return selected.slice(0, Math.max(total, 1))
}

function buildSkillQuestionVariants(
  skill: string,
  roleIntelligence: RoleIntelligence,
  experienceLevel?: string,
  dataEngineeringRole?: boolean
) {
  const displaySkill = presentSkillName(skill)
  const normalizedSkill = normalizeText(skill)
  const difficulty = extractDifficultyForExperience(experienceLevel)

  const guided = difficulty === "guided"
  const strategic = difficulty === "strategic"

  if (/(azure data factory|adf)/.test(normalizedSkill)) {
    return [
      "How do you design ETL pipelines using Azure Data Factory?",
      "Walk me through an Azure Data Factory pipeline you built.",
      "What would you check first when an Azure Data Factory pipeline starts failing?",
    ]
  }

  if (/databricks/.test(normalizedSkill)) {
    return [
      "Walk me through a Databricks workflow you have built.",
      "How do you optimize Databricks jobs for large datasets?",
      "What would you do if a Databricks job starts missing its processing window?",
    ]
  }

  if (/(spark|pyspark)/.test(normalizedSkill)) {
    return [
      "How do you optimize Spark jobs for large datasets?",
      "Walk me through how you use Spark in ETL pipelines.",
      "What would you do if Spark jobs start slowing down as data volume grows?",
    ]
  }

  if (/delta lake/.test(normalizedSkill)) {
    return [
      "How do you use Delta Lake to manage schema changes in data pipelines?",
      "How do you structure Delta Lake tables for downstream querying?",
      "What trade-offs do you consider when using Delta Lake?",
    ]
  }

  if (/data lake/.test(normalizedSkill)) {
    return [
      "How do you structure data in a data lake for efficient querying?",
      "What would you do to improve data quality in a data lake?",
      "How would you organize a data lake for downstream consumers?",
    ]
  }

  if (/(etl pipeline|data pipeline)/.test(normalizedSkill)) {
    return [
      "How do you design ETL pipelines for reliable data delivery?",
      "Walk me through an ETL pipeline you built.",
      "What would you do if an ETL pipeline starts failing after a schema change?",
    ]
  }

  if (/data warehouse/.test(normalizedSkill)) {
    return [
      "How do you model data for a warehouse used by analytics teams?",
      "Walk me through a data warehouse design you implemented.",
      "What would you do to improve query performance in a data warehouse?",
    ]
  }

  if (/performance optimization/.test(normalizedSkill)) {
    return [
      "How do you identify the biggest bottleneck in a data pipeline?",
      "What would you optimize first in a slow data workflow?",
      "Walk me through how you improved throughput in a pipeline.",
    ]
  }

  if (/big data/.test(normalizedSkill)) {
    return [
      "How do you design pipelines that can handle big data workloads reliably?",
      "What would you optimize first in a big data processing workflow?",
      "Walk me through a project where you worked with big data systems.",
    ]
  }

  if (/(sql|postgresql|postgres)\b/.test(normalizedSkill)) {
    if (dataEngineeringRole) {
      return [
        `How do you optimize ${displaySkill} queries for large datasets?`,
        `What would you check first when ${displaySkill} queries start slowing down in ETL workflows?`,
        `How do you use ${displaySkill} to support reliable data pipelines?`,
      ]
    }

    return [
      `How do you optimize ${displaySkill} queries under heavy load?`,
      `What would you check first when ${displaySkill} queries start slowing down?`,
      `Walk me through how you use ${displaySkill} in production systems.`,
    ]
  }

  if (/mysql/.test(normalizedSkill)) {
    if (dataEngineeringRole) {
      return [
        "How do you troubleshoot slow MySQL queries in ETL workflows?",
        "Walk me through how you use MySQL in a data pipeline.",
        "What would you do to improve MySQL query performance on large datasets?",
      ]
    }

    return [
      "How do you troubleshoot recurring MySQL issues?",
      "Walk me through how you use MySQL in production systems.",
      "What would you do to improve MySQL query performance under heavy load?",
    ]
  }

  if (/database/.test(normalizedSkill)) {
    if (dataEngineeringRole) {
      return [
        "How do you design database tables for reliable ETL workflows?",
        "What would you check first when a database slows down a data pipeline?",
        "Walk me through a database change you made to support data engineering work.",
      ]
    }

    return [
      "How do you design database changes without affecting system reliability?",
      "What would you check first when a database issue affects production performance?",
      "Walk me through a database design decision you have made.",
    ]
  }

  if (roleIntelligence.family === "technical") {
    if (dataEngineeringRole) {
      return guided
        ? [
            `How do you use ${displaySkill} in a real data pipeline?`,
            `Walk me through where ${displaySkill} fits in your ETL workflow.`,
          ]
        : strategic
          ? [
              `How would you scale ${displaySkill} for growing data volume?`,
              `What trade-offs matter most when using ${displaySkill} in data platforms?`,
            ]
          : [
              `How do you use ${displaySkill} in a production data pipeline?`,
              `What would you optimize first when working with ${displaySkill} at scale?`,
              `Walk me through a project where ${displaySkill} was important to your data platform.`,
            ]
    }

    return guided
      ? [`How do you use ${displaySkill} in real work?`]
      : strategic
        ? [
            `How would you scale ${displaySkill} without losing reliability?`,
            `What trade-offs matter most when designing around ${displaySkill}?`,
          ]
        : [
            `How do you implement ${displaySkill} in production systems?`,
            `How do you troubleshoot issues related to ${displaySkill}?`,
          ]
  }

  if (roleIntelligence.family === "operations") {
    return [
      `How do you manage ${displaySkill} when priorities change unexpectedly?`,
      `How do you keep ${displaySkill} on track under pressure?`,
    ]
  }

  if (roleIntelligence.family === "sales") {
    return [
      `How do you use ${displaySkill} to move deals forward?`,
      `How do you improve results when ${displaySkill} starts slipping?`,
    ]
  }

  return [
    `How do you apply ${displaySkill} in real work situations?`,
    `How would you approach a practical problem using ${displaySkill}?`,
  ]
}

function buildStrictSkillQuestions(
  input: BaseGenerationInput
): BaseGenerationOutput {
  const requested = resolveBaseQuestionCount(input) ?? DEFAULT_TOTAL
  const plan = buildRoleQuestionPlan(input)
  const requiredJobSkills = prioritizeDomainSpecificJobSkills(
    filterSpecificSkillAnchors(plan.jobSkills, plan.roleIntelligence)
  )
  const total = Math.min(
    STRICT_MAX_QUESTIONS,
    Math.max(MIN_BASE_QUESTIONS, requested, requiredJobSkills.length)
  )
  const variationSeed = buildVariationSeed(input)
  const dataEngineeringRole = isDataEngineeringRole(plan, input)
  const selectedSkills = buildSelectedInterviewSkills(plan, input, total)
  const resumeSkillSet = new Set(plan.resumeSkills.map(normalizeText))
  const jobSkillSet = new Set(plan.jobSkills.map(normalizeText))
  const questions: InterviewQuestion[] = []
  const seenQuestions = new Set<string>()
  const seenPatterns = new Set<string>()
  const usedSkills = new Set<string>()
  const usedStarters = new Set<string>()
  const usedAngles = new Set<string>()
  const allSkillTerms = selectedSkills
    .map((item) => presentSkillName(item.skill))
    .map(normalizeText)
    .filter(Boolean)
    .sort((left, right) => right.length - left.length)

  const extractStarter = (question: string) => {
    const normalized = normalizeText(question)
    if (normalized.startsWith("how do you")) return "how-do-you"
    if (normalized.startsWith("walk me through")) return "walk-me-through"
    if (normalized.startsWith("what would you do if")) return "what-would-you-do-if"
    if (normalized.startsWith("what would you check first")) return "what-would-you-check-first"
    return normalized.split(" ").slice(0, 3).join(" ")
  }

  const extractPattern = (question: string) => {
    let normalized = normalizeText(question)
    for (const term of allSkillTerms) {
      if (!term) {
        continue
      }
      normalized = normalized.replace(new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g"), " skill ")
    }

    return normalized
      .replace(/\b(how do you|walk me through|what would you do if|what would you check first|tell me about)\b/g, " ")
      .replace(/\b(skill|large datasets|data pipeline|etl workflows|production data pipeline|at scale|for downstream consumers)\b/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  }

  const extractAngle = (question: string) => {
    const normalized = normalizeText(question)
    if (normalized.includes("walk me through")) return "walkthrough"
    if (normalized.includes("what would you check first")) return "check-first"
    if (normalized.includes("what would you do if")) return "failure-scenario"
    if (normalized.includes("trade-offs")) return "trade-offs"
    if (normalized.includes("optimize")) return "optimization"
    if (normalized.includes("troubleshoot")) return "troubleshooting"
    if (normalized.includes("design")) return "design"
    if (normalized.includes("structure")) return "structure"
    if (normalized.includes("handle failures")) return "failure-handling"
    if (normalized.includes("use ")) return "usage"
    if (normalized.includes("improve reliability")) return "reliability"
    return normalized.split(" ").slice(0, 4).join(" ")
  }

  const appendQuestionForSkill = (selected: SelectedInterviewSkill, variantIndex: number) => {
    const normalizedSkill = normalizeText(selected.skill)
    if (!normalizedSkill) {
      return false
    }

    const variants = buildSkillQuestionVariants(
      selected.skill,
      plan.roleIntelligence,
      input.experienceLevel,
      dataEngineeringRole
    )
    const ordered = shuffleWithSeed(
      variants,
      `${variationSeed}|${selected.skill}|${variantIndex}|${selected.source}`
    )

    const primaryPass = ordered.filter((candidateQuestion) => !usedStarters.has(extractStarter(candidateQuestion)))
    const starterPool = primaryPass.length > 0 ? primaryPass : ordered
    const anglePass = starterPool.filter((candidateQuestion) => !usedAngles.has(extractAngle(candidateQuestion)))
    const evaluationPool = anglePass.length > 0 ? anglePass : starterPool

    for (const candidateQuestion of evaluationPool) {
      const skillType = normalizeInterviewSkillType(classifySkillType(selected.skill))
      const question = humanizeQuestion(candidateQuestion, skillType)
      const normalizedQuestion = normalizeText(question)
      if (!hasGoodQuestionLength(question)) {
        continue
      }
      if (!questionMentionsSkill(question, selected.skill)) {
        continue
      }
      if (isTooGenericSkillQuestion(question, selected.skill)) {
        continue
      }
      if (seenQuestions.has(normalizedQuestion)) {
        continue
      }
      const pattern = extractPattern(question)
      if (pattern && seenPatterns.has(pattern)) {
        continue
      }

      const id = buildInterviewQuestionId("strict", questions.length, selected.skill)
      const sourceType: InterviewQuestion["source_type"] =
        selected.source === "resume" && !jobSkillSet.has(normalizedSkill) ? "resume" : "job"
      const classification = classifyInterviewQuestion(question, input.jobTitle, [selected.skill])

      questions.push({
        id,
        question,
        skill: presentSkillName(selected.skill),
        skill_type: skillType,
        skill_bucket: bucketSkill(selected.skill),
        source_type: sourceType,
        reference_context: {
          anchor: presentSkillName(selected.skill),
          source: sourceType,
        },
        is_dynamic: true,
        allow_followups: true,
        question_type:
          skillType === "behavioral"
            ? InterviewQuestionType.BEHAVIORAL
            : classification.questionType,
        classifier_confidence:
          skillType === "behavioral" ? 0.86 : classification.confidence,
        recruiter_override: false,
        rendering_mode:
          skillType === "behavioral" ? "behavioral" : classification.renderingMode,
        phase_hint: buildPhaseHint(questions.length, total),
      })
      seenQuestions.add(normalizedQuestion)
      if (pattern) {
        seenPatterns.add(pattern)
      }
      usedSkills.add(normalizedSkill)
      usedStarters.add(extractStarter(question))
      usedAngles.add(extractAngle(question))
      return true
    }

    return false
  }

  for (const [index, selected] of selectedSkills.entries()) {
    if (questions.length >= total) {
      break
    }
    appendQuestionForSkill(selected, index)
  }

  if (questions.length < total) {
    for (const [index, selected] of selectedSkills.entries()) {
      if (questions.length >= total) {
        break
      }
      appendQuestionForSkill(selected, index + 100)
    }
  }

  if (questions.length < total) {
    const fallbackSkills = buildJobFirstSkillPool(plan)
      .filter((skill) => !usedSkills.has(normalizeText(skill)))
      .map((skill) => ({
        skill,
        source: jobSkillSet.has(normalizeText(skill)) ? "job" : "resume",
      })) as SelectedInterviewSkill[]

    for (const [index, selected] of fallbackSkills.entries()) {
      if (questions.length >= total) {
        break
      }
      appendQuestionForSkill(selected, index + 200)
    }
  }

  const deduped = dedupeInterviewQuestions(questions).slice(0, total)
  const coverage = computeSkillCoverage(deduped, mergeUniqueSkills(plan.jobSkills, plan.resumeSkills, plan.skillUniverse))

  return {
    questions: deduped,
    skills_covered: coverage.covered,
    skills_remaining: coverage.remaining,
    meta: {
      role_family: plan.roleIntelligence.family,
      role_subfamily: plan.roleIntelligence.subfamily,
      role_confidence: plan.roleIntelligence.confidence,
      adaptive_mode: false,
      question_mode: plan.roleIntelligence.questionMode,
    },
  }
}

function isWeakGenericAnchorSkill(skill: string, roleIntelligence?: RoleIntelligence) {
  const normalized = normalizeText(presentSkillName(skill))
  if (!normalized) {
    return true
  }

  const genericSingles = new Set([
    "data",
    "operations",
    "operation",
    "performance",
    "monitoring",
    "systems",
    "system",
    "process",
    "processes",
    "execution",
    "delivery",
    "quality",
    "reporting",
    "analytics",
    "analysis",
    "support",
    "service",
    "services",
    "database",
    "security",
    "performance optimization",
  ])

  const technicalKeep = [
    "sql",
    "mysql",
    "postgresql",
    "postgres",
    "spark",
    "databricks",
    "etl",
    "airflow",
    "snowflake",
    "dbt",
    "python",
    "java",
    "azure data factory",
    "azure",
    "aws",
    "gcp",
    "api",
  ]

  if (technicalKeep.some((item) => normalized === item || normalized.includes(item))) {
    return false
  }

  if (genericSingles.has(normalized)) {
    return true
  }

  const tokens = normalized.split(/\s+/).filter(Boolean)
  if (tokens.length === 1 && tokens[0].length <= 4) {
    return true
  }

  if (roleIntelligence?.family === "technical") {
    if (tokens.length === 1 && !containsTechnicalLanguage(skill)) {
      return true
    }
  }

  return false
}

function filterSpecificSkillAnchors(skills: string[], roleIntelligence?: RoleIntelligence) {
  const filtered = skills.filter((skill) => !isWeakGenericAnchorSkill(skill, roleIntelligence))
  return filtered.length > 0 ? filtered : skills
}

function isDataEngineeringAnchor(skill: string) {
  const normalized = normalizeText(skill)
  return /(azure data factory|adf|databricks|spark|pyspark|delta lake|data lake|etl pipeline|data pipeline|data warehouse|big data)/.test(normalized)
}

function prioritizeDomainSpecificJobSkills(skills: string[]) {
  const dataAnchors = skills.filter(isDataEngineeringAnchor)
  if (dataAnchors.length === 0) {
    return skills
  }

  const rest = skills.filter((skill) => !isDataEngineeringAnchor(skill))
  return mergeUniqueSkills(dataAnchors, rest)
}

function buildJobFirstSkillPool(plan: RoleQuestionPlan) {
  const specificResume = filterSpecificSkillAnchors(plan.resumeSkills, plan.roleIntelligence)
  const specificUniverse = filterSpecificSkillAnchors(plan.skillUniverse, plan.roleIntelligence)
  const specificFallback = filterSpecificSkillAnchors(plan.roleFallbackSkills, plan.roleIntelligence)

  return prioritizeDomainSpecificJobSkills(mergeUniqueSkills(
    plan.commonSkills,
    plan.missingSkills,
    plan.jobCoverageSkills,
    plan.jobSkills,
    specificFallback,
    specificUniverse,
    specificResume
  ))
}

export function generateBaseInterviewQuestions(input: BaseGenerationInput): BaseGenerationOutput {
  void input
  throw new Error("Old interview pipeline disabled. Use generateInterviewQuestions() from @/lib/interview-flow.")
  const requested = resolveBaseQuestionCount(input) ?? DEFAULT_TOTAL
  const total = Math.min(MAX_BASE_QUESTIONS, Math.max(MIN_BASE_QUESTIONS, requested))
  const {
    roleIntelligence,
    jobSkills,
    resumeSkills,
    roleFallbackSkills,
    skillUniverse,
    commonSkills,
    missingSkills,
    jobCoverageSkills,
    prioritizedSkills,
  } = buildRoleQuestionPlan(input)

  const normalizedJob = new Set(jobSkills.map(normalizeText))
  const normalizedResume = new Set(resumeSkills.map(normalizeText))
  const variationSeed = buildVariationSeed(input)
  const roleSeed = `${roleIntelligence.family}|${roleIntelligence.subfamily ?? ""}|${normalizeExperienceLevel(input.experienceLevel)}|${variationSeed}|${prioritizedSkills.join("|")}`
  const shuffledSkills = shuffleWithSeed(prioritizedSkills, roleSeed)
  const { anchorSkills, remainingPool } = selectTargetSkillsForInterview(
    {
      roleIntelligence,
      jobSkills,
      rawResumeSkills: resumeSkills,
      resumeSkills,
      rawSkillUniverse: skillUniverse,
      roleFallbackSkills,
      skillUniverse,
      commonSkills,
      missingSkills,
      jobCoverageSkills,
      prioritizedSkills,
    },
    total
  )

  const usedSkills = new Set<string>()
  const skillDrivenSkills = pickUniqueSkills(anchorSkills, Math.min(total, anchorSkills.length), usedSkills)
  const maxBehavioralCount = roleIntelligence.family === "technical" ? 1 : Math.round(total * BEHAVIORAL_RATIO)
  const fillBehavioralCount = Math.max(0, Math.min(total - skillDrivenSkills.length, maxBehavioralCount))
  const behavioralSkills = pickUniqueSkills(shuffledSkills, fillBehavioralCount, usedSkills)

  const skillDrivenQuestions = buildQuestionsForSkills(
    skillDrivenSkills,
    0,
    roleIntelligence,
    input.experienceLevel,
    variationSeed
  )
  const behavioralQuestions = deriveBehavioralQuestions(
    fillBehavioralCount,
    behavioralSkills,
    skillDrivenQuestions.length,
    input.experienceLevel
  )

  let combined = [...skillDrivenQuestions, ...behavioralQuestions].slice(0, total)
  if (combined.length < total) {
    const supplementalSkills = pickUniqueSkills(
      buildJobFirstSkillPool({
        roleIntelligence,
        jobSkills,
        rawResumeSkills: resumeSkills,
        resumeSkills,
        rawSkillUniverse: skillUniverse,
        roleFallbackSkills,
        skillUniverse,
        commonSkills,
        missingSkills,
        jobCoverageSkills,
        prioritizedSkills,
      }).filter((skill) => !usedSkills.has(skill)),
      total - combined.length,
      new Set(usedSkills)
    )
    const supplementalQuestions = buildQuestionsForSkills(
      supplementalSkills,
      combined.length,
      roleIntelligence,
      input.experienceLevel,
      variationSeed
    )
    combined = [...combined, ...supplementalQuestions].slice(0, total)
  }
  const regenerated = combined.map((question) => {
    const mappedSkill = question.tags?.[0] ?? mapQuestionToSkill(question.text, skillUniverse).skill
    const normalizedSkillType = normalizeInterviewSkillType(classifySkillType(mappedSkill))
    const quality = validateQuestionQuality({
      question: humanizeQuestion(question.text, normalizedSkillType),
      jobTitle: input.jobTitle,
      jobSkills: skillUniverse,
      previousQuestions: input.previousQuestions ?? [],
      similarityThreshold: input.similarityThreshold ?? 0.8,
    })

    if (quality.status === "accepted") {
      return question
    }

    return regenerateQuestionWithValidation({
      question,
      jobTitle: input.jobTitle,
      jobSkills: skillUniverse,
      previousQuestions: input.previousQuestions ?? [],
      similarityThreshold: input.similarityThreshold ?? 0.8,
    }).question
  })

  const withSkills: EnrichedGeneratedQuestion[] = assignSkillsToQuestions(regenerated, skillUniverse)
  const resumeSkillSet = new Set(resumeSkills.map(normalizeText))
  const jobSkillSet = new Set(jobSkills.map(normalizeText))

  let output: InterviewQuestion[] = withSkills.map((question, index) => {
    const mappedSkill = question.skill ?? mapQuestionToSkill(question.text, skillUniverse).skill
    const normalizedSkillType = normalizeInterviewSkillType(classifySkillType(mappedSkill))

    return {
      id: question.id,
      question: question.text,
      skill: presentSkillName(mappedSkill),
      skill_type: normalizedSkillType,
      skill_bucket: question.skillBucket,
      ...buildQuestionMetadata({
        id: question.id,
        skill: mappedSkill,
        skillType: normalizedSkillType,
        total: withSkills.length,
        index,
        roleIntelligence,
        resumeSkillSet,
        jobSkillSet,
      }),
    }
  }).filter((question) =>
    questionMatchesRoleStyle({
      question: question.question,
      roleIntelligence,
      skillType: classifySkillType(question.skill),
    })
    && questionMentionsSkill(question.question, question.skill)
    && !isTooGenericSkillQuestion(question.question, question.skill)
  )
  output = dedupeInterviewQuestions(output)

  if (output.length < total) {
    const outputSkills = new Set(output.map((question) => normalizeText(question.skill)))
    const supplementalSkills = mergeUniqueSkills(skillUniverse, roleFallbackSkills).filter(
      (skill) => !outputSkills.has(normalizeText(skill))
    )
    const supplementalQuestions = buildQuestionsForSkills(
      supplementalSkills.slice(0, total - output.length),
      output.length,
      roleIntelligence,
      input.experienceLevel,
      variationSeed
    )
    const supplementalWithSkills: EnrichedGeneratedQuestion[] = assignSkillsToQuestions(supplementalQuestions, skillUniverse)
    const supplementalOutput = supplementalWithSkills.map((question, index) => {
      const mappedSkill = question.skill ?? mapQuestionToSkill(question.text, skillUniverse).skill
      const normalizedSkillType = normalizeInterviewSkillType(classifySkillType(mappedSkill))

      return {
        id: question.id,
        question: humanizeQuestion(question.text, normalizedSkillType),
        skill: presentSkillName(mappedSkill),
        skill_type: normalizedSkillType,
        skill_bucket: question.skillBucket,
        ...buildQuestionMetadata({
          id: question.id,
          skill: mappedSkill,
          skillType: normalizedSkillType,
          total,
          index: output.length + index,
          roleIntelligence,
          resumeSkillSet,
          jobSkillSet,
        }),
      }
    }).filter((question) =>
      questionMatchesRoleStyle({
        question: question.question,
        roleIntelligence,
        skillType: classifySkillType(question.skill),
      })
      && questionMentionsSkill(question.question, question.skill)
      && !isTooGenericSkillQuestion(question.question, question.skill)
    )
    output = dedupeInterviewQuestions([...output, ...supplementalOutput]).slice(0, total)
  }

  output = ensureSkillCoverageQuestionSet({
    questions: output,
    total,
    anchorSkills,
    roleIntelligence,
    experienceLevel: input.experienceLevel,
    skillPool: mergeUniqueSkills(jobSkills, resumeSkills, roleFallbackSkills, skillUniverse),
    variationSeed,
    resumeSkillSet,
    jobSkillSet,
  })

  output = rebalanceQuestionSources({
    questions: output,
    total,
    roleIntelligence,
    experienceLevel: input.experienceLevel,
    anchorSkills,
    plan: {
      roleIntelligence,
      jobSkills,
      rawResumeSkills: resumeSkills,
      resumeSkills,
      rawSkillUniverse: skillUniverse,
      roleFallbackSkills,
      skillUniverse,
      commonSkills,
      missingSkills,
      jobCoverageSkills,
      prioritizedSkills,
    },
    variationSeed,
    resumeSkillSet,
    jobSkillSet,
  })
  const coverage = computeSkillCoverage(output, skillUniverse)

  return {
    questions: output,
    skills_covered: coverage.covered,
    skills_remaining: coverage.remaining,
    meta: {
      role_family: roleIntelligence.family,
      role_subfamily: roleIntelligence.subfamily,
      role_confidence: roleIntelligence.confidence,
      adaptive_mode: roleIntelligence.adaptiveMode,
      question_mode: roleIntelligence.questionMode,
    },
  }
}

export async function generateBaseInterviewQuestionsAI(
  input: BaseGenerationInput,
  options?: { requireAi?: boolean }
): Promise<BaseGenerationOutputWithError> {
  void input
  void options
  throw new Error("Old interview pipeline disabled. Use generateInterviewQuestions() from @/lib/interview-flow.")
  const apiKey = (process.env.OPENAI_API_KEY ?? "").trim().replace(/^"|"$/g, "")
  const model = process.env.OPENAI_QUESTION_MODEL ?? OPENAI_QUESTION_MODEL

  try {
    const skillUniverse = buildSkillUniverse(input)
    const roleIntelligence = inferRoleIntelligence(input)
    const generatedQuestions = await generateQuestions(input)
    const mappedQuestions = generatedQuestions.map((item) => ({
      ...item,
      skill_type: classifySkillType(item.skill),
    }))
    const coverage = computeSkillCoverage(mappedQuestions, skillUniverse)

    return {
      questions: mappedQuestions,
      skills_covered: coverage.covered,
      skills_remaining: coverage.remaining,
      meta: {
        role_family: roleIntelligence.family,
        role_confidence: 1.0,
        adaptive_mode: false,
        question_mode: "role_aware",
      },
    }
  } catch {
    // Fall through to the existing strict/fallback generation path.
  }

  return buildStrictSkillQuestions(input)
  const {
    roleIntelligence,
    jobSkills,
    resumeSkills,
    roleFallbackSkills,
    skillUniverse,
    commonSkills,
    missingSkills,
    jobCoverageSkills,
    prioritizedSkills,
  } = buildRoleQuestionPlan(input)

  if (!apiKey) {
    return options?.requireAi
      ? {
          questions: [],
          skills_covered: [],
          skills_remaining: [],
          error_message: "Missing OPENAI_API_KEY",
          meta: {
            role_family: roleIntelligence.family,
            role_subfamily: roleIntelligence.subfamily,
            role_confidence: roleIntelligence.confidence,
            adaptive_mode: roleIntelligence.adaptiveMode,
            question_mode: roleIntelligence.questionMode,
          },
        }
      : generateBaseInterviewQuestions(input)
  }

  const requested = resolveBaseQuestionCount(input) ?? DEFAULT_TOTAL
  const total = Math.min(MAX_BASE_QUESTIONS, Math.max(MIN_BASE_QUESTIONS, requested))
  const previousQuestions = input.previousQuestions ?? []
  if (skillUniverse.length === 0) {
    skillUniverse.push("general workflow")
  }

  const normalizedJob = new Set(jobSkills.map(normalizeText))
  const normalizedResume = new Set(resumeSkills.map(normalizeText))
  const variationSeed = buildVariationSeed(input)
  const shuffledSkills = shuffleWithSeed(
    prioritizedSkills,
    `${roleIntelligence.family}|${roleIntelligence.subfamily ?? ""}|${normalizeExperienceLevel(input.experienceLevel)}|${variationSeed}`
  )
  const { anchorSkills, remainingPool } = selectTargetSkillsForInterview(
    {
      roleIntelligence,
      jobSkills,
      rawResumeSkills: resumeSkills,
      resumeSkills,
      rawSkillUniverse: skillUniverse,
      roleFallbackSkills,
      skillUniverse,
      commonSkills,
      missingSkills,
      jobCoverageSkills,
      prioritizedSkills,
    },
    total
  )
  const usedSkills = new Set<string>()
  const primarySkills = pickUniqueSkills(anchorSkills, Math.min(total, anchorSkills.length), usedSkills)
  const maxBehavioralCount = roleIntelligence.family === "technical" ? 1 : Math.round(total * BEHAVIORAL_RATIO)
  const trailingBehavioralCount = Math.max(0, Math.min(total - primarySkills.length, maxBehavioralCount))
  const behavioralSkills = pickUniqueSkills(shuffledSkills, trailingBehavioralCount, usedSkills)
  const resumeSkillSet = new Set(resumeSkills.map(normalizeText))
  const jobSkillSet = new Set(jobSkills.map(normalizeText))

  const requiredSkills = [...primarySkills, ...behavioralSkills]
  const jobFirstPool = buildJobFirstSkillPool({
    roleIntelligence,
    jobSkills,
    rawResumeSkills: resumeSkills,
    resumeSkills,
    rawSkillUniverse: skillUniverse,
    roleFallbackSkills,
    skillUniverse,
    commonSkills,
    missingSkills,
    jobCoverageSkills,
    prioritizedSkills,
  })
  const baseCandidates = requiredSkills.length > 0 ? requiredSkills : jobFirstPool
  const skillCandidates = baseCandidates.length >= total
    ? baseCandidates
    : [
        ...baseCandidates,
        ...jobFirstPool.filter((skill) => !baseCandidates.includes(skill)).slice(0, total - baseCandidates.length),
      ]

  const accepted: InterviewQuestion[] = []
  const used = new Set<string>()
  const prev = [...previousQuestions]
  const similarityThreshold = input.similarityThreshold ?? 0.8
  const strictMode = options?.requireAi ?? false

  const maxAttempts = 5
  let lastError: string | null = null

  function basicDedupCheck(question: string) {
    const normalized = question.trim()
    if (!normalized) {
      return false
    }
    for (const prevQuestion of prev) {
      if (normalized.toLowerCase() === prevQuestion.toLowerCase()) {
        return false
      }
    }
    return true
  }

  function shouldAcceptQuestion(params: {
    question: string
    skill: string
    attempt: number
  }) {
    if (looksLikeResumeLine(params.question)) {
      return false
    }

    const skillType = classifySkillType(params.skill)
    if (skillType !== "technical" && containsForbiddenNonTechnicalPhrase(params.question)) {
      return false
    }

    if (
      !questionMatchesRoleStyle({
        question: params.question,
        roleIntelligence,
        skillType,
      })
    ) {
      return false
    }

    if (strictMode) {
      if (!basicDedupCheck(params.question)) {
        return false
      }

      const quality = validateQuestionQuality({
        question: params.question,
        jobTitle: input.jobTitle,
        jobSkills: skillUniverse.length > 0 ? skillUniverse : [params.skill],
        previousQuestions: prev,
        similarityThreshold,
      })

      if (quality.status !== "accepted" && !quality.reason.includes("missing real-world scenario")) {
        return false
      }

      return true
    }

    const allowMissingScenario = skillType !== "technical"
    const allowSimilarityRelax = params.attempt >= 2
    const jobSkillsForValidation = skillUniverse.length > 0 ? skillUniverse : [params.skill]
    const relaxedThreshold = allowSimilarityRelax ? Math.min(0.95, similarityThreshold + 0.15) : similarityThreshold

    const quality = validateQuestionQuality({
      question: params.question,
      jobTitle: input.jobTitle,
      jobSkills: jobSkillsForValidation,
      previousQuestions: prev,
      similarityThreshold: relaxedThreshold,
    })

    if (quality.status === "accepted") {
      return true
    }

    if (allowMissingScenario && quality.reason.includes("missing real-world scenario")) {
      return true
    }

    if (allowSimilarityRelax && quality.reason.includes("too similar")) {
      return true
    }

    return false
  }

  async function requestAIQuestions(params: {
    requiredSkills: string[]
    count: number
    attemptNonce: string
  }) {
    const promptPayload = {
      role_context: {
        title: input.jobTitle ?? "",
        jd_context: buildContextSnippet(input.jobDescription),
        resume_context: buildContextSnippet(input.candidateResumeText),
      },
      job_skills: jobSkills,
      resume_skills: resumeSkills,
      role_intelligence: {
        family: roleIntelligence.family,
        subfamily: roleIntelligence.subfamily ?? null,
        confidence: roleIntelligence.confidence,
        adaptive_mode: roleIntelligence.adaptiveMode,
        question_mode: roleIntelligence.questionMode,
      },
      common_skills: commonSkills,
      missing_skills: missingSkills,
      resume_target_skills: primarySkills.filter((skill) => resumeSkillSet.has(normalizeText(skill))),
      job_target_skills: primarySkills.filter((skill) => jobSkillSet.has(normalizeText(skill))),
      behavioral_target_skills: behavioralSkills,
      required_skills: params.requiredSkills.map((skill) => presentSkillName(skill)),
      skill_type_map: Object.fromEntries(
        params.requiredSkills.map((skill) => [presentSkillName(skill), classifySkillType(skill)])
      ),
      existing_questions: prev,
      total_questions: params.count,
      variation_nonce: params.attemptNonce,
      diversity_rules: [
        "use a different phrasing pattern per question",
        "do not reuse openings across runs",
        "avoid mirroring existing questions",
      ],
      non_technical_forbidden_phrases: [
        "troubleshoot",
        "system failing",
        "optimize performance",
        "latency",
        "deployment",
        "rollback",
        "regression",
      ],
                      question_style_rules: {
                        technical: "use tools, systems, debugging, validation, and incident recovery",
                        functional: "use workflow, prioritization, SLA handling, process control, and customer coordination",
                        behavioral: "use real scenarios, ownership, communication, urgency handling, and cross-team tension",
                        analytical: "use metrics, forecasting, service levels, trend reading, and decision support",
                        strategic: "use planning, trade-offs, scaling the process, and long-term improvements",
                        operational: "use execution, dispatch, scheduling, resource allocation, field coordination, and recovery from disruption",
                      },
                      experience_rules: {
                        junior: "ask guided, clearer, foundational questions; prefer explain-how-you-would-approach wording over high-ambiguity leadership trade-offs",
                        mid: "ask scenario-based questions with realistic constraints and decision points",
                        senior: "ask higher-ownership questions involving strategy, ambiguity, trade-offs, stakeholder alignment, and scaling decisions",
                      },
                    }

    const response = await fetch("https://api.openai.com/v1/responses", {
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
                  "Generate interview questions from a structured role-family system. The JD and resume are context only, not source text to copy. Use job_skills and resume_skills as the main anchors. Use role_context only to shape realistic scenarios, terminology, and ownership. Rules: one question per skill, no job titles inside the question body, no locations, no generic phrases. Use structures appropriate to each skill type from question_style_rules. Follow the role_intelligence.question_mode when choosing the questioning style for this role family. Follow experience_rules so fresher/junior roles get guided foundational questions, mid-level roles get realistic scenario questions, and senior/leadership roles get strategy, ambiguity, ownership, and trade-off questions. Technical roles must sound like a real technical interview and use technical language, systems thinking, debugging, architecture, tooling, validation, or incident handling. Non-technical roles must sound like a human business or operational interview and must not use technical failure language such as production, deployment, latency, rollback, debugging, or system failure. Use common_skills for resume-validation questions, missing_skills for coverage/probe questions, and variation_nonce only to vary phrasing. If role_intelligence.adaptive_mode is true, make the first one or two questions exploratory and role-family-aware so the interview can refine what the candidate actually owns. For functional/behavioral/analytical/strategic/operational skills avoid technical phrases listed in non_technical_forbidden_phrases. Never quote the JD or resume directly. Never mention awards, dates, date ranges, employer names, pasted bullet text, or sentence fragments from the resume. Output only JSON.",
              },
            ],
          },
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: JSON.stringify(promptPayload),
              },
            ],
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "interview_questions",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                questions: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      question: { type: "string" },
                      skill: { type: "string" },
                      skill_type: {
                        type: "string",
                        enum: ["technical", "functional", "behavioral", "analytical", "strategic", "operational"],
                      },
                    },
                    required: ["question", "skill", "skill_type"],
                  },
                },
              },
              required: ["questions"],
            },
          },
        },
      }),
    })

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "")
      console.error("OpenAI question generation failed", {
        status: response.status,
        body: errorBody.slice(0, 500),
      })
      lastError = errorBody.slice(0, 500) || `OpenAI error ${response.status}`
      return []
    }

    const payload = (await response.json()) as OpenAIResponsesOutputText
    const outputText = extractStructuredOutputText(payload)
    if (!outputText) {
      lastError = "Empty OpenAI output"
      return []
    }

    const parsed = JSON.parse(outputText) as { questions: Array<{ question: string; skill: string; skill_type: string }> }
    if (!parsed || !Array.isArray(parsed.questions)) {
      lastError = "Invalid OpenAI response payload"
      return []
    }

    return parsed.questions
  }

  for (let attempt = 0; attempt < maxAttempts && accepted.length < total; attempt += 1) {
    const remainingCount = total - accepted.length
    const remainingSkills = skillCandidates.filter((skill) => !used.has(normalizeText(skill)))
      const variationNonce = `${roleIntelligence.family}|${roleIntelligence.subfamily ?? ""}|${normalizeExperienceLevel(input.experienceLevel)}|batch|${attempt}`

    try {
      const questions = await requestAIQuestions({
        requiredSkills: remainingSkills,
        count: remainingCount,
        attemptNonce: variationNonce,
      })

      for (let i = 0; i < questions.length && accepted.length < total; i += 1) {
        const item = questions[i]
        const skillMatch = normalizeSkillMatch(item.skill, skillCandidates) ?? item.skill
        const normalizedSkill = normalizeText(skillMatch)
        if (!normalizedSkill || used.has(normalizedSkill)) {
          continue
        }

        if (!shouldAcceptQuestion({ question: item.question, skill: skillMatch, attempt })) {
          continue
        }
        if (!questionMentionsSkill(item.question, skillMatch)) {
          continue
        }
        if (isTooGenericSkillQuestion(item.question, skillMatch)) {
          continue
        }

        used.add(normalizedSkill)
        prev.push(item.question)
        const id = buildInterviewQuestionId("ai", accepted.length, skillMatch)
        const normalizedSkillType = normalizeInterviewSkillType(item.skill_type || classifySkillType(skillMatch))
        accepted.push({
          id,
          question: humanizeQuestion(item.question, normalizedSkillType),
          skill: presentSkillName(skillMatch),
          skill_type: normalizedSkillType,
          skill_bucket: bucketSkill(skillMatch),
          ...buildQuestionMetadata({
            id,
            skill: skillMatch,
            skillType: normalizedSkillType,
            total,
            index: accepted.length,
            roleIntelligence,
            resumeSkillSet,
            jobSkillSet,
          }),
        })
      }
    } catch (error) {
      console.error("Failed to generate AI questions", error)
      lastError = "OpenAI request failed"
    }
  }

    if (accepted.length < total) {
      const remainingSkills = skillCandidates.filter((skill) => !used.has(normalizeText(skill)))
      for (const skill of remainingSkills) {
        if (accepted.length >= total) {
          break
        }
        let item: { question: string; skill: string; skill_type: string } | null = null
        for (let retry = 0; retry < 5 && !item; retry += 1) {
          const variationNonce = `${roleIntelligence.family}|${roleIntelligence.subfamily ?? ""}|single|retry-${retry}|${skill}`
          const questions = await requestAIQuestions({
            requiredSkills: [skill],
            count: 1,
            attemptNonce: variationNonce,
          })
          if (questions[0]?.question) {
            item = questions[0]
          }
        }

        if (!item) {
          continue
        }

        const finalItem = item!

        const skillMatch = normalizeSkillMatch(finalItem.skill, skillCandidates) ?? skill
        const normalizedSkill = normalizeText(skillMatch)
        if (!normalizedSkill || used.has(normalizedSkill)) {
          continue
        }

        if (!shouldAcceptQuestion({ question: finalItem.question, skill: skillMatch, attempt: 4 })) {
          continue
        }
        if (!questionMentionsSkill(finalItem.question, skillMatch)) {
          continue
        }
        if (isTooGenericSkillQuestion(finalItem.question, skillMatch)) {
          continue
        }

        used.add(normalizedSkill)
        prev.push(finalItem.question)
        const id = buildInterviewQuestionId("ai", accepted.length, skillMatch)
        const normalizedSkillType = normalizeInterviewSkillType(finalItem.skill_type || classifySkillType(skillMatch))
        accepted.push({
          id,
          question: humanizeQuestion(finalItem.question, normalizedSkillType),
          skill: presentSkillName(skillMatch),
          skill_type: normalizedSkillType,
          skill_bucket: bucketSkill(skillMatch),
          ...buildQuestionMetadata({
            id,
            skill: skillMatch,
            skillType: normalizedSkillType,
            total,
            index: accepted.length,
            roleIntelligence,
            resumeSkillSet,
            jobSkillSet,
          }),
        })
      }
    }

    if (accepted.length < total && strictMode) {
      const remainingSkills = skillCandidates.filter((skill) => !used.has(normalizeText(skill)))
      for (const skill of remainingSkills) {
        if (accepted.length >= total) {
          break
        }
        const variationNonce = `${roleIntelligence.family}|${roleIntelligence.subfamily ?? ""}|strict|${skill}`
        const questions = await requestAIQuestions({
          requiredSkills: [skill],
          count: 1,
          attemptNonce: variationNonce,
        })
        const item = questions[0]
        if (!item?.question) {
          continue
        }
        if (!questionMentionsSkill(item.question, skill)) {
          continue
        }
        if (isTooGenericSkillQuestion(item.question, skill)) {
          continue
        }
        const normalizedSkill = normalizeText(skill)
        if (used.has(normalizedSkill)) {
          continue
        }
        used.add(normalizedSkill)
        prev.push(item.question)
        const id = buildInterviewQuestionId("ai", accepted.length, skill)
        const normalizedSkillType = normalizeInterviewSkillType(classifySkillType(skill))
        accepted.push({
          id,
          question: humanizeQuestion(item.question, normalizedSkillType),
          skill: presentSkillName(skill),
          skill_type: normalizedSkillType,
          skill_bucket: bucketSkill(skill),
          ...buildQuestionMetadata({
            id,
            skill,
            skillType: normalizedSkillType,
            total,
            index: accepted.length,
            roleIntelligence,
            resumeSkillSet,
            jobSkillSet,
          }),
        })
      }
    }

  if (accepted.length < total) {
    if (options?.requireAi) {
      const remainingSkills = skillCandidates.filter((skill) => !used.has(normalizeText(skill)))
      const filler = buildQuestionsForSkills(
        remainingSkills,
        accepted.length,
        roleIntelligence,
        input.experienceLevel,
        variationSeed
      )
      const fillerWithSkills = assignSkillsToQuestions(filler, skillUniverse)
      for (const question of fillerWithSkills) {
        if (accepted.length >= total) {
          break
        }
        const normalizedSkill = normalizeText(question.skill ?? question.tags?.[0] ?? "")
        if (!normalizedSkill || used.has(normalizedSkill)) {
          continue
        }
        used.add(normalizedSkill)
        prev.push(question.text)
        const normalizedSkillType = normalizeInterviewSkillType(classifySkillType(question.skill ?? normalizedSkill))
        accepted.push({
          id: question.id,
          question: humanizeQuestion(question.text, normalizedSkillType),
          skill: presentSkillName(question.skill ?? normalizedSkill),
          skill_type: normalizedSkillType,
          skill_bucket: question.skillBucket,
          ...buildQuestionMetadata({
            id: question.id,
            skill: question.skill ?? normalizedSkill,
            skillType: normalizedSkillType,
            total,
            index: accepted.length,
            roleIntelligence,
            resumeSkillSet,
            jobSkillSet,
          }),
        })
      }
    }

    if (accepted.length < total) {
      const fallback = generateBaseInterviewQuestions(input)
      const fallbackNeeded = total - accepted.length
      const fallbackQuestions = fallback.questions.filter((question) => !used.has(normalizeText(question.skill))).slice(0, fallbackNeeded)
      accepted.push(...fallbackQuestions)
    }
  }

  if (accepted.length < total) {
    const supplementalSkillPool = mergeUniqueSkills(skillCandidates, roleFallbackSkills, skillUniverse).filter(
      (skill) => !used.has(normalizeText(skill))
    )
    const supplemental = buildQuestionsForSkills(
      supplementalSkillPool.slice(0, total - accepted.length),
      accepted.length,
      roleIntelligence,
      input.experienceLevel,
      variationSeed
    )
    const supplementalWithSkills: EnrichedGeneratedQuestion[] = assignSkillsToQuestions(supplemental, skillUniverse)
    for (const question of supplementalWithSkills) {
      if (accepted.length >= total) {
        break
      }

      const mappedSkill = question.skill ?? mapQuestionToSkill(question.text, skillUniverse).skill
      const normalizedSkill = normalizeText(mappedSkill)
      if (!normalizedSkill || used.has(normalizedSkill)) {
        continue
      }

      used.add(normalizedSkill)
      const normalizedSkillType = normalizeInterviewSkillType(classifySkillType(mappedSkill))
      accepted.push({
        id: question.id,
        question: humanizeQuestion(question.text, normalizedSkillType),
        skill: presentSkillName(mappedSkill),
        skill_type: normalizedSkillType,
        skill_bucket: question.skillBucket,
        ...buildQuestionMetadata({
          id: question.id,
          skill: mappedSkill,
          skillType: normalizedSkillType,
          total,
          index: accepted.length,
          roleIntelligence,
          resumeSkillSet,
          jobSkillSet,
        }),
      })
    }
  }

  let dedupedAccepted = dedupeInterviewQuestions(accepted).slice(0, total)

  if (dedupedAccepted.length < total) {
    const usedSkillsAfterDedupe = new Set(dedupedAccepted.map((question) => normalizeText(question.skill)))
    const refillSkills = mergeUniqueSkills(skillCandidates, roleFallbackSkills, skillUniverse).filter(
      (skill) => !usedSkillsAfterDedupe.has(normalizeText(skill))
    )
    const refillQuestions = buildQuestionsForSkills(
      refillSkills.slice(0, total - dedupedAccepted.length),
      dedupedAccepted.length,
      roleIntelligence,
      input.experienceLevel,
      variationSeed
    )
    const refillWithSkills: EnrichedGeneratedQuestion[] = assignSkillsToQuestions(refillQuestions, skillUniverse)
    const refillOutput = refillWithSkills.map((question, index) => {
      const mappedSkill = question.skill ?? mapQuestionToSkill(question.text, skillUniverse).skill
      const normalizedSkillType = normalizeInterviewSkillType(classifySkillType(mappedSkill))

      return {
        id: question.id,
        question: humanizeQuestion(question.text, normalizedSkillType),
        skill: presentSkillName(mappedSkill),
        skill_type: normalizedSkillType,
        skill_bucket: question.skillBucket,
        ...buildQuestionMetadata({
          id: question.id,
          skill: mappedSkill,
          skillType: normalizedSkillType,
          total,
          index: dedupedAccepted.length + index,
          roleIntelligence,
          resumeSkillSet,
          jobSkillSet,
        }),
      }
    }).filter((question) =>
      questionMatchesRoleStyle({
        question: question.question,
        roleIntelligence,
        skillType: classifySkillType(question.skill),
      })
      && questionMentionsSkill(question.question, question.skill)
      && !isTooGenericSkillQuestion(question.question, question.skill)
    )

    dedupedAccepted = dedupeInterviewQuestions([...dedupedAccepted, ...refillOutput]).slice(0, total)
  }

  dedupedAccepted = ensureSkillCoverageQuestionSet({
    questions: dedupedAccepted,
    total,
    anchorSkills,
    roleIntelligence,
    experienceLevel: input.experienceLevel,
    skillPool: mergeUniqueSkills(jobSkills, resumeSkills, roleFallbackSkills, skillUniverse),
    variationSeed,
    resumeSkillSet,
    jobSkillSet,
  })

  dedupedAccepted = rebalanceQuestionSources({
    questions: dedupedAccepted,
    total,
    roleIntelligence,
    experienceLevel: input.experienceLevel,
    anchorSkills,
    plan: {
      roleIntelligence,
      jobSkills,
      rawResumeSkills: resumeSkills,
      resumeSkills,
      rawSkillUniverse: skillUniverse,
      roleFallbackSkills,
      skillUniverse,
      commonSkills,
      missingSkills,
      jobCoverageSkills,
      prioritizedSkills,
    },
    variationSeed,
    resumeSkillSet,
    jobSkillSet,
  })

  const coverage = computeSkillCoverage(dedupedAccepted, skillUniverse)

  return {
    questions: dedupedAccepted,
    skills_covered: coverage.covered,
    skills_remaining: coverage.remaining,
    meta: {
      role_family: roleIntelligence.family,
      role_subfamily: roleIntelligence.subfamily,
      role_confidence: roleIntelligence.confidence,
      adaptive_mode: roleIntelligence.adaptiveMode,
      question_mode: roleIntelligence.questionMode,
    },
  }
}

export function decideNextQuestion(input: NextQuestionInput): NextQuestionDecision {
  const fraudScore = input.fraudScore ?? 0
  const analysis =
    input.responseAnalysis ??
    (input.lastQuestion && input.lastAnswer
      ? analyzeCandidateResponse({
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
  const difficulty = analysis?.question_difficulty ?? extractDifficultyForExperience(input.experienceLevel)

  if ((analysis?.suspicion_score ?? fraudScore) >= 0.7 && input.lastQuestion) {
    return {
      intent: "contradiction",
      followUp: {
        follow_up_question: "You mentioned earlier a different detail. Can you clarify what actually happened?",
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
  const critical =
    input.criticalSkills ??
    deriveCriticalSkills(remaining, {
      experienceLevel: input.experienceLevel,
      coreSkills: remaining,
    })

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
    analyzeCandidateResponse({
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
      follow_up_question: "Can you walk me through that step-by-step so the timeline is clear?",
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
    const response = await fetch("https://api.openai.com/v1/responses", {
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
                  "You are generating one adaptive interview follow-up question. Be specific to the candidate answer, skill-focused, concise, and professional. Avoid job titles, locations, and generic phrases like 'tell me about a time'. Use simplification if clarity is low, exploratory if role ownership is still unclear, contradiction if suspicion is high, difficulty_up when the answer is strong and should be stretched, and probe for deeper detail when needed. Return JSON only.",
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
                  enum: ["clarification", "probe", "contradiction", "exploratory", "simplification", "difficulty_up"],
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
      !["clarification", "probe", "contradiction", "exploratory", "simplification", "difficulty_up"].includes(parsed.intent)
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

export function updateSkillState(params: {
  skill: string
  skillsCovered: string[]
  skillsRemaining: string[]
}) {
  const normalizedSkill = normalizeSkillName(params.skill)
  const covered = new Set(params.skillsCovered.map(normalizeSkillName))
  covered.add(normalizedSkill)
  const remaining = params.skillsRemaining
    .map(normalizeSkillName)
    .filter((skill) => skill !== normalizedSkill)

  return {
    skills_covered: Array.from(covered),
    skills_remaining: remaining,
  }
}

export function evaluateCandidateResponse(params: {
  skill: string
  answer: string
  skillType?: InterviewQuestion["skill_type"]
  fraudScore?: number
  experienceLevel?: string
  roleConfidence?: number
  adaptiveMode?: boolean
}) {
  return analyzeCandidateResponse({
    answer: params.answer,
    skill: params.skill,
    skillType: params.skillType,
    fraudScore: params.fraudScore,
    experienceLevel: params.experienceLevel,
    roleConfidence: params.roleConfidence,
    adaptiveMode: params.adaptiveMode,
  })
}

export function scoreAnswer(skill: string, answer: string) {
  return scoreAnswerForSkill(answer, skill) / 5
}
