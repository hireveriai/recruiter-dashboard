import { Prisma } from "@prisma/client"
import type { z } from "zod"

import { ApiError } from "@/lib/server/errors"
import { prisma } from "@/lib/server/prisma"
import type {
  createDepartmentSchema,
  createProjectSchema,
  listOrgUnitsQuerySchema,
  updateDepartmentSchema,
  updateProjectSchema,
} from "@/lib/server/employees/validators"

/**
 * Departments and Projects: the two organization-level groupings employees
 * are targeted by. Every query here is scoped by organizationId; ids coming
 * from the client are only ever used together with it. Neither is ever
 * hard-deleted (deactivate instead) so assessment history that references
 * them keeps resolving.
 */

type ListQuery = z.infer<typeof listOrgUnitsQuerySchema>
type CreateDepartmentInput = z.infer<typeof createDepartmentSchema>
type UpdateDepartmentInput = z.infer<typeof updateDepartmentSchema>
type CreateProjectInput = z.infer<typeof createProjectSchema>
type UpdateProjectInput = z.infer<typeof updateProjectSchema>

type OrgUnitRow = {
  id: string
  name: string
  code?: string | null
  description: string | null
  status: string
  created_at: Date
  updated_at: Date
  active_employee_count: number
  employee_count: number
}

function toOrgUnit(row: OrgUnitRow) {
  return {
    id: row.id,
    name: row.name,
    ...(row.code !== undefined ? { code: row.code } : {}),
    description: row.description,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    activeEmployeeCount: Number(row.active_employee_count),
    employeeCount: Number(row.employee_count),
  }
}

function isUniqueViolation(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
}

function blankToNull(value: string | null | undefined) {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

function unitFilters(query: ListQuery, alias: "d" | "p") {
  const parts: Prisma.Sql[] = []
  if (query.status) parts.push(Prisma.sql`${Prisma.raw(alias)}.status = ${query.status}`)
  if (query.search) parts.push(Prisma.sql`${Prisma.raw(alias)}.name ilike ${`%${query.search}%`}`)
  return parts.length ? Prisma.sql`and ${Prisma.join(parts, " and ")}` : Prisma.empty
}

// Departments ------------------------------------------------------------------

async function queryDepartments(organizationId: string, extra: Prisma.Sql) {
  return prisma.$queryRaw<OrgUnitRow[]>(Prisma.sql`
    select d.id::text, d.name, d.description, d.status, d.created_at, d.updated_at,
           count(e.id) filter (where e.status = 'ACTIVE')::int as active_employee_count,
           count(e.id)::int as employee_count
    from public.departments d
    left join public.employees e
      on e.organization_id = d.organization_id and e.department_id = d.id
    where d.organization_id = ${organizationId}::uuid
    ${extra}
    group by d.id
    order by lower(d.name)
  `)
}

export async function listDepartments(organizationId: string, query: ListQuery) {
  const rows = await queryDepartments(organizationId, unitFilters(query, "d"))
  return { departments: rows.map(toOrgUnit) }
}

export async function getDepartment(organizationId: string, departmentId: string) {
  const rows = await queryDepartments(organizationId, Prisma.sql`and d.id = ${departmentId}::uuid`)
  if (!rows[0]) {
    throw new ApiError(404, "DEPARTMENT_NOT_FOUND", "Department not found for this organization")
  }
  return toOrgUnit(rows[0])
}

async function assertDepartmentNameFree(organizationId: string, name: string, exceptId?: string) {
  const clash = await prisma.department.findFirst({
    where: {
      organizationId,
      name: { equals: name, mode: "insensitive" },
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    select: { id: true },
  })
  if (clash) {
    throw new ApiError(409, "DEPARTMENT_NAME_TAKEN", `A department named "${name}" already exists`)
  }
}

export async function createDepartment(organizationId: string, input: CreateDepartmentInput) {
  const name = input.name.trim()
  await assertDepartmentNameFree(organizationId, name)

  try {
    const department = await prisma.department.create({
      data: { organizationId, name, description: blankToNull(input.description), status: input.status },
    })
    return getDepartment(organizationId, department.id)
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ApiError(409, "DEPARTMENT_NAME_TAKEN", `A department named "${name}" already exists`)
    }
    throw error
  }
}

export async function updateDepartment(organizationId: string, departmentId: string, input: UpdateDepartmentInput) {
  await getDepartment(organizationId, departmentId)
  const name = input.name?.trim()
  if (name) await assertDepartmentNameFree(organizationId, name, departmentId)

  try {
    await prisma.$transaction(async (tx) => {
      await tx.department.update({
        where: { id: departmentId },
        data: {
          ...(name ? { name } : {}),
          ...(input.description !== undefined ? { description: blankToNull(input.description) } : {}),
          ...(input.status ? { status: input.status } : {}),
          updatedAt: new Date(),
        },
      })

      // Keep the legacy free-text employees.department (read by the
      // assessment app and results pages) in step with a rename.
      if (name) {
        await tx.employee.updateMany({
          where: { organizationId, departmentId },
          data: { department: name },
        })
      }
    })
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ApiError(409, "DEPARTMENT_NAME_TAKEN", `A department named "${name}" already exists`)
    }
    throw error
  }

  return getDepartment(organizationId, departmentId)
}

// Projects -----------------------------------------------------------------------

async function queryProjects(organizationId: string, extra: Prisma.Sql) {
  return prisma.$queryRaw<OrgUnitRow[]>(Prisma.sql`
    select p.id::text, p.name, p.code, p.description, p.status, p.created_at, p.updated_at,
           count(e.id) filter (where e.status = 'ACTIVE')::int as active_employee_count,
           count(e.id)::int as employee_count
    from public.projects p
    left join public.employee_projects ep
      on ep.organization_id = p.organization_id and ep.project_id = p.id
    left join public.employees e
      on e.organization_id = ep.organization_id and e.id = ep.employee_id
    where p.organization_id = ${organizationId}::uuid
    ${extra}
    group by p.id
    order by lower(p.name)
  `)
}

export async function listProjects(organizationId: string, query: ListQuery) {
  const extra = query.search
    ? Prisma.sql`${unitFilters({ ...query, search: undefined }, "p")} and (p.name ilike ${`%${query.search}%`} or p.code ilike ${`%${query.search}%`})`
    : unitFilters(query, "p")
  const rows = await queryProjects(organizationId, extra)
  return { projects: rows.map(toOrgUnit) }
}

export async function getProject(organizationId: string, projectId: string) {
  const rows = await queryProjects(organizationId, Prisma.sql`and p.id = ${projectId}::uuid`)
  if (!rows[0]) {
    throw new ApiError(404, "PROJECT_NOT_FOUND", "Project not found for this organization")
  }
  return toOrgUnit(rows[0])
}

async function assertProjectIdentityFree(organizationId: string, name: string | undefined, code: string | null | undefined, exceptId?: string) {
  const notSelf = exceptId ? { id: { not: exceptId } } : {}

  if (name) {
    const clash = await prisma.project.findFirst({
      where: { organizationId, name: { equals: name, mode: "insensitive" }, ...notSelf },
      select: { id: true },
    })
    if (clash) throw new ApiError(409, "PROJECT_NAME_TAKEN", `A project named "${name}" already exists`)
  }

  if (code) {
    const clash = await prisma.project.findFirst({
      where: { organizationId, code: { equals: code, mode: "insensitive" }, ...notSelf },
      select: { id: true },
    })
    if (clash) throw new ApiError(409, "PROJECT_CODE_TAKEN", `Project code "${code}" is already in use`)
  }
}

export async function createProject(organizationId: string, input: CreateProjectInput) {
  const name = input.name.trim()
  const code = blankToNull(input.code)
  await assertProjectIdentityFree(organizationId, name, code)

  try {
    const project = await prisma.project.create({
      data: { organizationId, name, code, description: blankToNull(input.description), status: input.status },
    })
    return getProject(organizationId, project.id)
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ApiError(409, "PROJECT_NAME_TAKEN", "A project with this name or code already exists")
    }
    throw error
  }
}

export async function updateProject(organizationId: string, projectId: string, input: UpdateProjectInput) {
  await getProject(organizationId, projectId)
  const name = input.name?.trim()
  const code = input.code !== undefined ? blankToNull(input.code) : undefined
  await assertProjectIdentityFree(organizationId, name, code, projectId)

  try {
    await prisma.project.update({
      where: { id: projectId },
      data: {
        ...(name ? { name } : {}),
        ...(code !== undefined ? { code } : {}),
        ...(input.description !== undefined ? { description: blankToNull(input.description) } : {}),
        ...(input.status ? { status: input.status } : {}),
        updatedAt: new Date(),
      },
    })
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ApiError(409, "PROJECT_NAME_TAKEN", "A project with this name or code already exists")
    }
    throw error
  }

  return getProject(organizationId, projectId)
}

/**
 * Adds employees to a project. Idempotent: employees already on the project
 * are skipped. Every id must be an employee of this organization — the
 * composite FK would reject a foreign one anyway, this just says so clearly.
 */
export async function addProjectMembers(organizationId: string, projectId: string, employeeIds: string[]) {
  const project = await getProject(organizationId, projectId)
  if (project.status !== "ACTIVE") {
    throw new ApiError(409, "PROJECT_INACTIVE", "Reactivate this project before adding employees to it")
  }

  const uniqueIds = [...new Set(employeeIds)]
  const found = await prisma.employee.findMany({
    where: { organizationId, id: { in: uniqueIds } },
    select: { id: true },
  })
  if (found.length !== uniqueIds.length) {
    throw new ApiError(404, "EMPLOYEE_NOT_FOUND", "One or more employees were not found for this organization")
  }

  const { count } = await prisma.employeeProject.createMany({
    data: uniqueIds.map((employeeId) => ({ organizationId, projectId, employeeId })),
    skipDuplicates: true,
  })

  return { added: count, alreadyMembers: uniqueIds.length - count }
}

/**
 * Removes an employee from a project. Only the membership row goes; any
 * assessment the employee was assigned through this project, and its
 * result, stays exactly as it was.
 */
export async function removeProjectMember(organizationId: string, projectId: string, employeeId: string) {
  await getProject(organizationId, projectId)
  const { count } = await prisma.employeeProject.deleteMany({
    where: { organizationId, projectId, employeeId },
  })
  if (count === 0) {
    throw new ApiError(404, "PROJECT_MEMBER_NOT_FOUND", "This employee is not on this project")
  }
  return { removed: count }
}
