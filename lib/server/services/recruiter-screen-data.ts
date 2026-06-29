import { Prisma } from "@prisma/client"

import type { RecruiterRequestContext } from "@/lib/server/auth-context"
import { prisma } from "@/lib/server/prisma"
import { getFastDashboardCandidates } from "@/lib/server/services/dashboard-fast-snapshot"
import { getCandidatesDashboard } from "@/lib/server/services/dashboard.service"
import { finalizeStaleInterviewAttempts } from "@/lib/server/services/interview-stale-finalizer"
import { getOrganizationBillingHistory } from "@/lib/server/services/invoices"
import {
  jobPositionsSupportCodingConfig,
  jobPositionsSupportIsActive,
  jobPositionsSupportQuestionTypeDefault,
} from "@/lib/server/services/jobs"
import { getReportsOverview } from "@/lib/server/services/reports.service"

type ScreenLimit = number | "all"

type JobScreenOptions = {
  view?: string | null
  includeInactive?: boolean
}

type CandidateScreenOptions = {
  limit?: ScreenLimit
  includeAnswerSummaries?: boolean
}

type JobRow = {
  jobId: string
  jobTitle: string
  jobDescription: string | null
  experienceLevelId: number
  difficultyProfile: string
  interviewDurationMinutes: number | null
  questionTypeDefault: string | null
  coreSkills: string[] | null
  codingRequired: string | null
  codingAssessmentType: string | null
  codingDifficulty: string | null
  codingDurationMinutes: number | null
  codingLanguages: string[] | null
  isActive: boolean
  interviewCount: number
}

type JobSelectorRow = {
  jobId: string
  jobTitle: string
  isActive: boolean
}

export async function getCandidatesScreenData(
  auth: RecruiterRequestContext,
  options: CandidateScreenOptions = {}
) {
  const limit = options.limit ?? 5

  await finalizeStaleInterviewAttempts(auth.organizationId)

  if (options.includeAnswerSummaries) {
    return getCandidatesDashboard({
      organizationId: auth.organizationId,
      limit,
      includeAnswerSummaries: true,
    })
  }

  return getFastDashboardCandidates(auth.organizationId, limit === "all" ? 20 : limit)
}

export async function getReportsScreenData(auth: RecruiterRequestContext) {
  return getReportsOverview(auth.organizationId)
}

export async function getBillingScreenData(auth: RecruiterRequestContext) {
  return getOrganizationBillingHistory(auth)
}

export async function getJobsScreenData(auth: RecruiterRequestContext, options: JobScreenOptions = {}) {
  const view = options.view ?? null
  const includeInactive = Boolean(options.includeInactive)

  if (view === "selector") {
    const hasIsActive = await jobPositionsSupportIsActive()
    const rows = await prisma.$queryRaw<JobSelectorRow[]>(Prisma.sql`
      select
        jp.job_id as "jobId",
        jp.job_title as "jobTitle",
        ${hasIsActive ? Prisma.sql`jp.is_active` : Prisma.sql`true`} as "isActive"
      from public.job_positions jp
      where jp.organization_id = ${auth.organizationId}::uuid
        ${hasIsActive && !includeInactive ? Prisma.sql`and jp.is_active = true` : Prisma.empty}
      order by jp.job_id desc
    `)

    return {
      jobs: rows.map((row) => ({
        jobId: row.jobId,
        jobTitle: row.jobTitle,
        isActive: row.isActive,
      })),
      meta: {
        supportsJobActiveState: hasIsActive,
        view: "selector",
      },
    }
  }

  const [hasIsActive, hasCodingConfig, hasQuestionTypeDefault] = await Promise.all([
    jobPositionsSupportIsActive(),
    jobPositionsSupportCodingConfig(),
    jobPositionsSupportQuestionTypeDefault(),
  ])

  const rows = await prisma.$queryRaw<JobRow[]>(Prisma.sql`
    select
      jp.job_id as "jobId",
      jp.job_title as "jobTitle",
      jp.job_description as "jobDescription",
      jp.experience_level_id as "experienceLevelId",
      jp.difficulty_profile::text as "difficultyProfile",
      jp.interview_duration_minutes as "interviewDurationMinutes",
      ${hasQuestionTypeDefault ? Prisma.sql`jp.question_type_default::text` : Prisma.sql`'AUTO'`} as "questionTypeDefault",
      jp.core_skills as "coreSkills",
      ${hasCodingConfig ? Prisma.sql`jp.coding_required::text` : Prisma.sql`null`} as "codingRequired",
      ${hasCodingConfig ? Prisma.sql`jp.coding_assessment_type::text` : Prisma.sql`null`} as "codingAssessmentType",
      ${hasCodingConfig ? Prisma.sql`jp.coding_difficulty::text` : Prisma.sql`null`} as "codingDifficulty",
      ${hasCodingConfig ? Prisma.sql`jp.coding_duration_minutes` : Prisma.sql`null`} as "codingDurationMinutes",
      ${hasCodingConfig ? Prisma.sql`jp.coding_languages` : Prisma.sql`null`} as "codingLanguages",
      ${hasIsActive ? Prisma.sql`jp.is_active` : Prisma.sql`true`} as "isActive",
      count(i.interview_id)::int as "interviewCount"
    from public.job_positions jp
    left join public.interviews i
      on i.job_id = jp.job_id
    where jp.organization_id = ${auth.organizationId}::uuid
      ${hasIsActive && !includeInactive ? Prisma.sql`and jp.is_active = true` : Prisma.empty}
    group by
      jp.job_id,
      jp.job_title,
      jp.job_description,
      jp.experience_level_id,
      jp.difficulty_profile,
      jp.interview_duration_minutes,
      ${hasQuestionTypeDefault ? Prisma.sql`jp.question_type_default,` : Prisma.empty}
      jp.core_skills
      ${hasIsActive ? Prisma.sql`, jp.is_active` : Prisma.empty}
      ${hasCodingConfig ? Prisma.sql`, jp.coding_required, jp.coding_assessment_type, jp.coding_difficulty, jp.coding_duration_minutes, jp.coding_languages` : Prisma.empty}
    order by jp.job_id desc
  `)

  return {
    jobs: rows.map((row) => ({
      jobId: row.jobId,
      jobTitle: row.jobTitle,
      jobDescription: row.jobDescription,
      experienceLevelId: row.experienceLevelId,
      difficultyProfile: row.difficultyProfile,
      interviewDurationMinutes: row.interviewDurationMinutes,
      questionTypeDefault: row.questionTypeDefault ?? "AUTO",
      coreSkills: row.coreSkills ?? [],
      codingRequired: row.codingRequired,
      codingAssessmentType: row.codingAssessmentType,
      codingDifficulty: row.codingDifficulty,
      codingDurationMinutes: row.codingDurationMinutes,
      codingLanguages: row.codingLanguages ?? [],
      isActive: row.isActive,
      _count: {
        interviews: row.interviewCount ?? 0,
      },
    })),
    meta: {
      supportsJobActiveState: hasIsActive,
      supportsCodingConfig: hasCodingConfig,
      supportsQuestionTypeDefault: hasQuestionTypeDefault,
    },
  }
}
