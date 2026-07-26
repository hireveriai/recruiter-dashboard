import { randomUUID } from "crypto"

import { NextResponse } from "next/server"

import { getRecruiterRequestContext } from "@/lib/server/auth-context"
import { ApiError } from "@/lib/server/errors"
import { errorResponse } from "@/lib/server/response"
import { parseResumeWithAI } from "@/lib/server/resumeParser"
import {
  extractResumeText,
  getResumeFileKind,
  isSupportedResumeFile,
} from "@/lib/server/ai-screening/resume-file"
import { uploadResumeToSupabaseStorage } from "@/lib/server/ai-screening/storage"
import {
  normalizeEmail,
  recordUploadBatchManifest,
  saveParsedCandidate,
} from "@/lib/server/ai-screening/service"

export const runtime = "nodejs"
export const maxDuration = 300

const MAX_FILES = 50
// Vercel Functions reject request bodies above the platform limit before this
// route runs. Keep one resume below 4 MiB so multipart overhead also fits.
const MAX_FILE_SIZE_BYTES = 4 * 1024 * 1024
const BATCH_SIZE = 3
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

type UploadResult = {
  fileName: string
  status: "ready" | "failed"
  candidateId: string | null
  uploadBatchId: string | null
  name: string | null
  email: string | null
  resumeUrl: string | null
  error: string | null
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message
  }

  return "Unknown error"
}

function getResumeFiles(formData: FormData) {
  return formData
    .getAll("files")
    .concat(formData.getAll("resumes"))
    .concat(formData.getAll("resume"))
    .filter((entry): entry is File => entry instanceof File && entry.size > 0)
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

export async function POST(request: Request) {
  try {
    const auth = await getRecruiterRequestContext(request)
    const formData = await request.formData()
    const files = getResumeFiles(formData)
    const requestedBatchId = String(formData.get("batchId") ?? formData.get("batch_id") ?? "").trim()

    if (files.length === 0) {
      throw new ApiError(400, "RESUMES_REQUIRED", "At least one PDF or DOCX resume is required")
    }

    if (files.length > MAX_FILES) {
      throw new ApiError(400, "TOO_MANY_FILES", `Upload at most ${MAX_FILES} resumes at a time`)
    }

    if (requestedBatchId && !UUID_REGEX.test(requestedBatchId)) {
      throw new ApiError(400, "INVALID_UPLOAD_BATCH", "Upload batch ID is invalid")
    }

    const batchId = requestedBatchId || randomUUID()
    const results = await processInBatches(files, BATCH_SIZE, async (file): Promise<UploadResult> => {
      try {
        if (!isSupportedResumeFile(file)) {
          throw new ApiError(400, "UNSUPPORTED_RESUME_TYPE", "Only PDF and DOCX resumes are supported")
        }

        if (file.size > MAX_FILE_SIZE_BYTES) {
          throw new ApiError(400, "RESUME_TOO_LARGE", "Resume must be 4MB or smaller")
        }

        const buffer = Buffer.from(await file.arrayBuffer())
        const uploaded = await uploadResumeToSupabaseStorage({
          organizationId: auth.organizationId,
          fileName: file.name,
          contentType: file.type,
          buffer,
        })
        const resumeText = await extractResumeText(file, buffer)

        if (!resumeText) {
          throw new ApiError(
            400,
            "RESUME_TEXT_EMPTY",
            "Resume text could not be extracted from this file"
          )
        }

        const parsed = await parseResumeWithAI(resumeText)
        const normalizedEmail = normalizeEmail(parsed.email)
        const candidate = await saveParsedCandidate({
          organizationId: auth.organizationId,
          userId: auth.userId,
          uploadBatchId: batchId,
          fileName: file.name,
          resumeUrl: uploaded.url,
          resumeText,
          parsed: {
            ...parsed,
            email: normalizedEmail,
          },
          storage: {
            bucket: uploaded.bucket,
            key: uploaded.key,
          },
        })

        return {
          fileName: file.name,
          status: "ready",
          candidateId: candidate.candidateId,
          uploadBatchId: batchId,
          name: candidate.name,
          email: candidate.email,
          resumeUrl: uploaded.url,
          error: null,
        }
      } catch (error) {
        console.error("VERIS screening resume upload failed", {
          fileName: file.name,
          fileKind: getResumeFileKind(file),
          error,
        })

        return {
          fileName: file.name,
          status: "failed",
          candidateId: null,
          uploadBatchId: null,
          name: null,
          email: null,
          resumeUrl: null,
          error: getErrorMessage(error),
        }
      }
    })

    const uploadedCount = results.filter((result) => result.status === "ready").length
    const uploadedCandidateIds = results
      .map((result) => result.candidateId)
      .filter((candidateId): candidateId is string => typeof candidateId === "string" && candidateId.length > 0)
    const firstFailure = results.find((result) => result.status === "failed" && result.error)
    const success = uploadedCount > 0
    const failureMessage = firstFailure?.error || "No resumes could be processed"

    if (uploadedCandidateIds.length > 0) {
      await recordUploadBatchManifest({
        batchId,
        organizationId: auth.organizationId,
        userId: auth.userId,
        candidateIds: uploadedCandidateIds,
        fileNames: results.map((result) => result.fileName),
      })
    }

    return NextResponse.json({
      success,
      ...(!success
        ? {
            error: {
              code: "RESUME_UPLOAD_FAILED",
              message: failureMessage,
            },
          }
        : {}),
      data: {
        batchId,
        uploadedCount,
        failedCount: results.length - uploadedCount,
        results,
      },
    }, { status: success ? 201 : 400 })
  } catch (error) {
    return errorResponse(error)
  }
}
