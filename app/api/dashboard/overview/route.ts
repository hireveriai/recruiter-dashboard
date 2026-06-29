import { Prisma } from "@prisma/client"
import { NextResponse } from "next/server"

import { getRecruiterRequestContext } from "@/lib/server/auth-context"
import { errorResponse } from "@/lib/server/response"
import { getCandidatesDashboard } from "@/lib/server/services/dashboard.service"
import { getDashboardPipelineData } from "@/lib/server/services/dashboard-pipeline"
import { deriveDashboardState } from "@/lib/dashboard/dashboard-state-engine"
import { getRecruiterProfile } from "@/lib/server/services/recruiter-profile"
import { getDashboardAlerts, type DashboardAlert } from "@/lib/server/services/dashboard-alerts"
import { getDashboardRecordings } from "@/lib/server/services/dashboard-recordings"
import { getDashboardWorkflowSnapshot } from "@/lib/server/services/dashboard-workflow"
import {
  getFastDashboardCandidates,
  getFastDashboardSnapshot,
  getFastVerisSummaryCards,
} from "@/lib/server/services/dashboard-fast-snapshot"
import {
  getTrialCreditsDashboardSnapshot,
  type TrialCreditSnapshot,
} from "@/lib/server/services/trial-credits"
import { prisma } from "@/lib/server/prisma"

type OverviewPayload = {
  partial?: boolean
  profile: Awaited<ReturnType<typeof getRecruiterProfile>>
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
  pendingInterviews: Array<Record<string, unknown>>
  pendingInterviewsTotal: number
  recordedInterviews?: Array<Record<string, unknown>>
  candidates: Awaited<ReturnType<typeof getCandidatesDashboard>>
  veris?: Array<Record<string, unknown>>
  alerts: DashboardAlert[]
  trialCredits: TrialCreditSnapshot | null
}

type CacheEntry = {
  value: OverviewPayload
  expiresAt: number
}

const CACHE_TTL_MS = 60000
const CACHE_MAX = 50
const SLOW_DASHBOARD_ROUTE_MS = 1200
const SLOW_DASHBOARD_STEP_MS = 750
const overviewCache = new Map<string, CacheEntry>()
const inFlight = new Map<string, Promise<OverviewPayload>>()

async function timedStep<T>(name: string, operation: () => Promise<T>) {
  const startedAt = Date.now()
  const result = await operation()
  const durationMs = Date.now() - startedAt

  if (durationMs >= SLOW_DASHBOARD_STEP_MS) {
    console.warn(JSON.stringify({
      level: "warn",
      msg: "slow_dashboard_step",
      step: name,
      durationMs,
    }))
  }

  return { result, durationMs }
}

async function safeTimedStep<T>(name: string, operation: () => Promise<T>, fallback: T) {
  try {
    return await timedStep(name, operation)
  } catch (error) {
    console.warn(JSON.stringify({
      level: "warn",
      msg: "dashboard_step_recovered",
      step: name,
      error: error instanceof Error ? error.message : String(error),
    }))

    return { result: fallback, durationMs: 0 }
  }
}

function emptyDashboardState() {
  return deriveDashboardState({
    jobs_count: 0,
    active_jobs_count: 0,
    veris_screening_count: 0,
    interview_links_count: 0,
    interviews_count: 0,
    pending_reviews_count: 0,
  })
}

function emptyPipeline() {
  return {
    pipeline: {
      pending: 0,
      inProgress: 0,
      completed: 0,
      flagged: 0,
      reviewed: 0,
      reviewRequired: 0,
    },
    pendingInterviews: [],
    pendingTotal: 0,
  }
}

type QuickWorkflowMetricsRow = {
  jobs: number
  active_jobs: number
  invites: number
  interviews_running: number
  completed_interviews: number
}

function buildWorkflowMetricsFromQuickRow(row?: QuickWorkflowMetricsRow | null): OverviewPayload["workflowMetrics"] {
  const jobs = Number(row?.jobs ?? 0)
  const activeJobs = Number(row?.active_jobs ?? jobs)
  const invites = Number(row?.invites ?? 0)
  const interviewsRunning = Number(row?.interviews_running ?? 0)
  const completedInterviews = Number(row?.completed_interviews ?? 0)

  return {
    jobs,
    activeJobs,
    invites,
    screeningRuns: 0,
    shortlistedCandidates: 0,
    screeningStarted: false,
    screeningCompleted: false,
    interviewsRunning,
    completedInterviews,
    pendingReports: completedInterviews,
    reviewedReports: 0,
    decisionsPending: completedInterviews,
  }
}

function buildPipelineFromWorkflowMetrics(metrics: OverviewPayload["workflowMetrics"]): OverviewPayload["pipeline"] {
  const pending = Math.max(0, metrics.invites - metrics.interviewsRunning - metrics.completedInterviews)

  return {
    pending,
    inProgress: metrics.interviewsRunning,
    completed: metrics.completedInterviews,
    flagged: 0,
    reviewed: metrics.reviewedReports,
    reviewRequired: metrics.decisionsPending,
  }
}

async function getQuickWorkflowMetrics(organizationId: string): Promise<OverviewPayload["workflowMetrics"]> {
  const rows = await prisma.$queryRaw<QuickWorkflowMetricsRow[]>(Prisma.sql`
    with job_counts as (
      select
        count(*)::int as jobs,
        count(*) filter (
          where coalesce(nullif(to_jsonb(jp)->>'is_active', '')::boolean, true) = true
        )::int as active_jobs
      from public.job_positions jp
      where jp.organization_id = ${organizationId}::uuid
    ),
    invite_counts as (
      select count(*)::int as invites
      from public.interview_invites inv
      inner join public.interviews i
        on i.interview_id = inv.interview_id
        and i.organization_id = ${organizationId}::uuid
    ),
    interview_counts as (
      select
        count(*) filter (
          where ia.attempt_id is not null
            and coalesce(ia.ended_at, null) is null
            and upper(coalesce(ia.status, '')) not in ('COMPLETED', 'SUBMITTED', 'EVALUATED', 'FAILED', 'INTERRUPTED')
        )::int as interviews_running,
        count(*) filter (
          where upper(coalesce(i.status, ia.status, '')) in ('COMPLETED', 'SUBMITTED', 'EVALUATED')
             or ia.ended_at is not null
        )::int as completed_interviews
      from public.interviews i
      left join public.interview_invites inv on inv.interview_id = i.interview_id
      left join lateral (
        select *
        from public.interview_attempts latest_attempt
        where latest_attempt.interview_id = i.interview_id
        order by latest_attempt.attempt_number desc, latest_attempt.started_at desc
        limit 1
      ) ia on true
      where i.organization_id = ${organizationId}::uuid
    )
    select
      job_counts.jobs,
      job_counts.active_jobs,
      invite_counts.invites,
      interview_counts.interviews_running,
      interview_counts.completed_interviews
    from job_counts
    cross join invite_counts
    cross join interview_counts
  `)

  return buildWorkflowMetricsFromQuickRow(rows[0])
}

async function buildFastOverview(
  auth: Awaited<ReturnType<typeof getRecruiterRequestContext>>
): Promise<OverviewPayload> {
  const [profileStep, alertsStep, trialCreditsStep, quickWorkflowStep, fastSnapshotStep] = await Promise.all([
    timedStep("profile", () => getRecruiterProfile(auth)),
    safeTimedStep("alerts", () => getDashboardAlerts(auth.organizationId, "all", auth.userId), []),
    safeTimedStep<TrialCreditSnapshot | null>("trialCredits", () => getTrialCreditsDashboardSnapshot(auth.organizationId), null),
    safeTimedStep("quickWorkflow", () => getQuickWorkflowMetrics(auth.organizationId), buildWorkflowMetricsFromQuickRow()),
    safeTimedStep("fastSnapshot", () => getFastDashboardSnapshot(auth.organizationId), {
      candidates: [],
      recordedInterviews: [],
      veris: [],
    }),
  ])
  const profile = profileStep.result
  const alerts = alertsStep.result
  const trialCredits = trialCreditsStep.result
  const quickWorkflowMetrics = quickWorkflowStep.result
  const fastSnapshot = fastSnapshotStep.result
  const quickDashboardState = deriveDashboardState({
    jobs_count: quickWorkflowMetrics.jobs,
    active_jobs_count: quickWorkflowMetrics.activeJobs,
    interview_links_count: quickWorkflowMetrics.invites,
    interviews_count: quickWorkflowMetrics.interviewsRunning + quickWorkflowMetrics.completedInterviews,
    pending_reviews_count: quickWorkflowMetrics.decisionsPending,
  })

  return {
    partial: true,
    profile,
    pipeline: buildPipelineFromWorkflowMetrics(quickWorkflowMetrics),
    workflowMetrics: quickWorkflowMetrics,
    dashboardState: quickDashboardState,
    pendingInterviews: [],
    pendingInterviewsTotal: buildPipelineFromWorkflowMetrics(quickWorkflowMetrics).pending,
    candidates: fastSnapshot.candidates as Awaited<ReturnType<typeof getCandidatesDashboard>>,
    recordedInterviews: fastSnapshot.recordedInterviews,
    veris: fastSnapshot.veris,
    alerts,
    trialCredits,
  }
}

async function buildOverview(
  auth: Awaited<ReturnType<typeof getRecruiterRequestContext>>
): Promise<OverviewPayload> {
  const emptyPipelineData = emptyPipeline()
  const pipelinePromise = safeTimedStep("pipeline", () => getDashboardPipelineData({
    organizationId: auth.organizationId,
    limit: 5,
    finalizeStale: false,
    ensureRecoverySchema: false,
  }), emptyPipelineData)

  const [profileStep, candidatesStep, pipelineStep, alertsStep, trialCreditsStep, recordingsStep, verisStep] = await Promise.all([
    timedStep("profile", () => getRecruiterProfile(auth)),
    safeTimedStep("candidates", () => getFastDashboardCandidates(auth.organizationId, 5), []),
    pipelinePromise,
    safeTimedStep("alerts", () => getDashboardAlerts(auth.organizationId, "all", auth.userId), []),
    safeTimedStep<TrialCreditSnapshot | null>("trialCredits", () => getTrialCreditsDashboardSnapshot(auth.organizationId), null),
    safeTimedStep("recordedInterviews", () => getDashboardRecordings(auth.organizationId, 6, { verifyStorage: false }), []),
    safeTimedStep("veris", () => getFastVerisSummaryCards(auth.organizationId, 4), []),
  ])
  const profile = profileStep.result
  const candidates = candidatesStep.result
  const pipelineData = pipelineStep.result
  const alerts = alertsStep.result
  const trialCredits = trialCreditsStep.result
  const recordedInterviews = recordingsStep.result
  const veris = verisStep.result
  const workflowStep = await safeTimedStep(
    "workflow",
    () => getDashboardWorkflowSnapshot(auth.organizationId, pipelineData),
    {
      pipeline: pipelineData.pipeline,
      workflowMetrics: {
        jobs: 0,
        activeJobs: 0,
        invites: 0,
        screeningRuns: 0,
        shortlistedCandidates: 0,
        screeningStarted: false,
        screeningCompleted: false,
        interviewsRunning: pipelineData.pipeline.inProgress,
        completedInterviews: pipelineData.pipeline.completed,
        pendingReports: 0,
        reviewedReports: 0,
        decisionsPending: 0,
      },
      dashboardState: emptyDashboardState(),
    }
  )
  const workflowSnapshot = workflowStep.result

  return {
    profile,
    pipeline: pipelineData.pipeline,
    workflowMetrics: {
      ...workflowSnapshot.workflowMetrics,
      interviewsRunning: pipelineData.pipeline.inProgress,
    },
    dashboardState: workflowSnapshot.dashboardState,
    pendingInterviews: pipelineData.pendingInterviews,
    pendingInterviewsTotal: pipelineData.pendingTotal,
    candidates: candidates ?? [],
    recordedInterviews,
    veris,
    alerts,
    trialCredits,
  }
}

function getCachedOverview(cacheKey: string) {
  const cached = overviewCache.get(cacheKey)
  if (!cached) {
    return null
  }

  if (cached.expiresAt <= Date.now()) {
    overviewCache.delete(cacheKey)
    return null
  }

  return cached.value
}

function setCachedOverview(cacheKey: string, value: OverviewPayload) {
  overviewCache.set(cacheKey, {
    value,
    expiresAt: Date.now() + CACHE_TTL_MS,
  })

  if (overviewCache.size <= CACHE_MAX) {
    return
  }

  const oldestKey = overviewCache.keys().next().value
  if (oldestKey) {
    overviewCache.delete(oldestKey)
  }
}

export async function GET(request: Request) {
  const routeStartedAt = Date.now()

  try {
    const authStartedAt = Date.now()
    const auth = await getRecruiterRequestContext(request)
    const authMs = Date.now() - authStartedAt
    const cacheKey = `overview:${auth.organizationId}:${auth.userId}`
    const { searchParams } = new URL(request.url)
    const forceRefresh = searchParams.has("refresh") || searchParams.get("cache") === "bust"
    const fullOverview = searchParams.get("full") === "1"

    const cached = forceRefresh ? null : getCachedOverview(cacheKey)
    const cachedSatisfiesRequest = cached && (!fullOverview || !cached.partial)
    if (cachedSatisfiesRequest) {
      const response = NextResponse.json({ success: true, data: cached })
      const durationMs = Date.now() - routeStartedAt
      response.headers.set("Cache-Control", "private, max-age=15, stale-while-revalidate=60")
      response.headers.set("X-HireVeri-Cache", "hit")
      response.headers.set("Server-Timing", `auth;dur=${authMs}, total;dur=${durationMs}`)
      return response
    }

    if (!fullOverview && !forceRefresh) {
      const dataStartedAt = Date.now()
      const inFlightKey = `${cacheKey}:partial`
      let overviewPromise = inFlight.get(inFlightKey)
      if (!overviewPromise) {
        overviewPromise = buildFastOverview(auth)
        inFlight.set(inFlightKey, overviewPromise)
      }
      const overview = await overviewPromise.finally(() => {
        inFlight.delete(inFlightKey)
      })
      const dataMs = Date.now() - dataStartedAt
      const durationMs = Date.now() - routeStartedAt
      setCachedOverview(cacheKey, overview)
      const response = NextResponse.json({ success: true, data: overview })
      response.headers.set("Cache-Control", "private, max-age=30, stale-while-revalidate=120")
      response.headers.set("X-HireVeri-Cache", "fast")
      response.headers.set("Server-Timing", `auth;dur=${authMs}, data;dur=${dataMs}, total;dur=${durationMs}`)
      return response
    }

    const inFlightKey = forceRefresh ? `${cacheKey}:refresh:${fullOverview ? "full" : "partial"}` : cacheKey
    let overviewPromise = inFlight.get(inFlightKey)
    if (!overviewPromise) {
      overviewPromise = buildOverview(auth)
      inFlight.set(inFlightKey, overviewPromise)
    }

    const dataStartedAt = Date.now()
    const overview = await overviewPromise.finally(() => {
      inFlight.delete(inFlightKey)
    })
    const dataMs = Date.now() - dataStartedAt

    setCachedOverview(cacheKey, overview)

    const response = NextResponse.json({ success: true, data: overview })
    const durationMs = Date.now() - routeStartedAt

    response.headers.set("Cache-Control", forceRefresh ? "no-store" : "private, max-age=15, stale-while-revalidate=60")
    response.headers.set("X-HireVeri-Cache", forceRefresh ? "refresh" : "miss")
    response.headers.set("Server-Timing", `auth;dur=${authMs}, data;dur=${dataMs}, total;dur=${durationMs}`)

    if (durationMs >= SLOW_DASHBOARD_ROUTE_MS) {
      console.warn(JSON.stringify({
        level: "warn",
        msg: "slow_dashboard_overview",
        cache: forceRefresh ? "refresh" : "miss",
        authMs,
        dataMs,
        durationMs,
      }))
    }

    return response
  } catch (error) {
    console.error(JSON.stringify({
      level: "error",
      msg: "dashboard_overview_failed",
      durationMs: Date.now() - routeStartedAt,
      error: error instanceof Error ? error.message : String(error),
    }))
    return errorResponse(error)
  }
}
