import { getRecruiterRequestContext } from "@/lib/server/auth-context"
import { assertCanEmployees } from "@/lib/server/employees/auth"
import { assignAssessmentSchema } from "@/lib/server/employees/validators"
import { errorResponse, successResponse } from "@/lib/server/response"
import { assignAssessmentToTarget } from "@/lib/server/services/employee-targeting"

// Large departments are emailed in batches of 100 after the invites commit.
export const maxDuration = 300

// POST { target } — assign a published employee assessment to every active
// employee matching the target who does not already have it, and email them.
// Idempotent: repeating the call assigns nobody twice.
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await getRecruiterRequestContext(request)
    await assertCanEmployees(auth, "employeeActivities.assign")
    const { id } = await context.params

    const payload = assignAssessmentSchema.parse(await request.json())
    return successResponse(await assignAssessmentToTarget(auth, id, payload.target), 201)
  } catch (error) {
    return errorResponse(error)
  }
}
