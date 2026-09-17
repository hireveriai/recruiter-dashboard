import { NextResponse } from "next/server"

import { getRecruiterRequestContext } from "@/lib/server/auth-context"
import { assertEntitlement } from "@/lib/server/entitlements"
import { ApiError } from "@/lib/server/errors"
import { errorResponse } from "@/lib/server/response"
import { normalizeEmail, updateCandidateEmail } from "@/lib/server/ai-screening/service"

export const runtime = "nodejs"

type RouteContext = {
  params: Promise<{
    candidateId: string
  }>
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const auth = await getRecruiterRequestContext(request)
    await assertEntitlement(auth, "SCREENING")
    const { candidateId } = await context.params
    const body = (await request.json()) as {
      email?: string | null
    }
    const rawEmail = typeof body.email === "string" ? body.email.trim() : ""
    const email = rawEmail ? normalizeEmail(rawEmail) : null

    if (rawEmail && !email) {
      throw new ApiError(400, "INVALID_EMAIL", "Enter a valid candidate email")
    }

    const result = await updateCandidateEmail({
      organizationId: auth.organizationId,
      candidateId,
      email,
    })

    return NextResponse.json({
      success: true,
      data: result,
    })
  } catch (error) {
    return errorResponse(error)
  }
}
