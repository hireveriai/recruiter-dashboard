import { getRecruiterRequestContext } from "@/lib/server/auth-context"
import { assertCanAssessment } from "@/lib/server/assessment/auth"
import { assertCanEmployees } from "@/lib/server/employees/auth"
import { createAssessmentSchema, listAssessmentsQuerySchema } from "@/lib/server/assessment/validators"
import { ApiError } from "@/lib/server/errors"
import { prisma } from "@/lib/server/prisma"
import { errorResponse, successResponse } from "@/lib/server/response"

async function checkPermission(fn: () => Promise<void>): Promise<boolean> {
  try {
    await fn()
    return true
  } catch {
    return false
  }
}

export async function GET(request: Request) {
  try {
    const auth = await getRecruiterRequestContext(request)

    const url = new URL(request.url)
    const query = listAssessmentsQuerySchema.parse({
      status: url.searchParams.get("status") ?? undefined,
      activityType: url.searchParams.get("activityType") ?? undefined,
      participantType: url.searchParams.get("participantType") ?? undefined,
      page: url.searchParams.get("page") ?? undefined,
      pageSize: url.searchParams.get("pageSize") ?? undefined,
    })

    // Employee-participant activities are gated by the employeeActivities.*
    // permission domain, not assessments.* — a recruiter who can see
    // candidate Assessments is not automatically allowed to see Employee
    // Assessments/Challenges/Tasks, and vice versa. When the caller doesn't
    // explicitly filter by participantType, the query is restricted to only
    // the participant types they're actually permitted to view, rather than
    // silently defaulting to (and potentially leaking) both.
    if (query.participantType === "EMPLOYEE") {
      await assertCanEmployees(auth, "employeeActivities.view")
    } else if (query.participantType === "CANDIDATE") {
      await assertCanAssessment(auth, "assessments.view")
    }

    const allowedParticipantTypes = query.participantType
      ? [query.participantType]
      : (
          await Promise.all([
            checkPermission(() => assertCanAssessment(auth, "assessments.view")).then((ok) => (ok ? "CANDIDATE" : null)),
            checkPermission(() => assertCanEmployees(auth, "employeeActivities.view")).then((ok) => (ok ? "EMPLOYEE" : null)),
          ])
        ).filter((value): value is "CANDIDATE" | "EMPLOYEE" => value !== null)

    if (allowedParticipantTypes.length === 0) {
      throw new ApiError(403, "INSUFFICIENT_PERMISSION", "assessments.view or employeeActivities.view is required")
    }

    const where = {
      organizationId: auth.organizationId,
      participantType: { in: allowedParticipantTypes },
      ...(query.status ? { status: query.status } : {}),
      ...(query.activityType ? { activityType: query.activityType } : {}),
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

    const payload = createAssessmentSchema.parse(await request.json())

    if (payload.participantType === "EMPLOYEE") {
      await assertCanEmployees(auth, "employeeActivities.create")
    } else {
      await assertCanAssessment(auth, "assessments.create")
    }

    // jobId remains required for every activity, including Employee
    // Assessments/Challenges/Tasks — this schema deliberately did not touch
    // that NOT NULL constraint. An organization creating employee-only
    // activities can reuse (or create once) a generic JobPosition such as
    // "Internal / Employee Development" to satisfy it; see the
    // implementation report's Known Limitations for the follow-up option of
    // making Assessment.jobId nullable in a future pass.
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
        activityType: payload.activityType,
        participantType: payload.participantType,
        skills: payload.skills,
        ...(payload.security ? { settings: { security: payload.security } } : {}),
      },
    })

    return successResponse(assessment, 201)
  } catch (error) {
    return errorResponse(error)
  }
}
