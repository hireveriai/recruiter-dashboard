import type { z } from "zod"

import { ApiError } from "@/lib/server/errors"
import { prisma } from "@/lib/server/prisma"
import type { createEmployeeSchema, listEmployeesQuerySchema, updateEmployeeSchema } from "@/lib/server/employees/validators"

type CreateEmployeeInput = z.infer<typeof createEmployeeSchema>
type UpdateEmployeeInput = z.infer<typeof updateEmployeeSchema>
type ListEmployeesQuery = z.infer<typeof listEmployeesQuerySchema>

export async function listEmployees(organizationId: string, query: ListEmployeesQuery) {
  const where = {
    organizationId,
    ...(query.status ? { status: query.status } : {}),
    ...(query.search
      ? {
          OR: [
            { fullName: { contains: query.search, mode: "insensitive" as const } },
            { email: { contains: query.search, mode: "insensitive" as const } },
          ],
        }
      : {}),
  }

  const [total, employees] = await Promise.all([
    prisma.employee.count({ where }),
    prisma.employee.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ])

  return {
    employees,
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

  return prisma.employee.create({
    data: {
      organizationId,
      fullName: input.fullName.trim(),
      email,
      managerUserId: input.managerUserId ?? null,
      department: input.department?.trim() || null,
      title: input.title?.trim() || null,
      status: input.status,
    },
  })
}

export async function getEmployee(organizationId: string, employeeId: string) {
  const employee = await prisma.employee.findFirst({
    where: { id: employeeId, organizationId },
  })
  if (!employee) {
    throw new ApiError(404, "EMPLOYEE_NOT_FOUND", "Employee not found for this organization")
  }
  return employee
}

export async function updateEmployee(organizationId: string, employeeId: string, input: UpdateEmployeeInput) {
  await getEmployee(organizationId, employeeId)

  return prisma.employee.update({
    where: { id: employeeId },
    data: {
      ...(input.fullName !== undefined ? { fullName: input.fullName.trim() } : {}),
      ...(input.managerUserId !== undefined ? { managerUserId: input.managerUserId } : {}),
      ...(input.department !== undefined ? { department: input.department?.trim() || null } : {}),
      ...(input.title !== undefined ? { title: input.title?.trim() || null } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      updatedAt: new Date(),
    },
  })
}
