import { z } from "zod"

/**
 * Employee Assessments/Challenges/Tasks validators. Kept in their own module,
 * mirroring lib/server/assessment/validators.ts, since this feature is
 * deliberately standalone from the existing Screening/Interview validators.
 */

const uuidField = z.string().uuid()

export const EMPLOYEE_STATUSES = ["ACTIVE", "INACTIVE"] as const

export const createEmployeeSchema = z.object({
  fullName: z.string().trim().min(1).max(200),
  email: z.string().trim().email(),
  managerUserId: uuidField.optional().nullable(),
  department: z.string().trim().max(200).optional().nullable(),
  title: z.string().trim().max(200).optional().nullable(),
  status: z.enum(EMPLOYEE_STATUSES).default("ACTIVE"),
})

export const updateEmployeeSchema = z.object({
  fullName: z.string().trim().min(1).max(200).optional(),
  managerUserId: uuidField.optional().nullable(),
  department: z.string().trim().max(200).optional().nullable(),
  title: z.string().trim().max(200).optional().nullable(),
  status: z.enum(EMPLOYEE_STATUSES).optional(),
})

export const listEmployeesQuerySchema = z.object({
  status: z.enum(EMPLOYEE_STATUSES).optional(),
  search: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

export const manageReviewSchema = z.object({
  score: z.number().min(0).max(1000),
  feedback: z.string().trim().max(4000).optional().nullable(),
})
