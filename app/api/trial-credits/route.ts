import { getRecruiterRequestContext } from "@/lib/server/auth-context"
import { ApiError } from "@/lib/server/errors"
import { errorResponse, successResponse } from "@/lib/server/response"
import { getOrCreateTrialCredits } from "@/lib/server/services/trial-credits"
import { getAssessmentCreditSnapshot } from "@/lib/server/services/assessment-credits"

export const runtime = "nodejs"

export async function GET(request: Request) {
  let auth: Awaited<ReturnType<typeof getRecruiterRequestContext>>

  try {
    auth = await getRecruiterRequestContext(request)
  } catch (error) {
    return errorResponse(error)
  }

  try {
    const credits = await getOrCreateTrialCredits(auth.organizationId)

    // Assessment credits are a deliberately standalone module (see
    // lib/server/services/assessment-credits.ts) - merged in here only for
    // display, never touching lib/server/services/trial-credits.ts itself.
    const assessmentCredits = await getAssessmentCreditSnapshot(auth.organizationId).catch((error) => {
      console.warn("Assessment credit snapshot failed, defaulting to 0", error)
      return { assessmentCreditsRemaining: 0 }
    })

    const response = successResponse({
      ...credits,
      assessmentCreditsRemaining: assessmentCredits.assessmentCreditsRemaining,
    })
    response.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
    response.headers.set("Pragma", "no-cache")
    return response
  } catch (error) {
    console.error("Trial credits bootstrap failed", error)
    return errorResponse(
      error instanceof ApiError
        ? error
        : new ApiError(503, "TRIAL_CREDITS_UNAVAILABLE", "Unable to load free trial credits from the workspace balance table.")
    )
  }
}
