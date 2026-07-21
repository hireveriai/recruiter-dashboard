import { refundAllExpiredUnusedInterviewCredits } from "@/lib/server/services/trial-credits"

export const runtime = "nodejs"
export const maxDuration = 300

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET?.trim()
  if (!cronSecret || request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 })
  }

  try {
    const result = await refundAllExpiredUnusedInterviewCredits()
    console.log("Expired interview credit reconciliation completed", result)
    return Response.json({ ok: true, ...result })
  } catch (error) {
    console.error("Expired interview credit reconciliation failed", error)
    return Response.json(
      { ok: false, error: "Expired interview credit reconciliation failed" },
      { status: 500 }
    )
  }
}
