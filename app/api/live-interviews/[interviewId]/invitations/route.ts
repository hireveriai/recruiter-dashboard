import { errorResponse, successResponse } from "@/lib/server/response"
import { revokeLiveInvitation, sendLiveInvitations } from "@/lib/server/services/live-interviews"
import { requireVerisLiveRecruiter } from "@/lib/server/veris-live/route-guard"

export const dynamic = "force-dynamic"

type Params = { params: Promise<{ interviewId: string }> }

/** Send or resend invitations. Body: { participantIds?: string[] }. Tokens are never returned. */
export async function POST(request: Request, { params }: Params) {
  try {
    const auth = await requireVerisLiveRecruiter(request)
    const { interviewId } = await params
    const body = (await request.json().catch(() => ({}))) as { participantIds?: unknown }
    const participantIds = Array.isArray(body.participantIds) ? body.participantIds.map(String) : undefined
    const result = await sendLiveInvitations({ organizationId: auth.organizationId, interviewId, participantIds })
    return successResponse(result)
  } catch (error) {
    return errorResponse(error)
  }
}

/** Revoke one participant's link. Body: { participantId }. */
export async function DELETE(request: Request, { params }: Params) {
  try {
    const auth = await requireVerisLiveRecruiter(request)
    const { interviewId } = await params
    const body = (await request.json().catch(() => ({}))) as { participantId?: unknown }
    await revokeLiveInvitation({ organizationId: auth.organizationId, interviewId, participantId: String(body.participantId ?? "") })
    return successResponse({ revoked: true })
  } catch (error) {
    return errorResponse(error)
  }
}
