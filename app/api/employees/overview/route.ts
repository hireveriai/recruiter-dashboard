import { getRecruiterRequestContext } from "@/lib/server/auth-context"
import { assertCanEmployees } from "@/lib/server/employees/auth"
import { errorResponse, successResponse } from "@/lib/server/response"
import { getEmployeeProgramOverview } from "@/lib/server/services/employee"

// Setup progress for the Employees area's guided flow (counts only).
export async function GET(request: Request) {
  try {
    const auth = await getRecruiterRequestContext(request)
    await assertCanEmployees(auth, "employees.view")

    return successResponse(await getEmployeeProgramOverview(auth.organizationId))
  } catch (error) {
    return errorResponse(error)
  }
}
