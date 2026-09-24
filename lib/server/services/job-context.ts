/**
 * Org-scoped job context used by questionnaire generation and Interview Focus.
 *
 * Kept in its own module so job-questionnaire.ts and interview-focus.ts can
 * both depend on it without importing each other. Throws 404 for a job the
 * organization does not own, which is what makes every caller tenant-safe.
 */

import { Prisma } from "@prisma/client"

import { ApiError } from "@/lib/server/errors"
import { prisma } from "@/lib/server/prisma"

export type JobContextRow = {
  job_id: string
  organization_id: string
  job_title: string | null
  job_description: string | null
  core_skills: string[] | null
  experience_level_id: number | null
  experience_level_label: string | null
  interview_duration_minutes: number | null
  interview_mode: string
  resume_questions_enabled: boolean
}

export async function getJobQuestionnaireContext(organizationId: string, jobId: string) {
  const rows = await prisma.$queryRaw<JobContextRow[]>(Prisma.sql`
    select
      jp.job_id::text,
      jp.organization_id::text,
      jp.job_title,
      jp.job_description,
      jp.core_skills,
      jp.experience_level_id,
      elp.label as experience_level_label,
      jp.interview_duration_minutes,
      jp.interview_mode,
      jp.resume_questions_enabled
    from public.job_positions jp
    left join public.experience_level_pool elp
      on elp.experience_level_id = jp.experience_level_id
    where jp.job_id = ${jobId}::uuid
      and jp.organization_id = ${organizationId}::uuid
    limit 1
  `)

  if (!rows[0]) {
    throw new ApiError(404, "JOB_NOT_FOUND", "Job not found for this organization")
  }

  return rows[0]
}
