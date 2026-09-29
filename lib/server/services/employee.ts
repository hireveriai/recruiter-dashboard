import { Prisma } from "@prisma/client"
import type { z } from "zod"

import { ApiError } from "@/lib/server/errors"
import { prisma } from "@/lib/server/prisma"
import type { createEmployeeSchema, listEmployeesQuerySchema, updateEmployeeSchema } from "@/lib/server/employees/validators"

type CreateEmployeeInput = z.infer<typeof createEmployeeSchema>
type UpdateEmployeeInput = z.infer<typeof updateEmployeeSchema>
type ListEmployeesQuery = z.infer<typeof listEmployeesQuerySchema>
type Tx = Prisma.TransactionClient

type EmployeeRecord = Awaited<ReturnType<typeof prisma.employee.findFirst>> & object

function blankToNull(value: string | null | undefined) {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

function splitFullName(fullName: string) {
  const trimmed = fullName.trim().replace(/\s+/g, " ")
  const space = trimmed.indexOf(" ")
  return space === -1
    ? { firstName: trimmed, lastName: null }
    : { firstName: trimmed.slice(0, space), lastName: trimmed.slice(space + 1) }
}

function joinName(firstName: string | null | undefined, lastName: string | null | undefined) {
  return [firstName?.trim(), lastName?.trim()].filter(Boolean).join(" ")
}

function toDateOnly(value: string | null | undefined) {
  if (value === undefined) return undefined
  return value ? new Date(`${value}T00:00:00.000Z`) : null
}

function isUniqueViolation(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
}

/**
 * Resolves departmentId to a department of THIS organization. A department
 * must be active to have employees moved into it; an employee who is merely
 * staying in a department that was later deactivated is left alone.
 */
async function resolveDepartment(organizationId: string, departmentId: string, currentDepartmentId?: string | null) {
  const department = await prisma.department.findFirst({
    where: { id: departmentId, organizationId },
    select: { id: true, name: true, status: true },
  })
  if (!department) {
    throw new ApiError(404, "DEPARTMENT_NOT_FOUND", "Department not found for this organization")
  }
  if (department.status !== "ACTIVE" && department.id !== currentDepartmentId) {
    throw new ApiError(409, "DEPARTMENT_INACTIVE", `${department.name} is inactive. Reactivate it before adding employees to it.`)
  }
  return department
}

/** Same rule as departments: new memberships only on active projects. */
async function resolveProjects(organizationId: string, projectIds: string[], currentProjectIds: string[] = []) {
  const uniqueIds = [...new Set(projectIds)]
  if (uniqueIds.length === 0) return []

  const projects = await prisma.project.findMany({
    where: { organizationId, id: { in: uniqueIds } },
    select: { id: true, name: true, status: true },
  })
  if (projects.length !== uniqueIds.length) {
    throw new ApiError(404, "PROJECT_NOT_FOUND", "One or more projects were not found for this organization")
  }
  const inactive = projects.find((project) => project.status !== "ACTIVE" && !currentProjectIds.includes(project.id))
  if (inactive) {
    throw new ApiError(409, "PROJECT_INACTIVE", `${inactive.name} is inactive. Reactivate it before adding employees to it.`)
  }
  return projects
}

/** The manager must be a staff user of this organization. */
async function assertManagerInOrganization(organizationId: string, managerUserId: string) {
  const manager = await prisma.user.findFirst({
    where: { userId: managerUserId, organizationId },
    select: { userId: true },
  })
  if (!manager) {
    throw new ApiError(404, "MANAGER_NOT_FOUND", "Manager not found for this organization")
  }
}

async function assertEmployeeCodeFree(organizationId: string, employeeCode: string, exceptId?: string) {
  const clash = await prisma.employee.findFirst({
    where: { organizationId, employeeCode, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true },
  })
  if (clash) {
    throw new ApiError(409, "EMPLOYEE_CODE_TAKEN", `Employee ID ${employeeCode} is already in use`)
  }
}

async function replaceProjects(tx: Tx, organizationId: string, employeeId: string, projectIds: string[]) {
  await tx.employeeProject.deleteMany({
    where: { organizationId, employeeId, projectId: { notIn: projectIds } },
  })
  if (projectIds.length) {
    await tx.employeeProject.createMany({
      data: projectIds.map((projectId) => ({ organizationId, employeeId, projectId })),
      skipDuplicates: true,
    })
  }
}

/**
 * Adds department, projects and manager display data to employee rows —
 * separate lookups rather than Prisma relations, per this schema's
 * plain-scalar-FK convention.
 */
async function decorateEmployees(organizationId: string, employees: EmployeeRecord[]) {
  if (employees.length === 0) return []

  const employeeIds = employees.map((employee) => employee.id)
  const departmentIds = [...new Set(employees.map((e) => e.departmentId).filter((v): v is string => Boolean(v)))]
  const managerIds = [...new Set(employees.map((e) => e.managerUserId).filter((v): v is string => Boolean(v)))]

  const [departments, links, managers] = await Promise.all([
    departmentIds.length
      ? prisma.department.findMany({
          where: { organizationId, id: { in: departmentIds } },
          select: { id: true, name: true, status: true },
        })
      : Promise.resolve([]),
    prisma.employeeProject.findMany({
      where: { organizationId, employeeId: { in: employeeIds } },
      select: { employeeId: true, projectId: true },
    }),
    managerIds.length
      ? prisma.user.findMany({
          where: { organizationId, userId: { in: managerIds } },
          select: { userId: true, fullName: true, email: true },
        })
      : Promise.resolve([]),
  ])

  const projectIds = [...new Set(links.map((link) => link.projectId))]
  const projects = projectIds.length
    ? await prisma.project.findMany({
        where: { organizationId, id: { in: projectIds } },
        select: { id: true, name: true, code: true, status: true },
        orderBy: { name: "asc" },
      })
    : []

  const departmentById = new Map(departments.map((d) => [d.id, d]))
  const projectById = new Map(projects.map((p) => [p.id, p]))
  const managerById = new Map(managers.map((m) => [m.userId, m]))
  const projectsByEmployee = new Map<string, typeof projects>()
  for (const link of links) {
    const project = projectById.get(link.projectId)
    if (!project) continue
    const list = projectsByEmployee.get(link.employeeId) ?? []
    list.push(project)
    projectsByEmployee.set(link.employeeId, list)
  }

  return employees.map((employee) => {
    const manager = employee.managerUserId ? managerById.get(employee.managerUserId) : null
    return {
      ...employee,
      departmentInfo: employee.departmentId ? departmentById.get(employee.departmentId) ?? null : null,
      projects: (projectsByEmployee.get(employee.id) ?? []).sort((a, b) => a.name.localeCompare(b.name)),
      manager: manager ? { userId: manager.userId, fullName: manager.fullName, email: manager.email } : null,
    }
  })
}

export async function listEmployees(organizationId: string, query: ListEmployeesQuery) {
  const where: Prisma.EmployeeWhereInput = {
    organizationId,
    ...(query.status ? { status: query.status } : {}),
    ...(query.departmentId ? { departmentId: query.departmentId } : {}),
    ...(query.search
      ? {
          OR: [
            { fullName: { contains: query.search, mode: "insensitive" as const } },
            { email: { contains: query.search, mode: "insensitive" as const } },
            { employeeCode: { contains: query.search, mode: "insensitive" as const } },
            { title: { contains: query.search, mode: "insensitive" as const } },
          ],
        }
      : {}),
  }

  // Project filter: resolved to member ids inside the same organization.
  if (query.projectId) {
    const members = await prisma.employeeProject.findMany({
      where: { organizationId, projectId: query.projectId },
      select: { employeeId: true },
    })
    where.id = { in: members.map((member) => member.employeeId) }
  }

  const [total, employees] = await Promise.all([
    prisma.employee.count({ where }),
    prisma.employee.findMany({
      where,
      orderBy: [{ fullName: "asc" }, { id: "asc" }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ])

  return {
    employees: await decorateEmployees(organizationId, employees),
    meta: {
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    },
  }
}

export async function createEmployee(organizationId: string, input: CreateEmployeeInput) {
  const email = input.email.trim().toLowerCase()

  const existing = await prisma.employee.findFirst({
    where: { organizationId, email: { equals: email, mode: "insensitive" } },
  })
  if (existing) {
    throw new ApiError(409, "EMPLOYEE_ALREADY_EXISTS", "An employee with this email already exists in this organization")
  }

  const names = input.firstName?.trim()
    ? { firstName: input.firstName.trim(), lastName: blankToNull(input.lastName) }
    : splitFullName(input.fullName ?? "")
  const fullName = joinName(names.firstName, names.lastName)

  const employeeCode = blankToNull(input.employeeCode)
  if (employeeCode) await assertEmployeeCodeFree(organizationId, employeeCode)
  if (input.managerUserId) await assertManagerInOrganization(organizationId, input.managerUserId)

  const department = input.departmentId ? await resolveDepartment(organizationId, input.departmentId) : null
  const projects = await resolveProjects(organizationId, input.projectIds ?? [])

  try {
    const employee = await prisma.$transaction(async (tx) => {
      const created = await tx.employee.create({
        data: {
          organizationId,
          fullName,
          firstName: names.firstName,
          lastName: names.lastName,
          email,
          employeeCode,
          phone: blankToNull(input.phone),
          managerUserId: input.managerUserId ?? null,
          departmentId: department?.id ?? null,
          // Legacy free text, kept in sync with the department's name.
          department: department ? department.name : blankToNull(input.department),
          title: blankToNull(input.title),
          joiningDate: toDateOnly(input.joiningDate) ?? null,
          status: input.status,
        },
      })
      await replaceProjects(tx, organizationId, created.id, projects.map((p) => p.id))
      return created
    })
    return getEmployee(organizationId, employee.id)
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ApiError(409, "EMPLOYEE_ALREADY_EXISTS", "An employee with this email or employee ID already exists")
    }
    throw error
  }
}

export async function getEmployee(organizationId: string, employeeId: string) {
  const employee = await prisma.employee.findFirst({
    where: { id: employeeId, organizationId },
  })
  if (!employee) {
    throw new ApiError(404, "EMPLOYEE_NOT_FOUND", "Employee not found for this organization")
  }
  const [decorated] = await decorateEmployees(organizationId, [employee])
  return decorated
}

export async function updateEmployee(organizationId: string, employeeId: string, input: UpdateEmployeeInput) {
  const current = await getEmployee(organizationId, employeeId)

  let names: { firstName: string | null; lastName: string | null; fullName: string } | null = null
  if (input.firstName !== undefined || input.lastName !== undefined) {
    const firstName = input.firstName !== undefined ? blankToNull(input.firstName) : current.firstName
    const lastName = input.lastName !== undefined ? blankToNull(input.lastName) : current.lastName
    if (!firstName) {
      throw new ApiError(400, "VALIDATION_ERROR", "firstName: First name is required")
    }
    names = { firstName, lastName, fullName: joinName(firstName, lastName) }
  } else if (input.fullName !== undefined) {
    // Pre-existing payload shape (fullName only).
    const split = splitFullName(input.fullName)
    names = { ...split, fullName: joinName(split.firstName, split.lastName) }
  }

  const employeeCode = input.employeeCode !== undefined ? blankToNull(input.employeeCode) : undefined
  if (employeeCode) await assertEmployeeCodeFree(organizationId, employeeCode, employeeId)
  if (input.managerUserId) await assertManagerInOrganization(organizationId, input.managerUserId)

  const email = input.email?.trim().toLowerCase()
  if (email && email !== current.email.toLowerCase()) {
    const clash = await prisma.employee.findFirst({
      where: { organizationId, email: { equals: email, mode: "insensitive" }, id: { not: employeeId } },
      select: { id: true },
    })
    if (clash) {
      throw new ApiError(409, "EMPLOYEE_ALREADY_EXISTS", "An employee with this email already exists in this organization")
    }
  }

  let departmentData: { departmentId: string | null; department: string | null } | undefined
  if (input.departmentId !== undefined) {
    const department = input.departmentId
      ? await resolveDepartment(organizationId, input.departmentId, current.departmentId)
      : null
    departmentData = { departmentId: department?.id ?? null, department: department?.name ?? null }
  } else if (input.department !== undefined && !current.departmentId) {
    // Legacy free-text edit, only for employees not yet on a department.
    departmentData = { departmentId: null, department: blankToNull(input.department) }
  }

  const projects =
    input.projectIds !== undefined
      ? await resolveProjects(
          organizationId,
          input.projectIds,
          current.projects.map((p) => p.id)
        )
      : undefined

  try {
    await prisma.$transaction(async (tx) => {
      await tx.employee.update({
        where: { id: employeeId },
        data: {
          ...(names ? names : {}),
          ...(email ? { email } : {}),
          ...(employeeCode !== undefined ? { employeeCode } : {}),
          ...(input.phone !== undefined ? { phone: blankToNull(input.phone) } : {}),
          ...(input.managerUserId !== undefined ? { managerUserId: input.managerUserId } : {}),
          ...(departmentData ?? {}),
          ...(input.title !== undefined ? { title: blankToNull(input.title) } : {}),
          ...(input.joiningDate !== undefined ? { joiningDate: toDateOnly(input.joiningDate) ?? null } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          updatedAt: new Date(),
        },
      })
      if (projects) {
        await replaceProjects(tx, organizationId, employeeId, projects.map((p) => p.id))
      }
    })
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ApiError(409, "EMPLOYEE_ALREADY_EXISTS", "Another employee already uses this email or employee ID")
    }
    throw error
  }

  return getEmployee(organizationId, employeeId)
}

/** Staff users of this organization who can be set as an employee's manager. */
export async function listManagerOptions(organizationId: string) {
  const users = await prisma.user.findMany({
    where: {
      organizationId,
      isActive: true,
      teamRemovedAt: null,
      role: { in: ["RECRUITER", "ORG_OWNER", "ADMIN"] },
    },
    select: { userId: true, fullName: true, email: true },
    orderBy: [{ fullName: "asc" }, { email: "asc" }],
    take: 500,
  })
  return { managers: users }
}
