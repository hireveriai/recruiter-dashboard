import { NextResponse } from "next/server"

import { getRecruiterRequestContext } from "@/lib/server/auth-context"
import { ApiError } from "@/lib/server/errors"
import { assertEntitlement } from "@/lib/server/entitlements"
import { errorResponse } from "@/lib/server/response"
import { matchCandidateToJobWithAI } from "@/lib/server/ai-screening/openai"
import {
  attachCandidatesToUploadBatch,
  createScreeningRun,
  getCandidatesForMatching,
  getCandidatesForMatchingByUploadFiles,
  getLatestUploadBatchManifest,
  getMatchResults,
  getScreeningJob,
  getScreeningJobs,
  getUploadBatchManifest,
  upsertCandidateJobMatch,
} from "@/lib/server/ai-screening/service"
import { assertTrialCreditsAvailable, deductTrialCredits } from "@/lib/server/services/trial-credits"

export const runtime = "nodejs"
export const maxDuration = 300

const BATCH_SIZE = 12
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
type MatchScope = "BATCH" | "GLOBAL"

async function resolveScreeningJobId(organizationId: string, input: {
  jobId?: string
  sourceJobPositionId?: string
}) {
  const directJobId = String(input.jobId ?? "").trim()

  if (directJobId) {
    return directJobId
  }

  const sourceJobPositionId = String(input.sourceJobPositionId ?? "").trim()

  const jobs = await getScreeningJobs(organizationId)

  if (!sourceJobPositionId) {
    return jobs[0]?.id ?? ""
  }

  const job = jobs.find((item) => item.id === sourceJobPositionId || item.sourceJobPositionId === sourceJobPositionId)
  return job?.id ?? jobs[0]?.id ?? ""
}

function resolveMatchScope(value: unknown, includeAllCandidates: boolean): MatchScope {
  const normalized = typeof value === "string" ? value.trim().toUpperCase() : ""

  if (normalized === "GLOBAL") {
    return "GLOBAL"
  }

  if (normalized === "BATCH") {
    return "BATCH"
  }

  return includeAllCandidates ? "GLOBAL" : "BATCH"
}

async function processInBatches<T, R>(items: T[], batchSize: number, worker: (item: T) => Promise<R>) {
  const results: R[] = []

  for (let index = 0; index < items.length; index += batchSize) {
    const batch = items.slice(index, index + batchSize)
    const batchResults = await Promise.all(batch.map(worker))
    results.push(...batchResults)
  }

  return results
}

function filterMatchesToCandidateIds<T extends { candidateId: string }>(matches: T[], candidateIds: string[]) {
  const scopedIds = new Set(candidateIds.filter(Boolean))

  if (scopedIds.size === 0) {
    return matches
  }

  return matches.filter((match) => scopedIds.has(match.candidateId))
}

export async function GET(request: Request) {
  try {
    const auth = await getRecruiterRequestContext(request)
    await assertEntitlement(auth, "SCREENING")
    const url = new URL(request.url)
    const jobId = await resolveScreeningJobId(auth.organizationId, {
      jobId: String(url.searchParams.get("job_id") ?? url.searchParams.get("jobId") ?? "").trim(),
      sourceJobPositionId: String(
        url.searchParams.get("sourceJobPositionId") ??
          url.searchParams.get("source_job_position_id") ??
          url.searchParams.get("existingJobId") ??
          ""
      ).trim(),
    })
    const batchId = String(url.searchParams.get("batchId") ?? url.searchParams.get("batch_id") ?? "").trim()
    const candidateIds = String(url.searchParams.get("candidateIds") ?? url.searchParams.get("candidate_ids") ?? "")
      .split(",")
      .map((candidateId) => candidateId.trim())
      .filter(Boolean)
    const uploadFileNames = String(url.searchParams.get("uploadFileNames") ?? url.searchParams.get("upload_file_names") ?? "")
      .split(",")
      .map((fileName) => fileName.trim())
      .filter(Boolean)
    const legacyIncludeAllCandidates =
      url.searchParams.get("includeAllCandidates") === "true" ||
      url.searchParams.get("include_all_candidates") === "true"
    const requestedMatchScope = resolveMatchScope(
      url.searchParams.get("matchScope") ?? url.searchParams.get("match_scope"),
      legacyIncludeAllCandidates
    )
    const latestManifest =
      !batchId && candidateIds.length === 0 && uploadFileNames.length > 0
        ? await getLatestUploadBatchManifest({
            organizationId: auth.organizationId,
            userId: auth.userId,
            fileNames: uploadFileNames,
          })
        : null
    const effectiveBatchId = batchId || latestManifest?.batchId || ""
    const effectiveCandidateIds = candidateIds.length > 0 ? candidateIds : latestManifest?.candidateIds ?? []
    const hasCurrentUploadScope = Boolean(effectiveBatchId || effectiveCandidateIds.length > 0 || uploadFileNames.length > 0)
    const includeAllCandidates = hasCurrentUploadScope ? false : requestedMatchScope === "GLOBAL"
    const matchScope = includeAllCandidates ? "GLOBAL" : "BATCH"

    if (!jobId) {
      throw new ApiError(400, "JD_NOT_PROCESSED", "Analyze a job before matching candidates")
    }

    const job = await getScreeningJob(auth.organizationId, jobId)

    if (!job) {
      throw new ApiError(400, "JD_NOT_PROCESSED", "Process JD first")
    }

    if (effectiveBatchId && !UUID_REGEX.test(effectiveBatchId)) {
      throw new ApiError(400, "INVALID_UPLOAD_BATCH", "Current upload is invalid. Please upload resumes again.")
    }

    if (!includeAllCandidates && !effectiveBatchId && effectiveCandidateIds.length === 0) {
      throw new ApiError(400, "UPLOAD_BATCH_REQUIRED", "Current upload is required. Upload resumes before matching.")
    }

    const manifestCandidateIds =
      !includeAllCandidates && effectiveBatchId && effectiveCandidateIds.length === 0
        ? (await getUploadBatchManifest({
            batchId: effectiveBatchId,
            organizationId: auth.organizationId,
          }))?.candidateIds ?? []
        : []
    const scopedCandidateIds = effectiveCandidateIds.length > 0 ? effectiveCandidateIds : manifestCandidateIds

    let matches = await getMatchResults(auth.organizationId, jobId, {
      uploadBatchId: effectiveBatchId || null,
      candidateIds: scopedCandidateIds,
      fileNames: uploadFileNames,
      includeAllCandidates,
    })
    matches = includeAllCandidates ? matches : filterMatchesToCandidateIds(matches, scopedCandidateIds)

    if (matches.length === 0 && !includeAllCandidates && effectiveBatchId && scopedCandidateIds.length > 0) {
      return NextResponse.json({
        success: true,
        data: {
          job,
          matchScope,
          source: "batch",
          matches: [],
        },
      })
    }

    if (matches.length === 0 && !includeAllCandidates && uploadFileNames.length > 0 && scopedCandidateIds.length > 0) {
      matches = await getMatchResults(auth.organizationId, jobId, {
        candidateIds: scopedCandidateIds,
        fileNames: uploadFileNames,
        includeAllCandidates: false,
      })
      matches = filterMatchesToCandidateIds(matches, scopedCandidateIds)
    }

    return NextResponse.json({
      success: true,
      data: {
        job,
        matchScope,
        source: includeAllCandidates ? "full_db" : "batch",
        matches,
      },
    })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function POST(request: Request) {
  try {
    const auth = await getRecruiterRequestContext(request)
    await assertEntitlement(auth, "SCREENING")
    const body = (await request.json()) as {
      job_id?: string
      jobId?: string
      candidateIds?: string[]
      candidate_ids?: string[]
      batchId?: string
      batch_id?: string
      uploadFileNames?: string[]
      upload_file_names?: string[]
      matchScope?: string
      match_scope?: string
      includeAllCandidates?: boolean
      include_all_candidates?: boolean
      sourceJobPositionId?: string
      source_job_position_id?: string
      existingJobId?: string
      existing_job_id?: string
    }
    const jobId = await resolveScreeningJobId(auth.organizationId, {
      jobId: String(body.job_id ?? body.jobId ?? "").trim(),
      sourceJobPositionId: String(
        body.sourceJobPositionId ??
          body.source_job_position_id ??
          body.existingJobId ??
          body.existing_job_id ??
          ""
      ).trim(),
    })
    const batchId = String(body.batchId ?? body.batch_id ?? "").trim()
    const legacyIncludeAllCandidates = body.includeAllCandidates === true || body.include_all_candidates === true
    const requestedMatchScope = resolveMatchScope(body.matchScope ?? body.match_scope, legacyIncludeAllCandidates)
    const candidateIds = Array.isArray(body.candidateIds)
      ? body.candidateIds
      : Array.isArray(body.candidate_ids)
        ? body.candidate_ids
        : undefined
    const uploadFileNames = Array.isArray(body.uploadFileNames)
      ? body.uploadFileNames
      : Array.isArray(body.upload_file_names)
        ? body.upload_file_names
        : []
    const latestManifest =
      !batchId && !candidateIds?.length && uploadFileNames.length > 0
        ? await getLatestUploadBatchManifest({
            organizationId: auth.organizationId,
            userId: auth.userId,
            fileNames: uploadFileNames,
          })
        : null
    const effectiveBatchId = batchId || latestManifest?.batchId || ""
    const effectiveCandidateIds = candidateIds?.length ? candidateIds : latestManifest?.candidateIds ?? []
    const hasCurrentUploadScope = Boolean(effectiveBatchId || effectiveCandidateIds.length > 0 || uploadFileNames.length > 0)
    const includeAllCandidates = hasCurrentUploadScope ? false : requestedMatchScope === "GLOBAL"
    const matchScope = includeAllCandidates ? "GLOBAL" : "BATCH"

    if (!jobId) {
      throw new ApiError(400, "JD_NOT_PROCESSED", "Analyze a job before matching candidates")
    }

    const job = await getScreeningJob(auth.organizationId, jobId)

    if (!job) {
      throw new ApiError(400, "JD_NOT_PROCESSED", "Process JD first")
    }

    if (effectiveBatchId && !UUID_REGEX.test(effectiveBatchId)) {
      throw new ApiError(400, "INVALID_UPLOAD_BATCH", "Current upload is invalid. Please upload resumes again.")
    }

    if (!includeAllCandidates && !effectiveBatchId && effectiveCandidateIds.length === 0) {
      throw new ApiError(400, "UPLOAD_BATCH_REQUIRED", "Current upload is required. Upload resumes before matching.")
    }

    const manifestCandidateIds =
      !includeAllCandidates && effectiveBatchId && effectiveCandidateIds.length === 0
        ? (await getUploadBatchManifest({
            batchId: effectiveBatchId,
            organizationId: auth.organizationId,
          }))?.candidateIds ?? []
        : []
    const scopedCandidateIds = effectiveCandidateIds.length > 0 ? effectiveCandidateIds : manifestCandidateIds

    const source = includeAllCandidates ? "full_db" : "batch"
    let usedBatchFallback = false
    let candidates = !includeAllCandidates && scopedCandidateIds.length === 0 && uploadFileNames.length > 0
      ? await getCandidatesForMatchingByUploadFiles({
          organizationId: auth.organizationId,
          userId: auth.userId,
          uploadBatchId: effectiveBatchId || null,
          fileNames: uploadFileNames,
        })
      : await getCandidatesForMatching({
          organizationId: auth.organizationId,
          candidateIds: scopedCandidateIds,
          uploadBatchId: effectiveBatchId || null,
          includeAllCandidates,
        })

    if (!includeAllCandidates && scopedCandidateIds.length === 0 && uploadFileNames.length > 0 && candidates.length > 0) {
      usedBatchFallback = true
    }

    if (
      candidates.length === 0 &&
      !includeAllCandidates &&
      effectiveBatchId &&
      scopedCandidateIds.length > 0 &&
      uploadFileNames.length > 0
    ) {
      candidates = await getCandidatesForMatchingByUploadFiles({
        organizationId: auth.organizationId,
        userId: auth.userId,
        uploadBatchId: effectiveBatchId || null,
        fileNames: uploadFileNames,
      })
      usedBatchFallback = candidates.length > 0
    }

    if (candidates.length === 0 && !includeAllCandidates && effectiveBatchId && scopedCandidateIds.length > 0) {
      throw new ApiError(
        400,
        "CURRENT_UPLOAD_CANDIDATES_NOT_FOUND",
        "The current upload candidate scope could not be found. Please refresh and upload the resumes again."
      )
    }

    if (candidates.length === 0 && !includeAllCandidates && uploadFileNames.length > 0) {
      candidates = await getCandidatesForMatchingByUploadFiles({
        organizationId: auth.organizationId,
        userId: auth.userId,
        uploadBatchId: effectiveBatchId || null,
        fileNames: uploadFileNames,
      })
      usedBatchFallback = candidates.length > 0

      if (candidates.length > 0 && effectiveBatchId) {
        await attachCandidatesToUploadBatch({
          organizationId: auth.organizationId,
          uploadBatchId: effectiveBatchId,
          candidateIds: candidates.map((candidate) => candidate.candidate_id),
        })
      }
    }

    const resolvedCandidateIds = scopedCandidateIds.length > 0 && !usedBatchFallback
      ? scopedCandidateIds
      : candidates.map((candidate) => candidate.candidate_id)

    if (!includeAllCandidates && scopedCandidateIds.length > 0) {
      const scopedCandidateSet = new Set(scopedCandidateIds)
      candidates = candidates.filter((candidate) => scopedCandidateSet.has(candidate.candidate_id))
    }

    if (candidates.length === 0) {
      console.warn("VERIS screening matching found no candidates", {
        organizationId: auth.organizationId,
        jobId,
        batchId: effectiveBatchId || null,
        candidateIdsCount: scopedCandidateIds.length,
        uploadFileNamesCount: uploadFileNames.length,
        includeAllCandidates,
      })
      throw new ApiError(
        400,
        "NO_CANDIDATES_FOR_UPLOAD",
        "Uploaded resumes were saved, but matching could not find the current upload. Please refresh and run matching again, or use Scope: All Candidates (Database)."
      )
    }

    await assertTrialCreditsAvailable({
      organizationId: auth.organizationId,
      kind: "SCREENING",
      amount: candidates.length,
    })

    const generatedMatchResults = await processInBatches(candidates, BATCH_SIZE, async (candidate) => {
      try {
        const result = await matchCandidateToJobWithAI({
          candidateJson: candidate.extracted_json ?? {},
          resumeText: candidate.resume_text,
          job: {
            title: job.title,
            description: job.description,
            roleTitle: job.roleTitle,
            requiredSkills: job.requiredSkills,
            experienceNeeded: job.experienceNeeded,
            seniority:
              job.extractedJson &&
              typeof job.extractedJson === "object" &&
              "seniority" in job.extractedJson &&
              (job.extractedJson.seniority === "JUNIOR" ||
                job.extractedJson.seniority === "MID" ||
                job.extractedJson.seniority === "SENIOR")
                ? job.extractedJson.seniority
                : null,
            summary:
              job.extractedJson &&
              typeof job.extractedJson === "object" &&
              "summary" in job.extractedJson &&
              typeof job.extractedJson.summary === "string"
                ? job.extractedJson.summary
                : job.description.slice(0, 700),
          },
        })

        await upsertCandidateJobMatch({
          organizationId: auth.organizationId,
          candidateId: candidate.candidate_id,
          jobId,
          result,
        }).catch((error) => {
          console.warn("VERIS generated match cache write skipped", {
            candidateId: candidate.candidate_id,
            jobId,
            error: error instanceof Error ? error.message : String(error),
          })
        })

        return {
          id: `generated-${candidate.candidate_id}`,
          candidateId: candidate.candidate_id,
          candidateName: candidate.full_name,
          email: candidate.email,
          phone: candidate.phone,
          resumeUrl: candidate.resume_url,
          matchScore: result.matchScore,
          skillMatch: result.skillMatch,
          experienceMatch: result.experienceMatch,
          riskLevel: result.riskLevel,
          recommendation: result.recommendation,
          insights: {
            missing_skills: result.missingSkills,
            short_reasoning: result.shortReasoning,
            evaluated_at: new Date().toISOString(),
          },
          createdAt: new Date().toISOString(),
        }
      } catch (error) {
        console.error("VERIS candidate match failed; continuing bulk screening", {
          candidateId: candidate.candidate_id,
          jobId,
          error: error instanceof Error ? error.message : String(error),
        })
        return null
      }
    })
    const generatedMatches = generatedMatchResults.filter(
      (match): match is NonNullable<typeof match> => match !== null
    )
    const failedMatchCount = candidates.length - generatedMatches.length

    if (generatedMatches.length === 0) {
      throw new ApiError(502, "VERIS_MATCHING_FAILED", "No candidates could be screened. Please retry the screening.")
    }

    const successfullyMatchedCandidateIds = generatedMatches.map((match) => match.candidateId)

    let matches = await getMatchResults(auth.organizationId, jobId, {
      uploadBatchId: effectiveBatchId || null,
      candidateIds: successfullyMatchedCandidateIds,
      fileNames: uploadFileNames,
      includeAllCandidates,
    }).catch((error) => {
      console.warn("VERIS stored match lookup skipped", {
        jobId,
        error: error instanceof Error ? error.message : String(error),
      })
      return [] as typeof generatedMatches
    })
    matches = filterMatchesToCandidateIds(matches, successfullyMatchedCandidateIds)

    if (matches.length === 0 && !includeAllCandidates && uploadFileNames.length > 0 && successfullyMatchedCandidateIds.length > 0) {
      matches = await getMatchResults(auth.organizationId, jobId, {
        candidateIds: successfullyMatchedCandidateIds,
        fileNames: uploadFileNames,
        includeAllCandidates: false,
      }).catch((error) => {
        console.warn("VERIS stored match file lookup skipped", {
          jobId,
          error: error instanceof Error ? error.message : String(error),
        })
        return [] as typeof generatedMatches
      })
      matches = filterMatchesToCandidateIds(matches, successfullyMatchedCandidateIds)
    }

    if (matches.length === 0) {
      matches = generatedMatches
    }
    const trialCredits = await deductTrialCredits({
      organizationId: auth.organizationId,
      kind: "SCREENING",
      amount: generatedMatches.length,
    })
    const runId = await createScreeningRun({
      organizationId: auth.organizationId,
      userId: auth.userId,
      jobId,
      batchId: effectiveBatchId || null,
      matches,
    }).catch((error) => {
      console.warn("VERIS screening run snapshot write skipped after successful credit deduction", {
        jobId,
        error: error instanceof Error ? error.message : String(error),
      })
      return null
    })

    return NextResponse.json({
      success: true,
      data: {
        job,
        runId,
        matchedCount: generatedMatches.length,
        failedCount: failedMatchCount,
        matchScope,
        source,
        matches,
        trialCredits,
      },
    })
  } catch (error) {
    console.error("VERIS candidate matching failed", {
      error: error instanceof Error ? error.message : String(error),
      code: typeof error === "object" && error !== null && "code" in error ? (error as { code?: unknown }).code : undefined,
    })
    if (error instanceof ApiError) {
      return errorResponse(error)
    }

    return errorResponse(
      new ApiError(
        500,
        "VERIS_MATCHING_FAILED",
        error instanceof Error ? `VERIS matching failed: ${error.message}` : "VERIS matching failed."
      )
    )
  }
}
