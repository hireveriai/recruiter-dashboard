import { z } from "zod"

/**
 * Employee Assessments/Challenges/Tasks validators. Kept in their own module,
 * mirroring lib/server/assessment/validators.ts, since this feature is
 * deliberately standalone from the existing Screening/Interview validators.
 */

const uuidField = z.string().uuid()

export const EMPLOYEE_STATUSES = ["ACTIVE", "INACTIVE"] as const
export const ORG_UNIT_STATUSES = ["ACTIVE", "INACTIVE"] as const

const optionalText = (max: number) => z.string().trim().max(max).optional().nullable()
// Accepts "YYYY-MM-DD" (a date input's value); empty string clears it.
const optionalDate = z
  .union([z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"), z.literal("")])
  .optional()
  .nullable()

// fullName is still accepted on its own (the pre-existing Add Employee
// payload), but firstName/lastName are preferred and, when given, are the
// source of fullName.
export const createEmployeeSchema = z
  .object({
    employeeCode: optionalText(64),
    firstName: optionalText(100),
    lastName: optionalText(100),
    fullName: optionalText(200),
    email: z.string().trim().email(),
    phone: optionalText(40),
    managerUserId: uuidField.optional().nullable(),
    departmentId: uuidField.optional().nullable(),
    // Legacy free-text department. Ignored when departmentId is given.
    department: optionalText(200),
    projectIds: z.array(uuidField).max(50).optional(),
    title: optionalText(200),
    joiningDate: optionalDate,
    status: z.enum(EMPLOYEE_STATUSES).default("ACTIVE"),
  })
  .refine((value) => Boolean(value.firstName?.trim() || value.fullName?.trim()), {
    message: "First name is required",
    path: ["firstName"],
  })

export const updateEmployeeSchema = z.object({
  employeeCode: optionalText(64),
  firstName: optionalText(100),
  lastName: optionalText(100),
  fullName: z.string().trim().min(1).max(200).optional(),
  email: z.string().trim().email().optional(),
  phone: optionalText(40),
  managerUserId: uuidField.optional().nullable(),
  departmentId: uuidField.optional().nullable(),
  department: optionalText(200),
  // When present, replaces the employee's project memberships.
  projectIds: z.array(uuidField).max(50).optional(),
  title: optionalText(200),
  joiningDate: optionalDate,
  status: z.enum(EMPLOYEE_STATUSES).optional(),
})

export const listEmployeesQuerySchema = z.object({
  status: z.enum(EMPLOYEE_STATUSES).optional(),
  search: z.string().trim().max(200).optional(),
  departmentId: uuidField.optional(),
  projectId: uuidField.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

export const manageReviewSchema = z.object({
  score: z.number().min(0).max(1000),
  feedback: z.string().trim().max(4000).optional().nullable(),
})

// Departments / Projects -------------------------------------------------------

export const createDepartmentSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: optionalText(1000),
  status: z.enum(ORG_UNIT_STATUSES).default("ACTIVE"),
})

export const updateDepartmentSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: optionalText(1000),
  status: z.enum(ORG_UNIT_STATUSES).optional(),
})

export const createProjectSchema = z.object({
  name: z.string().trim().min(1).max(120),
  code: optionalText(40),
  description: optionalText(1000),
  status: z.enum(ORG_UNIT_STATUSES).default("ACTIVE"),
})

export const updateProjectSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  code: optionalText(40),
  description: optionalText(1000),
  status: z.enum(ORG_UNIT_STATUSES).optional(),
})

export const listOrgUnitsQuerySchema = z.object({
  status: z.enum(ORG_UNIT_STATUSES).optional(),
  search: z.string().trim().max(120).optional(),
})

export const projectMembersSchema = z.object({
  employeeIds: z.array(uuidField).min(1).max(500),
})

// Assessment targeting ----------------------------------------------------------

export const ASSESSMENT_TARGET_TYPES = ["INDIVIDUAL", "DEPARTMENT", "PROJECT", "DEPARTMENT_PROJECT"] as const

export const assessmentTargetSchema = z
  .object({
    targetType: z.enum(ASSESSMENT_TARGET_TYPES),
    departmentId: uuidField.optional().nullable(),
    projectId: uuidField.optional().nullable(),
    employeeIds: z.array(uuidField).max(1000).optional(),
  })
  .superRefine((value, ctx) => {
    const needsDepartment = value.targetType === "DEPARTMENT" || value.targetType === "DEPARTMENT_PROJECT"
    const needsProject = value.targetType === "PROJECT" || value.targetType === "DEPARTMENT_PROJECT"

    if (needsDepartment && !value.departmentId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["departmentId"], message: "Select a department" })
    }
    if (needsProject && !value.projectId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["projectId"], message: "Select a project" })
    }
    if (value.targetType === "INDIVIDUAL" && !value.employeeIds?.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["employeeIds"], message: "Select at least one employee" })
    }
  })
  .transform((value) => ({
    targetType: value.targetType,
    // Normalized so a stray id for an unused dimension never widens or
    // narrows the match.
    departmentId:
      value.targetType === "DEPARTMENT" || value.targetType === "DEPARTMENT_PROJECT" ? value.departmentId ?? null : null,
    projectId: value.targetType === "PROJECT" || value.targetType === "DEPARTMENT_PROJECT" ? value.projectId ?? null : null,
    employeeIds: value.targetType === "INDIVIDUAL" ? [...new Set(value.employeeIds ?? [])] : [],
  }))

export const targetPreviewSchema = z.object({
  target: assessmentTargetSchema,
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(25),
})

export const assignAssessmentSchema = z.object({
  target: assessmentTargetSchema,
})

export const listAssignmentsQuerySchema = z.object({
  status: z.enum(["PENDING", "COMPLETED"]).optional(),
  search: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
})
