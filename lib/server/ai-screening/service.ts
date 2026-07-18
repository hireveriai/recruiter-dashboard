import { Prisma } from "@prisma/client"

import { prisma } from "@/lib/server/prisma"
import { ApiError } from "@/lib/server/errors"
import { normalizeCandidateName, type ParsedResume } from "@/lib/server/resumeParser"
import type { CandidateMatchResult, ParsedJobDescription } from "@/lib/server/ai-screening/openai"

const EMAIL_REGEX = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type ScreeningJob = {
  id: string
  title: string
  description: string
  requiredSkills: string[]
  experienceNeeded: number | null
  roleTitle: string | null
  extractedJson: ParsedJobDescription | Record<string, unknown>
  sourceJobPositionId: string | null
  createdAt: string
}

type ScreeningJobRow = {
  id: string
  title: string
  description: string
  required_skills: string[] | null
  experience_needed: string | number | null
  role_title: string | null
  extracted_json: ParsedJobDescription | Record<string, unknown> | null
  source_job_position_id: string | null
  created_at: Date | string
}

type CandidateRow = {
  candidate_id: string
  full_name: string
  email: string | null
  phone: string | null
  resume_url: string | null
  resume_text: string | null
  extracted_json: ParsedResume | Record<string, unknown> | null
  upload_batch_id: string | null
  created_at: Date | string
}

export type MatchResultRow = {
  id: string
  candidateId: string
  candidateName: string
  email: string | null
  phone: string | null
  resumeUrl: string | null
  matchScore: number
  skillMatch: number
  experienceMatch: number
  riskLevel: "LOW" | "MEDIUM" | "HIGH"
  recommendation: "STRONG_FIT" | "POTENTIAL" | "WEAK" | "REJECT"
  insights: Record<string, unknown>
  createdAt: string
}

type MatchDbRow = {
  id: string
  candidate_id: string
  candidate_name: string
  email: string | null
  phone: string | null
  resume_url: string | null
  match_score: number
  skill_match: number
  experience_match: number
  risk_level: "LOW" | "MEDIUM" | "HIGH"
  recommendation: "STRONG_FIT" | "POTENTIAL" | "WEAK" | "REJECT"
  insights: Record<string, unknown> | null
  created_at: Date | string
}

type JobPositionRow = {
  job_id: string
  job_title: string
  job_description: string | null
  core_skills: string[] | null
  experience_level_id: number
}

type UploadBatchManifestRow = {
  batch_id: string
  candidate_ids: unknown
}

export type ResumeStorageObject = {
  bucket: string
  key: string
}

type CandidateStorageRow = {
  candidate_id: string
  bucket: string | null
  key: string | null
}

type ScreeningRunRow = {
  id: string
  job_id: string
  batch_id: string | null
  created_at: Date | string
  total_candidates: number
  strong_fit_count: number
  avg_score: number | string | null
}

type ScreeningRunMatchRow = {
  match_snapshot: MatchResultRow
}

type ScreeningRunInviteRow = {
  match_id: string
  candidate_id: string
  candidate_name: string
  email: string | null
  match_score: number
  recommendation: "STRONG_FIT" | "POTENTIAL" | "WEAK" | "REJECT"
}

export type ScreeningRun = {
  id: string
  jobId: string
  batchId: string | null
  createdAt: string
  totalCandidates: number
  strongFitCount: number
  avgScore: number
}

let ensureCandidateJobMatchesPromise: Promise<void> | null = null
let ensureScreeningRunTablesPromise: Promise<void> | null = null

function toIso(value: Date | string) {
  return value instanceof Date ? value.toISOString() : value
}

function normalizeUuidList(values: unknown) {
  if (!Array.isArray(values)) {
    return []
  }

  return values
    .map((value) => (typeof value === "string" ? normalizeUuid(value) : null))
    .filter((value): value is string => Boolean(value))
}

function normalizeJob(row: ScreeningJobRow): ScreeningJob {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    requiredSkills: row.required_skills ?? [],
    experienceNeeded:
      row.experience_needed === null || row.experience_needed === undefined
        ? null
        : Number(row.experience_needed),
    roleTitle: row.role_title,
    extractedJson: row.extracted_json ?? {},
    sourceJobPositionId: row.source_job_position_id,
    createdAt: toIso(row.created_at),
  }
}

function normalizeMatch(row: MatchDbRow): MatchResultRow {
  return {
    id: row.id,
    candidateId: row.candidate_id,
    candidateName: row.candidate_name,
    email: row.email,
    phone: row.phone,
    resumeUrl: row.resume_url,
    matchScore: row.match_score,
    skillMatch: row.skill_match,
    experienceMatch: row.experience_match,
    riskLevel: row.risk_level,
    recommendation: row.recommendation,
    insights: row.insights ?? {},
    createdAt: toIso(row.created_at),
  }
}

function normalizeScreeningRun(row: ScreeningRunRow): ScreeningRun {
  return {
    id: row.id,
    jobId: row.job_id,
    batchId: row.batch_id,
    createdAt: toIso(row.created_at),
    totalCandidates: Number(row.total_candidates ?? 0),
    strongFitCount: Number(row.strong_fit_count ?? 0),
    avgScore: Number(row.avg_score ?? 0),
  }
}

export function normalizeEmail(value: unknown) {
  if (typeof value !== "string") {
    return null
  }

  const trimmed = value.trim().toLowerCase()
  return EMAIL_REGEX.test(trimmed) ? trimmed : null
}

export function getDisplayNameFromFile(fileName: string) {
  const withoutExtension = fileName.replace(/\.(pdf|docx)$/i, "")
  const normalized = withoutExtension
    .replace(/^(?:cv|resume|curriculum[\s_-]*vitae)[\s_-]*/i, "")
    .replace(/[\s_-]*(?:cv|resume|curriculum[\s_-]*vitae)$/i, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  return normalizeCandidateName(normalized) ?? "Unnamed Candidate"
}

export async function saveParsedCandidate(input: {
  organizationId: string
  userId: string
  uploadBatchId: string
  fileName: string
  resumeUrl: string | null
  resumeText: string
  parsed: ParsedResume
  storage?: {
    bucket: string
    key: string
  }
}) {
  const email = normalizeEmail(input.parsed.email)
  const fullName = normalizeCandidateName(input.parsed.name) ?? getDisplayNameFromFile(input.fileName)
  const extractedJson = {
    ...input.parsed,
    name: fullName,
    email,
    sourceFileName: input.fileName,
    storage: input.storage ?? null,
    uploadBatchId: input.uploadBatchId,
    extractedAt: new Date().toISOString(),
  }

  if (email) {
    const existingRows = await prisma.$queryRaw<{ candidate_id: string }[]>(Prisma.sql`
      select candidate_id
      from public.candidates
      where organization_id = ${input.organizationId}::uuid
        and lower(email) = lower(${email})
      order by created_at desc
      limit 1
    `)
    const existing = existingRows[0]

    if (existing?.candidate_id) {
      const rows = await prisma.$queryRaw<{ candidate_id: string }[]>(Prisma.sql`
        update public.candidates
        set
          full_name = ${fullName},
          email = ${email},
          phone = ${input.parsed.phone ?? null},
          resume_url = ${input.resumeUrl},
          resume_text = ${input.resumeText},
          extracted_json = ${JSON.stringify(extractedJson)}::jsonb,
          upload_batch_id = ${input.uploadBatchId}::uuid,
          ai_screening_status = 'READY',
          created_by = coalesce(created_by, ${input.userId}::uuid)
        where candidate_id = ${existing.candidate_id}::uuid
          and organization_id = ${input.organizationId}::uuid
        returning candidate_id
      `)

      return {
        candidateId: rows[0]?.candidate_id ?? existing.candidate_id,
        created: false,
        email,
        name: fullName,
        extractedJson,
      }
    }
  }

  const rows = await prisma.$queryRaw<{ candidate_id: string }[]>(Prisma.sql`
    insert into public.candidates (
      organization_id,
      full_name,
      email,
      phone,
      resume_url,
      resume_text,
      extracted_json,
      upload_batch_id,
      ai_screening_status,
      created_by
    )
    values (
      ${input.organizationId}::uuid,
      ${fullName},
      ${email},
      ${input.parsed.phone ?? null},
      ${input.resumeUrl},
      ${input.resumeText},
      ${JSON.stringify(extractedJson)}::jsonb,
      ${input.uploadBatchId}::uuid,
      'READY',
      ${input.userId}::uuid
    )
    returning candidate_id
  `)

  const candidate = rows[0]

  if (!candidate?.candidate_id) {
    throw new ApiError(500, "CANDIDATE_SAVE_FAILED", "Failed to save parsed candidate")
  }

  return {
    candidateId: candidate.candidate_id,
    created: true,
    email,
    name: fullName,
    extractedJson,
  }
}

export async function getScreeningJobs(organizationId: string) {
  const rows = await prisma.$queryRaw<ScreeningJobRow[]>(Prisma.sql`
    select
      id::text,
      title,
      description,
      required_skills,
      experience_needed,
      role_title,
      extracted_json,
      source_job_position_id::text,
      created_at
    from public.jobs
    where organization_id = ${organizationId}::uuid
    order by created_at desc
    limit 100
  `)

  return rows.map(normalizeJob)
}

export async function recordUploadBatchManifest(input: {
  batchId: string
  organizationId: string
  userId: string
  candidateIds: string[]
  fileNames: string[]
}) {
  const batchId = normalizeUuid(input.batchId)

  if (!batchId) {
    return
  }

  const candidateIds = normalizeUuidList(input.candidateIds)

  try {
    await prisma.$queryRaw(Prisma.sql`
      insert into public.ai_screening_upload_batches (
        batch_id,
        organization_id,
        created_by,
        candidate_ids,
        file_names
      )
      values (
        ${batchId}::uuid,
        ${input.organizationId}::uuid,
        ${input.userId}::uuid,
        ${JSON.stringify(candidateIds)}::jsonb,
        ${JSON.stringify(input.fileNames)}::jsonb
      )
      on conflict (batch_id) do update
      set
        organization_id = excluded.organization_id,
        created_by = excluded.created_by,
        candidate_ids = (
          select coalesce(jsonb_agg(distinct candidate_id), '[]'::jsonb)
          from jsonb_array_elements(
            coalesce(public.ai_screening_upload_batches.candidate_ids, '[]'::jsonb) ||
            coalesce(excluded.candidate_ids, '[]'::jsonb)
          ) as candidates(candidate_id)
        ),
        file_names = (
          select coalesce(jsonb_agg(distinct file_name), '[]'::jsonb)
          from jsonb_array_elements(
            coalesce(public.ai_screening_upload_batches.file_names, '[]'::jsonb) ||
            coalesce(excluded.file_names, '[]'::jsonb)
          ) as files(file_name)
        )
    `)
  } catch (error) {
    console.warn("VERIS screening upload batch manifest write skipped", error)
  }
}

export async function getUploadBatchManifest(input: {
  batchId: string
  organizationId: string
}) {
  const batchId = normalizeUuid(input.batchId)

  if (!batchId) {
    return null
  }

  let rows: UploadBatchManifestRow[]

  try {
    rows = await prisma.$queryRaw<UploadBatchManifestRow[]>(Prisma.sql`
      select
        batch_id::text,
        candidate_ids
      from public.ai_screening_upload_batches
      where batch_id = ${batchId}::uuid
        and organization_id = ${input.organizationId}::uuid
      limit 1
    `)
  } catch (error) {
    console.warn("VERIS screening upload batch manifest lookup skipped", error)
    return null
  }

  const manifest = rows[0]

  if (!manifest?.batch_id) {
    return null
  }

  return {
    batchId: manifest.batch_id,
    candidateIds: normalizeUuidList(manifest.candidate_ids),
  }
}

export async function getLatestUploadBatchManifest(input: {
  organizationId: string
  userId?: string | null
  fileNames?: string[]
}) {
  const fileNames = normalizeFileNames(input.fileNames ?? [])

  async function getLatestCandidateBatch() {
    const rows = await prisma.$queryRaw<UploadBatchManifestRow[]>(Prisma.sql`
      select
        c.upload_batch_id::text as batch_id,
        jsonb_agg(c.candidate_id::text order by c.created_at desc) as candidate_ids
      from public.candidates c
      where c.organization_id = ${input.organizationId}::uuid
        and c.upload_batch_id is not null
        and coalesce(c.ai_screening_status, 'READY') <> 'ARCHIVED'
        ${input.userId ? Prisma.sql`and (c.created_by = ${input.userId}::uuid or c.created_by is null)` : Prisma.empty}
        ${
          fileNames.length > 0
            ? Prisma.sql`and lower(coalesce(c.extracted_json->>'sourceFileName', '')) in (${Prisma.join(fileNames)})`
            : Prisma.empty
        }
      group by c.upload_batch_id
      order by max(c.created_at) desc
      limit 1
    `)

    const batch = rows[0]

    if (!batch?.batch_id) {
      return null
    }

    return {
      batchId: batch.batch_id,
      candidateIds: normalizeUuidList(batch.candidate_ids),
    }
  }

  try {
    const rows = await prisma.$queryRaw<UploadBatchManifestRow[]>(Prisma.sql`
      select
        batch_id::text,
        candidate_ids
      from public.ai_screening_upload_batches
      where organization_id = ${input.organizationId}::uuid
        ${input.userId ? Prisma.sql`and (created_by = ${input.userId}::uuid or created_by is null)` : Prisma.empty}
        ${
          fileNames.length > 0
            ? Prisma.sql`and exists (
                select 1
                from jsonb_array_elements_text(file_names) as item(file_name)
                where lower(item.file_name) in (${Prisma.join(fileNames)})
              )`
            : Prisma.empty
        }
      order by created_at desc
      limit 1
    `)

    const manifest = rows[0]

    if (!manifest?.batch_id) {
      return getLatestCandidateBatch()
    }

    return {
      batchId: manifest.batch_id,
      candidateIds: normalizeUuidList(manifest.candidate_ids),
    }
  } catch (error) {
    console.warn("VERIS latest upload batch manifest lookup skipped", error)
    try {
      return await getLatestCandidateBatch()
    } catch (fallbackError) {
      console.warn("VERIS latest candidate upload batch lookup skipped", fallbackError)
      return null
    }
  }
}

export async function getScreeningJob(organizationId: string, jobId: string) {
  const rows = await prisma.$queryRaw<ScreeningJobRow[]>(Prisma.sql`
    select
      id::text,
      title,
      description,
      required_skills,
      experience_needed,
      role_title,
      extracted_json,
      source_job_position_id::text,
      created_at
    from public.jobs
    where id = ${jobId}::uuid
      and organization_id = ${organizationId}::uuid
    limit 1
  `)

  return rows[0] ? normalizeJob(rows[0]) : null
}

async function getLatestScreeningJobId(organizationId: string) {
  const rows = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
    select id::text
    from public.jobs
    where organization_id = ${organizationId}::uuid
    order by created_at desc
    limit 1
  `)

  return rows[0]?.id ?? null
}

async function resolveRequiredScreeningJobId(organizationId: string, jobId: string | null | undefined) {
  const normalized = normalizeUuid(jobId)

  if (normalized) {
    return normalized
  }

  const latestJobId = await getLatestScreeningJobId(organizationId)

  if (latestJobId) {
    return latestJobId
  }

  throw new ApiError(400, "JD_NOT_PROCESSED", "Analyze a job before matching candidates")
}

async function ensureScreeningRunTables() {
  if (ensureScreeningRunTablesPromise) {
    return ensureScreeningRunTablesPromise
  }

  ensureScreeningRunTablesPromise = ensureScreeningRunTablesUncached().catch((error) => {
    ensureScreeningRunTablesPromise = null
    throw error
  })

  return ensureScreeningRunTablesPromise
}

async function ensureScreeningRunTablesUncached() {
  await prisma.$executeRawUnsafe(`
    create table if not exists public.screening_runs (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null references public.organizations(organization_id) on delete cascade,
      job_id uuid not null,
      batch_id uuid null,
      created_by uuid null,
      created_at timestamptz not null default now(),
      total_candidates int not null default 0,
      strong_fit_count int not null default 0,
      avg_score numeric(5,2) not null default 0
    )
  `)

  await prisma.$executeRawUnsafe(`
    create table if not exists public.screening_run_matches (
      id uuid primary key default gen_random_uuid(),
      run_id uuid not null references public.screening_runs(id) on delete cascade,
      organization_id uuid not null references public.organizations(organization_id) on delete cascade,
      candidate_id uuid null,
      match_snapshot jsonb not null,
      created_at timestamptz not null default now()
    )
  `)

  await prisma.$executeRawUnsafe(`
    alter table public.screening_runs
      add column if not exists batch_id uuid null,
      add column if not exists created_by uuid null,
      add column if not exists total_candidates int not null default 0,
      add column if not exists strong_fit_count int not null default 0,
      add column if not exists avg_score numeric(5,2) not null default 0
  `)

  await prisma.$executeRawUnsafe(`
    alter table public.screening_run_matches
      add column if not exists organization_id uuid,
      add column if not exists candidate_id uuid,
      add column if not exists match_snapshot jsonb not null default '{}'::jsonb,
      add column if not exists created_at timestamptz not null default now()
  `)

  await prisma.$executeRawUnsafe(`
    create index if not exists idx_screening_runs_org_job_created
      on public.screening_runs (organization_id, job_id, created_at desc)
  `)

  await prisma.$executeRawUnsafe(`
    create index if not exists idx_screening_runs_batch
      on public.screening_runs (organization_id, batch_id)
      where batch_id is not null
  `)

  await prisma.$executeRawUnsafe(`
    create index if not exists idx_screening_run_matches_run
      on public.screening_run_matches (run_id)
  `)

  await prisma.$executeRawUnsafe(`
    create index if not exists idx_screening_run_matches_org_candidate
      on public.screening_run_matches (organization_id, candidate_id)
      where candidate_id is not null
  `)
}

async function ensureCandidateJobMatchesTable() {
  if (ensureCandidateJobMatchesPromise) {
    return ensureCandidateJobMatchesPromise
  }

  ensureCandidateJobMatchesPromise = ensureCandidateJobMatchesTableUncached().catch((error) => {
    ensureCandidateJobMatchesPromise = null
    throw error
  })

  return ensureCandidateJobMatchesPromise
}

async function ensureCandidateJobMatchesTableUncached() {
  await prisma.$executeRawUnsafe(`
    create table if not exists public.candidate_job_matches (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null references public.organizations(organization_id) on delete cascade,
      candidate_id uuid not null references public.candidates(candidate_id) on delete cascade,
      job_id uuid not null references public.jobs(id) on delete cascade,
      match_score int not null default 0,
      skill_match int not null default 0,
      experience_match int not null default 0,
      risk_level text not null default 'MEDIUM',
      recommendation text not null default 'POTENTIAL',
      insights jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now()
    )
  `)

  await prisma.$executeRawUnsafe(`
    alter table public.candidate_job_matches
      add column if not exists organization_id uuid,
      add column if not exists candidate_id uuid,
      add column if not exists job_id uuid,
      add column if not exists match_score int not null default 0,
      add column if not exists skill_match int not null default 0,
      add column if not exists experience_match int not null default 0,
      add column if not exists risk_level text not null default 'MEDIUM',
      add column if not exists recommendation text not null default 'POTENTIAL',
      add column if not exists insights jsonb not null default '{}'::jsonb,
      add column if not exists created_at timestamptz not null default now()
  `)

  await prisma.$executeRawUnsafe(`
    delete from public.candidate_job_matches a
    using public.candidate_job_matches b
    where a.candidate_id = b.candidate_id
      and a.job_id = b.job_id
      and a.ctid < b.ctid
  `)

  await prisma.$executeRawUnsafe(`
    create unique index if not exists candidate_job_matches_candidate_job_uidx
      on public.candidate_job_matches (candidate_id, job_id)
  `)

  await prisma.$executeRawUnsafe(`
    create index if not exists idx_candidate_job_matches_org_candidate_created_desc
      on public.candidate_job_matches (organization_id, candidate_id, created_at desc)
  `)
}

export async function getJobPositionForScreening(organizationId: string, jobId: string) {
  const rows = await prisma.$queryRaw<JobPositionRow[]>(Prisma.sql`
    select
      job_id::text,
      job_title,
      job_description,
      core_skills,
      experience_level_id
    from public.job_positions
    where job_id = ${jobId}::uuid
      and organization_id = ${organizationId}::uuid
    limit 1
  `)

  return rows[0] ?? null
}

async function getExperienceLevelId(experienceNeeded: number | null) {
  const desired = experienceNeeded === null ? 2 : experienceNeeded <= 1.5 ? 1 : experienceNeeded >= 6 ? 3 : 2
  const rows = await prisma.$queryRaw<{ experience_level_id: number }[]>(Prisma.sql`
    select experience_level_id
    from public.experience_level_pool
    order by abs(experience_level_id - ${desired})
    limit 1
  `)

  return rows[0]?.experience_level_id ?? 1
}

function difficultyFromParsedJob(parsed: ParsedJobDescription) {
  if (parsed.seniority === "SENIOR") {
    return "SENIOR"
  }

  if (parsed.seniority === "JUNIOR") {
    return "JUNIOR"
  }

  return "MID"
}

export async function createJobPositionForPastedJd(input: {
  organizationId: string
  title: string
  description: string
  parsed: ParsedJobDescription
}) {
  const experienceLevelId = await getExperienceLevelId(input.parsed.experienceNeeded)
  const rows = await prisma.$queryRaw<{ job_id: string }[]>(Prisma.sql`
    insert into public.job_positions (
      organization_id,
      job_title,
      job_description,
      experience_level_id,
      core_skills,
      difficulty_profile,
      interview_duration_minutes
    )
    values (
      ${input.organizationId}::uuid,
      ${input.title},
      ${input.description},
      ${experienceLevelId}::smallint,
      ${input.parsed.requiredSkills}::text[],
      ${difficultyFromParsedJob(input.parsed)}::difficulty_profile,
      30
    )
    returning job_id::text
  `)

  const job = rows[0]

  if (!job?.job_id) {
    throw new ApiError(500, "JOB_POSITION_CREATE_FAILED", "Failed to create interview job for the pasted JD")
  }

  return job.job_id
}

export async function upsertScreeningJob(input: {
  id: string
  organizationId: string
  userId: string
  title: string
  description: string
  parsed: ParsedJobDescription
  sourceJobPositionId: string
}) {
  const rows = await prisma.$queryRaw<ScreeningJobRow[]>(Prisma.sql`
    insert into public.jobs (
      id,
      organization_id,
      title,
      description,
      required_skills,
      experience_needed,
      role_title,
      extracted_json,
      source_job_position_id,
      created_by
    )
    values (
      ${input.id}::uuid,
      ${input.organizationId}::uuid,
      ${input.title},
      ${input.description},
      ${input.parsed.requiredSkills}::text[],
      ${input.parsed.experienceNeeded},
      ${input.parsed.roleTitle},
      ${JSON.stringify(input.parsed)}::jsonb,
      ${input.sourceJobPositionId}::uuid,
      ${input.userId}::uuid
    )
    on conflict (id) do update
    set
      title = excluded.title,
      description = excluded.description,
      required_skills = excluded.required_skills,
      experience_needed = excluded.experience_needed,
      role_title = excluded.role_title,
      extracted_json = excluded.extracted_json,
      source_job_position_id = excluded.source_job_position_id
    returning
      id::text,
      title,
      description,
      required_skills,
      experience_needed,
      role_title,
      extracted_json,
      source_job_position_id::text,
      created_at
  `)

  const job = rows[0]

  if (!job?.id) {
    throw new ApiError(500, "SCREENING_JOB_SAVE_FAILED", "Failed to save screening job")
  }

  return normalizeJob(job)
}

function normalizeUuid(value: string | null | undefined) {
  const trimmed = value?.trim()
  return trimmed && UUID_REGEX.test(trimmed) ? trimmed : null
}

function getCandidateScopeSql(batchId: string | null, candidateIds: string[]) {
  if (batchId && candidateIds.length > 0) {
    return Prisma.sql`and c.candidate_id::text in (${Prisma.join(candidateIds)})`
  }

  if (candidateIds.length > 0) {
    return Prisma.sql`and c.candidate_id::text in (${Prisma.join(candidateIds)})`
  }

  if (batchId) {
    return Prisma.sql`and (c.upload_batch_id = ${batchId}::uuid or c.extracted_json->>'uploadBatchId' = ${batchId})`
  }

  return Prisma.empty
}

function requireCleanupScope(batchId: string | null, candidateIds: string[]) {
  if (!batchId && candidateIds.length === 0) {
    throw new ApiError(400, "CLEANUP_SCOPE_REQUIRED", "Current upload scope is required")
  }
}

export async function getCandidatesForMatching(input: {
  organizationId: string
  candidateIds?: string[]
  uploadBatchId?: string | null
  includeAllCandidates?: boolean
}) {
  const batchId = normalizeUuid(input.uploadBatchId)
  const candidateIds = (input.candidateIds ?? []).map(normalizeUuid).filter((id): id is string => Boolean(id))
  const includeAllCandidates = input.includeAllCandidates === true
  const hasCandidateFilter = candidateIds.length > 0

  if (!includeAllCandidates && !batchId && !hasCandidateFilter) {
    return []
  }

  const rows = await prisma.$queryRaw<CandidateRow[]>(Prisma.sql`
    select
      candidate_id::text,
      full_name,
      email,
      phone,
      resume_url,
      resume_text,
      extracted_json,
      upload_batch_id::text,
      created_at
    from public.candidates
    where organization_id = ${input.organizationId}::uuid
      and coalesce(ai_screening_status, 'READY') <> 'ARCHIVED'
      ${
        !includeAllCandidates && hasCandidateFilter && batchId
          ? Prisma.sql`and candidate_id::text in (${Prisma.join(candidateIds)})`
          : !includeAllCandidates && hasCandidateFilter
            ? Prisma.sql`and candidate_id::text in (${Prisma.join(candidateIds)})`
            : !includeAllCandidates && batchId
              ? Prisma.sql`and (upload_batch_id = ${batchId}::uuid or extracted_json->>'uploadBatchId' = ${batchId})`
              : Prisma.empty
      }
    order by created_at desc
    limit 250
  `)

  return rows
}

function normalizeFileNames(values: unknown) {
  if (!Array.isArray(values)) {
    return []
  }

  return [...new Set(values
    .map((value) => (typeof value === "string" ? value.trim().toLowerCase() : ""))
    .filter(Boolean))]
    .slice(0, 50)
}

export async function getCandidatesForMatchingByUploadFiles(input: {
  organizationId: string
  userId: string
  uploadBatchId?: string | null
  fileNames?: string[]
}) {
  const batchId = normalizeUuid(input.uploadBatchId)
  const fileNames = normalizeFileNames(input.fileNames ?? [])

  if (fileNames.length === 0) {
    return []
  }

  const rows = await prisma.$queryRaw<CandidateRow[]>(Prisma.sql`
    select
      candidate_id::text,
      full_name,
      email,
      phone,
      resume_url,
      resume_text,
      extracted_json,
      upload_batch_id::text,
      created_at
    from public.candidates
    where organization_id = ${input.organizationId}::uuid
      and coalesce(ai_screening_status, 'READY') <> 'ARCHIVED'
      and lower(coalesce(extracted_json->>'sourceFileName', '')) in (${Prisma.join(fileNames)})
      and (
        ${
          batchId
            ? Prisma.sql`upload_batch_id = ${batchId}::uuid or extracted_json->>'uploadBatchId' = ${batchId} or`
            : Prisma.empty
        }
        coalesce(
          case
            when extracted_json->>'extractedAt' ~ '^\\d{4}-\\d{2}-\\d{2}T'
              then (extracted_json->>'extractedAt')::timestamptz
            else null
          end,
          created_at
        ) > now() - interval '2 hours'
      )
      and (created_by = ${input.userId}::uuid or created_by is null)
    order by coalesce(
      case
        when extracted_json->>'extractedAt' ~ '^\\d{4}-\\d{2}-\\d{2}T'
          then (extracted_json->>'extractedAt')::timestamptz
        else null
      end,
      created_at
    ) desc
    limit 50
  `)

  return rows
}

export async function attachCandidatesToUploadBatch(input: {
  organizationId: string
  uploadBatchId: string
  candidateIds: string[]
}) {
  const batchId = normalizeUuid(input.uploadBatchId)
  const candidateIds = normalizeUuidList(input.candidateIds)

  if (!batchId || candidateIds.length === 0) {
    return
  }

  await prisma.$executeRaw(Prisma.sql`
    update public.candidates
    set
      upload_batch_id = ${batchId}::uuid,
      extracted_json = jsonb_set(
        coalesce(extracted_json, '{}'::jsonb),
        '{uploadBatchId}',
        to_jsonb(${batchId}::text),
        true
      )
    where organization_id = ${input.organizationId}::uuid
      and candidate_id::text in (${Prisma.join(candidateIds)})
  `)
}

export async function upsertCandidateJobMatch(input: {
  organizationId: string
  candidateId: string
  jobId: string
  result: CandidateMatchResult
}) {
  await ensureCandidateJobMatchesTable()

  const insights = {
    missing_skills: input.result.missingSkills,
    short_reasoning: input.result.shortReasoning,
    evaluated_at: new Date().toISOString(),
  }
  const rows = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
    insert into public.candidate_job_matches (
      organization_id,
      candidate_id,
      job_id,
      match_score,
      skill_match,
      experience_match,
      risk_level,
      recommendation,
      insights
    )
    values (
      ${input.organizationId}::uuid,
      ${input.candidateId}::uuid,
      ${input.jobId}::uuid,
      ${input.result.matchScore},
      ${input.result.skillMatch},
      ${input.result.experienceMatch},
      ${input.result.riskLevel},
      ${input.result.recommendation},
      ${JSON.stringify(insights)}::jsonb
    )
    on conflict (candidate_id, job_id) do update
    set
      organization_id = excluded.organization_id,
      match_score = excluded.match_score,
      skill_match = excluded.skill_match,
      experience_match = excluded.experience_match,
      risk_level = excluded.risk_level,
      recommendation = excluded.recommendation,
      insights = excluded.insights
    returning id::text
  `)

  return rows[0]?.id ?? null
}

export async function getMatchResults(
  organizationId: string,
  jobId: string,
  options?: {
    uploadBatchId?: string | null
    candidateIds?: string[]
    fileNames?: string[]
    includeAllCandidates?: boolean
  }
) {
  await ensureCandidateJobMatchesTable()

  const batchId = normalizeUuid(options?.uploadBatchId)
  const candidateIds = (options?.candidateIds ?? []).map(normalizeUuid).filter((id): id is string => Boolean(id))
  const fileNames = normalizeFileNames(options?.fileNames ?? [])
  const hasCandidateFilter = candidateIds.length > 0
  const hasFileFilter = fileNames.length > 0
  const includeAllCandidates = options?.includeAllCandidates === true

  if (!includeAllCandidates && !batchId && !hasCandidateFilter && !hasFileFilter) {
    return []
  }

  const rows = await prisma.$queryRaw<MatchDbRow[]>(Prisma.sql`
    select
      m.id::text,
      c.candidate_id::text,
      c.full_name as candidate_name,
      c.email,
      c.phone,
      c.resume_url,
      m.match_score,
      m.skill_match,
      m.experience_match,
      m.risk_level,
      m.recommendation,
      m.insights,
      m.created_at
    from public.candidate_job_matches m
    inner join public.candidates c
      on c.candidate_id = m.candidate_id
    inner join public.jobs j
      on j.id = m.job_id
    where m.job_id = ${jobId}::uuid
      and c.organization_id = ${organizationId}::uuid
      and j.organization_id = ${organizationId}::uuid
      ${
        !includeAllCandidates && hasCandidateFilter && batchId
          ? Prisma.sql`and c.candidate_id::text in (${Prisma.join(candidateIds)})`
        : !includeAllCandidates && hasCandidateFilter
            ? Prisma.sql`and c.candidate_id::text in (${Prisma.join(candidateIds)})`
            : !includeAllCandidates && hasFileFilter
              ? Prisma.sql`and lower(coalesce(c.extracted_json->>'sourceFileName', '')) in (${Prisma.join(fileNames)})`
            : !includeAllCandidates && batchId
              ? Prisma.sql`and (c.upload_batch_id = ${batchId}::uuid or c.extracted_json->>'uploadBatchId' = ${batchId})`
              : Prisma.empty
      }
    order by m.match_score desc, m.created_at desc
  `)

  return rows.map(normalizeMatch)
}

export async function createScreeningRun(input: {
  organizationId: string
  userId: string
  jobId: string
  batchId?: string | null
  matches: MatchResultRow[]
}) {
  await ensureScreeningRunTables()

  const jobId = await resolveRequiredScreeningJobId(input.organizationId, input.jobId)
  const batchId = normalizeUuid(input.batchId)

  const totalCandidates = input.matches.length
  const strongFitCount = input.matches.filter((match) => match.recommendation === "STRONG_FIT").length
  const avgScore = totalCandidates > 0
    ? Math.round(input.matches.reduce((total, match) => total + match.matchScore, 0) / totalCandidates)
    : 0

  const rows = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
    insert into public.screening_runs (
      organization_id,
      job_id,
      batch_id,
      created_by,
      total_candidates,
      strong_fit_count,
      avg_score
    )
    values (
      ${input.organizationId}::uuid,
      ${jobId}::uuid,
      ${batchId ? Prisma.sql`${batchId}::uuid` : Prisma.sql`null`},
      ${input.userId}::uuid,
      ${totalCandidates},
      ${strongFitCount},
      ${avgScore}
    )
    returning id::text
  `)
  const runId = rows[0]?.id

  if (!runId) {
    throw new ApiError(500, "SCREENING_RUN_CREATE_FAILED", "Failed to create screening run")
  }

  if (input.matches.length > 0) {
    await prisma.$queryRaw(Prisma.sql`
      insert into public.screening_run_matches (
        run_id,
        organization_id,
        candidate_id,
        match_snapshot
      )
      select
        ${runId}::uuid,
        ${input.organizationId}::uuid,
        (item->>'candidateId')::uuid,
        item
      from jsonb_array_elements(${JSON.stringify(input.matches)}::jsonb) as item
    `)
  }

  return runId
}

export async function getScreeningRuns(input: {
  organizationId: string
  jobId: string
  limit?: number
}) {
  await ensureScreeningRunTables()

  const jobId = await resolveRequiredScreeningJobId(input.organizationId, input.jobId)

  const rows = await prisma.$queryRaw<ScreeningRunRow[]>(Prisma.sql`
    select
      id::text,
      job_id::text,
      batch_id::text,
      created_at,
      total_candidates,
      strong_fit_count,
      avg_score
    from public.screening_runs
    where organization_id = ${input.organizationId}::uuid
      and job_id = ${jobId}::uuid
    order by created_at desc
    limit ${Math.min(Math.max(input.limit ?? 5, 1), 20)}
  `)

  return rows.map(normalizeScreeningRun)
}

export async function getScreeningRunMatches(input: {
  organizationId: string
  runId: string
}) {
  await ensureScreeningRunTables()

  const runId = normalizeUuid(input.runId)

  if (!runId) {
    throw new ApiError(400, "SCREENING_RUN_REQUIRED", "Screening run is required")
  }

  const rows = await prisma.$queryRaw<ScreeningRunMatchRow[]>(Prisma.sql`
    select match_snapshot
    from public.screening_run_matches
    where organization_id = ${input.organizationId}::uuid
      and run_id = ${runId}::uuid
    order by (match_snapshot->>'matchScore')::int desc, match_snapshot->>'createdAt' desc
  `)

  return rows.map((row) => row.match_snapshot)
}

export async function getScreeningRunSnapshot(input: {
  organizationId: string
  runId: string
}) {
  await ensureScreeningRunTables()

  const runId = normalizeUuid(input.runId)

  if (!runId) {
    throw new ApiError(400, "SCREENING_RUN_REQUIRED", "Screening run is required")
  }

  const runRows = await prisma.$queryRaw<ScreeningRunRow[]>(Prisma.sql`
    select
      id::text,
      job_id::text,
      batch_id::text,
      created_at,
      total_candidates,
      strong_fit_count,
      avg_score
    from public.screening_runs
    where organization_id = ${input.organizationId}::uuid
      and id = ${runId}::uuid
    limit 1
  `)

  const run = runRows[0]

  if (!run) {
    throw new ApiError(404, "SCREENING_RUN_NOT_FOUND", "Screening run not found")
  }

  const matches = await getScreeningRunMatches({
    organizationId: input.organizationId,
    runId,
  })

  return {
    run: normalizeScreeningRun(run),
    matches,
    diagnostics: matches.length === 0
      ? "This screening run exists, but it has no stored candidate snapshots."
      : null,
  }
}

export async function clearScreeningResultsForUpload(input: {
  organizationId: string
  jobId: string
  uploadBatchId?: string | null
  candidateIds?: string[]
}) {
  await ensureScreeningRunTables()

  const jobId = await resolveRequiredScreeningJobId(input.organizationId, input.jobId)
  const batchId = normalizeUuid(input.uploadBatchId)
  const candidateIds = normalizeUuidList(input.candidateIds ?? [])

  requireCleanupScope(batchId, candidateIds)

  const deletedMatches = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
    delete from public.candidate_job_matches m
    using public.candidates c, public.jobs j
    where c.candidate_id = m.candidate_id
      and j.id = m.job_id
      and c.organization_id = ${input.organizationId}::uuid
      and j.organization_id = ${input.organizationId}::uuid
      and m.job_id = ${jobId}::uuid
      ${getCandidateScopeSql(batchId, candidateIds)}
    returning m.id::text
  `)

  const runRows = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
    select distinct r.id::text
    from public.screening_runs r
    left join public.screening_run_matches rm
      on rm.run_id = r.id
      and rm.organization_id = r.organization_id
    where r.organization_id = ${input.organizationId}::uuid
      and r.job_id = ${jobId}::uuid
      and (
        ${batchId ? Prisma.sql`r.batch_id = ${batchId}::uuid` : Prisma.sql`false`}
        ${
          candidateIds.length > 0
            ? Prisma.sql`or rm.candidate_id::text in (${Prisma.join(candidateIds)})
                or rm.match_snapshot->>'candidateId' in (${Prisma.join(candidateIds)})`
            : Prisma.empty
        }
      )
  `)
  const runIds = runRows.map((row) => row.id).filter(Boolean)
  let deletedRunMatches: { id: string }[] = []
  let deletedRuns: { id: string }[] = []

  if (runIds.length > 0) {
    deletedRunMatches = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
      delete from public.screening_run_matches rm
      where rm.organization_id = ${input.organizationId}::uuid
        and rm.run_id::text in (${Prisma.join(runIds)})
      returning rm.id::text
    `)

    deletedRuns = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
      delete from public.screening_runs r
      where r.organization_id = ${input.organizationId}::uuid
        and r.id::text in (${Prisma.join(runIds)})
      returning r.id::text
    `)
  }

  return {
    deletedResults: deletedMatches.length,
    deletedRunMatches: deletedRunMatches.length,
    deletedRuns: deletedRuns.length,
  }
}

export async function deleteUploadAndAnalysis(input: {
  organizationId: string
  uploadBatchId?: string | null
  candidateIds?: string[]
}) {
  const batchId = normalizeUuid(input.uploadBatchId)
  const candidateIds = normalizeUuidList(input.candidateIds ?? [])

  requireCleanupScope(batchId, candidateIds)

  const storageRows = await prisma.$queryRaw<CandidateStorageRow[]>(Prisma.sql`
    select
      c.candidate_id::text,
      c.extracted_json->'storage'->>'bucket' as bucket,
      c.extracted_json->'storage'->>'key' as key
    from public.candidates c
    where c.organization_id = ${input.organizationId}::uuid
      ${getCandidateScopeSql(batchId, candidateIds)}
  `)

  const deletedMatches = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
    delete from public.candidate_job_matches m
    using public.candidates c
    where c.candidate_id = m.candidate_id
      and c.organization_id = ${input.organizationId}::uuid
      ${getCandidateScopeSql(batchId, candidateIds)}
    returning m.id::text
  `)

  const deletedCandidates = await prisma.$queryRaw<{ candidate_id: string }[]>(Prisma.sql`
    delete from public.candidates c
    where c.organization_id = ${input.organizationId}::uuid
      ${getCandidateScopeSql(batchId, candidateIds)}
    returning c.candidate_id::text
  `)

  if (batchId) {
    await prisma.$queryRaw(Prisma.sql`
      delete from public.ai_screening_upload_batches b
      where b.organization_id = ${input.organizationId}::uuid
        and b.batch_id = ${batchId}::uuid
    `).catch((error) => {
      console.warn("VERIS screening upload batch manifest cleanup skipped", error)
    })
  }

  const storageObjects = storageRows
    .filter((row): row is CandidateStorageRow & ResumeStorageObject => Boolean(row.bucket && row.key))
    .map((row) => ({
      bucket: row.bucket,
      key: row.key,
    }))

  return {
    deletedResults: deletedMatches.length,
    deletedCandidates: deletedCandidates.length,
    storageObjects,
  }
}

export async function updateCandidateEmail(input: {
  organizationId: string
  candidateId: string
  email: string | null
}) {
  const rows = await prisma.$queryRaw<{ candidate_id: string; email: string | null }[]>(Prisma.sql`
    update public.candidates
    set email = ${input.email}
    where candidate_id = ${input.candidateId}::uuid
      and organization_id = ${input.organizationId}::uuid
    returning candidate_id::text, email
  `)

  const candidate = rows[0]

  if (!candidate?.candidate_id) {
    throw new ApiError(404, "CANDIDATE_NOT_FOUND", "Candidate not found")
  }

  return {
    candidateId: candidate.candidate_id,
    email: candidate.email,
  }
}

export async function getMatchesForInviteSelection(input: {
  organizationId: string
  jobId: string
  mode: "STRONG_FIT" | "TOP_N" | "SELECTED"
  topN?: number
  candidateIds?: string[]
  uploadBatchId?: string | null
  includeAllCandidates?: boolean
  runId?: string | null
}) {
  const topN = Math.min(100, Math.max(1, input.topN ?? 10))
  const candidateIds = (input.candidateIds ?? []).map(normalizeUuid).filter((id): id is string => Boolean(id))
  const hasCandidateIds = candidateIds.length > 0
  const batchId = normalizeUuid(input.uploadBatchId)
  const includeAllCandidates = input.includeAllCandidates === true
  const runId = normalizeUuid(input.runId ?? null)

  if (input.mode === "SELECTED" && !hasCandidateIds) {
    throw new ApiError(
      400,
      "SELECTED_CANDIDATES_REQUIRED",
      "Selected interview send requires explicit candidate IDs."
    )
  }

  if (runId) {
    const rows = await prisma.$queryRaw<ScreeningRunInviteRow[]>(Prisma.sql`
      select
        coalesce(rm.match_snapshot->>'id', rm.id::text) as match_id,
        coalesce(rm.match_snapshot->>'candidateId', rm.candidate_id::text) as candidate_id,
        coalesce(rm.match_snapshot->>'candidateName', 'Candidate') as candidate_name,
        nullif(rm.match_snapshot->>'email', '') as email,
        coalesce(nullif(rm.match_snapshot->>'matchScore', '')::int, 0) as match_score,
        coalesce(rm.match_snapshot->>'recommendation', 'POTENTIAL')::text as recommendation
      from public.screening_run_matches rm
      inner join public.screening_runs r
        on r.id = rm.run_id
        and r.organization_id = rm.organization_id
      where rm.organization_id = ${input.organizationId}::uuid
        and rm.run_id = ${runId}::uuid
        and r.job_id = ${input.jobId}::uuid
        ${
          input.mode === "STRONG_FIT"
            ? Prisma.sql`and rm.match_snapshot->>'recommendation' = 'STRONG_FIT'`
            : Prisma.empty
        }
        ${
          hasCandidateIds
            ? Prisma.sql`and coalesce(rm.match_snapshot->>'candidateId', rm.candidate_id::text) in (${Prisma.join(candidateIds)})`
            : Prisma.empty
        }
      order by coalesce(nullif(rm.match_snapshot->>'matchScore', '')::int, 0) desc, rm.match_snapshot->>'createdAt' desc
      ${input.mode === "TOP_N" ? Prisma.sql`limit ${topN}` : Prisma.empty}
    `)

    return rows
  }

  const rows = await prisma.$queryRaw<
    Array<{
      match_id: string
      candidate_id: string
      candidate_name: string
      email: string | null
      match_score: number
      recommendation: "STRONG_FIT" | "POTENTIAL" | "WEAK" | "REJECT"
    }>
  >(Prisma.sql`
    select
      m.id::text as match_id,
      c.candidate_id::text,
      c.full_name as candidate_name,
      c.email,
      m.match_score,
      m.recommendation
    from public.candidate_job_matches m
    inner join public.candidates c on c.candidate_id = m.candidate_id
    where m.organization_id = ${input.organizationId}::uuid
      and m.job_id = ${input.jobId}::uuid
      ${
        input.mode === "STRONG_FIT"
          ? Prisma.sql`and m.recommendation = 'STRONG_FIT'`
          : Prisma.empty
      }
      ${
        input.mode === "SELECTED" && hasCandidateIds
          ? Prisma.sql`and c.candidate_id::text in (${Prisma.join(candidateIds)})`
          : Prisma.empty
      }
      ${
        input.mode !== "SELECTED" && !includeAllCandidates && hasCandidateIds && batchId
          ? Prisma.sql`and c.candidate_id::text in (${Prisma.join(candidateIds)})`
          : input.mode !== "SELECTED" && !includeAllCandidates && hasCandidateIds
            ? Prisma.sql`and c.candidate_id::text in (${Prisma.join(candidateIds)})`
            : input.mode !== "SELECTED" && !includeAllCandidates && batchId
              ? Prisma.sql`and (c.upload_batch_id = ${batchId}::uuid or c.extracted_json->>'uploadBatchId' = ${batchId})`
              : Prisma.empty
      }
    order by m.match_score desc, m.created_at desc
    ${input.mode === "TOP_N" ? Prisma.sql`limit ${topN}` : Prisma.empty}
  `)

  return rows
}

export async function recordInterviewInviteForScreening(input: {
  interviewId: string
  candidateId: string
  screeningJobId: string
  email: string
  inviteLink: string
  matchId: string | null
  emailStatus: "SENT" | "FAILED"
}) {
  const rows = await prisma.$queryRaw<{ invite_id: string }[]>(Prisma.sql`
    update public.interview_invites
    set
      candidate_id = ${input.candidateId}::uuid,
      job_id = ${input.screeningJobId}::uuid,
      email = ${input.email},
      invite_link = ${input.inviteLink},
      ai_screening_match_id = ${input.matchId}::uuid,
      ai_screening_email_status = ${input.emailStatus},
      ai_screening_sent_at = now()
    where interview_id = ${input.interviewId}::uuid
    returning invite_id::text
  `)

  return rows[0]?.invite_id ?? null
}
