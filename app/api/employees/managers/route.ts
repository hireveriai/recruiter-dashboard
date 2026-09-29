import { getRecruiterRequestContext } from "@/lib/server/auth-context"
import { assertCanEmployees } from "@/lib/server/employees/auth"
import { errorResponse, successResponse } from "@/lib/server/response"
import { listManagerOptions } from "@/lib/server/services/employee"

// Staff users of this organization, for the employee form's Manager field.
export async function GET(request: Request) {
  try {
    const auth = await getRecruiterRequestContext(request)
    await assertCanEmployees(auth, "employees.view")

    return successResponse(await listManagerOptions(auth.organizationId))
  } catch (error) {
    return errorResponse(error)
  }
}
