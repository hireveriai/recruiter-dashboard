import { getRecruiterRequestContext } from "@/lib/server/auth-context"
import { COMPETENCY_LIBRARY } from "@/lib/server/interview-focus/competency-library"
import {
  COVERAGE_STEP,
  MIN_AREA_COVERAGE,
  RESUME_EMPHASIS_VALUES,
  TOTAL_COVERAGE,
} from "@/lib/server/interview-focus/focus-rules"
import { errorResponse, successResponse } from "@/lib/server/response"
import { isInterviewFocusAvailable } from "@/lib/server/services/interview-focus"

export const runtime = "nodejs"

/**
 * GET - whether Interview Focus is on for this organization, plus the
 * competency library and rules the editor needs. No job is required, so the
 * Create Job modal can use it before a job exists. Never calls the AI.
 */
export async function GET(request: Request) {
  try {
    const auth = await getRecruiterRequestContext(request)
    const enabled = await isInterviewFocusAvailable(auth.organizationId)

    if (!enabled) {
      return successResponse({ enabled: false })
    }

    return successResponse({
      enabled: true,
      library: COMPETENCY_LIBRARY.map(({ key, label, description }) => ({ key, label, description })),
      rules: {
        totalCoverage: TOTAL_COVERAGE,
        coverageStep: COVERAGE_STEP,
        minAreaCoverage: MIN_AREA_COVERAGE,
        maxAreasByDuration: { 30: 5, 45: 6, 60: 7 },
        resumeEmphasis: RESUME_EMPHASIS_VALUES,
      },
    })
  } catch (error) {
    return errorResponse(error)
  }
}
