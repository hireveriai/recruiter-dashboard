import { z } from "zod"

import { getRecruiterRequestContext } from "@/lib/server/auth-context"
import { assertCanEmployees } from "@/lib/server/employees/auth"
import { projectMembersSchema } from "@/lib/server/employees/validators"
import { errorResponse, successResponse } from "@/lib/server/response"
import { addProjectMembers, removeProjectMember } from "@/lib/server/services/org-units"

// Members are listed through GET /api/employees?projectId=...

// POST { employeeIds } — add employees to the project (idempotent).
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await getRecruiterRequestContext(request)
    await assertCanEmployees(auth, "employees.edit")
    const { id } = await context.params

    const payload = projectMembersSchema.parse(await request.json())
    return successResponse(await addProjectMembers(auth.organizationId, id, payload.employeeIds))
  } catch (error) {
    return errorResponse(error)
  }
}

// DELETE ?employeeId=... — remove one employee from the project.
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await getRecruiterRequestContext(request)
    await assertCanEmployees(auth, "employees.edit")
    const { id } = await context.params

    const employeeId = z.string().uuid().parse(new URL(request.url).searchParams.get("employeeId"))
    return successResponse(await removeProjectMember(auth.organizationId, id, employeeId))
  } catch (error) {
    return errorResponse(error)
  }
}
