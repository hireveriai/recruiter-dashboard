import { Prisma } from "@prisma/client"

import { prepareInterviewQuestionSet } from "@/lib/server/interview/prepare-questions"
import { inferRoleIntelligence, sanitizeSkillList } from "@/lib/server/ai/skills"
import { prisma } from "@/lib/server/prisma"
import {
  clearInterviewQuestions,
  fetchExistingInterviewQuestions,
} from "@/lib/server/services/interview-questions"

type RepairInterviewInput = {
  organizationId: string
  jobId?: string
  interviewId?: string
  limit?: number
  force?: boolean
}

type RepairInterviewRow = {
  interviewId: string
  jobId: string
  createdAt: Date
  candidate: {
    resumeText: string | null
  }
  job: {
    jobTitle: string
    jobDescription: string | null
    coreSkills: string[]
    experienceLevelId: number | null
  }
}

type RepairItem = {
  interviewId: string
  jobId: string
  status: "repaired" | "skipped" | "failed"
  reason?: string
}

export type RepairInterviewQuestionsResult = {
  scanned: number
  repaired: number
  skipped: number
  jobsSanitized: number
  items: RepairItem[]
}

const NON_TECHNICAL_BAD_PHRASES = ["troubleshoot", "production", "deployment", "latency", "rollback"]

function normalizeText(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim()
}

function areSkillListsEquivalent(left: string[], right: string[]) {
  if (left.length !== right.length) {
    return false
  }

  const leftSorted = [...left].map(normalizeText).sort()
  const rightSorted = [...right].map(normalizeText).sort()

  return leftSorted.every((value, index) => value === rightSorted[index])
}

function looksLikeSentenceSkill(value: string) {
  const normalized = normalizeText(value)
  const words = normalized.split(" ").filter(Boolean)
  return words.length > 7 || /[.:;!?]/.test(value)
}

function needsRepair(
  existingQuestions: string[],
  input: {
    jobTitle?: string
    jobDescription?: string
    storedCoreSkills: string[]
    sanitizedCoreSkills: string[]
    resumeText?: string | null
  }
) {
  if (existingQuestions.length === 0) {
    return true
  }

  if (!areSkillListsEquivalent(input.storedCoreSkills, input.sanitizedCoreSkills)) {
    return true
  }

  const role = inferRoleIntelligence({
    jobTitle: input.jobTitle,
    jobDescription: input.jobDescription,
    coreSkills: input.sanitizedCoreSkills,
    resumeText: input.resumeText ?? undefined,
  })

  const normalizedTitle = normalizeText(input.jobTitle ?? "")
  const sentenceLikeSourceSkills = input.storedCoreSkills.filter(looksLikeSentenceSkill).map(normalizeText)
  const nonTechnicalRole = role.family !== "technical"

  return existingQuestions.some((question) => {
    const normalizedQuestion = normalizeText(question)

    if (normalizedTitle && normalizedQuestion.includes(normalizedTitle)) {
      return true
    }

    if (sentenceLikeSourceSkills.some((skill) => normalizedQuestion.includes(skill))) {
      return true
    }

    if (nonTechnicalRole && NON_TECHNICAL_BAD_PHRASES.some((phrase) => normalizedQuestion.includes(phrase))) {
      return true
    }

    return false
  })
}

async function updateJobSkillsIfNeeded(
  organizationId: string,
  jobId: string,
  storedCoreSkills: string[],
  sanitizedCoreSkills: string[]
) {
  if (areSkillListsEquivalent(storedCoreSkills, sanitizedCoreSkills)) {
    return false
  }

  await prisma.$executeRaw(Prisma.sql`
    update public.job_positions
    set core_skills = ${sanitizedCoreSkills}::text[]
    where job_id = ${jobId}::uuid
      and organization_id = ${organizationId}::uuid
  `)

  return true
}

export async function repairInterviewQuestions(input: RepairInterviewInput): Promise<RepairInterviewQuestionsResult> {
  const interviews = await prisma.interview.findMany({
    where: {
      organizationId: input.organizationId,
      ...(input.jobId ? { jobId: input.jobId } : {}),
      ...(input.interviewId ? { interviewId: input.interviewId } : {}),
    },
    orderBy: {
      createdAt: "desc",
    },
    take: input.limit ?? 50,
    select: {
      interviewId: true,
      jobId: true,
      createdAt: true,
      candidate: {
        select: {
          resumeText: true,
        },
      },
      job: {
        select: {
          jobTitle: true,
          jobDescription: true,
          coreSkills: true,
          experienceLevelId: true,
        },
      },
    },
  })

  const items: RepairItem[] = []
  const sanitizedJobs = new Set<string>()
  let repaired = 0
  let skipped = 0

  for (const interview of interviews as RepairInterviewRow[]) {
    const sanitizedCoreSkills = sanitizeSkillList(interview.job.coreSkills ?? [], {
      jobTitle: interview.job.jobTitle ?? undefined,
      jobDescription: interview.job.jobDescription ?? undefined,
    })

    try {
      const jobSanitized = await updateJobSkillsIfNeeded(
        input.organizationId,
        interview.jobId,
        interview.job.coreSkills ?? [],
        sanitizedCoreSkills
      )

      if (jobSanitized) {
        sanitizedJobs.add(interview.jobId)
      }

      const existingQuestions = await fetchExistingInterviewQuestions(interview.interviewId)
      const shouldRepair =
        input.force === true ||
        needsRepair(existingQuestions, {
          jobTitle: interview.job.jobTitle,
          jobDescription: interview.job.jobDescription ?? undefined,
          storedCoreSkills: interview.job.coreSkills ?? [],
          sanitizedCoreSkills,
          resumeText: interview.candidate.resumeText,
        })

      if (!shouldRepair) {
        skipped += 1
        items.push({
          interviewId: interview.interviewId,
          jobId: interview.jobId,
          status: "skipped",
          reason: "Question set already looks healthy.",
        })
        continue
      }

      // Repair routes through the same authoritative preparation path as a
      // normal interview, so there is exactly one way questions come into
      // existence. Previously this was a second, divergent generator.
      await clearInterviewQuestions(interview.interviewId)

      const prepared = await prepareInterviewQuestionSet({
        organizationId: input.organizationId,
        jobId: interview.jobId,
        interviewId: interview.interviewId,
        candidateBackground: interview.candidate.resumeText ?? undefined,
        excludeQuestions: existingQuestions,
      })

      const producedCount = prepared.structuredQuestionCount + prepared.resumeQuestionCount

      if (producedCount === 0) {
        items.push({
          interviewId: interview.interviewId,
          jobId: interview.jobId,
          status: "failed",
          reason: "No regenerated questions were produced.",
        })
        continue
      }

      repaired += 1
      items.push({
        interviewId: interview.interviewId,
        jobId: interview.jobId,
        status: "repaired",
      })
    } catch (error) {
      items.push({
        interviewId: interview.interviewId,
        jobId: interview.jobId,
        status: "failed",
        reason: error instanceof Error ? error.message : "Unknown repair error",
      })
    }
  }

  return {
    scanned: interviews.length,
    repaired,
    skipped,
    jobsSanitized: sanitizedJobs.size,
    items,
  }
}
