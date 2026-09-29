import { getRecruiterRequestContext } from "@/lib/server/auth-context"
import { assertCanEmployees, hasOrgWideEmployeeActivityAccess } from "@/lib/server/employees/auth"
import { listAssignmentsQuerySchema } from "@/lib/server/employees/validators"
import { errorResponse, successResponse } from "@/lib/server/response"
import { listAssessmentAssignments } from "@/lib/server/services/employee-targeting"

// GET — employee-level assignment status and results for one employee
// assessment (paginated), plus Assigned/Completed/Pending/Average/Pass rate.
// Same visibility rule as the results route: without the org-wide
// employeeActivities.manage permission, only the caller's direct reports.
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await getRecruiterRequestContext(request)
    await assertCanEmployees(auth, "employeeActivities.view_results")
    const { id } = await context.params

    const url = new URL(request.url)
    const query = listAssignmentsQuerySchema.parse({
      status: url.searchParams.get("status") ?? undefined,
      search: url.searchParams.get("search") ?? undefined,
      page: url.searchParams.get("page") ?? undefined,
      pageSize: url.searchParams.get("pageSize") ?? undefined,
    })

    const managerScope = (await hasOrgWideEmployeeActivityAccess(auth)) ? null : auth.userId
    return successResponse(await listAssessmentAssignments(auth.organizationId, id, query, managerScope))
  } catch (error) {
    return errorResponse(error)
  }
}
