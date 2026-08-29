import { refundAllPlatformFailureInterviewCredits } from "@/lib/server/services/trial-credits"

export const runtime = "nodejs"
export const maxDuration = 300

/**
 * Returns interview credits for sessions VerisNova itself failed to capture.
 *
 * This runs on a schedule rather than inside GET /api/dashboard/interviews so
 * that reading the interviews screen never mutates a credit balance. The
 * screen reads the resulting refund state; this job is what writes it.
 *
 * Idempotency is enforced by the partial unique index on
 * (organization_id, kind, source, source_id), so overlapping runs, retries, and
 * manual invocations cannot refund the same interview twice.
 */
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET?.trim()
  if (!cronSecret || request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 })
  }

  try {
    const result = await refundAllPlatformFailureInterviewCredits()
    console.log("Platform-failure interview credit refunds completed", result)
    return Response.json({ ok: true, ...result })
  } catch (error) {
    console.error("Platform-failure interview credit refunds failed", error)
    return Response.json(
      { ok: false, error: "Platform-failure interview credit refunds failed" },
      { status: 500 }
    )
  }
}
