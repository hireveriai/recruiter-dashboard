import { getRecruiterRequestContext } from "@/lib/server/auth-context"
import { assertEntitlement } from "@/lib/server/entitlements"
import { errorResponse, successResponse } from "@/lib/server/response"
import { upsertJobScreenData } from "@/lib/server/services/recruiter-screen-writes"
import { createJobSchema } from "@/lib/server/validators"

export async function POST(request: Request) {
  try {
    const auth = await getRecruiterRequestContext(request)
    await assertEntitlement(auth, "AI_INTERVIEW")
    const payload = createJobSchema.parse(await request.json())
    const result = await upsertJobScreenData({
      ...payload,
      organization_id: auth.organizationId,
    })
    return successResponse(result, 201)
  } catch (error) {
    return errorResponse(error)
  }
}
