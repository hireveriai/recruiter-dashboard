import { NextResponse } from "next/server"

import { getRecruiterRequestContext } from "@/lib/server/auth-context"
import { assertEntitlement } from "@/lib/server/entitlements"
import { ApiError } from "@/lib/server/errors"
import { errorResponse } from "@/lib/server/response"
import { deleteResumeFromSupabaseStorage } from "@/lib/server/ai-screening/storage"
import {
  clearScreeningResultsForUpload,
  deleteUploadAndAnalysis,
} from "@/lib/server/ai-screening/service"

export const runtime = "nodejs"

type CleanupBody = {
  action?: "CLEAR_RESULTS" | "DELETE_UPLOAD"
  job_id?: string
  jobId?: string
  batchId?: string
  batch_id?: string
  candidateIds?: string[]
  candidate_ids?: string[]
  confirmation?: string
}

function readCandidateIds(body: CleanupBody) {
  if (Array.isArray(body.candidateIds)) {
    return body.candidateIds
  }

  if (Array.isArray(body.candidate_ids)) {
    return body.candidate_ids
  }

  return []
}

async function deleteStorageObjects(storageObjects: Array<{ bucket: string; key: string }>) {
  const results = await Promise.allSettled(
    storageObjects.map((storageObject) => deleteResumeFromSupabaseStorage(storageObject))
  )

  return {
    storageDeletedCount: results.filter((result) => result.status === "fulfilled").length,
    storageFailedCount: results.filter((result) => result.status === "rejected").length,
  }
}

export async function POST(request: Request) {
  try {
    const auth = await getRecruiterRequestContext(request)
    await assertEntitlement(auth, "SCREENING")
    const body = (await request.json()) as CleanupBody
    const action = body.action
    const jobId = String(body.job_id ?? body.jobId ?? "").trim()
    const batchId = String(body.batchId ?? body.batch_id ?? "").trim()
    const candidateIds = readCandidateIds(body)

    if (action === "CLEAR_RESULTS") {
      const result = await clearScreeningResultsForUpload({
        organizationId: auth.organizationId,
        jobId,
        uploadBatchId: batchId || null,
        candidateIds,
      })

      return NextResponse.json({
        success: true,
        data: result,
      })
    }

    if (action === "DELETE_UPLOAD") {
      if (body.confirmation !== "DELETE") {
        throw new ApiError(400, "DELETE_CONFIRMATION_REQUIRED", "Type DELETE to confirm upload deletion")
      }

      const result = await deleteUploadAndAnalysis({
        organizationId: auth.organizationId,
        uploadBatchId: batchId || null,
        candidateIds,
      })
      const storageResult = await deleteStorageObjects(result.storageObjects)

      return NextResponse.json({
        success: true,
        data: {
          deletedResults: result.deletedResults,
          deletedCandidates: result.deletedCandidates,
          ...storageResult,
        },
      })
    }

    throw new ApiError(400, "INVALID_CLEANUP_ACTION", "Invalid cleanup action")
  } catch (error) {
    return errorResponse(error)
  }
}
