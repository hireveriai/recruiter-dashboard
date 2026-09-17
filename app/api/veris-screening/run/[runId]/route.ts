import { NextResponse } from "next/server"

import { getRecruiterRequestContext } from "@/lib/server/auth-context"
import { assertEntitlement } from "@/lib/server/entitlements"
import { getScreeningRunSnapshot } from "@/lib/server/ai-screening/service"
import { errorResponse } from "@/lib/server/response"

export const runtime = "nodejs"

export async function GET(
  request: Request,
  context: { params: Promise<{ runId: string }> }
) {
  try {
    const auth = await getRecruiterRequestContext(request)
    await assertEntitlement(auth, "SCREENING")
    const params = await context.params
    const snapshot = await getScreeningRunSnapshot({
      organizationId: auth.organizationId,
      runId: params.runId,
    })

    return NextResponse.json({
      success: true,
      data: {
        run: snapshot.run,
        matches: snapshot.matches,
        insights: snapshot.matches.map((match) => ({
          candidateId: match.candidateId,
          candidateName: match.candidateName,
          insights: match.insights,
        })),
        recommendations: snapshot.matches.map((match) => ({
          candidateId: match.candidateId,
          recommendation: match.recommendation,
          riskLevel: match.riskLevel,
          score: match.matchScore,
        })),
        diagnostics: snapshot.diagnostics,
      },
    })
  } catch (error) {
    return errorResponse(error)
  }
}
