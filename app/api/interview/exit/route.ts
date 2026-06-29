import { z } from "zod"

import { errorResponse, successResponse } from "@/lib/server/response"
import { recordInterviewEarlyExit } from "@/lib/server/services/interview-exit"

const earlyExitSchema = z.object({
  token: z.string().min(1),
  attemptId: z.string().uuid().optional().nullable(),
  attempt_id: z.string().uuid().optional().nullable(),
  reason: z.string().max(80).optional().nullable(),
  source: z.string().max(80).optional().nullable(),
  completionPercentage: z.number().optional().nullable(),
  completion_percentage: z.number().optional().nullable(),
  timerRemainingSeconds: z.number().optional().nullable(),
  timer_remaining_seconds: z.number().optional().nullable(),
  metadata: z.record(z.unknown()).optional().nullable(),
})

async function readBody(request: Request) {
  const contentType = request.headers.get("content-type") ?? ""

  if (contentType.includes("application/json")) {
    return request.json()
  }

  const text = await request.text()
  if (!text) {
    return {}
  }

  try {
    return JSON.parse(text)
  } catch {
    return Object.fromEntries(new URLSearchParams(text))
  }
}

export async function POST(request: Request) {
  try {
    const body = earlyExitSchema.parse(await readBody(request))
    const result = await recordInterviewEarlyExit({
      token: body.token,
      attemptId: body.attemptId ?? body.attempt_id ?? null,
      reason: body.reason ?? "candidate_left_interview",
      source: body.source ?? "client",
      completionPercentage: body.completionPercentage ?? body.completion_percentage ?? null,
      timerRemainingSeconds: body.timerRemainingSeconds ?? body.timer_remaining_seconds ?? null,
      metadata: body.metadata ?? null,
    })

    return successResponse(result)
  } catch (error) {
    return errorResponse(error)
  }
}
