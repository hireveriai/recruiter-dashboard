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
] as const

export const ASSESSMENT_DIFFICULTIES = ["JUNIOR", "MID", "SENIOR"] as const

export const ASSESSMENT_STATUSES = ["DRAFT", "PUBLISHED", "ARCHIVED"] as const

export const createAssessmentSchema = z.object({
  jobId: uuidField,
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
})

export const listAssessmentsQuerySchema = z.object({
  status: z.enum(ASSESSMENT_STATUSES).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

export const generateQuestionsSchema = z.object({
  questionCount: z.number().int().min(1).max(50).optional(),
  questionTypes: z.array(z.enum(ASSESSMENT_QUESTION_TYPES)).optional(),
  difficulty: z.enum(ASSESSMENT_DIFFICULTIES).optional(),
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

export const inviteAssessmentSchema = z.object({
  candidateId: uuidField,
  versionId: uuidField.optional(),
})

export const listInvitesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})
