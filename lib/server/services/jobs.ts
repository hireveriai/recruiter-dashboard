import type { z } from "zod"

import { Prisma } from "@prisma/client"

import { prisma } from "@/lib/server/prisma"
import { ApiError } from "@/lib/server/errors"
import { toFunctionApiError } from "@/lib/server/function-errors"
import { sanitizeSkillList } from "@/lib/server/ai/skills"
import { createJobSchema, updateJobSchema } from "@/lib/server/validators"

type CreateJobInput = z.infer<typeof createJobSchema>
type UpdateJobInput = z.infer<typeof updateJobSchema> & {
  job_id: string
  organization_id: string
}

type CreatedJobRow = {
  job_id: string
}

type ColumnExistsRow = {
  exists: boolean
}

export async function createJob(input: CreateJobInput) {
  try {
    const sanitizedCoreSkills = sanitizeSkillList(input.core_skills, {
      jobTitle: input.job_title,
      jobDescription: input.job_description ?? undefined,
    })

    const rows = await prisma.$queryRaw<CreatedJobRow[]>(Prisma.sql`
      select *
      from public.fn_create_job(
        ${input.organization_id}::uuid,
        ${input.job_title},
        ${input.job_description ?? null},
        ${input.experience_level_id}::smallint,
        ${sanitizedCoreSkills}::text[],
        ${input.difficulty_profile},
        ${JSON.stringify(input.skill_baseline)}::jsonb,
        ${input.coding_required},
        ${input.coding_assessment_type ?? null},
        ${input.coding_difficulty ?? null},
        ${input.coding_duration_minutes ?? null}::integer,
        ${input.coding_languages}::text[],
        ${input.interview_duration_minutes}::integer
      )
    `)

    const job = rows[0]

    if (!job?.job_id) {
      throw new ApiError(500, "JOB_CREATE_FAILED", "Failed to create job")
    }

    if (await jobPositionsSupportQuestionTypeDefault()) {
      await prisma.$executeRaw(Prisma.sql`
        update public.job_positions
        set question_type_default = ${input.question_type_default}
        where job_id = ${job.job_id}::uuid
      `)
    }

    await prisma.$executeRaw(Prisma.sql`
      update public.job_positions
      set device_requirement = ${input.device_requirement}
      where job_id = ${job.job_id}::uuid
        and organization_id = ${input.organization_id}::uuid
    `)

    // Interview mode is written only for NEW jobs. The column default is
    // INDIVIDUALIZED so existing jobs keep their current behaviour untouched;
    // new jobs default to STANDARD unless the recruiter chooses otherwise.
    if (await jobPositionsSupportQuestionnaireConfig()) {
      await prisma.$executeRaw(Prisma.sql`
        update public.job_positions
        set interview_mode = ${input.interview_mode ?? "STANDARD"},
            resume_questions_enabled = ${input.resume_questions_enabled ?? true}
        where job_id = ${job.job_id}::uuid
          and organization_id = ${input.organization_id}::uuid
      `)
    }

    return { job_id: job.job_id }
  } catch (error) {
    throw toFunctionApiError(error, {
      statusCode: 500,
      code: "JOB_CREATE_FAILED",
      message: "Failed to create job",
    })
  }
}

let hasJobIsActiveColumnCache: boolean | null = null
let hasJobCodingColumnsCache: boolean | null = null
let hasJobQuestionTypeDefaultColumnCache: boolean | null = null
let hasJobQuestionnaireConfigColumnCache: boolean | null = null

/**
 * Schema changes here are applied out of band, so environments drift. Follows
 * the existing capability-probe pattern rather than assuming the questionnaire
 * columns exist.
 */
export async function jobPositionsSupportQuestionnaireConfig() {
  if (hasJobQuestionnaireConfigColumnCache !== null) {
    return hasJobQuestionnaireConfigColumnCache
  }

  try {
    const rows = await prisma.$queryRaw<ColumnExistsRow[]>(Prisma.sql`
      select exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'job_positions'
          and column_name = 'interview_mode'
      )
    `)

    hasJobQuestionnaireConfigColumnCache = Boolean(rows[0]?.exists)
    return hasJobQuestionnaireConfigColumnCache
  } catch (error) {
    console.warn("Job position questionnaire config capability lookup failed", error)
    hasJobQuestionnaireConfigColumnCache = false
    return false
  }
}

export async function jobPositionsSupportQuestionTypeDefault() {
  if (hasJobQuestionTypeDefaultColumnCache !== null) {
    return hasJobQuestionTypeDefaultColumnCache
  }

  try {
    const rows = await prisma.$queryRaw<ColumnExistsRow[]>(Prisma.sql`
      select exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'job_positions'
          and column_name = 'question_type_default'
      )
    `)

    hasJobQuestionTypeDefaultColumnCache = Boolean(rows[0]?.exists)
    return hasJobQuestionTypeDefaultColumnCache
  } catch (error) {
    console.warn("Job position question type default capability lookup failed", error)
    hasJobQuestionTypeDefaultColumnCache = false
    return false
  }
}

export async function jobPositionsSupportIsActive() {
  if (hasJobIsActiveColumnCache !== null) {
    return hasJobIsActiveColumnCache
  }

  try {
    const rows = await prisma.$queryRaw<ColumnExistsRow[]>(Prisma.sql`
      select exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'job_positions'
          and column_name = 'is_active'
      )
    `)

    hasJobIsActiveColumnCache = Boolean(rows[0]?.exists)
    return hasJobIsActiveColumnCache
  } catch (error) {
    console.warn("Job position is_active capability lookup failed", error)
    hasJobIsActiveColumnCache = false
    return false
  }
}

export async function jobPositionsSupportCodingConfig() {
  if (hasJobCodingColumnsCache !== null) {
    return hasJobCodingColumnsCache
  }

  try {
    const rows = await prisma.$queryRaw<ColumnExistsRow[]>(Prisma.sql`
      select exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'job_positions'
          and column_name in (
            'coding_required',
            'coding_assessment_type',
            'coding_difficulty',
            'coding_duration_minutes',
            'coding_languages'
          )
        group by table_schema, table_name
        having count(*) = 5
      )
    `)

    hasJobCodingColumnsCache = Boolean(rows[0]?.exists)
    return hasJobCodingColumnsCache
  } catch (error) {
    console.warn("Job position coding capability lookup failed", error)
    hasJobCodingColumnsCache = false
    return false
  }
}

export async function updateJob(input: UpdateJobInput) {
  try {
    const sanitizedCoreSkills = sanitizeSkillList(input.core_skills, {
      jobTitle: input.job_title,
      jobDescription: input.job_description ?? undefined,
    })

    await prisma.$executeRaw(Prisma.sql`
      update public.job_positions
      set
        job_title = ${input.job_title},
        job_description = ${input.job_description ?? null},
        experience_level_id = ${input.experience_level_id}::smallint,
        core_skills = ${sanitizedCoreSkills}::text[],
        difficulty_profile = ${input.difficulty_profile}::text,
        interview_duration_minutes = ${input.interview_duration_minutes}::integer
      where job_id = ${input.job_id}::uuid
        and organization_id = ${input.organization_id}::uuid
    `)

    if (await jobPositionsSupportCodingConfig()) {
      await prisma.$executeRaw(Prisma.sql`
        update public.job_positions
        set
          coding_required = ${input.coding_required},
          coding_assessment_type = ${input.coding_assessment_type ?? null},
          coding_difficulty = ${input.coding_difficulty ?? null},
          coding_duration_minutes = ${input.coding_duration_minutes ?? null}::integer,
          coding_languages = ${input.coding_languages}::text[]
        where job_id = ${input.job_id}::uuid
          and organization_id = ${input.organization_id}::uuid
      `)
    }

    if (await jobPositionsSupportQuestionTypeDefault()) {
      await prisma.$executeRaw(Prisma.sql`
        update public.job_positions
        set question_type_default = ${input.question_type_default}
        where job_id = ${input.job_id}::uuid
          and organization_id = ${input.organization_id}::uuid
      `)
    }

    await prisma.$executeRaw(Prisma.sql`
      update public.job_positions
      set device_requirement = ${input.device_requirement}
      where job_id = ${input.job_id}::uuid
        and organization_id = ${input.organization_id}::uuid
    `)

    if (await jobPositionsSupportIsActive()) {
      await prisma.$executeRaw(Prisma.sql`
        update public.job_positions
        set is_active = ${input.is_active ?? true}
        where job_id = ${input.job_id}::uuid
          and organization_id = ${input.organization_id}::uuid
      `)
    }

    // Only written when explicitly supplied. Editing an existing job must never
    // silently change its interview mode, since that would alter how every
    // future candidate for that job is interviewed.
    if (input.interview_mode !== undefined && (await jobPositionsSupportQuestionnaireConfig())) {
      await prisma.$executeRaw(Prisma.sql`
        update public.job_positions
        set interview_mode = ${input.interview_mode}
        where job_id = ${input.job_id}::uuid
          and organization_id = ${input.organization_id}::uuid
      `)
    }

    if (input.resume_questions_enabled !== undefined && (await jobPositionsSupportQuestionnaireConfig())) {
      await prisma.$executeRaw(Prisma.sql`
        update public.job_positions
        set resume_questions_enabled = ${input.resume_questions_enabled}
        where job_id = ${input.job_id}::uuid
          and organization_id = ${input.organization_id}::uuid
      `)
    }

    return { job_id: input.job_id }
  } catch (error) {
    throw toFunctionApiError(error, {
      statusCode: 500,
      code: "JOB_UPDATE_FAILED",
      message: "Failed to update job",
    })
  }
}

export async function setJobActiveState(input: { job_id: string; organization_id: string; is_active: boolean }) {
  const supportsIsActive = await jobPositionsSupportIsActive()

  if (!supportsIsActive) {
    throw new ApiError(
      400,
      "JOB_INACTIVE_UNSUPPORTED",
      "Job active/inactive status is not supported in the current database schema"
    )
  }

  try {
    await prisma.$executeRaw(Prisma.sql`
      update public.job_positions
      set is_active = ${input.is_active}
      where job_id = ${input.job_id}::uuid
        and organization_id = ${input.organization_id}::uuid
    `)

    return {
      job_id: input.job_id,
      is_active: input.is_active,
    }
  } catch (error) {
    throw toFunctionApiError(error, {
      statusCode: 500,
      code: "JOB_STATUS_UPDATE_FAILED",
      message: "Failed to update job status",
    })
  }
}
