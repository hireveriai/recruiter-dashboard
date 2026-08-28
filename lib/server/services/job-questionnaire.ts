/**
 * Job-level questionnaire lifecycle.
 *
 * Owns the DRAFT -> FINALIZED -> SUPERSEDED version flow and the snapshot of a
 * finalized version into an individual interview.
 *
 * The important property here is IDEMPOTENCE. Inviting fifty candidates to a
 * STANDARD job must trigger exactly one generation, not fifty. That is enforced
 * with a transaction-scoped Postgres advisory lock keyed on the job, plus a
 * re-check inside the lock.
 *
 * Role-agnostic: this module moves questions around and never inspects or
 * reasons about their subject matter.
 */

import { Prisma } from "@prisma/client"

import { ApiError } from "@/lib/server/errors"
import { prisma } from "@/lib/server/prisma"
import {
  generateStructuredQuestionnaire,
  type GeneratedQuestion,
} from "@/lib/server/interview/questionnaire-generator"

export type InterviewMode = "STANDARD" | "INDIVIDUALIZED"

/**
 * interview_questions.source_type is constrained to resume | job | behavioral,
 * and the interview engine's blueprint distribution is keyed on those same three
 * buckets. The questionnaire model additionally distinguishes "experience",
 * which is a useful authoring distinction but has no runtime meaning, so it is
 * folded into "job" on the way in. The original value is preserved in
 * reference_context so reporting and the recruiter UI can still tell them apart.
 */
export function toRuntimeSourceType(sourceType: string): "resume" | "job" | "behavioral" {
  if (sourceType === "resume") return "resume"
  if (sourceType === "behavioral") return "behavioral"
  return "job"
}

export type QuestionnaireVersionRow = {
  questionnaire_version_id: string
  questionnaire_id: string
  version_number: number
  status: string
  generated_by: string
  interview_mode: string
  target_question_count: number | null
  interview_duration_minutes: number | null
}

type JobContextRow = {
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

export function resolveInterviewMode(value: unknown): InterviewMode {
  return String(value ?? "").toUpperCase() === "STANDARD" ? "STANDARD" : "INDIVIDUALIZED"
}

async function ensureQuestionnaireRow(
  tx: Prisma.TransactionClient,
  organizationId: string,
  jobId: string
) {
  const rows = await tx.$queryRaw<{ questionnaire_id: string }[]>(Prisma.sql`
    insert into public.job_questionnaires (organization_id, job_id)
    values (${organizationId}::uuid, ${jobId}::uuid)
    on conflict (job_id) do update set updated_at = now()
    returning questionnaire_id::text
  `)

  return rows[0].questionnaire_id
}

async function insertVersionQuestions(
  tx: Prisma.TransactionClient,
  params: {
    versionId: string
    organizationId: string
    questions: GeneratedQuestion[]
  }
) {
  for (const [index, question] of params.questions.entries()) {
    await tx.$executeRaw(Prisma.sql`
      insert into public.job_questionnaire_questions (
        questionnaire_version_id,
        organization_id,
        question_order,
        question_text,
        question_type,
        source_type,
        competency_label,
        difficulty_level,
        phase_hint,
        evaluation_criteria,
        origin
      )
      values (
        ${params.versionId}::uuid,
        ${params.organizationId}::uuid,
        ${index + 1}::integer,
        ${question.questionText},
        ${question.questionType},
        ${question.sourceType},
        ${question.competencyLabel},
        ${question.difficultyLevel}::integer,
        ${question.phaseHint},
        ${question.evaluationCriteria},
        'AI'
      )
    `)
  }
}

/**
 * Returns the finalized version for a job, generating and auto-finalizing one if
 * none exists yet.
 *
 * Auto-finalize matches the product decision that a recruiter who never opens
 * the review step still gets a usable questionnaire - nothing that works today
 * starts failing. A recruiter who does review keeps full control, because their
 * explicit finalize supersedes the draft.
 *
 * Safe to call concurrently: the advisory lock serialises callers per job and
 * the post-lock re-check means only the first one generates.
 */
export async function ensureFinalizedQuestionnaireVersion(params: {
  organizationId: string
  jobId: string
  createdBy?: string | null
}): Promise<{ version: QuestionnaireVersionRow; generated: boolean; openAiCalls: number }> {
  const existing = await getFinalizedVersion(params.organizationId, params.jobId)
  if (existing) {
    return { version: existing, generated: false, openAiCalls: 0 }
  }

  const job = await getJobQuestionnaireContext(params.organizationId, params.jobId)

  // Generate OUTSIDE the transaction: an OpenAI round trip must never hold a
  // database transaction (or its advisory lock) open.
  const generation = await generateStructuredQuestionnaire({
    jobTitle: job.job_title,
    jobDescription: job.job_description,
    coreSkills: job.core_skills,
    experienceLevel: job.experience_level_label,
    durationMinutes: job.interview_duration_minutes,
    resumeQuestionsEnabled: job.resume_questions_enabled,
  })

  const result = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw(
      Prisma.sql`select pg_advisory_xact_lock(hashtext(${`job_questionnaire:${params.jobId}`}))`
    )

    // Re-check inside the lock: a concurrent caller may have finalized while we
    // were talking to OpenAI. If so, discard our generation and reuse theirs so
    // every candidate still shares one questionnaire.
    const raced = await selectFinalizedVersion(tx, params.organizationId, params.jobId)
    if (raced) {
      return { version: raced, generated: false }
    }

    const questionnaireId = await ensureQuestionnaireRow(tx, params.organizationId, params.jobId)

    const versionRows = await tx.$queryRaw<QuestionnaireVersionRow[]>(Prisma.sql`
      insert into public.job_questionnaire_versions (
        questionnaire_id,
        organization_id,
        version_number,
        status,
        generated_by,
        interview_mode,
        target_question_count,
        interview_duration_minutes,
        generation_model,
        generation_meta,
        created_by,
        finalized_by,
        finalized_at
      )
      select
        ${questionnaireId}::uuid,
        ${params.organizationId}::uuid,
        coalesce(max(version_number), 0) + 1,
        'FINALIZED',
        'AI',
        ${resolveInterviewMode(job.interview_mode)},
        ${generation.plan.structuredQuestionCount}::integer,
        ${generation.plan.durationMinutes}::integer,
        ${generation.model},
        ${JSON.stringify({
          openAiCalls: generation.openAiCalls,
          usedFallback: generation.usedFallback,
          autoFinalized: true,
        })}::jsonb,
        ${params.createdBy ?? null}::uuid,
        ${params.createdBy ?? null}::uuid,
        now()
      from public.job_questionnaire_versions
      where questionnaire_id = ${questionnaireId}::uuid
      returning
        questionnaire_version_id::text,
        questionnaire_id::text,
        version_number,
        status,
        generated_by,
        interview_mode,
        target_question_count,
        interview_duration_minutes
    `)

    const version = versionRows[0]

    await insertVersionQuestions(tx, {
      versionId: version.questionnaire_version_id,
      organizationId: params.organizationId,
      questions: generation.questions,
    })

    await tx.$executeRaw(Prisma.sql`
      update public.job_questionnaires
      set active_version_id = ${version.questionnaire_version_id}::uuid,
          updated_at = now()
      where questionnaire_id = ${questionnaireId}::uuid
    `)

    return { version, generated: true }
  })

  return { ...result, openAiCalls: result.generated ? generation.openAiCalls : 0 }
}

/**
 * Appends generated questions to an interview, continuing the existing order.
 *
 * Used for candidate-specific questions (resume-anchored, and the whole set in
 * INDIVIDUALIZED mode). Writes directly rather than going through
 * replaceInterviewQuestions, whose validation shield predates this pipeline and
 * assumes every question echoes a job skill verbatim.
 */
export async function appendInterviewQuestions(params: {
  organizationId: string
  interviewId: string
  questions: GeneratedQuestion[]
  questionnaireQuestionIds?: (string | null)[]
}) {
  if (params.questions.length === 0) return 0

  return prisma.$transaction(async (tx) => {
    const orderRows = await tx.$queryRaw<{ next_order: number }[]>(Prisma.sql`
      select coalesce(max(question_order), 0) + 1 as next_order
      from public.interview_questions
      where interview_id = ${params.interviewId}::uuid
    `)
    let order = Number(orderRows[0]?.next_order ?? 1)
    let written = 0

    for (const [index, question] of params.questions.entries()) {
      const sourceId = params.questionnaireQuestionIds?.[index] ?? null

      await tx.$executeRaw(Prisma.sql`
        insert into public.interview_questions (
          interview_id,
          question_order,
          question_text,
          question_type,
          source_type,
          reference_context,
          is_dynamic,
          phase_hint,
          difficulty_level,
          is_mandatory,
          allow_follow_up,
          source_questionnaire_question_id
        )
        values (
          ${params.interviewId}::uuid,
          ${order}::integer,
          ${question.questionText},
          ${question.questionType},
          ${toRuntimeSourceType(question.sourceType)},
          ${JSON.stringify({
            anchor: question.competencyLabel,
            source: question.sourceType === "resume" ? "candidate_background" : "generated",
            authored_source_type: question.sourceType,
            evaluation_criteria: question.evaluationCriteria,
          })}::jsonb,
          true,
          ${question.phaseHint},
          ${question.difficultyLevel}::integer,
          true,
          true,
          ${sourceId}::uuid
        )
      `)

      order += 1
      written += 1
    }

    return written
  })
}

async function selectFinalizedVersion(
  client: Prisma.TransactionClient | typeof prisma,
  organizationId: string,
  jobId: string
) {
  const rows = await client.$queryRaw<QuestionnaireVersionRow[]>(Prisma.sql`
    select
      v.questionnaire_version_id::text,
      v.questionnaire_id::text,
      v.version_number,
      v.status,
      v.generated_by,
      v.interview_mode,
      v.target_question_count,
      v.interview_duration_minutes
    from public.job_questionnaire_versions v
    join public.job_questionnaires q
      on q.questionnaire_id = v.questionnaire_id
    where q.job_id = ${jobId}::uuid
      and q.organization_id = ${organizationId}::uuid
      and v.status = 'FINALIZED'
    order by v.version_number desc
    limit 1
  `)

  return rows[0] ?? null
}

export async function getFinalizedVersion(organizationId: string, jobId: string) {
  return selectFinalizedVersion(prisma, organizationId, jobId)
}

// ---------------------------------------------------------------------------
// Recruiter editing
//
// A FINALIZED version is immutable: interviews already reference it and their
// reports must stay reproducible. Editing therefore never mutates a finalized
// version - it forks a new DRAFT, and finalizing that DRAFT supersedes the old
// one for FUTURE interviews only.
// ---------------------------------------------------------------------------

export type EditableQuestion = {
  questionnaireQuestionId?: string | null
  questionText: string
  sourceType: string
  competencyLabel: string | null
  evaluationCriteria: string | null
  difficultyLevel: number
  phaseHint: string
  questionType: string | null
  origin: string
}

const EDITABLE_SOURCE_TYPES = new Set(["job", "experience", "behavioral", "resume"])
const EDITABLE_PHASES = new Set(["warmup", "core", "probe", "closing"])

function sanitizeEditableQuestion(question: EditableQuestion) {
  const text = String(question.questionText ?? "").replace(/\s+/g, " ").trim()

  if (!text) {
    throw new ApiError(400, "QUESTION_TEXT_REQUIRED", "Every question needs text")
  }
  if (text.length > 500) {
    throw new ApiError(400, "QUESTION_TEXT_TOO_LONG", "Question text is limited to 500 characters")
  }

  const difficulty = Number(question.difficultyLevel)

  return {
    questionText: text,
    sourceType: EDITABLE_SOURCE_TYPES.has(question.sourceType) ? question.sourceType : "job",
    competencyLabel: question.competencyLabel?.trim() || null,
    evaluationCriteria: question.evaluationCriteria?.trim() || null,
    difficultyLevel: Number.isFinite(difficulty) ? Math.min(5, Math.max(1, Math.round(difficulty))) : 3,
    phaseHint: EDITABLE_PHASES.has(question.phaseHint) ? question.phaseHint : "core",
    questionType: question.questionType?.trim() || (question.sourceType === "behavioral" ? "behavioral" : "open_ended"),
    origin: question.origin === "RECRUITER" ? "RECRUITER" : "AI",
  }
}

async function selectDraftVersion(
  client: Prisma.TransactionClient | typeof prisma,
  organizationId: string,
  jobId: string
) {
  const rows = await client.$queryRaw<QuestionnaireVersionRow[]>(Prisma.sql`
    select
      v.questionnaire_version_id::text,
      v.questionnaire_id::text,
      v.version_number,
      v.status,
      v.generated_by,
      v.interview_mode,
      v.target_question_count,
      v.interview_duration_minutes
    from public.job_questionnaire_versions v
    join public.job_questionnaires q on q.questionnaire_id = v.questionnaire_id
    where q.job_id = ${jobId}::uuid
      and q.organization_id = ${organizationId}::uuid
      and v.status = 'DRAFT'
    order by v.version_number desc
    limit 1
  `)

  return rows[0] ?? null
}

export async function getVersionQuestions(organizationId: string, versionId: string) {
  return prisma.$queryRaw<
    Array<{
      questionnaire_question_id: string
      question_order: number
      question_text: string
      question_type: string | null
      source_type: string
      competency_label: string | null
      evaluation_criteria: string | null
      difficulty_level: number
      phase_hint: string
      origin: string
    }>
  >(Prisma.sql`
    select
      questionnaire_question_id::text,
      question_order,
      question_text,
      question_type,
      source_type,
      competency_label,
      evaluation_criteria,
      difficulty_level,
      phase_hint,
      origin
    from public.job_questionnaire_questions
    where questionnaire_version_id = ${versionId}::uuid
      and organization_id = ${organizationId}::uuid
    order by question_order
  `)
}

/**
 * Returns the questionnaire a recruiter should be looking at, generating a first
 * version if the job has none yet.
 *
 * Preference order: an open DRAFT, else the latest FINALIZED (read-only until
 * they choose to edit), else generate.
 */
export async function getQuestionnaireForEditing(params: {
  organizationId: string
  jobId: string
  createdBy?: string | null
}) {
  const draft = await selectDraftVersion(prisma, params.organizationId, params.jobId)
  if (draft) {
    return { version: draft, questions: await getVersionQuestions(params.organizationId, draft.questionnaire_version_id), openAiCalls: 0 }
  }

  const finalized = await getFinalizedVersion(params.organizationId, params.jobId)
  if (finalized) {
    return { version: finalized, questions: await getVersionQuestions(params.organizationId, finalized.questionnaire_version_id), openAiCalls: 0 }
  }

  const created = await ensureFinalizedQuestionnaireVersion({
    organizationId: params.organizationId,
    jobId: params.jobId,
    createdBy: params.createdBy,
  })

  return {
    version: created.version,
    questions: await getVersionQuestions(params.organizationId, created.version.questionnaire_version_id),
    openAiCalls: created.openAiCalls,
  }
}

/**
 * Persists a recruiter's edits.
 *
 * Always writes into a DRAFT. If the recruiter was viewing a FINALIZED version,
 * a new DRAFT is forked from their submitted content, leaving the finalized one
 * and every interview referencing it untouched.
 */
export async function saveQuestionnaireDraft(params: {
  organizationId: string
  jobId: string
  questions: EditableQuestion[]
  createdBy?: string | null
}) {
  if (params.questions.length === 0) {
    throw new ApiError(400, "QUESTIONNAIRE_EMPTY", "A questionnaire needs at least one question")
  }
  if (params.questions.length > 40) {
    throw new ApiError(400, "QUESTIONNAIRE_TOO_LONG", "A questionnaire is limited to 40 questions")
  }

  const sanitized = params.questions.map(sanitizeEditableQuestion)

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw(
      Prisma.sql`select pg_advisory_xact_lock(hashtext(${`job_questionnaire:${params.jobId}`}))`
    )

    let draft = await selectDraftVersion(tx, params.organizationId, params.jobId)

    if (!draft) {
      const questionnaireId = await ensureQuestionnaireRow(tx, params.organizationId, params.jobId)
      const rows = await tx.$queryRaw<QuestionnaireVersionRow[]>(Prisma.sql`
        insert into public.job_questionnaire_versions (
          questionnaire_id, organization_id, version_number, status, generated_by,
          interview_mode, created_by
        )
        select
          ${questionnaireId}::uuid,
          ${params.organizationId}::uuid,
          coalesce(max(version_number), 0) + 1,
          'DRAFT',
          'RECRUITER_EDITED',
          coalesce(
            (select interview_mode from public.job_positions where job_id = ${params.jobId}::uuid),
            'STANDARD'
          ),
          ${params.createdBy ?? null}::uuid
        from public.job_questionnaire_versions
        where questionnaire_id = ${questionnaireId}::uuid
        returning
          questionnaire_version_id::text, questionnaire_id::text, version_number,
          status, generated_by, interview_mode, target_question_count,
          interview_duration_minutes
      `)
      draft = rows[0]
    }

    await tx.$executeRaw(Prisma.sql`
      delete from public.job_questionnaire_questions
      where questionnaire_version_id = ${draft.questionnaire_version_id}::uuid
    `)

    for (const [index, question] of sanitized.entries()) {
      await tx.$executeRaw(Prisma.sql`
        insert into public.job_questionnaire_questions (
          questionnaire_version_id, organization_id, question_order, question_text,
          question_type, source_type, competency_label, difficulty_level,
          phase_hint, evaluation_criteria, origin
        )
        values (
          ${draft.questionnaire_version_id}::uuid,
          ${params.organizationId}::uuid,
          ${index + 1}::integer,
          ${question.questionText},
          ${question.questionType},
          ${question.sourceType},
          ${question.competencyLabel},
          ${question.difficultyLevel}::integer,
          ${question.phaseHint},
          ${question.evaluationCriteria},
          ${question.origin}
        )
      `)
    }

    await tx.$executeRaw(Prisma.sql`
      update public.job_questionnaire_versions
      set generated_by = 'RECRUITER_EDITED',
          target_question_count = ${sanitized.length}::integer
      where questionnaire_version_id = ${draft.questionnaire_version_id}::uuid
    `)

    return { version: draft, questionCount: sanitized.length }
  })
}

/**
 * Publishes the DRAFT. Previously finalized versions become SUPERSEDED, but are
 * never deleted - interviews that used them keep resolving.
 */
export async function finalizeQuestionnaireDraft(params: {
  organizationId: string
  jobId: string
  finalizedBy?: string | null
}) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw(
      Prisma.sql`select pg_advisory_xact_lock(hashtext(${`job_questionnaire:${params.jobId}`}))`
    )

    const draft = await selectDraftVersion(tx, params.organizationId, params.jobId)
    if (!draft) {
      throw new ApiError(404, "NO_DRAFT_TO_FINALIZE", "There is no draft questionnaire to finalize")
    }

    const count = await tx.$queryRaw<{ n: number }[]>(Prisma.sql`
      select count(*)::int as n
      from public.job_questionnaire_questions
      where questionnaire_version_id = ${draft.questionnaire_version_id}::uuid
    `)

    if ((count[0]?.n ?? 0) === 0) {
      throw new ApiError(400, "QUESTIONNAIRE_EMPTY", "Cannot finalize an empty questionnaire")
    }

    await tx.$executeRaw(Prisma.sql`
      update public.job_questionnaire_versions
      set status = 'SUPERSEDED'
      where questionnaire_id = ${draft.questionnaire_id}::uuid
        and status = 'FINALIZED'
    `)

    await tx.$executeRaw(Prisma.sql`
      update public.job_questionnaire_versions
      set status = 'FINALIZED',
          finalized_by = ${params.finalizedBy ?? null}::uuid,
          finalized_at = now()
      where questionnaire_version_id = ${draft.questionnaire_version_id}::uuid
    `)

    await tx.$executeRaw(Prisma.sql`
      update public.job_questionnaires
      set active_version_id = ${draft.questionnaire_version_id}::uuid,
          updated_at = now()
      where questionnaire_id = ${draft.questionnaire_id}::uuid
    `)

    return { versionId: draft.questionnaire_version_id, versionNumber: draft.version_number, questionCount: count[0].n }
  })
}

/** Discards the open draft, reverting the recruiter to the finalized version. */
export async function discardQuestionnaireDraft(params: { organizationId: string; jobId: string }) {
  const draft = await selectDraftVersion(prisma, params.organizationId, params.jobId)
  if (!draft) return { discarded: false }

  await prisma.$executeRaw(Prisma.sql`
    delete from public.job_questionnaire_versions
    where questionnaire_version_id = ${draft.questionnaire_version_id}::uuid
      and status = 'DRAFT'
  `)

  return { discarded: true }
}

/**
 * Copies a finalized version's questions into an interview.
 *
 * A copy rather than a reference, so that editing a job questionnaire later can
 * never retroactively change an interview that has already run. The link back to
 * the origin is preserved per row via source_questionnaire_question_id, and on
 * the interview via questionnaire_version_id.
 */
export async function snapshotVersionToInterview(params: {
  organizationId: string
  interviewId: string
  versionId: string
}) {
  return prisma.$transaction(async (tx) => {
    const inserted = await tx.$executeRaw(Prisma.sql`
      insert into public.interview_questions (
        interview_id,
        question_order,
        question_text,
        question_type,
        source_type,
        reference_context,
        is_dynamic,
        phase_hint,
        difficulty_level,
        is_mandatory,
        allow_follow_up,
        source_questionnaire_question_id
      )
      select
        ${params.interviewId}::uuid,
        q.question_order,
        q.question_text,
        q.question_type,
        case when q.source_type in ('resume', 'behavioral') then q.source_type else 'job' end,
        jsonb_build_object(
          'anchor', q.competency_label,
          'source', 'job_questionnaire',
          'authored_source_type', q.source_type,
          'evaluation_criteria', q.evaluation_criteria,
          'questionnaire_version_id', ${params.versionId}
        ),
        true,
        q.phase_hint,
        q.difficulty_level,
        q.is_mandatory,
        q.allow_follow_up,
        q.questionnaire_question_id
      from public.job_questionnaire_questions q
      where q.questionnaire_version_id = ${params.versionId}::uuid
        and q.organization_id = ${params.organizationId}::uuid
      order by q.question_order
    `)

    if (inserted === 0) {
      throw new ApiError(
        500,
        "QUESTIONNAIRE_SNAPSHOT_EMPTY",
        "Questionnaire version contained no questions to snapshot"
      )
    }

    await tx.$executeRaw(Prisma.sql`
      update public.interviews
      set questionnaire_version_id = ${params.versionId}::uuid,
          questionnaire_snapshot_at = now()
      where interview_id = ${params.interviewId}::uuid
        and organization_id = ${params.organizationId}::uuid
    `)

    return inserted
  })
}
