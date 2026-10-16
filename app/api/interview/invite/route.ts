import { Prisma } from "@prisma/client"

import { getRecruiterRequestContext } from "@/lib/server/auth-context"
import { assertEntitlement } from "@/lib/server/entitlements"
import { ApiError } from "@/lib/server/errors"
import { prisma } from "@/lib/server/prisma"
import { createInterviewInvite } from "@/lib/server/services/invite"
import { errorResponse, successResponse } from "@/lib/server/response"
import { inviteInterviewSchema } from "@/lib/server/validators"

export async function POST(request: Request) {
  try {
    const auth = await getRecruiterRequestContext(request)
    await assertEntitlement(auth, "AI_INTERVIEW")
    const payload = inviteInterviewSchema.parse(await request.json())

    const owned = await prisma.$queryRaw<Array<{ interview_id: string }>>(Prisma.sql`
      select i.interview_id::text as interview_id
      from public.interviews i
      where i.interview_id = ${payload.interview_id}::uuid
        and i.candidate_id = ${payload.candidate_id}::uuid
        and i.organization_id = ${auth.organizationId}::uuid
      limit 1
    `)

    if (!owned[0]) {
      throw new ApiError(404, "INTERVIEW_NOT_FOUND", "Interview not found for this organization")
    }

    const result = await createInterviewInvite(payload)
    return successResponse(result, 201)
  } catch (error) {
    return errorResponse(error)
  }
}
