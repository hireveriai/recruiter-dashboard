import { NextResponse } from "next/server"

import { getRecruiterRequestContext } from "@/lib/server/auth-context"
import { ApiError } from "@/lib/server/errors"
import { assertEntitlement } from "@/lib/server/entitlements"
import { errorResponse } from "@/lib/server/response"
import { parseJobDescriptionWithAI } from "@/lib/server/ai-screening/openai"
import {
  createJobPositionForPastedJd,
  getJobPositionForScreening,
  getScreeningJobs,
  upsertScreeningJob,
} from "@/lib/server/ai-screening/service"

export const runtime = "nodejs"

export async function GET(request: Request) {
  try {
    const auth = await getRecruiterRequestContext(request)
    await assertEntitlement(auth, "SCREENING")
    const jobs = await getScreeningJobs(auth.organizationId)

    return NextResponse.json({
      success: true,
      data: jobs,
    })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function POST(request: Request) {
  try {
    const auth = await getRecruiterRequestContext(request)
    await assertEntitlement(auth, "SCREENING")
    const body = (await request.json()) as {
      existingJobId?: string
      existing_job_id?: string
      title?: string
      description?: string
      jobDescription?: string
      jd?: string
    }
    const existingJobId = String(body.existingJobId ?? body.existing_job_id ?? "").trim()
    const pastedDescription = String(body.description ?? body.jobDescription ?? body.jd ?? "").trim()
    const titleHint = String(body.title ?? "").trim()

    if (existingJobId) {
      const jobPosition = await getJobPositionForScreening(auth.organizationId, existingJobId)

      if (!jobPosition) {
        throw new ApiError(404, "JOB_NOT_FOUND", "Existing job was not found for this recruiter")
      }

      const description = jobPosition.job_description || pastedDescription

      if (!description) {
        throw new ApiError(400, "JOB_DESCRIPTION_REQUIRED", "Selected job does not have a job description")
      }

      const parsed = await parseJobDescriptionWithAI(description, jobPosition.job_title)
      const job = await upsertScreeningJob({
        id: jobPosition.job_id,
        organizationId: auth.organizationId,
        userId: auth.userId,
        title: parsed.roleTitle || jobPosition.job_title,
        description,
        parsed: {
          ...parsed,
          requiredSkills: parsed.requiredSkills.length > 0 ? parsed.requiredSkills : jobPosition.core_skills ?? [],
        },
        sourceJobPositionId: jobPosition.job_id,
      })

      return NextResponse.json({ success: true, data: job }, { status: 201 })
    }

    if (!pastedDescription) {
      throw new ApiError(400, "JOB_DESCRIPTION_REQUIRED", "Paste a job description or choose an existing job")
    }

    const parsed = await parseJobDescriptionWithAI(pastedDescription, titleHint)
    const title = parsed.roleTitle || titleHint || "VERIS Screening Role"
    const jobPositionId = await createJobPositionForPastedJd({
      organizationId: auth.organizationId,
      title,
      description: pastedDescription,
      parsed,
    })
    const job = await upsertScreeningJob({
      id: jobPositionId,
      organizationId: auth.organizationId,
      userId: auth.userId,
      title,
      description: pastedDescription,
      parsed,
      sourceJobPositionId: jobPositionId,
    })

    return NextResponse.json({ success: true, data: job }, { status: 201 })
  } catch (error) {
    return errorResponse(error)
  }
}
