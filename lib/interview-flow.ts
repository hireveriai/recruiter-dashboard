import {
  type BaseGenerationInput,
  type InterviewQuestion,
  generateQuestions as generateRoleAwareQuestionSet,
} from "@/lib/server/ai/interview-flow"
import { validateQuestionStrict } from "@/lib/question-validator"
import {
  classifySkillType,
  bucketSkill,
  deriveSkillsFromText,
  normalizeSkillName,
  presentSkillName,
  sanitizeSkillList,
} from "@/lib/server/ai/skills"
import {
  classifyInterviewQuestion,
  InterviewQuestionType,
} from "@/lib/server/ai/interview-question-types"

function resolveSeniorityLevel(level?: string) {
  const normalized = String(level ?? "").toLowerCase().trim()
  if (/senior|lead|staff|principal|manager|head|director/.test(normalized)) {
    return "senior"
  }
  if (/mid|intermediate|3|4|5/.test(normalized)) {
    return "mid"
  }
  return "junior"
}

function buildResumeQuestion(skill: string, index: number, seniorityLevel: "junior" | "mid" | "senior") {
  const displaySkill = presentSkillName(skill)
  const templatesByLevel = {
    junior: [
      `How have you used ${displaySkill} in recent projects to solve routine problems?`,
      `Walk me through a recent task where you applied ${displaySkill} directly.`,
      `What would you check first when using ${displaySkill} under time pressure?`,
    ],
    mid: [
      `How have you used ${displaySkill} under delivery pressure in recent projects?`,
      `Walk me through using ${displaySkill} when priorities changed during execution.`,
      `What trade-offs matter when applying ${displaySkill} under moderate constraints?`,
    ],
    senior: [
      `How do you keep ${displaySkill} reliable under peak pressure and changing constraints?`,
      `Walk me through leading ${displaySkill} decisions under ambiguity and scale.`,
      `How do you design around ${displaySkill} when failures threaten critical outcomes?`,
    ],
  } as const
  const templates = templatesByLevel[seniorityLevel]

  return templates[index % templates.length]
}

const TECHNICAL_RESUME_ONLY_PATTERNS = [
  /\b(api|backend|frontend|coding|debug|deployment|devops|docker|kubernetes|latency|logging|monitoring|patching|programming|rollback|sre|system|troubleshoot)\b/i,
  /\b(database|dba|etl|mysql|postgres|postgresql|query|redis|sql)\b/i,
  /\b(aws|azure|gcp|java|javascript|node|python|react|typescript)\b/i,
]

const NON_TECH_ROLE_PATTERNS = [
  /\b(customer|support|service|operations|manager|lead|head|director|finance|banking|medical|healthcare|govt|government|hr|sales|marketing|procurement|legal|compliance|education|training|logistics|warehouse|manufacturing)\b/i,
]

function isTechnicalResumeOnlySkill(skill: string) {
  return TECHNICAL_RESUME_ONLY_PATTERNS.some((pattern) => pattern.test(skill))
}

function isClearlyNonTechnicalRole(input: BaseGenerationInput) {
  const corpus = `${input.jobTitle ?? ""} ${input.jobDescription ?? ""} ${(input.coreSkills ?? []).join(" ")}`
  const hasNonTechnicalSignal = NON_TECH_ROLE_PATTERNS.some((pattern) => pattern.test(corpus))
  const hasTechnicalRoleSignal = /\b(software|developer|engineer|programmer|data engineer|database administrator|dba|devops|sre|qa automation|full stack|frontend|backend|cloud|cybersecurity)\b/i.test(corpus)

  return hasNonTechnicalSignal && !hasTechnicalRoleSignal
}

function filterResumeSkillsForJobFit(input: BaseGenerationInput, resumeSkills: string[], jobSkills: string[]) {
  const normalizedJobSkills = new Set(jobSkills.map(normalizeSkillName))
  const nonTechnicalRole = isClearlyNonTechnicalRole(input)

  const filtered = resumeSkills.filter((skill) => {
    const normalizedSkill = normalizeSkillName(skill)

    if (normalizedJobSkills.has(normalizedSkill)) {
      return true
    }

    if (nonTechnicalRole && isTechnicalResumeOnlySkill(skill)) {
      return false
    }

    return true
  })

  return filtered
}

function isCodingRequired(input: BaseGenerationInput) {
  const requirement = String(input.codingRequired ?? "").toUpperCase()
  return requirement === "YES" || (requirement === "AUTO" && input.codingRecommended === true)
}

export function resolveInterviewQuestionTarget(input: Pick<BaseGenerationInput, "interviewDurationMinutes" | "totalQuestions">, generatedCount = 0) {
  const duration = Number(input.interviewDurationMinutes ?? 30)
  const durationMinimum =
    duration >= 60
      ? 15
      : duration >= 45
        ? 12
        : duration >= 30
          ? 8
          : 5
  const requestedTotal = Number(input.totalQuestions)

  if (Number.isFinite(requestedTotal) && requestedTotal > 0) {
    return Math.max(Math.round(requestedTotal), durationMinimum)
  }

  return Math.max(durationMinimum, generatedCount || 0)
}

function buildCodingQuestion(input: BaseGenerationInput) {
  const assessmentType = String(input.codingAssessmentType ?? "").toUpperCase()
  const language = (input.codingLanguages ?? []).find((item) => item?.trim())?.trim()
  const corpus = `${input.jobTitle ?? ""} ${input.jobDescription ?? ""} ${(input.coreSkills ?? []).join(" ")} ${assessmentType}`.toLowerCase()

  if (assessmentType === "SQL" || /\b(sql|database|postgres|postgresql|mysql|oracle|query)\b/.test(corpus)) {
    return {
      skill: "SQL query design",
      question:
        "Write a SQL query that returns the most active users during the last thirty days.",
    }
  }

  if (assessmentType === "DEBUGGING") {
    return {
      skill: "Debugging",
      question:
        "Debug a failing function and implement the smallest safe fix for its root cause.",
    }
  }

  if (assessmentType === "BACKEND_LOGIC" || /\b(api|backend|service|node|java|python|spring|express)\b/.test(corpus)) {
    return {
      skill: "Backend logic",
      question:
        `Implement a ${language || "TypeScript"} function that validates an API payload and returns a typed success or error result.`,
    }
  }

  if (assessmentType === "DSA" || /\b(algorithm|data structure|dsa)\b/.test(corpus)) {
    return {
      skill: "Problem solving",
      question:
        `Implement a ${language || "programming"} function that removes duplicates from a list while preserving the original order.`,
    }
  }

  return {
    skill: language ? `${language} coding` : "Practical coding",
    question:
      `Implement a ${language || "TypeScript"} function that groups records by status while preserving their original order.`,
  }
}

function buildCodingInterviewQuestion(input: BaseGenerationInput, index: number): InterviewQuestion {
  const coding = buildCodingQuestion(input)
  const questionId = `coding-${index}`

  return {
    id: questionId,
    question: coding.question,
    skill: coding.skill,
    skill_type: "technical",
    skill_bucket: bucketSkill(coding.skill),
    source_type: "job",
    reference_context: {
      anchor: coding.skill,
      source: "coding_assessment",
    },
    is_dynamic: true,
    allow_followups: true,
    question_type: InterviewQuestionType.CODING,
    classifier_confidence: 0.94,
    recruiter_override: false,
    rendering_mode: "code_editor",
    phase_hint: index <= 1 ? "warmup" : "core",
  }
}

function mapQuestion(
  question: {
    id: string
    question: string
    skill: string
    source_type?: "resume" | "job" | "behavioral" | "adaptive"
  },
  index: number
): InterviewQuestion {
  const displaySkill = presentSkillName(question.skill)
  const skillType = classifySkillType(displaySkill)
  const classification = classifyInterviewQuestion(question.question, undefined, [
    displaySkill,
  ])
  const questionId = question.id || `q-${index}`
  const sourceType = question.source_type === "resume" ? "resume" : question.source_type === "behavioral" ? "behavioral" : "job"

  return {
    id: questionId,
    question: question.question,
    skill: displaySkill,
    skill_type: skillType,
    skill_bucket: bucketSkill(displaySkill),
    source_type: sourceType,
    reference_context: {
      anchor: `${displaySkill}:${questionId}`,
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
  }
}

export async function generateInterviewQuestions(
  input: BaseGenerationInput
): Promise<InterviewQuestion[]> {
  const generated = await generateRoleAwareQuestionSet(input)
  const seniorityLevel = resolveSeniorityLevel(input.experienceLevel)
  const totalQuestions = resolveInterviewQuestionTarget(input, generated.length)
  const targetResumeCount = Math.min(
    2,
    Math.max(1, Math.round(totalQuestions * 0.3)),
  )
  const jobSkills = Array.from(new Set([
    ...sanitizeSkillList(input.coreSkills ?? [], {
      jobTitle: input.jobTitle,
      jobDescription: input.jobDescription,
    }),
    ...deriveSkillsFromText(input.jobDescription),
  ])).map(normalizeSkillName)
  const rawResumeSkills = Array.from(new Set([
    ...sanitizeSkillList(input.candidateResumeSkills ?? [], {
      jobTitle: input.jobTitle,
      jobDescription: input.jobDescription,
    }),
    ...deriveSkillsFromText(input.candidateResumeText),
  ])).map(normalizeSkillName)
  const resumeSkills = filterResumeSkillsForJobFit(input, rawResumeSkills, jobSkills)
  const resumeOnlySkills = resumeSkills.filter((skill) => !jobSkills.includes(skill))
  const selectedResumeSkills = (resumeOnlySkills.length > 0 ? resumeOnlySkills : resumeSkills)
    .slice(0, targetResumeCount)

  const generatedQuestions = generated.map((question, index) => mapQuestion(question, index))
  const keptJobQuestions = generatedQuestions
    .filter((question) => question.source_type !== "resume")
    .slice(0, Math.max(0, totalQuestions - selectedResumeSkills.length))

  const injectedResumeQuestions = selectedResumeSkills.map((skill, index) => {
    const retakeVariantOffset = (input.previousQuestions?.length ?? 0) % 3
    const questionText = buildResumeQuestion(skill, index + retakeVariantOffset, seniorityLevel)
    const safeQuestion = validateQuestionStrict(questionText).valid
      ? questionText
      : seniorityLevel === "senior"
        ? `How do you design ${presentSkillName(skill)} for resilience under pressure?`
        : seniorityLevel === "mid"
          ? `How have you used ${presentSkillName(skill)} under delivery pressure at work?`
          : `How have you used ${presentSkillName(skill)} in recent projects at work?`

    return mapQuestion(
      {
        id: `resume-${index}`,
        question: safeQuestion,
        skill,
        source_type: "resume",
      },
      keptJobQuestions.length + index
    )
  })

  const finalQuestions = [...keptJobQuestions, ...injectedResumeQuestions].slice(0, totalQuestions)

  if (!isCodingRequired(input)) {
    return finalQuestions
  }

  const codingQuestion = buildCodingInterviewQuestion(input, finalQuestions.length)
  const withoutExistingCoding = finalQuestions.filter((question) => question.question_type !== InterviewQuestionType.CODING)

  if (withoutExistingCoding.length >= totalQuestions) {
    withoutExistingCoding.splice(Math.max(1, Math.min(withoutExistingCoding.length - 1, 2)), 1, codingQuestion)
    return withoutExistingCoding.slice(0, totalQuestions)
  }

  return [codingQuestion, ...withoutExistingCoding].slice(0, totalQuestions)
}

export type { BaseGenerationInput, InterviewQuestion } from "@/lib/server/ai/interview-flow"
