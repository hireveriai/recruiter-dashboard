import { z } from "zod"

/**
 * VERIS Assessment validators. Kept in their own module (rather than appended
 * to lib/server/validators.ts) since this feature is deliberately standalone
 * from the existing Screening/Interview validators.
 */

const uuidField = z.string().uuid()

export const ASSESSMENT_QUESTION_TYPES = [
  "SINGLE_CHOICE",
  "MULTI_SELECT",
  "SHORT_ANSWER",
  "SCENARIO",
  "CODING",
] as const

export const ASSESSMENT_DIFFICULTIES = ["JUNIOR", "MID", "SENIOR"] as const

export const ASSESSMENT_STATUSES = ["DRAFT", "PUBLISHED", "ARCHIVED"] as const

// Employee Assessments/Challenges/Tasks — product/UI distinction only, all
// three share this exact persistence pipeline. Defaults preserve today's
// candidate-assessment behavior exactly.
export const ASSESSMENT_ACTIVITY_TYPES = ["ASSESSMENT", "CHALLENGE", "TASK"] as const
export const ASSESSMENT_PARTICIPANT_TYPES = ["CANDIDATE", "EMPLOYEE"] as const

// VERIS Integrity settings, persisted into Assessment.settings.security
// (a generic Json column - no new scalar columns needed). Both flags default
// to off so an assessment created before this feature existed keeps behaving
// exactly as before: no camera prompt, no paste blocking.
export const assessmentSecuritySettingsSchema = z.object({
  blockCopyPaste: z.boolean().default(false),
  cameraMonitoring: z.boolean().default(false),
})

// jobId is required for a CANDIDATE-participant activity ("is this
// candidate suitable for this open job?") but optional for an
// EMPLOYEE-participant one ("does this existing employee have the required
// knowledge/skill/ability?", which has no inherent job to attach to). When
// an employee activity does set jobId, it's optional context only — e.g. a
// target role for future internal mobility, never a requirement.
export const createAssessmentSchema = z
  .object({
    jobId: uuidField.optional().nullable(),
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(4000).optional().nullable(),
    durationMinutes: z.number().int().min(5).max(240).default(30),
    passingPercentage: z.number().min(0).max(100).default(60),
    questionCount: z.number().int().min(1).max(100).optional().nullable(),
    difficulty: z.enum(ASSESSMENT_DIFFICULTIES).optional().nullable(),
    questionTypes: z.array(z.enum(ASSESSMENT_QUESTION_TYPES)).default([]),
    randomizeQuestions: z.boolean().default(false),
    randomizeOptions: z.boolean().default(false),
    linkExpiryDays: z.number().int().min(1).max(90).default(7),
    security: assessmentSecuritySettingsSchema.optional(),
    activityType: z.enum(ASSESSMENT_ACTIVITY_TYPES).default("ASSESSMENT"),
    participantType: z.enum(ASSESSMENT_PARTICIPANT_TYPES).default("CANDIDATE"),
    // Generic tags — technical (SQL, Cloud), functional (Sales, Recruitment),
    // behavioral (Communication, Negotiation), or competency (Conflict
    // Resolution) labels are all just strings here; nothing in this schema
    // assumes a category or industry.
    skills: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
  })
  .refine((value) => value.participantType === "EMPLOYEE" || Boolean(value.jobId), {
    message: "jobId is required for a candidate activity",
    path: ["jobId"],
  })

export const updateAssessmentSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(4000).optional().nullable(),
  durationMinutes: z.number().int().min(5).max(240).optional(),
  passingPercentage: z.number().min(0).max(100).optional(),
  questionCount: z.number().int().min(1).max(100).optional().nullable(),
  difficulty: z.enum(ASSESSMENT_DIFFICULTIES).optional().nullable(),
  questionTypes: z.array(z.enum(ASSESSMENT_QUESTION_TYPES)).optional(),
  randomizeQuestions: z.boolean().optional(),
  randomizeOptions: z.boolean().optional(),
  linkExpiryDays: z.number().int().min(1).max(90).optional(),
  status: z.enum(["DRAFT", "ARCHIVED"]).optional(),
  security: assessmentSecuritySettingsSchema.optional(),
})

export const listAssessmentsQuerySchema = z.object({
  status: z.enum(ASSESSMENT_STATUSES).optional(),
  activityType: z.enum(ASSESSMENT_ACTIVITY_TYPES).optional(),
  participantType: z.enum(ASSESSMENT_PARTICIPANT_TYPES).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

export const generateQuestionsSchema = z.object({
  questionCount: z.number().int().min(1).max(50).optional(),
  questionTypes: z.array(z.enum(ASSESSMENT_QUESTION_TYPES)).optional(),
  difficulty: z.enum(ASSESSMENT_DIFFICULTIES).optional(),
  idempotencyKey: z.string().trim().min(1).max(200).optional(),
})

// A CODING question's language/starter code/test cases, stored inside the
// existing rubric Json column as rubric.codingSpec (no new table/column —
// see the assessment app's lib/server/coding-spec.ts, which reads this
// exact shape). Test cases are graded by actually executing the candidate's
// code, so input/expectedOutput must be exact stdin/stdout values.
export const codingSpecSchema = z.object({
  language: z.string().trim().min(1).max(40),
  starterCode: z.string().max(20000).default(""),
  timeLimitMs: z.number().int().min(500).max(15000).optional(),
  testCases: z
    .array(
      z.object({
        input: z.string().max(5000).default(""),
        expectedOutput: z.string().trim().min(1).max(5000),
        hidden: z.boolean().default(false),
      })
    )
    .min(1)
    .max(20),
})

export const createQuestionSchema = z.object({
  questionType: z.enum(ASSESSMENT_QUESTION_TYPES),
  questionText: z.string().trim().min(1).max(4000),
  points: z.number().min(0).max(1000).default(1),
  orderIndex: z.number().int().min(0).optional(),
  required: z.boolean().default(true),
  rubric: z
    .object({
      criteria: z.array(z.string().trim().min(1)).default([]),
      modelAnswerNotes: z.string().trim().max(4000).optional().nullable(),
    })
    .optional()
    .nullable(),
  codingSpec: codingSpecSchema.optional().nullable(),
  explanation: z.string().trim().max(2000).optional().nullable(),
  options: z
    .array(
      z.object({
        optionText: z.string().trim().min(1).max(1000),
        isCorrect: z.boolean().default(false),
        optionOrder: z.number().int().min(0).optional(),
      })
    )
    .optional(),
})

export const updateQuestionSchema = z.object({
  questionText: z.string().trim().min(1).max(4000).optional(),
  points: z.number().min(0).max(1000).optional(),
  orderIndex: z.number().int().min(0).optional(),
  required: z.boolean().optional(),
  rubric: z
    .object({
      criteria: z.array(z.string().trim().min(1)).default([]),
      modelAnswerNotes: z.string().trim().max(4000).optional().nullable(),
    })
    .optional()
    .nullable(),
  codingSpec: codingSpecSchema.optional().nullable(),
  explanation: z.string().trim().max(2000).optional().nullable(),
})

export const createOptionSchema = z.object({
  optionText: z.string().trim().min(1).max(1000),
  isCorrect: z.boolean().default(false),
  optionOrder: z.number().int().min(0).optional(),
})

export const updateOptionSchema = z.object({
  optionText: z.string().trim().min(1).max(1000).optional(),
  isCorrect: z.boolean().optional(),
  optionOrder: z.number().int().min(0).optional(),
})

export const inviteAssessmentSchema = z
  .object({
    candidateId: uuidField.optional(),
    candidateEmail: z.string().trim().email().optional(),
    candidateName: z.string().trim().min(1).max(200).optional(),
    // Set instead of candidateId/candidateEmail when the target Assessment's
    // participantType is EMPLOYEE. Unlike candidates, an employee is never
    // find-or-created here — they must already exist via the Employees page.
    employeeId: uuidField.optional(),
    versionId: uuidField.optional(),
  })
  .refine(
    (value) => Boolean(value.candidateId) || Boolean(value.candidateEmail) || Boolean(value.employeeId),
    {
      message: "Either candidateId, candidateEmail, or employeeId is required",
      path: ["candidateEmail"],
    },
  )

export const listInvitesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})
