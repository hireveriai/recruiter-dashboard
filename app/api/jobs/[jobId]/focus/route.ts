import { getRecruiterRequestContext } from "@/lib/server/auth-context"
import { assertEntitlement } from "@/lib/server/entitlements"
import { ApiError } from "@/lib/server/errors"
import { maxFocusAreasForDuration } from "@/lib/server/interview-focus/focus-rules"
import { errorResponse, successResponse } from "@/lib/server/response"
import { applyFocusAndRegenerate } from "@/lib/server/services/interview-focus-questionnaire"
import {
  discardFocusDraft,
  ensureActiveFocusPlan,
  getFocusPlans,
  isInterviewFocusAvailable,
  restoreRecommendedFocusDraft,
  saveFocusDraft,
  serializeFocusPlan,
} from "@/lib/server/services/interview-focus"
import { getJobQuestionnaireContext } from "@/lib/server/services/job-questionnaire"

export const runtime = "nodejs"
export const maxDuration = 120

type Params = { params: Promise<{ jobId: string }> }

async function buildState(organizationId: string, jobId: string) {
  const job = await getJobQuestionnaireContext(organizationId, jobId)
  const { active, draft } = await getFocusPlans({ organizationId, jobId })
  return {
    enabled: true,
    durationMinutes: job.interview_duration_minutes,
    maxAreas: maxFocusAreasForDuration(job.interview_duration_minutes),
    resumeQuestionsEnabled: job.resume_questions_enabled,
    active: serializeFocusPlan(active),
    draft: serializeFocusPlan(draft),
  }
}

/**
 * GET - the job's focus plans.
 *
 *   ?view=summary   read-only; never creates a plan or calls the AI (used by
 *                   the Edit Job modal)
 *   default         ensures an ACTIVE plan exists, creating the VERIS
 *                   Recommended one on first use (used by the focus editor)
 */
export async function GET(request: Request, context: Params) {
  try {
    const auth = await getRecruiterRequestContext(request)
    await assertEntitlement(auth, "AI_INTERVIEW")
    const { jobId } = await context.params

    if (!(await isInterviewFocusAvailable(auth.organizationId))) {
      return successResponse({ enabled: false })
    }

    const summaryOnly = new URL(request.url).searchParams.get("view") === "summary"
    if (!summaryOnly) {
      await ensureActiveFocusPlan({ organizationId: auth.organizationId, jobId, createdBy: auth.userId })
    }

    return successResponse(await buildState(auth.organizationId, jobId))
  } catch (error) {
    return errorResponse(error)
  }
}

/**
 * POST - editor actions.
 *
 *   { action: "save_draft", areas, resumeEmphasis }
 *   { action: "restore_recommended" }
 *   { action: "discard_draft" }
 *   { action: "apply" }   generate a DRAFT questionnaire from the focus draft,
 *                         then make that plan ACTIVE (the finalized
 *                         questionnaire is untouched until the recruiter
 *                         finalizes the new draft)
 */
export async function POST(request: Request, context: Params) {
  try {
    const auth = await getRecruiterRequestContext(request)
    await assertEntitlement(auth, "AI_INTERVIEW")
    const { jobId } = await context.params
    const body = await request.json().catch(() => ({}))
    const action = String(body?.action ?? "")
    const base = { organizationId: auth.organizationId, jobId, createdBy: auth.userId }

    if (action === "save_draft") {
      await saveFocusDraft({ ...base, areas: body.areas, resumeEmphasis: body.resumeEmphasis })
    } else if (action === "restore_recommended") {
      await restoreRecommendedFocusDraft(base)
    } else if (action === "discard_draft") {
      await discardFocusDraft(base)
    } else if (action === "apply") {
      const applied = await applyFocusAndRegenerate({
        ...base,
        idempotencyKey: typeof body.idempotencyKey === "string" ? body.idempotencyKey.trim() || null : null,
      })
      return successResponse({ ...(await buildState(auth.organizationId, jobId)), applied })
    } else {
      throw new ApiError(400, "UNSUPPORTED_ACTION", `Unsupported action: ${action || "(none)"}`)
    }

    return successResponse(await buildState(auth.organizationId, jobId))
  } catch (error) {
    return errorResponse(error)
  }
}
