import { NextResponse } from "next/server"

import { getRecruiterRequestContext } from "@/lib/server/auth-context"
import { errorResponse } from "@/lib/server/response"
import { getFastVerisSummaryCards } from "@/lib/server/services/dashboard-fast-snapshot"
import { finalizeStaleInterviewAttempts } from "@/lib/server/services/interview-stale-finalizer"
import { getVerisSummaryCards } from "@/lib/server/services/reports.service"

export async function GET(request: Request) {
  try {
    const auth = await getRecruiterRequestContext(request)
    const { searchParams } = new URL(request.url)
    const rawLimit = searchParams.get("limit")
    const rawOffset = Number.parseInt(searchParams.get("offset") ?? "0", 10)
    const limit = rawLimit === "all" ? null : Math.min(Math.max(Number(rawLimit || 6) || 6, 1), 50)
    const offset = Number.isFinite(rawOffset) && rawOffset > 0 ? rawOffset : 0
    const fast = searchParams.get("fast") === "1" || searchParams.get("summary") === "1"
    const startedAt = Date.now()
    await finalizeStaleInterviewAttempts(auth.organizationId)
    const cards = fast && offset === 0
      ? await getFastVerisSummaryCards(auth.organizationId, limit ?? 20)
      : await getVerisSummaryCards(auth.organizationId, limit, offset)

    const response = NextResponse.json({
      success: true,
      data: cards,
    })

    response.headers.set("Cache-Control", fast ? "private, max-age=10, stale-while-revalidate=30" : "no-store, no-cache, must-revalidate, max-age=0")
    if (!fast) {
      response.headers.set("Pragma", "no-cache")
    }
    response.headers.set("Server-Timing", `veris;dur=${Date.now() - startedAt}`)
    return response
  } catch (error) {
    return errorResponse(error)
  }
}
