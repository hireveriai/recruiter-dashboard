import { NextRequest, NextResponse } from "next/server"

import { getRecruiterRequestContext } from "@/lib/server/auth-context"
import { assertEntitlement } from "@/lib/server/entitlements"
import { ApiError } from "@/lib/server/errors"
import { errorResponse, successResponse } from "@/lib/server/response"
import { updateJobScreenActiveState, upsertJobScreenData } from "@/lib/server/services/recruiter-screen-writes"
import { updateJobSchema } from "@/lib/server/validators"

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ jobId: string }> }
) {
  try {
    const auth = await getRecruiterRequestContext(request)
    await assertEntitlement(auth, "AI_INTERVIEW")
    const { jobId } = await context.params
    const payload = await request.json()

    if (!jobId) {
      throw new ApiError(400, "INVALID_JOB_ID", "jobId is required")
    }

    if (typeof payload?.is_active === "boolean" && Object.keys(payload).length === 1) {
      const result = await updateJobScreenActiveState({
        job_id: jobId,
        organization_id: auth.organizationId,
        is_active: payload.is_active,
      })

      return successResponse(result)
    }

    const parsed = updateJobSchema.parse(payload)
    const result = await upsertJobScreenData({
      ...parsed,
      job_id: jobId,
      organization_id: auth.organizationId,
    })

    return NextResponse.json({
      success: true,
      data: result,
    })
  } catch (error) {
    return errorResponse(error)
  }
}
