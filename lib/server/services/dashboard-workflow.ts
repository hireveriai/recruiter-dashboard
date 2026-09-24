import { Prisma } from "@prisma/client"

import { deriveDashboardState } from "@/lib/dashboard/dashboard-state-engine"
import { prisma } from "@/lib/server/prisma"
import { getDashboardPipelineData } from "@/lib/server/services/dashboard-pipeline"
import { jobPositionsSupportIsActive } from "@/lib/server/services/jobs"
import { aiInterviewsOnly } from "@/lib/server/veris-live/ai-scope"

export type DashboardWorkflowSnapshot = {
  pipeline: {
    pending: number
    inProgress: number
    completed: number
    flagged: number
    reviewed: number
    reviewRequired: number
  }
  workflowMetrics: {
    jobs: number
    activeJobs: number
    invites: number
    screeningRuns: number
    shortlistedCandidates: number
    screeningStarted: boolean
    screeningCompleted: boolean
    interviewsRunning: number
    completedInterviews: number
    pendingReports: number
    reviewedReports: number
    decisionsPending: number
  }
  dashboardState: ReturnType<typeof deriveDashboardState>
}

type DashboardPipelineSnapshot = {
  pipeline: {
    pending: number
    inProgress: number
    completed: number
    flagged: number
    reviewed?: number
    reviewRequired?: number
  }
}

const tableExistenceCache = new Map<string, boolean>()

async function tableExists(tableName: string) {
  const cached = tableExistenceCache.get(tableName)
  if (cached !== undefined) {
    return cached
  }

  const rows = await prisma.$queryRaw<Array<{ regclass: string | null }>>`
    select to_regclass(${`public.${tableName}`})::text as regclass
  `
  const exists = Boolean(rows[0]?.regclass)
  if (exists) {
    tableExistenceCache.set(tableName, true)
  }
  return exists
}

async function getScreeningWorkflowMetrics(organizationId: string) {
  let screeningRuns = 0
  let shortlistedCandidates = 0

  if (await tableExists("screening_runs")) {
    const rows = await prisma.$queryRaw<Array<{ screening_runs: number; shortlisted_candidates: number }>>`
      select
        count(*)::int as screening_runs,
        coalesce(sum(strong_fit_count), 0)::int as shortlisted_candidates
      from public.screening_runs
      where organization_id = ${organizationId}::uuid
    `

    screeningRuns = Number(rows[0]?.screening_runs ?? 0)
    shortlistedCandidates = Number(rows[0]?.shortlisted_candidates ?? 0)
  }

  if (await tableExists("candidate_job_matches")) {
    const rows = await prisma.$queryRaw<Array<{ screened_candidates: number; shortlisted_candidates: number }>>`
      select
        count(*)::int as screened_candidates,
        count(*) filter (where recommendation = 'STRONG_FIT')::int as shortlisted_candidates
      from public.candidate_job_matches
      where organization_id = ${organizationId}::uuid
    `

    screeningRuns = Math.max(screeningRuns, Number(rows[0]?.screened_candidates ?? 0))
    shortlistedCandidates = Math.max(shortlistedCandidates, Number(rows[0]?.shortlisted_candidates ?? 0))
  }

  return { screeningRuns, shortlistedCandidates }
}

type InterviewWorkflowRow = {
  pending_reports: number
  reviewed_reports: number
  decisions_pending: number
}

type JobWorkflowRow = {
  jobs: number
  active_jobs: number
}

async function getJobWorkflowMetrics(organizationId: string) {
  const supportsIsActive = await jobPositionsSupportIsActive()

  if (!supportsIsActive) {
    const jobs = await prisma.jobPosition.count({
      where: {
        organizationId,
      },
    })

    return {
      jobs,
      activeJobs: jobs,
    }
  }

  const rows = await prisma.$queryRaw<JobWorkflowRow[]>(Prisma.sql`
    select
      count(*)::int as jobs,
      count(*) filter (where coalesce(is_active, true) = true)::int as active_jobs
    from public.job_positions
    where organization_id = ${organizationId}::uuid
  `)

  return {
    jobs: Number(rows[0]?.jobs ?? 0),
    activeJobs: Number(rows[0]?.active_jobs ?? 0),
  }
}

async function getInterviewWorkflowMetrics(organizationId: string) {
  const rows = await prisma.$queryRaw<InterviewWorkflowRow[]>(Prisma.sql`
    with latest_attempts as (
      select distinct on (ia.interview_id)
        ia.attempt_id,
        ia.interview_id,
        ia.status,
        ia.started_at,
        ia.ended_at
      from public.interview_attempts ia
      inner join public.interviews i on i.interview_id = ia.interview_id
      where i.organization_id = ${organizationId}::uuid
      order by ia.interview_id, ia.started_at desc nulls last
    ),
    base as (
      select
        i.interview_id,
        i.status as interview_status,
        la.attempt_id,
        la.status as attempt_status,
        la.started_at,
        la.ended_at,
        ie.evaluation_id,
        ie.decision,
        rd.status as recruiter_decision_status
      from public.interviews i
      left join latest_attempts la on la.interview_id = i.interview_id
      left join public.interview_evaluations ie on ie.attempt_id = la.attempt_id
      left join public.candidate_recruiter_decisions rd
        on rd.organization_id = i.organization_id
        and rd.candidate_id = i.candidate_id
        and rd.interview_id = i.interview_id
      where i.organization_id = ${organizationId}::uuid
        and ${aiInterviewsOnly("i")}
    )
    select
      count(*) filter (
        where (upper(coalesce(interview_status, attempt_status, '')) in ('COMPLETED', 'SUBMITTED', 'EVALUATED') or ended_at is not null)
          and recruiter_decision_status is null
      )::int as pending_reports,
      count(*) filter (
        where (upper(coalesce(interview_status, attempt_status, '')) in ('COMPLETED', 'SUBMITTED', 'EVALUATED') or ended_at is not null)
          and recruiter_decision_status is not null
      )::int as reviewed_reports,
      count(*) filter (
        where (upper(coalesce(interview_status, attempt_status, '')) in ('COMPLETED', 'SUBMITTED', 'EVALUATED') or ended_at is not null)
          and recruiter_decision_status is null
      )::int as decisions_pending
    from base
  `)

  const row = rows[0]

  return {
    pendingReports: Number(row?.pending_reports ?? 0),
    reviewedReports: Number(row?.reviewed_reports ?? 0),
    decisionsPending: Number(row?.decisions_pending ?? 0),
  }
}

export async function getDashboardWorkflowSnapshot(
  organizationId: string,
  existingPipelineData?: DashboardPipelineSnapshot
): Promise<DashboardWorkflowSnapshot> {
  const interviewMetricsPromise =
    existingPipelineData?.pipeline.reviewed !== undefined && existingPipelineData.pipeline.reviewRequired !== undefined
      ? Promise.resolve({
          pendingReports: existingPipelineData.pipeline.reviewRequired,
          reviewedReports: existingPipelineData.pipeline.reviewed,
          decisionsPending: existingPipelineData.pipeline.reviewRequired,
        })
      : getInterviewWorkflowMetrics(organizationId)

  const [jobMetrics, invites, screeningMetrics, interviewMetrics, pipelineData] = await Promise.all([
    getJobWorkflowMetrics(organizationId),
    prisma.interviewInvite.count({
      where: {
        interview: {
          organizationId,
        },
      },
    }),
    getScreeningWorkflowMetrics(organizationId),
    interviewMetricsPromise,
    existingPipelineData ?? getDashboardPipelineData({ organizationId, limit: 5, finalizeStale: false, ensureRecoverySchema: false }),
  ])

  const workflowMetrics = {
    jobs: jobMetrics.jobs,
    activeJobs: jobMetrics.activeJobs,
    invites,
    screeningRuns: screeningMetrics.screeningRuns,
    shortlistedCandidates: screeningMetrics.shortlistedCandidates,
    screeningStarted: screeningMetrics.screeningRuns > 0,
    screeningCompleted: screeningMetrics.screeningRuns > 0 && screeningMetrics.shortlistedCandidates > 0,
    interviewsRunning: pipelineData.pipeline.inProgress,
    completedInterviews: pipelineData.pipeline.completed,
    pendingReports: interviewMetrics.pendingReports,
    reviewedReports: interviewMetrics.reviewedReports,
    decisionsPending: interviewMetrics.decisionsPending,
  }

  const dashboardState = deriveDashboardState({
    jobs_count: jobMetrics.jobs,
    active_jobs_count: jobMetrics.activeJobs,
    veris_screening_count: screeningMetrics.screeningRuns,
    interview_links_count: invites,
    interviews_count: pipelineData.pipeline.completed + pipelineData.pipeline.inProgress,
    pending_reviews_count: interviewMetrics.decisionsPending,
  })

  return {
    pipeline: {
      pending: pipelineData.pipeline.pending,
      inProgress: pipelineData.pipeline.inProgress,
      completed: pipelineData.pipeline.completed,
      flagged: pipelineData.pipeline.flagged,
      reviewed: pipelineData.pipeline.reviewed ?? 0,
      reviewRequired: pipelineData.pipeline.reviewRequired ?? 0,
    },
    workflowMetrics,
    dashboardState,
  }
}
