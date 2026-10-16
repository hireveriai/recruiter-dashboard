import { getRecruiterRequestContext } from "@/lib/server/auth-context"
import { ApiError } from "@/lib/server/errors"
import { prisma } from "@/lib/server/prisma"
import { createCandidate } from "@/lib/server/services/candidate"
import { errorResponse, successResponse } from "@/lib/server/response"
import { createCandidateSchema } from "@/lib/server/validators"

export async function POST(request: Request) {
  try {
    const auth = await getRecruiterRequestContext(request)
    const payload = createCandidateSchema.parse(await request.json())

    const job = await prisma.jobPosition.findFirst({
      where: {
        jobId: payload.jobId ?? payload.job_id,
        organizationId: auth.organizationId,
      },
      select: { jobId: true },
    })

    if (!job) {
      throw new ApiError(404, "JOB_NOT_FOUND", "Job not found for this organization")
    }

    const result = await createCandidate(payload)
    return successResponse(result, 201)
  } catch (error) {
    return errorResponse(error)
  }
}
