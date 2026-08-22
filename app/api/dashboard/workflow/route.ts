import { NextResponse } from "next/server"

import { getRecruiterRequestContext } from "@/lib/server/auth-context"
import { errorResponse } from "@/lib/server/response"
import { getDashboardWorkflowSnapshot } from "@/lib/server/services/dashboard-workflow"

const WORKFLOW_CACHE_TTL_MS = 10000
const workflowCache = new Map<string, { value: Awaited<ReturnType<typeof getDashboardWorkflowSnapshot>>; expiresAt: number }>()
const inFlightWorkflow = new Map<string, Promise<Awaited<ReturnType<typeof getDashboardWorkflowSnapshot>>>>()

function getCachedWorkflow(cacheKey: string) {
  const cached = workflowCache.get(cacheKey)
  if (!cached) {
    return null
  }

  if (cached.expiresAt <= Date.now()) {
    workflowCache.delete(cacheKey)
    return null
  }

  return cached.value
}

function setCachedWorkflow(cacheKey: string, value: Awaited<ReturnType<typeof getDashboardWorkflowSnapshot>>) {
  workflowCache.set(cacheKey, {
    value,
    expiresAt: Date.now() + WORKFLOW_CACHE_TTL_MS,
  })

  if (workflowCache.size > 50) {
    const oldestKey = workflowCache.keys().next().value
    if (oldestKey) {
      workflowCache.delete(oldestKey)
    }
  }
}

export async function GET(request: Request) {
  try {
    const startedAt = Date.now()
    const auth = await getRecruiterRequestContext(request)
    const { searchParams } = new URL(request.url)
    const forceRefresh = searchParams.has("refresh") || searchParams.get("cache") === "bust"
    const cacheKey = `workflow:${auth.organizationId}`
    const cached = forceRefresh ? null : getCachedWorkflow(cacheKey)

    if (cached) {
      const response = NextResponse.json({
        success: true,
        data: cached,
      })

      response.headers.set("Cache-Control", "private, max-age=10, stale-while-revalidate=30")
      response.headers.set("X-VerisNova-Cache", "hit")
      response.headers.set("Server-Timing", `workflow;dur=${Date.now() - startedAt}`)
      return response
    }

    let snapshotPromise = inFlightWorkflow.get(cacheKey)
    if (!snapshotPromise) {
      snapshotPromise = getDashboardWorkflowSnapshot(auth.organizationId)
      inFlightWorkflow.set(cacheKey, snapshotPromise)
    }

    const snapshot = await snapshotPromise.finally(() => {
      inFlightWorkflow.delete(cacheKey)
    })
    setCachedWorkflow(cacheKey, snapshot)

    const response = NextResponse.json({
      success: true,
      data: snapshot,
    })

    response.headers.set("Cache-Control", forceRefresh ? "no-store" : "private, max-age=10, stale-while-revalidate=30")
    response.headers.set("X-VerisNova-Cache", forceRefresh ? "refresh" : "miss")
    response.headers.set("Server-Timing", `workflow;dur=${Date.now() - startedAt}`)
    return response
  } catch (error) {
    return errorResponse(error)
  }
}
