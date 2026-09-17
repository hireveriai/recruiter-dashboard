import { NextResponse } from "next/server"

import { getRecruiterRequestContext } from "@/lib/server/auth-context"
import { assertEntitlement } from "@/lib/server/entitlements"
import { errorResponse } from "@/lib/server/response"
import {
  decideInterviewRecovery,
  getInterviewRecoveryAudit,
} from "@/lib/server/services/interview-recovery"

type Params = {
  params: Promise<{ interviewId: string }>
}

type RequestBody = {
  action?: "approve" | "deny" | "expire"
  idempotencyKey?: string
}

export async function GET(request: Request, { params }: Params) {
  try {
    const auth = await getRecruiterRequestContext(request)
    await assertEntitlement(auth, "AI_INTERVIEW")
    const { interviewId } = await params
    const events = await getInterviewRecoveryAudit(auth.organizationId, interviewId)

    return NextResponse.json({
      success: true,
      data: {
        events,
      },
    })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function POST(request: Request, { params }: Params) {
  try {
    const auth = await getRecruiterRequestContext(request)
    await assertEntitlement(auth, "AI_INTERVIEW")
    const { interviewId } = await params
    const body = (await request.json().catch(() => ({}))) as RequestBody
    const action = body.action ?? "approve"

    const result = await decideInterviewRecovery({
      organizationId: auth.organizationId,
      recruiterId: auth.userId,
      interviewId,
      action,
      idempotencyKey: body.idempotencyKey,
    })

    return NextResponse.json({
      success: true,
      data: result,
    })
  } catch (error) {
    return errorResponse(error)
  }
}
