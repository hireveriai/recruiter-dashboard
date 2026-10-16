import { Prisma } from "@prisma/client"

import { getRecruiterRequestContext, type RecruiterRequestContext } from "@/lib/server/auth-context"
import { ApiError } from "@/lib/server/errors"
import { prisma } from "@/lib/server/prisma"

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type AiRouteAccess = {
  auth: RecruiterRequestContext
  /** Present only when the request named an attempt; always owned by auth.organizationId. */
  attempt: { attemptId: string; interviewId: string } | null
}

/**
 * Guard for the /api/ai/* routes. They were reachable without a session (and
 * two of them call OpenAI), and they accept attemptId / organizationId in the
 * request. Requires a recruiter session and, when an attempt is named, that it
 * belongs to the caller's organization. Callers must take the organization
 * and interview from the returned values, never from the request body.
 */
export async function requireAiRouteAccess(request: Request, attemptId?: unknown): Promise<AiRouteAccess> {
  const auth = await getRecruiterRequestContext(request)

  if (attemptId === undefined || attemptId === null || attemptId === "") {
    return { auth, attempt: null }
  }

  const id = String(attemptId).trim()

  if (!UUID_REGEX.test(id)) {
    throw new ApiError(400, "INVALID_ATTEMPT_ID", "attemptId must be a UUID")
  }

  const rows = await prisma.$queryRaw<Array<{ interview_id: string }>>(Prisma.sql`
    select ia.interview_id::text as interview_id
    from public.interview_attempts ia
    join public.interviews i
      on i.interview_id = ia.interview_id
    where ia.attempt_id = ${id}::uuid
      and i.organization_id = ${auth.organizationId}::uuid
    limit 1
  `)

  if (!rows[0]) {
    throw new ApiError(404, "ATTEMPT_NOT_FOUND", "Interview attempt not found for this organization")
  }

  return { auth, attempt: { attemptId: id, interviewId: rows[0].interview_id } }
}
