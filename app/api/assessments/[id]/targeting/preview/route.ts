import { getRecruiterRequestContext } from "@/lib/server/auth-context"
import { assertCanEmployees } from "@/lib/server/employees/auth"
import { targetPreviewSchema } from "@/lib/server/employees/validators"
import { errorResponse, successResponse } from "@/lib/server/response"
import { previewAssessmentTarget } from "@/lib/server/services/employee-targeting"

// POST { target, page, pageSize } — who would receive this employee
// assessment: counts (matched / already assigned / new) computed in the
// database, plus one page of the matching employees. Writes nothing.
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await getRecruiterRequestContext(request)
    await assertCanEmployees(auth, "employeeActivities.assign")
    const { id } = await context.params

    const payload = targetPreviewSchema.parse(await request.json())
    return successResponse(
      await previewAssessmentTarget(auth.organizationId, id, payload.target, payload.page, payload.pageSize)
    )
  } catch (error) {
    return errorResponse(error)
  }
}
