/**
 * Interview Focus plan lifecycle.
 *
 *   DRAFT -> ACTIVE -> SUPERSEDED, one ACTIVE and at most one DRAFT per
 *   job + stage. ACTIVE/SUPERSEDED plans are immutable (also enforced by a
 *   database trigger), because questionnaire versions reference the exact plan
 *   that generated them.
 *
 * Tenant isolation: every entry point first resolves the job through
 * getJobQuestionnaireContext(organizationId, jobId), which 404s for a job the
 * organization does not own, and every query below is scoped by
 * organization_id as well as job_id.
 *
 * Concurrency mirrors job-questionnaire.ts: a transaction-scoped advisory
 * lock per job + stage, with any AI round trip made OUTSIDE the transaction.
 */

import { Prisma } from "@prisma/client"

import { openAiFetch } from "@/lib/server/ai-usage-log"
import { ApiError } from "@/lib/server/errors"
import { prisma } from "@/lib/server/prisma"
import { getCompetency } from "@/lib/server/interview-focus/competency-library"
import { isInterviewFocusFlagEnabled } from "@/lib/server/interview-focus/feature-flag"
import {
  DEFAULT_STAGE_KEY,
  maxFocusAreasForDuration,
  validateFocusPlanInput,
  type FocusArea,
  type ResumeEmphasis,
} from "@/lib/server/interview-focus/focus-rules"
import {
  buildFallbackRecommendation,
  buildRecommendationRequest,
  computeFocusInputHash,
  sanitizeAiRecommendation,
  type FocusRecommendation,
  type FocusRecommendationInput,
} from "@/lib/server/interview-focus/recommendation"
import { getJobQuestionnaireContext } from "@/lib/server/services/job-context"

const OPENAI_URL = "https://api.openai.com/v1/chat/completions"
const RECOMMENDATION_MODEL = process.env.OPENAI_FOCUS_MODEL || process.env.OPENAI_QUESTION_MODEL || "gpt-4o-mini"
const RECOMMENDATION_TIMEOUT_MS = Number(process.env.INTERVIEW_FOCUS_TIMEOUT_MS ?? 20000)

type Client = Prisma.TransactionClient | typeof prisma

export type FocusPlanStatus = "DRAFT" | "ACTIVE" | "SUPERSEDED"

type PlanRow = {
  plan_id: string
  organization_id: string
  job_id: string
  stage_key: string
  version_number: number
  status: FocusPlanStatus
  origin: "VERIS_RECOMMENDED" | "CUSTOM"
  resume_emphasis: ResumeEmphasis
  recommendation_meta: RecommendationMeta | null
  created_at: Date
  updated_at: Date
}

type AreaRow = {
  area_key: string
  label: string
  description: string | null
  is_custom: boolean
  sort_order: number
  coverage_weight: number
}

/** Cached recommendation, carried forward from plan version to plan version. */
type RecommendationMeta = {
  recommendation?: {
    input_hash: string
    source: "ai" | "fallback"
    model?: string | null
    generated_at: string
    role_family: string
    seniority: string
    areas: Array<{ areaKey: string; coverageWeight: number }>
    rationale: Record<string, string>
  }
}

export type FocusPlan = {
  planId: string
  jobId: string
  stageKey: string
  versionNumber: number
  status: FocusPlanStatus
  origin: "VERIS_RECOMMENDED" | "CUSTOM"
  resumeEmphasis: ResumeEmphasis
  areas: FocusArea[]
  recommendation: RecommendationMeta["recommendation"] | null
  createdAt: Date
  updatedAt: Date
}

// ---------------------------------------------------------------------------
// Availability
// ---------------------------------------------------------------------------

let focusTablesSupportedCache: boolean | null = null

/**
 * Schema changes are applied out of band, so environments drift; follows the
 * capability-probe pattern in jobs.ts rather than assuming 022 was applied.
 */
export async function interviewFocusTablesSupported() {
  if (focusTablesSupportedCache !== null) return focusTablesSupportedCache

  try {
    const rows = await prisma.$queryRaw<{ ok: boolean }[]>(Prisma.sql`
      select (
        to_regclass('public.interview_focus_plans') is not null
        and to_regclass('public.interview_focus_areas') is not null
        and exists (
          select 1 from information_schema.columns
          where table_schema = 'public'
            and table_name = 'job_questionnaire_versions'
            and column_name = 'focus_plan_id'
        )
      ) as ok
    `)
    focusTablesSupportedCache = Boolean(rows[0]?.ok)
  } catch (error) {
    console.warn("Interview focus capability lookup failed", error)
    focusTablesSupportedCache = false
  }

  return focusTablesSupportedCache
}

/** Feature flag AND schema present. Everything else checks this first. */
export async function isInterviewFocusAvailable(organizationId: string) {
  if (!isInterviewFocusFlagEnabled(organizationId)) return false
  return interviewFocusTablesSupported()
}

async function assertAvailable(organizationId: string) {
  if (!(await isInterviewFocusAvailable(organizationId))) {
    throw new ApiError(404, "INTERVIEW_FOCUS_UNAVAILABLE", "Interview Focus is not enabled for this organization")
  }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

function lockKey(jobId: string, stageKey: string) {
  return `interview_focus:${jobId}:${stageKey}`
}

async function selectAreas(client: Client, organizationId: string, planId: string): Promise<FocusArea[]> {
  const rows = await client.$queryRaw<AreaRow[]>(Prisma.sql`
    select area_key, label, description, is_custom, sort_order, coverage_weight
    from public.interview_focus_areas
    where plan_id = ${planId}::uuid
      and organization_id = ${organizationId}::uuid
    order by sort_order
  `)

  return rows.map((row) => ({
    areaKey: row.area_key,
    label: row.label,
    description: row.description,
    isCustom: row.is_custom,
    sortOrder: row.sort_order,
    coverageWeight: row.coverage_weight,
  }))
}

async function hydrate(client: Client, row: PlanRow | undefined): Promise<FocusPlan | null> {
  if (!row) return null
  return {
    planId: row.plan_id,
    jobId: row.job_id,
    stageKey: row.stage_key,
    versionNumber: row.version_number,
    status: row.status,
    origin: row.origin,
    resumeEmphasis: row.resume_emphasis,
    areas: await selectAreas(client, row.organization_id, row.plan_id),
    recommendation: row.recommendation_meta?.recommendation ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

async function selectPlanByStatus(
  client: Client,
  organizationId: string,
  jobId: string,
  stageKey: string,
  status: "ACTIVE" | "DRAFT"
) {
  const rows = await client.$queryRaw<PlanRow[]>(Prisma.sql`
    select plan_id::text, organization_id::text, job_id::text, stage_key, version_number, status,
           origin, resume_emphasis, recommendation_meta, created_at, updated_at
    from public.interview_focus_plans
    where organization_id = ${organizationId}::uuid
      and job_id = ${jobId}::uuid
      and stage_key = ${stageKey}
      and status = ${status}
    limit 1
  `)
  return hydrate(client, rows[0])
}

/** A specific plan version, org-scoped. Used for questionnaire provenance. */
export async function getFocusPlanById(organizationId: string, planId: string) {
  const rows = await prisma.$queryRaw<PlanRow[]>(Prisma.sql`
    select plan_id::text, organization_id::text, job_id::text, stage_key, version_number, status,
           origin, resume_emphasis, recommendation_meta, created_at, updated_at
    from public.interview_focus_plans
    where plan_id = ${planId}::uuid
      and organization_id = ${organizationId}::uuid
    limit 1
  `)
  return hydrate(prisma, rows[0])
}

export async function getFocusPlans(params: { organizationId: string; jobId: string; stageKey?: string }) {
  await assertAvailable(params.organizationId)
  await getJobQuestionnaireContext(params.organizationId, params.jobId)
  const stageKey = params.stageKey ?? DEFAULT_STAGE_KEY

  const [active, draft] = await Promise.all([
    selectPlanByStatus(prisma, params.organizationId, params.jobId, stageKey, "ACTIVE"),
    selectPlanByStatus(prisma, params.organizationId, params.jobId, stageKey, "DRAFT"),
  ])

  return { active, draft }
}

/** The ACTIVE plan used for generation, or null when unavailable / none exists. */
export async function getActiveFocusPlan(organizationId: string, jobId: string, stageKey = DEFAULT_STAGE_KEY) {
  if (!(await isInterviewFocusAvailable(organizationId))) return null
  return selectPlanByStatus(prisma, organizationId, jobId, stageKey, "ACTIVE")
}

// ---------------------------------------------------------------------------
// Recommendation
// ---------------------------------------------------------------------------

async function requestAiRecommendation(input: FocusRecommendationInput): Promise<FocusRecommendation | null> {
  const apiKey = (process.env.OPENAI_API_KEY ?? "").trim().replace(/^"|"$/g, "")
  if (!apiKey) return null

  const request = buildRecommendationRequest(input)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), RECOMMENDATION_TIMEOUT_MS)

  try {
    const response = await openAiFetch(OPENAI_URL, {
      aiUsage: { operation: "job.interview_focus_recommendation" },
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: RECOMMENDATION_MODEL,
        temperature: 0,
        messages: [
          { role: "system", content: request.system },
          { role: "user", content: request.user },
        ],
        response_format: {
          type: "json_schema",
          json_schema: { name: "interview_focus", strict: true, schema: request.schema },
        },
      }),
    })

    if (!response.ok) return null
    const payload = await response.json()
    const content = payload?.choices?.[0]?.message?.content
    if (typeof content !== "string") return null

    return sanitizeAiRecommendation(JSON.parse(content), input, { model: RECOMMENDATION_MODEL })
  } catch (error) {
    console.warn("Interview focus AI recommendation failed; using deterministic fallback", error)
    return null
  } finally {
    clearTimeout(timer)
  }
}

function recommendationToMeta(recommendation: FocusRecommendation): RecommendationMeta {
  return {
    recommendation: {
      input_hash: recommendation.inputHash,
      source: recommendation.source,
      model: recommendation.model ?? null,
      generated_at: new Date().toISOString(),
      role_family: recommendation.roleFamily,
      seniority: recommendation.seniority,
      areas: recommendation.areas.map((area) => ({ areaKey: area.areaKey, coverageWeight: area.coverageWeight })),
      rationale: recommendation.rationale,
    },
  }
}

function recommendedAreasFromMeta(meta: NonNullable<RecommendationMeta["recommendation"]>): FocusArea[] {
  const areas: FocusArea[] = []
  for (const entry of meta.areas) {
    const competency = getCompetency(entry.areaKey)
    if (!competency) continue
    areas.push({
      areaKey: competency.key,
      label: competency.label,
      description: competency.description,
      isCustom: false,
      sortOrder: areas.length + 1,
      coverageWeight: entry.coverageWeight,
    })
  }
  return areas
}

async function findCachedRecommendation(organizationId: string, jobId: string, inputHash: string) {
  const rows = await prisma.$queryRaw<{ recommendation_meta: RecommendationMeta }[]>(Prisma.sql`
    select recommendation_meta
    from public.interview_focus_plans
    where organization_id = ${organizationId}::uuid
      and job_id = ${jobId}::uuid
      and recommendation_meta -> 'recommendation' ->> 'input_hash' = ${inputHash}
    order by version_number desc
    limit 1
  `)
  return rows[0]?.recommendation_meta?.recommendation ?? null
}

type JobContext = Awaited<ReturnType<typeof getJobQuestionnaireContext>>

function recommendationInput(job: JobContext): FocusRecommendationInput {
  return {
    jobTitle: job.job_title,
    jobDescription: job.job_description,
    coreSkills: job.core_skills,
    experienceLevel: job.experience_level_label,
    durationMinutes: job.interview_duration_minutes,
  }
}

/**
 * VERIS Recommended focus for a job. Reuses a cached recommendation when the
 * job inputs (title, JD, skills, level, duration band) are unchanged, so the
 * AI is called at most once per distinct set of inputs. Falls back to the
 * deterministic recommendation when the AI is unavailable or unusable.
 */
async function resolveRecommendation(organizationId: string, job: JobContext) {
  const input = recommendationInput(job)
  const inputHash = computeFocusInputHash(input)
  const cached = await findCachedRecommendation(organizationId, job.job_id, inputHash)

  if (cached) {
    const areas = recommendedAreasFromMeta(cached)
    if (areas.length > 0) {
      return { areas, meta: { recommendation: cached } satisfies RecommendationMeta, cached: true }
    }
  }

  const recommendation = (await requestAiRecommendation(input)) ?? buildFallbackRecommendation(input)
  return { areas: recommendation.areas, meta: recommendationToMeta(recommendation), cached: false }
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

async function lockPlanStage(tx: Prisma.TransactionClient, jobId: string, stageKey: string) {
  await tx.$executeRaw(Prisma.sql`select pg_advisory_xact_lock(hashtext(${lockKey(jobId, stageKey)}))`)
}

async function nextVersionNumber(tx: Prisma.TransactionClient, organizationId: string, jobId: string, stageKey: string) {
  const rows = await tx.$queryRaw<{ next: number }[]>(Prisma.sql`
    select coalesce(max(version_number), 0) + 1 as next
    from public.interview_focus_plans
    where organization_id = ${organizationId}::uuid
      and job_id = ${jobId}::uuid
      and stage_key = ${stageKey}
  `)
  return Number(rows[0]?.next ?? 1)
}

async function insertDraftPlan(
  tx: Prisma.TransactionClient,
  params: {
    organizationId: string
    jobId: string
    stageKey: string
    origin: "VERIS_RECOMMENDED" | "CUSTOM"
    resumeEmphasis: ResumeEmphasis
    meta: RecommendationMeta
    createdBy?: string | null
  }
) {
  const versionNumber = await nextVersionNumber(tx, params.organizationId, params.jobId, params.stageKey)
  const rows = await tx.$queryRaw<{ plan_id: string }[]>(Prisma.sql`
    insert into public.interview_focus_plans (
      organization_id, job_id, stage_key, version_number, status, origin,
      resume_emphasis, recommendation_meta, created_by
    )
    values (
      ${params.organizationId}::uuid, ${params.jobId}::uuid, ${params.stageKey}, ${versionNumber},
      'DRAFT', ${params.origin}, ${params.resumeEmphasis}, ${JSON.stringify(params.meta)}::jsonb,
      ${params.createdBy ?? null}::uuid
    )
    returning plan_id::text
  `)
  return rows[0].plan_id
}

async function replaceAreas(tx: Prisma.TransactionClient, organizationId: string, planId: string, areas: FocusArea[]) {
  await tx.$executeRaw(Prisma.sql`
    delete from public.interview_focus_areas
    where plan_id = ${planId}::uuid and organization_id = ${organizationId}::uuid
  `)

  for (const [index, area] of areas.entries()) {
    await tx.$executeRaw(Prisma.sql`
      insert into public.interview_focus_areas (
        plan_id, organization_id, area_key, label, description, is_custom, sort_order, coverage_weight
      )
      values (
        ${planId}::uuid, ${organizationId}::uuid, ${area.areaKey}, ${area.label}, ${area.description},
        ${area.isCustom}, ${index + 1}::integer, ${area.coverageWeight}::integer
      )
    `)
  }
}

async function activatePlanInTx(tx: Prisma.TransactionClient, organizationId: string, jobId: string, stageKey: string, planId: string) {
  await tx.$executeRaw(Prisma.sql`
    update public.interview_focus_plans
    set status = 'SUPERSEDED'
    where organization_id = ${organizationId}::uuid
      and job_id = ${jobId}::uuid
      and stage_key = ${stageKey}
      and status = 'ACTIVE'
  `)
  await tx.$executeRaw(Prisma.sql`
    update public.interview_focus_plans
    set status = 'ACTIVE'
    where plan_id = ${planId}::uuid
      and organization_id = ${organizationId}::uuid
      and status = 'DRAFT'
  `)
}

function defaultResumeEmphasis(job: JobContext): ResumeEmphasis {
  return job.resume_questions_enabled === false ? "OFF" : "STANDARD"
}

/**
 * Returns the ACTIVE plan, creating a VERIS Recommended one if the job has
 * none. Safe to call concurrently: the advisory lock plus re-check means only
 * the first caller creates a plan (the partial unique index backs this up).
 */
export async function ensureActiveFocusPlan(params: {
  organizationId: string
  jobId: string
  stageKey?: string
  createdBy?: string | null
}): Promise<{ plan: FocusPlan; created: boolean }> {
  await assertAvailable(params.organizationId)
  const stageKey = params.stageKey ?? DEFAULT_STAGE_KEY
  const job = await getJobQuestionnaireContext(params.organizationId, params.jobId)

  const existing = await selectPlanByStatus(prisma, params.organizationId, params.jobId, stageKey, "ACTIVE")
  if (existing) return { plan: existing, created: false }

  // AI round trip outside any transaction or lock.
  const recommendation = await resolveRecommendation(params.organizationId, job)

  const result = await prisma.$transaction(async (tx) => {
    await lockPlanStage(tx, params.jobId, stageKey)
    const raced = await selectPlanByStatus(tx, params.organizationId, params.jobId, stageKey, "ACTIVE")
    if (raced) return { id: raced.planId, created: false }

    // Areas can only be written while the plan is a DRAFT (trigger-enforced),
    // so create it as a draft, fill it, then activate it in one transaction.
    const id = await insertDraftPlan(tx, {
      organizationId: params.organizationId,
      jobId: params.jobId,
      stageKey,
      origin: "VERIS_RECOMMENDED",
      resumeEmphasis: defaultResumeEmphasis(job),
      meta: recommendation.meta,
      createdBy: params.createdBy,
    })
    await replaceAreas(tx, params.organizationId, id, recommendation.areas)
    // A recruiter's open draft (if any) is left alone; only ACTIVE changes.
    await tx.$executeRaw(Prisma.sql`
      update public.interview_focus_plans set status = 'ACTIVE'
      where plan_id = ${id}::uuid and organization_id = ${params.organizationId}::uuid
    `)
    return { id, created: true }
  })

  const plan = await getFocusPlanById(params.organizationId, result.id)
  return { plan: plan!, created: result.created }
}

function sameAreas(a: FocusArea[], b: FocusArea[]) {
  return (
    a.length === b.length &&
    a.every((area, index) => area.areaKey === b[index].areaKey && area.coverageWeight === b[index].coverageWeight)
  )
}

/**
 * Saves the recruiter's edits into the job's DRAFT plan (forking one from the
 * ACTIVE plan when there is none). The ACTIVE plan is never modified.
 * Input is validated strictly against the job's current duration.
 */
export async function saveFocusDraft(params: {
  organizationId: string
  jobId: string
  stageKey?: string
  areas: unknown
  resumeEmphasis: unknown
  createdBy?: string | null
}) {
  await assertAvailable(params.organizationId)
  const stageKey = params.stageKey ?? DEFAULT_STAGE_KEY
  const job = await getJobQuestionnaireContext(params.organizationId, params.jobId)

  const validation = validateFocusPlanInput({
    areas: params.areas,
    resumeEmphasis: params.resumeEmphasis,
    durationMinutes: job.interview_duration_minutes,
  })
  if (!validation.ok) {
    throw new ApiError(400, "INVALID_FOCUS_PLAN", validation.errors[0], { errors: validation.errors })
  }

  const { plan: active } = await ensureActiveFocusPlan({ ...params, stageKey })
  const recommended = active.recommendation ? recommendedAreasFromMeta(active.recommendation) : []
  const origin = recommended.length > 0 && sameAreas(validation.areas, recommended) ? "VERIS_RECOMMENDED" : "CUSTOM"

  const planId = await prisma.$transaction(async (tx) => {
    await lockPlanStage(tx, params.jobId, stageKey)
    const draft = await selectPlanByStatus(tx, params.organizationId, params.jobId, stageKey, "DRAFT")
    const id =
      draft?.planId ??
      (await insertDraftPlan(tx, {
        organizationId: params.organizationId,
        jobId: params.jobId,
        stageKey,
        origin,
        resumeEmphasis: validation.resumeEmphasis,
        meta: active.recommendation ? { recommendation: active.recommendation } : {},
        createdBy: params.createdBy,
      }))

    await tx.$executeRaw(Prisma.sql`
      update public.interview_focus_plans
      set origin = ${origin}, resume_emphasis = ${validation.resumeEmphasis}
      where plan_id = ${id}::uuid and organization_id = ${params.organizationId}::uuid and status = 'DRAFT'
    `)
    await replaceAreas(tx, params.organizationId, id, validation.areas)
    return id
  })

  return (await getFocusPlanById(params.organizationId, planId))!
}

/**
 * Puts the VERIS Recommended focus into the draft, keeping the recruiter's
 * current resume emphasis. Uses the cached recommendation when job inputs are
 * unchanged, otherwise computes a fresh one.
 */
export async function restoreRecommendedFocusDraft(params: {
  organizationId: string
  jobId: string
  stageKey?: string
  createdBy?: string | null
}) {
  await assertAvailable(params.organizationId)
  const stageKey = params.stageKey ?? DEFAULT_STAGE_KEY
  const job = await getJobQuestionnaireContext(params.organizationId, params.jobId)
  const { active, draft } = await getFocusPlans({ ...params, stageKey })
  const recommendation = await resolveRecommendation(params.organizationId, job)

  const resumeEmphasis = draft?.resumeEmphasis ?? active?.resumeEmphasis ?? defaultResumeEmphasis(job)
  const saved = await saveFocusDraft({
    ...params,
    stageKey,
    areas: recommendation.areas.slice(0, maxFocusAreasForDuration(job.interview_duration_minutes)),
    resumeEmphasis,
  })

  // A fresh recommendation (job inputs changed) is recorded on the draft so
  // the rationale shown matches the areas.
  if (!recommendation.cached) {
    await prisma.$executeRaw(Prisma.sql`
      update public.interview_focus_plans
      set recommendation_meta = ${JSON.stringify(recommendation.meta)}::jsonb, origin = 'VERIS_RECOMMENDED'
      where plan_id = ${saved.planId}::uuid and organization_id = ${params.organizationId}::uuid and status = 'DRAFT'
    `)
  }

  return (await getFocusPlanById(params.organizationId, saved.planId))!
}

export async function discardFocusDraft(params: { organizationId: string; jobId: string; stageKey?: string }) {
  await assertAvailable(params.organizationId)
  await getJobQuestionnaireContext(params.organizationId, params.jobId)
  const deleted = await prisma.$executeRaw(Prisma.sql`
    delete from public.interview_focus_plans
    where organization_id = ${params.organizationId}::uuid
      and job_id = ${params.jobId}::uuid
      and stage_key = ${params.stageKey ?? DEFAULT_STAGE_KEY}
      and status = 'DRAFT'
  `)
  return { discarded: deleted > 0 }
}

/**
 * Makes the DRAFT the ACTIVE plan; the previous ACTIVE becomes SUPERSEDED.
 * Existing questionnaire versions keep pointing at the plan that generated
 * them, so nothing already generated or snapshotted changes.
 */
export async function activateFocusDraft(params: { organizationId: string; jobId: string; stageKey?: string }) {
  await assertAvailable(params.organizationId)
  const stageKey = params.stageKey ?? DEFAULT_STAGE_KEY
  await getJobQuestionnaireContext(params.organizationId, params.jobId)

  const planId = await prisma.$transaction(async (tx) => {
    await lockPlanStage(tx, params.jobId, stageKey)
    const draft = await selectPlanByStatus(tx, params.organizationId, params.jobId, stageKey, "DRAFT")
    if (!draft) {
      throw new ApiError(404, "NO_FOCUS_DRAFT", "There is no focus draft to apply")
    }
    await activatePlanInTx(tx, params.organizationId, params.jobId, stageKey, draft.planId)
    return draft.planId
  })

  return (await getFocusPlanById(params.organizationId, planId))!
}

// ---------------------------------------------------------------------------
// Question generation
// ---------------------------------------------------------------------------

/** What question generation needs from a focus plan version. */
export type GenerationFocus = {
  planId: string
  versionNumber: number
  status: FocusPlanStatus
  resumeEmphasis: ResumeEmphasis
  areas: FocusArea[]
}

function toGenerationFocus(plan: FocusPlan): GenerationFocus {
  return {
    planId: plan.planId,
    versionNumber: plan.versionNumber,
    status: plan.status,
    resumeEmphasis: plan.resumeEmphasis,
    areas: plan.areas,
  }
}

/**
 * The focus to generate with, or null for the legacy path.
 *
 * Returns null when the flag is off, the schema is missing, or (without
 * createIfMissing) the job has no ACTIVE plan. With createIfMissing the VERIS
 * Recommended plan is created on first use. Never throws: a focus problem
 * must not stop an interview from being prepared, so any failure falls back
 * to legacy generation and is logged.
 */
export async function resolveGenerationFocus(params: {
  organizationId: string
  jobId: string
  createIfMissing?: boolean
  createdBy?: string | null
}): Promise<GenerationFocus | null> {
  try {
    if (!(await isInterviewFocusAvailable(params.organizationId))) return null

    const plan = params.createIfMissing
      ? (await ensureActiveFocusPlan({ organizationId: params.organizationId, jobId: params.jobId, createdBy: params.createdBy })).plan
      : await selectPlanByStatus(prisma, params.organizationId, params.jobId, DEFAULT_STAGE_KEY, "ACTIVE")

    return plan && plan.areas.length > 0 ? toGenerationFocus(plan) : null
  } catch (error) {
    console.warn("Interview focus unavailable for generation; using legacy generation", {
      jobId: params.jobId,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

/** A specific plan version (e.g. the one a finalized questionnaire used). */
export async function getGenerationFocusForPlan(organizationId: string, planId: string | null | undefined) {
  if (!planId) return null
  try {
    if (!(await interviewFocusTablesSupported())) return null
    const plan = await getFocusPlanById(organizationId, planId)
    return plan ? toGenerationFocus(plan) : null
  } catch (error) {
    console.warn("Could not load focus plan for generation", { planId, error })
    return null
  }
}

/** The DRAFT plan if there is one, otherwise the ACTIVE plan. Org-scoped. */
export async function getEditableGenerationFocus(organizationId: string, jobId: string) {
  const { active, draft } = await getFocusPlans({ organizationId, jobId })
  const plan = draft ?? active
  return plan ? toGenerationFocus(plan) : null
}

export function serializeFocusPlan(plan: FocusPlan | null) {
  if (!plan) return null
  const rationale = plan.recommendation?.rationale ?? {}
  return {
    planId: plan.planId,
    versionNumber: plan.versionNumber,
    status: plan.status,
    origin: plan.origin,
    resumeEmphasis: plan.resumeEmphasis,
    areas: plan.areas.map((area) => ({
      areaKey: area.areaKey,
      label: area.label,
      description: area.description,
      isCustom: area.isCustom,
      coverageWeight: area.coverageWeight,
      rationale: rationale[area.areaKey] ?? null,
    })),
    recommendation: plan.recommendation
      ? {
          source: plan.recommendation.source,
          generatedAt: plan.recommendation.generated_at,
          areas: plan.recommendation.areas,
        }
      : null,
    updatedAt: plan.updatedAt,
  }
}
