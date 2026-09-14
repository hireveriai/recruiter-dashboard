import { getRecruiterRequestContext } from "@/lib/server/auth-context"
import { assertCanAssessment } from "@/lib/server/assessment/auth"
import { createAssessmentSchema, listAssessmentsQuerySchema } from "@/lib/server/assessment/validators"
import { ApiError } from "@/lib/server/errors"
import { prisma } from "@/lib/server/prisma"
import { errorResponse, successResponse } from "@/lib/server/response"

export async function GET(request: Request) {
  try {
    const auth = await getRecruiterRequestContext(request)
    await assertCanAssessment(auth, "assessments.view")

    const url = new URL(request.url)
    const query = listAssessmentsQuerySchema.parse({
      status: url.searchParams.get("status") ?? undefined,
      page: url.searchParams.get("page") ?? undefined,
      pageSize: url.searchParams.get("pageSize") ?? undefined,
    })

    const where = {
      organizationId: auth.organizationId,
      ...(query.status ? { status: query.status } : {}),
    }

    const [total, assessments] = await Promise.all([
      prisma.assessment.count({ where }),
      prisma.assessment.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ])

    // jobId is a plain scalar FK (see schema note), so job titles are
    // resolved with a separate lookup rather than a Prisma relation.
    const jobIds = [...new Set(assessments.map((a) => a.jobId))]
    const jobs = jobIds.length
      ? await prisma.jobPosition.findMany({
          where: { jobId: { in: jobIds }, organizationId: auth.organizationId },
          select: { jobId: true, jobTitle: true },
        })
      : []
    const jobTitleById = new Map(jobs.map((j) => [j.jobId, j.jobTitle]))

    return successResponse({
      assessments: assessments.map((a) => ({
        ...a,
        jobTitle: jobTitleById.get(a.jobId) ?? null,
      })),
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      },
    })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function POST(request: Request) {
  try {
    const auth = await getRecruiterRequestContext(request)
    await assertCanAssessment(auth, "assessments.create")

    const payload = createAssessmentSchema.parse(await request.json())

    const job = await prisma.jobPosition.findFirst({
      where: { jobId: payload.jobId, organizationId: auth.organizationId },
      select: { jobId: true },
    })

    if (!job) {
      throw new ApiError(404, "JOB_NOT_FOUND", "Job not found for this organization")
    }

    const assessment = await prisma.assessment.create({
      data: {
        organizationId: auth.organizationId,
        jobId: payload.jobId,
        title: payload.title,
        description: payload.description ?? null,
        durationMinutes: payload.durationMinutes,
        passingPercentage: payload.passingPercentage,
        questionCount: payload.questionCount ?? null,
        difficulty: payload.difficulty ?? null,
        questionTypes: payload.questionTypes,
        randomizeQuestions: payload.randomizeQuestions,
        randomizeOptions: payload.randomizeOptions,
        linkExpiryDays: payload.linkExpiryDays,
        status: "DRAFT",
        createdBy: auth.userId,
      },
    })

    return successResponse(assessment, 201)
  } catch (error) {
    return errorResponse(error)
  }
}
