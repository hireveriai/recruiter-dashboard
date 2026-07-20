import { Prisma } from "@prisma/client"

import { generateInterviewQuestions, type InterviewQuestion } from "@/lib/interview-flow"
import { InterviewQuestionType } from "@/lib/server/ai/interview-question-types"
import { ApiError } from "@/lib/server/errors"
import { getInterviewAppUrl } from "@/lib/server/interview-url"
import { prisma } from "@/lib/server/prisma"
import { parseResumeText } from "@/lib/server/resumeParser"
import {
  clearInterviewQuestions,
  fetchExistingInterviewQuestions,
  replaceInterviewQuestions,
  verifyInterviewQuestionsPersisted,
} from "@/lib/server/services/interview-questions"
import { sendInterviewEmail } from "@/lib/services/email.service"

const CREATE_LINK_AI_TIMEOUT_MS = Number(process.env.INTERVIEW_QUESTION_TIMEOUT_MS ?? 45000)
const MIN_QUESTION_COUNT = 5
const QUESTION_RETRY_COUNT = 3
const BASE_BACKOFF_MS = 400
let interviewWorkflowSchemaReady: Promise<void> | null = null

type PreparingInterviewInput = {
  organizationId: string
  jobId: string
  candidateId: string
  accessType?: string | null
  startTime?: string | null
  endTime?: string | null
  idempotencyKey?: string | null
}

type InterviewWorkflowRow = {
  interview_id: string
  token: string | null
  link: string | null
  status: string | null
  question_status: string | null
  email_status: string | null
  failure_reason: string | null
  last_error: string | null
  questions_generated_at: Date | string | null
  email_sent_at: Date | string | null
}

type InterviewContextRow = {
  interview_id: string
  organization_id: string
  job_id: string
  candidate_id: string
  job_title: string | null
  job_description: string | null
  core_skills: string[] | null
  experience_level_id: number | null
  interview_duration_minutes: number | null
  coding_required: string | null
  coding_recommended: boolean | null
  coding_assessment_type: string | null
  coding_difficulty: string | null
  coding_duration_minutes: number | null
  coding_languages: string[] | null
  candidate_name: string | null
  candidate_email: string | null
  resume_text: string | null
  start_time?: Date | string | null
  end_time?: Date | string | null
  organization_timezone?: string | null
  organization_timezone_label?: string | null
  organization_name?: string | null
  expires_at?: Date | string | null
  token: string | null
  link: string | null
  status?: string | null
  question_status?: string | null
  email_status?: string | null
}

type GenerateQuestionInput = {
  organizationId: string
  interviewId: string
  candidateResumeText?: string
  resumeSkills?: string[]
  totalQuestions?: number
  interviewDurationMinutes?: number
  similarityThreshold?: number
  maxAttempts?: number
  generationTimeoutMs?: number
  previousQuestions?: string[]
}

async function getPriorCandidateJobQuestions(context: InterviewContextRow) {
  const rows = await prisma.$queryRaw<Array<{ question_text: string }>>(Prisma.sql`
    select distinct iq.question_text
    from public.interview_questions iq
    join public.interviews prior on prior.interview_id = iq.interview_id
    where prior.organization_id = ${context.organization_id}::uuid
      and prior.candidate_id = ${context.candidate_id}::uuid
      and prior.job_id = ${context.job_id}::uuid
      and prior.interview_id <> ${context.interview_id}::uuid
      and nullif(trim(coalesce(iq.question_text, '')), '') is not null
    order by iq.question_text
    limit 100
  `)

  return rows.map((row) => row.question_text.trim()).filter(Boolean)
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function normalizeMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error"
}

function normalizeSkill(value: string | null | undefined) {
  return String(value ?? "").replace(/\s+/g, " ").trim()
}

function getEmergencySkillPool(context: InterviewContextRow) {
  const skills = [
    ...(context.core_skills ?? []),
    context.job_title ?? "",
    "problem solving",
    "communication",
    "delivery ownership",
    "quality mindset",
    "collaboration",
  ]
    .map(normalizeSkill)
    .filter(Boolean)

  return Array.from(new Set(skills.map((skill) => skill.toLowerCase()))).map((skill) =>
    skill.replace(/\b\w/g, (letter) => letter.toUpperCase())
  )
}

function buildEmergencyInterviewQuestions(
  context: InterviewContextRow,
  input: GenerateQuestionInput
): InterviewQuestion[] {
  const durationQuestionCount = Math.round((context.interview_duration_minutes ?? 30) / 4)
  const fallbackQuestionCount = input.totalQuestions ?? (durationQuestionCount || 7)
  const targetCount = Math.max(
    MIN_QUESTION_COUNT,
    Math.min(10, Number(fallbackQuestionCount))
  )
  const skills = getEmergencySkillPool(context)
  const templates = [
    (skill: string) => `How have you applied ${skill} to solve a production issue under delivery pressure?`,
    (skill: string) => `Walk me through a recent decision where ${skill} affected quality, speed, or reliability.`,
    (skill: string) => `What would you check first when ${skill} work starts failing before a deadline?`,
    (skill: string) => `How do you communicate trade-offs in ${skill} when requirements change during implementation?`,
    (skill: string) => `What signals tell you that ${skill} is working well for users or stakeholders?`,
    (skill: string) => `How would you improve a weak process involving ${skill} without slowing delivery?`,
    (skill: string) => `Walk me through how you validate assumptions before making a ${skill} decision.`,
    (skill: string) => `How do you recover when a ${skill} approach does not produce the expected result?`,
    (skill: string) => `What would you document after solving a difficult ${skill} problem for the team?`,
    (skill: string) => `How do you balance speed and correctness when working on ${skill} tasks?`,
  ]

  const questions: InterviewQuestion[] = []

  for (let index = 0; index < targetCount; index += 1) {
    const skill = skills[index % skills.length] ?? "Problem Solving"
    questions.push({
      id: `emergency-${index}`,
      question: templates[index % templates.length](skill),
      skill,
      skill_type: index === targetCount - 1 ? "behavioral" : "technical",
      skill_bucket: skill,
      source_type: index === targetCount - 1 ? "behavioral" : "job",
      reference_context: {
        anchor: skill,
        source: "emergency_question_fallback",
      },
      is_dynamic: true,
      allow_followups: true,
      question_type: index === targetCount - 1 ? InterviewQuestionType.BEHAVIORAL : InterviewQuestionType.TECHNICAL_DISCUSSION,
      classifier_confidence: 0.72,
      recruiter_override: false,
      rendering_mode: index === targetCount - 1 ? "behavioral" : "discussion",
      phase_hint: index === 0 ? "warmup" : index >= targetCount - 2 ? "closing" : "core",
    })
  }

  const resumeSkills = context.resume_text
    ? (parseResumeText(context.resume_text).skills ?? [])
        .map(normalizeSkill)
        .filter(Boolean)
        .filter((skill, index, all) =>
          all.findIndex((candidate) => candidate.toLowerCase() === skill.toLowerCase()) === index
        )
        .slice(0, Math.min(2, Math.max(1, Math.round(targetCount * 0.3))))
    : []
  const resumeTemplates = [
    (skill: string) => `Walk me through a resume project where you used ${skill} to solve a difficult problem.`,
    (skill: string) => `What trade-off did you personally make while applying ${skill} in work shown on your resume?`,
    (skill: string) => `How did you validate the outcome of a resume project involving ${skill}?`,
  ]
  const retakeVariantOffset = (input.previousQuestions?.length ?? 0) % resumeTemplates.length

  resumeSkills.forEach((skill, index) => {
    const insertionIndex = Math.max(1, questions.length - resumeSkills.length - 1 + index)
    const question = resumeTemplates[(retakeVariantOffset + index) % resumeTemplates.length](skill)

    questions.splice(insertionIndex, 1, {
      id: `emergency-resume-${index}`,
      question,
      skill,
      skill_type: "technical",
      skill_bucket: skill,
      source_type: "resume",
      reference_context: {
        anchor: skill,
        source: "emergency_resume_fallback",
      },
      is_dynamic: true,
      allow_followups: true,
      question_type: InterviewQuestionType.TECHNICAL_DISCUSSION,
      classifier_confidence: 0.82,
      recruiter_override: false,
      rendering_mode: "discussion",
      phase_hint: "core",
    })
  })

  const codingRequired = String(context.coding_required ?? "").toUpperCase() === "YES" ||
    (String(context.coding_required ?? "").toUpperCase() === "AUTO" && context.coding_recommended === true)

  if (codingRequired && questions.length >= MIN_QUESTION_COUNT) {
    const language = (context.coding_languages ?? []).find((item) => item?.trim())?.trim() || "TypeScript"
    questions.splice(Math.min(2, questions.length - 1), 1, {
      id: "emergency-coding",
      question: `Implement a ${language} function that validates an input record and returns a clear success or error result.`,
      skill: `${language} coding`,
      skill_type: "technical",
      skill_bucket: "Coding",
      source_type: "job",
      reference_context: {
        anchor: `${language} coding`,
        source: "emergency_question_fallback",
      },
      is_dynamic: true,
      allow_followups: true,
      question_type: InterviewQuestionType.CODING,
      classifier_confidence: 0.85,
      recruiter_override: false,
      rendering_mode: "code_editor",
      phase_hint: "core",
    })
  }

  return questions
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutHandle = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs)
      }),
    ])
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle)
    }
  }
}

function mapWorkflowRow(row: InterviewWorkflowRow) {
  return {
    interviewId: row.interview_id,
    token: row.token ?? "",
    link: row.link ?? "",
    status: row.status,
    questionStatus: row.question_status,
    emailStatus: row.email_status,
    failureReason: row.failure_reason,
    lastError: row.last_error,
    questionsGeneratedAt: row.questions_generated_at,
    emailSentAt: row.email_sent_at,
  }
}

export async function ensureInterviewWorkflowSchema() {
  if (!interviewWorkflowSchemaReady) {
    interviewWorkflowSchemaReady = (async () => {
      await prisma.$executeRawUnsafe(`
        alter table public.interviews
          add column if not exists question_status text not null default 'PENDING',
          add column if not exists email_status text not null default 'PENDING',
          add column if not exists failure_reason text,
          add column if not exists last_error text,
          add column if not exists questions_generated_at timestamptz,
          add column if not exists email_sent_at timestamptz,
          add column if not exists idempotency_key text
      `)

      await prisma.$executeRawUnsafe(`
        create unique index if not exists idx_interviews_org_idempotency_key
          on public.interviews (organization_id, idempotency_key)
          where idempotency_key is not null
      `)

      await prisma.$executeRawUnsafe(`
        alter table public.interview_invites
          drop constraint if exists interview_invites_status_check,
          drop constraint if exists status_check
      `)

      await prisma.$executeRawUnsafe(`
        alter table public.interview_invites
          add constraint interview_invites_status_check
          check (
            status = any (
              array[
                'ACTIVE',
                'EXPIRED',
                'USED',
                'REVOKED',
                'COMPLETED',
                'CANCELLED',
                'PREPARING',
                'PREPARATION_FAILED'
              ]::text[]
            )
          )
      `)
    })().catch((error) => {
      interviewWorkflowSchemaReady = null
      throw error
    })
  }

  await interviewWorkflowSchemaReady
}

async function getWorkflowByIdempotencyKey(organizationId: string, idempotencyKey: string) {
  const appUrl = getInterviewAppUrl().replace(/\/$/, "")
  const rows = await prisma.$queryRaw<InterviewWorkflowRow[]>(Prisma.sql`
    select
      i.interview_id::text,
      ii.token,
      case when ii.token is null then null else ${appUrl} || '/interview/' || ii.token end as link,
      i.status,
      i.question_status,
      i.email_status,
      i.failure_reason,
      i.last_error,
      i.questions_generated_at,
      i.email_sent_at
    from public.interviews i
    left join lateral (
      select token, start_time, end_time
      from public.interview_invites
      where interview_id = i.interview_id
      order by created_at desc
      limit 1
    ) ii on true
    where i.organization_id = ${organizationId}::uuid
      and i.idempotency_key = ${idempotencyKey}
    limit 1
  `)

  return rows[0] ? mapWorkflowRow(rows[0]) : null
}

export async function createPreparingInterview(input: PreparingInterviewInput) {
  await ensureInterviewWorkflowSchema()

  if (input.idempotencyKey) {
    const existing = await getWorkflowByIdempotencyKey(input.organizationId, input.idempotencyKey)
    if (existing) {
      return { ...existing, reused: true }
    }
  }

  const appUrl = getInterviewAppUrl()

  const result = await prisma.$transaction(async (tx) => {
    if (input.idempotencyKey) {
      await tx.$executeRaw(Prisma.sql`select pg_advisory_xact_lock(hashtext(${input.organizationId || ""}), hashtext(${input.idempotencyKey}))`)
      const existingRows = await tx.$queryRaw<InterviewWorkflowRow[]>(Prisma.sql`
        select
          i.interview_id::text,
          ii.token,
          case when ii.token is null then null else ${appUrl.replace(/\/$/, "")} || '/interview/' || ii.token end as link,
          i.status,
          i.question_status,
          i.email_status,
          i.failure_reason,
          i.last_error,
          i.questions_generated_at,
          i.email_sent_at
        from public.interviews i
        left join lateral (
          select token
          from public.interview_invites
          where interview_id = i.interview_id
          order by created_at desc
          limit 1
        ) ii on true
        where i.organization_id = ${input.organizationId}::uuid
          and i.idempotency_key = ${input.idempotencyKey}
        limit 1
      `)

      if (existingRows[0]) {
        return { ...mapWorkflowRow(existingRows[0]), reused: true }
      }
    }

    const rows = await tx.$queryRaw<{ interview_id: string; token: string; link: string }[]>(Prisma.sql`
      select *
      from public.fn_create_interview_link(
        ${input.organizationId}::uuid,
        ${input.jobId}::uuid,
        ${input.candidateId}::uuid,
        ${input.accessType ?? "FLEXIBLE"},
        ${input.startTime ?? null}::timestamptz,
        ${input.endTime ?? null}::timestamptz,
        ${appUrl}
      )
    `)

    const created = rows[0]
    if (!created?.interview_id || !created?.link) {
      throw new ApiError(500, "INTERVIEW_LINK_CREATE_FAILED", "Failed to create interview link")
    }

    await tx.$executeRaw(Prisma.sql`
      update public.interviews
      set
        status = 'PREPARING',
        question_status = 'GENERATING',
        email_status = 'PENDING',
        failure_reason = null,
        last_error = null,
        questions_generated_at = null,
        email_sent_at = null,
        idempotency_key = ${input.idempotencyKey ?? null}
      where interview_id = ${created.interview_id}::uuid
        and organization_id = ${input.organizationId}::uuid
    `)

    await tx.$executeRaw(Prisma.sql`
      update public.interview_invites
      set status = 'PREPARING'
      where interview_id = ${created.interview_id}::uuid
    `)

    return {
      interviewId: created.interview_id,
      token: created.token,
      link: created.link,
      status: "PREPARING",
      questionStatus: "GENERATING",
      emailStatus: "PENDING",
      failureReason: null,
      lastError: null,
      questionsGeneratedAt: null,
      emailSentAt: null,
      reused: false,
    }
  })

  return result
}

async function getInterviewContext(organizationId: string, interviewId: string) {
  const appUrl = getInterviewAppUrl().replace(/\/$/, "")
  const rows = await prisma.$queryRaw<InterviewContextRow[]>(Prisma.sql`
    select
      i.interview_id::text,
      i.organization_id::text,
      i.job_id::text,
      i.candidate_id::text,
      jp.job_title,
      jp.job_description,
      jp.core_skills,
      jp.experience_level_id,
      jp.interview_duration_minutes,
      jp.coding_required,
      jp.coding_recommended,
      jp.coding_assessment_type,
      jp.coding_difficulty,
      jp.coding_duration_minutes,
      jp.coding_languages,
      c.full_name as candidate_name,
      c.email as candidate_email,
      c.resume_text,
      ii.start_time,
      ii.end_time,
      ii.expires_at,
      o.organization_name,
      o.timezone as organization_timezone,
      o.timezone_label as organization_timezone_label,
      ii.token,
      i.status,
      i.question_status,
      i.email_status,
      case when ii.token is null then null else ${appUrl} || '/interview/' || ii.token end as link
    from public.interviews i
    inner join public.job_positions jp on jp.job_id = i.job_id
    inner join public.candidates c on c.candidate_id = i.candidate_id
    inner join public.organizations o on o.organization_id = i.organization_id
    left join lateral (
      select token, start_time, end_time, expires_at
      from public.interview_invites
      where interview_id = i.interview_id
      order by created_at desc
      limit 1
    ) ii on true
    where i.interview_id = ${interviewId}::uuid
      and i.organization_id = ${organizationId}::uuid
    limit 1
  `)

  if (!rows[0]) {
    throw new ApiError(404, "INTERVIEW_NOT_FOUND", "Interview not found for this organization")
  }

  return rows[0]
}

export async function markQuestionGenerationFailed(organizationId: string, interviewId: string, error: unknown) {
  const message = normalizeMessage(error)

  await prisma.$executeRaw(Prisma.sql`
    update public.interviews
    set
      status = 'FAILED',
      question_status = 'FAILED',
      email_status = case when email_status = 'SENT' then email_status else 'PENDING' end,
      failure_reason = 'AI_QUESTION_GENERATION_FAILED',
      last_error = ${message},
      is_active = false
    where interview_id = ${interviewId}::uuid
      and organization_id = ${organizationId}::uuid
  `)

  await prisma.$executeRaw(Prisma.sql`
    update public.interview_invites
    set status = 'PREPARATION_FAILED'
    where interview_id = ${interviewId}::uuid
      and coalesce(status, 'ACTIVE') <> 'USED'
  `)
}

async function markQuestionGenerationStarted(organizationId: string, interviewId: string) {
  await ensureInterviewWorkflowSchema()
  await prisma.$executeRaw(Prisma.sql`
    update public.interviews
    set
      status = 'PREPARING',
      question_status = 'GENERATING',
      failure_reason = null,
      last_error = null,
      is_active = true
    where interview_id = ${interviewId}::uuid
      and organization_id = ${organizationId}::uuid
  `)
}

async function markQuestionGenerationSucceeded(organizationId: string, interviewId: string) {
  await prisma.$executeRaw(Prisma.sql`
    update public.interviews
    set
      status = 'READY',
      question_status = 'COMPLETED',
      failure_reason = null,
      last_error = null,
      questions_generated_at = now(),
      is_active = true
    where interview_id = ${interviewId}::uuid
      and organization_id = ${organizationId}::uuid
  `)

  await prisma.$executeRaw(Prisma.sql`
    update public.interview_invites
    set status = 'ACTIVE'
    where interview_id = ${interviewId}::uuid
      and coalesce(status, 'ACTIVE') in ('PREPARING', 'PREPARATION_FAILED', 'ACTIVE')
  `)
}

export async function prepareInterviewQuestionsWithRetry(input: GenerateQuestionInput) {
  await markQuestionGenerationStarted(input.organizationId, input.interviewId)
  const context = await getInterviewContext(input.organizationId, input.interviewId)
  const previousQuestions = input.previousQuestions ?? await getPriorCandidateJobQuestions(context)
  let lastError: unknown = null
  const maxAttempts = Math.max(1, Math.min(QUESTION_RETRY_COUNT, input.maxAttempts ?? QUESTION_RETRY_COUNT))

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const candidateResumeText = input.candidateResumeText || context.resume_text || undefined
      const parsedResumeSkills = candidateResumeText ? parseResumeText(candidateResumeText).skills ?? [] : []
      const resumeSkills = input.resumeSkills && input.resumeSkills.length > 0 ? input.resumeSkills : parsedResumeSkills

      const cleared = await clearInterviewQuestions(input.interviewId)
      if (!cleared) {
        throw new Error("Failed to clear existing interview questions")
      }

      const generatedQuestions = await withTimeout(
        generateInterviewQuestions({
          jobDescription: context.job_description ?? undefined,
          coreSkills: context.core_skills ?? [],
          candidateResumeText,
          candidateResumeSkills: resumeSkills,
          candidateId: context.candidate_id,
          jobId: context.job_id,
          experienceLevel: String(context.experience_level_id ?? ""),
          totalQuestions: input.totalQuestions,
          interviewDurationMinutes: input.interviewDurationMinutes ?? context.interview_duration_minutes ?? undefined,
          jobTitle: context.job_title ?? undefined,
          codingRequired: context.coding_required,
          codingRecommended: context.coding_recommended,
          codingAssessmentType: context.coding_assessment_type,
          codingDifficulty: context.coding_difficulty,
          codingDurationMinutes: context.coding_duration_minutes,
          codingLanguages: context.coding_languages ?? [],
          previousQuestions,
          similarityThreshold: input.similarityThreshold ?? 0.72,
        }),
        input.generationTimeoutMs ?? CREATE_LINK_AI_TIMEOUT_MS,
        "AI question generation timed out"
      )

      if (generatedQuestions.length < MIN_QUESTION_COUNT) {
        throw new Error("Generated too few questions")
      }

      const replaced = await replaceInterviewQuestions(input.interviewId, generatedQuestions)
      if (!replaced) {
        const existingQuestions = await fetchExistingInterviewQuestions(input.interviewId)
        if (existingQuestions.length === 0) {
          throw new Error("Generated interview questions could not be saved")
        }
      }

      const verified = await verifyInterviewQuestionsPersisted(input.interviewId, generatedQuestions)
      if (!verified) {
        const existingQuestions = await fetchExistingInterviewQuestions(input.interviewId)
        if (existingQuestions.length === 0) {
          throw new Error("Interview questions were generated but could not be verified after saving")
        }
      }

      await markQuestionGenerationSucceeded(input.organizationId, input.interviewId)
      return { success: true }
    } catch (error) {
      lastError = error
      if (attempt < maxAttempts) {
        await sleep(BASE_BACKOFF_MS * 2 ** (attempt - 1))
      }
    }
  }

  try {
    const emergencyQuestions = buildEmergencyInterviewQuestions(context, input)
    const replaced = await replaceInterviewQuestions(input.interviewId, emergencyQuestions)

    if (!replaced) {
      throw new Error("Emergency interview questions could not be saved")
    }

    const verified = await verifyInterviewQuestionsPersisted(input.interviewId, emergencyQuestions)
    if (!verified) {
      const existingQuestions = await fetchExistingInterviewQuestions(input.interviewId)
      if (existingQuestions.length === 0) {
        throw new Error("Emergency interview questions could not be verified after saving")
      }
    }

    console.warn("AI question generation failed; emergency fallback questions were persisted", {
      interviewId: input.interviewId,
      organizationId: input.organizationId,
      lastError: normalizeMessage(lastError),
      questionCount: emergencyQuestions.length,
    })

    await markQuestionGenerationSucceeded(input.organizationId, input.interviewId)
    return { success: true, fallback: true }
  } catch (fallbackError) {
    lastError = fallbackError
  }

  await markQuestionGenerationFailed(input.organizationId, input.interviewId, lastError)
  throw new ApiError(502, "AI_QUESTION_GENERATION_FAILED", normalizeMessage(lastError))
}

async function markEmailSending(organizationId: string, interviewId: string) {
  await prisma.$executeRaw(Prisma.sql`
    update public.interviews
    set
      email_status = 'SENDING',
      last_error = null
    where interview_id = ${interviewId}::uuid
      and organization_id = ${organizationId}::uuid
      and status = 'READY'
  `)
}

export async function markEmailFailed(organizationId: string, interviewId: string, error: unknown) {
  await prisma.$executeRaw(Prisma.sql`
    update public.interviews
    set
      email_status = 'FAILED',
      last_error = ${normalizeMessage(error)}
    where interview_id = ${interviewId}::uuid
      and organization_id = ${organizationId}::uuid
      and status = 'READY'
  `)
}

async function markEmailSucceeded(organizationId: string, interviewId: string) {
  await prisma.$executeRaw(Prisma.sql`
    update public.interviews
    set
      email_status = 'SENT',
      email_sent_at = now(),
      last_error = null
    where interview_id = ${interviewId}::uuid
      and organization_id = ${organizationId}::uuid
      and status = 'READY'
  `)
}

export async function sendInterviewEmailForInterview(organizationId: string, interviewId: string) {
  const context = await getInterviewContext(organizationId, interviewId)

  if (String(context.status ?? "").toUpperCase() !== "READY" || String(context.question_status ?? "").toUpperCase() !== "COMPLETED") {
    throw new ApiError(409, "INTERVIEW_NOT_READY", "Interview is not ready for email delivery")
  }

  if (!context.link) {
    throw new ApiError(409, "INTERVIEW_LINK_NOT_READY", "Interview link is not available")
  }

  if (!context.candidate_email) {
    throw new ApiError(404, "CANDIDATE_EMAIL_NOT_FOUND", "Candidate email not found")
  }

  await markEmailSending(organizationId, interviewId)

  try {
    await sendInterviewEmail({
      to: context.candidate_email,
      name: context.candidate_name || "Candidate",
      link: context.link,
      companyName: context.organization_name ?? null,
      roleTitle: context.job_title ?? null,
      duration: context.interview_duration_minutes ?? null,
      expiryDate: context.expires_at ?? context.end_time ?? null,
      organizationTimezone: context.organization_timezone ?? null,
      organizationTimezoneLabel: context.organization_timezone_label ?? null,
      scheduledStartUtc: context.start_time ?? null,
      scheduledEndUtc: context.end_time ?? null,
    })
    await markEmailSucceeded(organizationId, interviewId)
    return { emailSent: true, emailError: null, link: context.link }
  } catch (error) {
    await markEmailFailed(organizationId, interviewId, error)
    return { emailSent: false, emailError: normalizeMessage(error), link: context.link }
  }
}
