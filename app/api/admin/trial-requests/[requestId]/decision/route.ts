import { z } from "zod"

import { getRecruiterRequestContext } from "@/lib/server/auth-context"
import { requirePlatformAdmin } from "@/lib/server/platform-admin"
import { errorResponse, successResponse } from "@/lib/server/response"
import {
  approveTrialRequest,
  getTrialRequestForAdmin,
  rejectTrialRequest,
} from "@/lib/server/services/trial-requests"
import { sendTrialDecisionEmail } from "@/lib/services/email.service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const decisionSchema = z.object({
  decision: z.enum(["APPROVE", "REJECT"]),
  reason: z.string().trim().max(500).optional().nullable(),
})

export async function POST(
  request: Request,
  context: { params: Promise<{ requestId: string }> }
) {
  try {
    const auth = await getRecruiterRequestContext(request)
    const admin = await requirePlatformAdmin(auth)
    const { requestId } = await context.params
    const payload = decisionSchema.parse(await request.json())

    const result =
      payload.decision === "APPROVE"
        ? await approveTrialRequest({ requestId, actor: admin.email, reason: payload.reason })
        : await rejectTrialRequest({ requestId, actor: admin.email, reason: payload.reason })

    // `granted` is true only when this call actually issued the credits, so a
    // second click sends no second email and adds no second grant.
    if (result.granted || payload.decision === "REJECT") {
      const row = await getTrialRequestForAdmin(result.requestId).catch(() => null)

      if (row?.contactEmail) {
        void sendTrialDecisionEmail({
          kind: row.requestType === "RECRUITER_TRIAL" ? "RECRUITER" : "CANDIDATE",
          decision: payload.decision,
          to: row.contactEmail,
          companyName: row.companyName,
          requestId: result.requestId,
        }).catch((error) => {
          console.warn("Trial decision notification failed", error)
        })
      }
    }

    return successResponse(result)
  } catch (error) {
    return errorResponse(error)
  }
}
