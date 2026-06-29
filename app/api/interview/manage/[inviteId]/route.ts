import { getRecruiterRequestContext } from "@/lib/server/auth-context"
import { errorResponse, successResponse } from "@/lib/server/response"
import { revokeInterviewInviteSchema, updateInterviewInviteSchema } from "@/lib/server/validators"
import { revokeInterviewInvite, updateInterviewInvite } from "@/lib/server/services/interview.service"
import { refundExpiredUnusedInterviewCredits } from "@/lib/server/services/trial-credits"

type RouteContext = {
  params: Promise<{
    inviteId: string
  }>
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const auth = await getRecruiterRequestContext(request)
    const body = await request.json()
    const parsed = updateInterviewInviteSchema.parse(body)
    const { inviteId } = await context.params

    const result = await updateInterviewInvite({
      inviteId: String(inviteId ?? "").trim(),
      organizationId: auth.organizationId,
      accessType: parsed.accessType,
      startTime: parsed.startTime ?? null,
      endTime: parsed.endTime ?? null,
    })

    return successResponse(result)
  } catch (error) {
    return errorResponse(error)
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const auth = await getRecruiterRequestContext(request)
    const body = await request.json().catch(() => ({}))
    const parsed = revokeInterviewInviteSchema.parse(body)
    const { inviteId } = await context.params

    const result = await revokeInterviewInvite({
      inviteId: String(inviteId ?? "").trim(),
      organizationId: auth.organizationId,
      reason: parsed.reason ?? null,
    })

    await refundExpiredUnusedInterviewCredits({
      organizationId: auth.organizationId,
      inviteIds: [result.inviteId],
    }).catch((error) => {
      console.warn("Unable to refund revoked unused interview invite", error)
    })

    return successResponse(result)
  } catch (error) {
    return errorResponse(error)
  }
}
