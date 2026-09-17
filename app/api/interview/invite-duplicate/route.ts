import { NextResponse } from "next/server"

import { getRecruiterRequestContext } from "@/lib/server/auth-context"
import { assertEntitlement } from "@/lib/server/entitlements"
import { getLatestInterviewInviteForEmail } from "@/lib/server/services/interview.service"
import { errorResponse } from "@/lib/server/response"

export const runtime = "nodejs"

export async function POST(request: Request) {
  try {
    const auth = await getRecruiterRequestContext(request)
    await assertEntitlement(auth, "AI_INTERVIEW")
    const body = await request.json().catch(() => ({}))
    const email = String(body.email ?? body.candidateEmail ?? body.candidate_email ?? "").trim().toLowerCase()

    const latest = email
      ? await getLatestInterviewInviteForEmail({
          companyId: auth.organizationId,
          candidateEmail: email,
        })
      : null

    return NextResponse.json({
      success: true,
      warning: Boolean(latest),
      lastSentAt: latest?.lastSentAt ?? null,
    })
  } catch (error) {
    return errorResponse(error)
  }
}
