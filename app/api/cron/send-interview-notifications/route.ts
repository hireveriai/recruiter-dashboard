import { processPendingInterviewNotifications } from "@/lib/server/services/interview-notifications"

export const runtime = "nodejs"
export const maxDuration = 60

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET?.trim()
  if (!cronSecret || request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 })
  }

  try {
    const result = await processPendingInterviewNotifications()
    console.log("Interview notification sweep completed", result)
    return Response.json({ ok: true, ...result })
  } catch (error) {
    console.error("Interview notification sweep failed", error)
    return Response.json(
      { ok: false, error: "Interview notification sweep failed" },
      { status: 500 }
    )
  }
}
