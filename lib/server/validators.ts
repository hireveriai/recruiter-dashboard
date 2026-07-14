import { z } from "zod"

const uuidField = z.string().uuid()
const questionTypeControl = z
  .enum([
    "AUTO",
    "coding",
    "technical_discussion",
    "system_design",
    "behavioral",
    "architecture",
    "troubleshooting",
    "mcq",
    "case_study",
  ])
  .default("AUTO")

const deviceRequirement = z.enum(["DESKTOP_ONLY", "MOBILE_ONLY", "ANY_DEVICE"]).default("ANY_DEVICE")

export const createJobSchema = z.object({
  organization_id: uuidField.optional(),
  job_title: z.string().trim().min(1),
  job_description: z.string().trim().optional().nullable(),
  experience_level_id: z.number().int().positive(),
  core_skills: z.array(z.string().trim().min(1)).default([]),
  difficulty_profile: z.enum(["JUNIOR", "MID", "SENIOR"]).default("MID"),
  interview_duration_minutes: z.union([z.literal(30), z.literal(45), z.literal(60)]).default(30),
  question_type_default: questionTypeControl,
  device_requirement: deviceRequirement,
  coding_required: z.enum(["NO", "YES", "AUTO"]).default("AUTO"),
  coding_assessment_type: z
    .enum(["LIVE_CODING", "DEBUGGING", "SQL", "BACKEND_LOGIC", "DSA"])
    .optional()
    .nullable(),
  coding_difficulty: z.enum(["EASY", "MEDIUM", "HARD"]).optional().nullable(),
  coding_duration_minutes: z.number().int().optional().nullable(),
  coding_languages: z.array(z.string().trim().min(1)).default([]),
  skill_baseline: z
    .array(
      z.object({
        skill_domain: z.string().trim().min(1),
        expected_level: z.number().int().min(1).max(4),
      })
    )
    .default([]),
})

export const updateJobSchema = z.object({
  job_title: z.string().trim().min(1),
  job_description: z.string().trim().optional().nullable(),
  experience_level_id: z.number().int().positive(),
  core_skills: z.array(z.string().trim().min(1)).default([]),
  difficulty_profile: z.enum(["JUNIOR", "MID", "SENIOR"]).default("MID"),
  interview_duration_minutes: z.union([z.literal(30), z.literal(45), z.literal(60)]).default(30),
  question_type_default: questionTypeControl,
  device_requirement: deviceRequirement,
  coding_required: z.enum(["NO", "YES", "AUTO"]).default("AUTO"),
  coding_assessment_type: z
    .enum(["LIVE_CODING", "DEBUGGING", "SQL", "BACKEND_LOGIC", "DSA"])
    .optional()
    .nullable(),
  coding_difficulty: z.enum(["EASY", "MEDIUM", "HARD"]).optional().nullable(),
  coding_duration_minutes: z.number().int().optional().nullable(),
  coding_languages: z.array(z.string().trim().min(1)).default([]),
  is_active: z.boolean().optional(),
})

export const createInterviewConfigSchema = z.object({
  job_id: uuidField,
  template_id: uuidField,
  coding_weight: z.number().int().min(0).max(100).optional(),
  verbal_weight: z.number().int().min(0).max(100).optional(),
  system_design_weight: z.number().int().min(0).max(100).optional(),
  total_duration_minutes: z.number().int().positive().optional(),
  mode: z.string().trim().min(1).default("AI"),
})

export const createCandidateSchema = z.object({
  email: z.string().trim().email(),
  jobId: uuidField.optional(),
  job_id: uuidField.optional(),
  name: z.string().trim().min(1).optional(),
  fullName: z.string().trim().min(1).optional(),
})
.refine((value) => Boolean(value.name || value.fullName), {
  message: "name is required",
  path: ["name"],
})
.refine((value) => Boolean(value.jobId || value.job_id), {
  message: "jobId is required",
  path: ["jobId"],
})

export const inviteInterviewSchema = z.object({
  interview_id: uuidField,
  candidate_id: uuidField,
})

export const validateInterviewTokenSchema = z.object({
  token: z.string().trim().min(1),
})

export const updateInterviewInviteSchema = z.object({
  accessType: z.enum(["FLEXIBLE", "SCHEDULED"]),
  startTime: z.string().datetime().optional().nullable(),
  endTime: z.string().datetime().optional().nullable(),
})
.refine((value) => {
  if (value.accessType !== "SCHEDULED") {
    return true
  }

  return Boolean(value.startTime && value.endTime)
}, {
  message: "startTime and endTime are required for scheduled interviews",
  path: ["startTime"],
})

export const revokeInterviewInviteSchema = z.object({
  reason: z.string().trim().min(1).max(500).optional().nullable(),
})
