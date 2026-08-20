import { z } from "zod"

import { getRecruiterRequestContext } from "@/lib/server/auth-context"
import { ApiError } from "@/lib/server/errors"
import { applyDeviceCookie, getRequestOrigin } from "@/lib/server/request-origin"
import { errorResponse, successResponse } from "@/lib/server/response"
import { getRecruiterProfile } from "@/lib/server/services/recruiter-profile"
import {
  getRecruiterTrialState,
  requestRecruiterTrial,
} from "@/lib/server/services/trial-requests"
import { sendTrialRequestEmails } from "@/lib/services/email.service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const requestSchema = z.object({
  companyWebsite: z
    .string()
    .trim()
    .max(255)
    .optional()
    .nullable(),
  companyName: z.string().trim().max(255).optional().nullable(),
})

function noStore(response: Response) {
  response.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
  return response
}

export async function GET(request: Request) {
  try {
    const auth = await getRecruiterRequestContext(request)
    const state = await getRecruiterTrialState(auth.organizationId)
    return noStore(successResponse(state))
  } catch (error) {
    return errorResponse(error)
  }
}

export async function POST(request: Request) {
  try {
    const auth = await getRecruiterRequestContext(request)
    const body = await request.json().catch(() => ({}))
    const payload = requestSchema.parse(body ?? {})

    // Reuse whatever the workspace already knows about the recruiter; the
    // form only ever asks for what is genuinely missing.
    const profile = await getRecruiterProfile(auth)

    if (!profile.email) {
      throw new ApiError(400, "RECRUITER_EMAIL_MISSING", "Your workspace is missing a work email address.")
    }

    const origin = getRequestOrigin(request)

    const state = await requestRecruiterTrial({
      organizationId: auth.organizationId,
      userId: auth.userId,
      email: profile.email,
      // Recruiters reach the dashboard only through an OTP-verified session.
      emailVerified: true,
      companyName: payload.companyName?.trim() || profile.organization || null,
      companyWebsite: payload.companyWebsite?.trim() || null,
      origin: {
        ip: origin.ip,
        userAgent: origin.userAgent,
        deviceHash: origin.deviceHash,
      },
    })

    // Notifications must never fail the request itself.
    void sendTrialRequestEmails({
      kind: "RECRUITER",
      status: state.status,
      to: profile.email,
      name: profile.name,
      companyName: profile.organization,
      requestId: state.requestId,
    }).catch((error) => {
      console.warn("Trial request notification failed", error)
    })

    return applyDeviceCookie(noStore(successResponse(state)), origin)
  } catch (error) {
    return errorResponse(error)
  }
}
