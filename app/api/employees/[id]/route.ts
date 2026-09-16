import { getRecruiterRequestContext } from "@/lib/server/auth-context"
import { assertCanEmployees } from "@/lib/server/employees/auth"
import { updateEmployeeSchema } from "@/lib/server/employees/validators"
import { errorResponse, successResponse } from "@/lib/server/response"
import { getEmployee, updateEmployee } from "@/lib/server/services/employee"

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await getRecruiterRequestContext(request)
    await assertCanEmployees(auth, "employees.view")
    const { id } = await context.params

    const employee = await getEmployee(auth.organizationId, id)
    return successResponse(employee)
  } catch (error) {
    return errorResponse(error)
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await getRecruiterRequestContext(request)
    await assertCanEmployees(auth, "employees.edit")
    const { id } = await context.params

    const payload = updateEmployeeSchema.parse(await request.json())
    const employee = await updateEmployee(auth.organizationId, id, payload)

    return successResponse(employee)
  } catch (error) {
    return errorResponse(error)
  }
}
