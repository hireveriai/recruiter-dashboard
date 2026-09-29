import { getRecruiterRequestContext } from "@/lib/server/auth-context"
import { assertCanEmployees } from "@/lib/server/employees/auth"
import { updateDepartmentSchema } from "@/lib/server/employees/validators"
import { errorResponse, successResponse } from "@/lib/server/response"
import { getDepartment, updateDepartment } from "@/lib/server/services/org-units"

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await getRecruiterRequestContext(request)
    await assertCanEmployees(auth, "employees.view")
    const { id } = await context.params

    return successResponse(await getDepartment(auth.organizationId, id))
  } catch (error) {
    return errorResponse(error)
  }
}

// Edit, and activate/deactivate via { status }.
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await getRecruiterRequestContext(request)
    await assertCanEmployees(auth, "employees.edit")
    const { id } = await context.params

    const payload = updateDepartmentSchema.parse(await request.json())
    return successResponse(await updateDepartment(auth.organizationId, id, payload))
  } catch (error) {
    return errorResponse(error)
  }
}
