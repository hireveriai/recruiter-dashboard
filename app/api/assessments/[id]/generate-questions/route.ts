import { getRecruiterRequestContext } from "@/lib/server/auth-context"
import { assertCanAssessment } from "@/lib/server/assessment/auth"
import { generateAssessmentQuestions } from "@/lib/server/assessment/question-generator"
import { generateQuestionsSchema } from "@/lib/server/assessment/validators"
import { getOrCreateDraftVersion } from "@/lib/server/assessment/versions"
import { jobPositionsSupportCodingConfig } from "@/lib/server/services/jobs"
import { ApiError } from "@/lib/server/errors"
import { prisma } from "@/lib/server/prisma"
import { errorResponse, successResponse } from "@/lib/server/response"

type JobCodingConfigRow = {
  coding_required: string | null
  coding_languages: string[] | null
}

/**
 * CODING questions may only ever be generated for a job where the recruiter
 * explicitly enabled coding (coding_required = 'YES') — a marketing role's
 * assessment must never get a coding question just because the enum happens
 * to include CODING. AUTO is deliberately NOT treated as enabled here: its
 * recommendation columns are a separate, less certain schema-drift surface
 * (see jobPositionsSupportCodingConfig's capability-probe pattern) and this
 * route only wants an explicit, recruiter-confirmed signal.
 */
async function loadJobCodingConfig(jobId: string): Promise<{ enabled: boolean; languages: string[] }> {
  const supported = await jobPositionsSupportCodingConfig()
  if (!supported) return { enabled: false, languages: [] }

  const rows = await prisma.$queryRaw<JobCodingConfigRow[]>`
    select coding_required, coding_languages
    from public.job_positions
    where job_id = ${jobId}::uuid
    limit 1
  `

  const row = rows[0]
  return { enabled: row?.coding_required === "YES", languages: Array.isArray(row?.coding_languages) ? row.coding_languages : [] }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await getRecruiterRequestContext(request)
    await assertCanAssessment(auth, "assessments.edit")
    const { id } = await context.params

    const assessment = await prisma.assessment.findFirst({
      where: { id, organizationId: auth.organizationId },
    })

    if (!assessment) {
      throw new ApiError(404, "ASSESSMENT_NOT_FOUND", "Assessment not found")
    }

    const payload = generateQuestionsSchema.parse(await request.json().catch(() => ({})))

    const job = await prisma.jobPosition.findUnique({
      where: { jobId: assessment.jobId },
      select: { jobTitle: true, jobDescription: true, coreSkills: true, difficultyProfile: true },
    })

    const questionCount = payload.questionCount ?? assessment.questionCount ?? 10
    const requestedQuestionTypes = payload.questionTypes ?? assessment.questionTypes ?? []
    const difficulty = payload.difficulty ?? (assessment.difficulty as "JUNIOR" | "MID" | "SENIOR" | null) ?? undefined

    const jobCoding = await loadJobCodingConfig(assessment.jobId)
    // Silently drop CODING from the request rather than erroring — a
    // recruiter's saved question-type mix may include CODING from before
    // coding was disabled on the job, and this keeps generation working.
    const questionTypes = jobCoding.enabled
      ? requestedQuestionTypes
      : requestedQuestionTypes.filter((type) => type !== "CODING")

    const { questions, model } = await generateAssessmentQuestions({
      jobTitle: job?.jobTitle,
      jobDescription: job?.jobDescription,
      coreSkills: job?.coreSkills,
      difficultyProfile: difficulty ?? job?.difficultyProfile,
      questionCount,
      questionTypes,
      entityId: assessment.id,
      codingLanguages: jobCoding.languages,
    })

    // generating questions never touches assessments.status - it only ever
    // writes into a DRAFT version.
    const created = await prisma.$transaction(async (tx) => {
      const draft = await getOrCreateDraftVersion(id, tx)

      const existingCount = await tx.assessmentQuestion.count({ where: { versionId: draft.id } })

      await tx.assessmentVersion.update({
        where: { id: draft.id },
        data: { generationModel: model, generationMeta: { lastGeneratedAt: new Date().toISOString() } },
      })

      const insertedQuestions = []
      for (let i = 0; i < questions.length; i += 1) {
        const q = questions[i]
        const question = await tx.assessmentQuestion.create({
          data: {
            versionId: draft.id,
            questionType: q.questionType,
            questionText: q.questionText,
            orderIndex: existingCount + i,
            explanation: q.explanation,
            rubric: q.codingSpec
              ? { codingSpec: q.codingSpec }
              : q.rubric
                ? { criteria: q.rubric.criteria, modelAnswerNotes: q.rubric.modelAnswerNotes }
                : undefined,
            origin: "AI",
          },
        })

        if (q.options.length > 0) {
          await tx.assessmentQuestionOption.createMany({
            data: q.options.map((option, idx) => ({
              questionId: question.id,
              optionText: option.text,
              optionOrder: idx,
              isCorrect: option.isCorrect,
            })),
          })
        }

        insertedQuestions.push(question)
      }

      return { draft, insertedQuestions }
    })

    return successResponse({
      versionId: created.draft.id,
      versionNumber: created.draft.versionNumber,
      questionsGenerated: created.insertedQuestions.length,
    }, 201)
  } catch (error) {
    return errorResponse(error)
  }
}
