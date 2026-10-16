import { NextResponse } from "next/server"

import { isApiError } from "@/lib/server/errors"
import { extractCapturedPayment, verifyRazorpayWebhookSignature } from "@/lib/server/razorpay-webhook"
import { activatePaymentFromWebhook } from "@/lib/server/services/billing"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

/**
 * Razorpay webhook (configure in the Razorpay dashboard with events
 * payment.captured and order.paid, and set RAZORPAY_WEBHOOK_SECRET).
 *
 * Responses: 2xx tells Razorpay to stop retrying. Permanent problems (amount or
 * plan mismatch) are acknowledged with 200 and logged for a human, because
 * Razorpay disables a webhook that keeps failing; only unexpected server errors
 * return 500 so the event is retried.
 */
export async function POST(request: Request) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET?.trim()

  if (!secret) {
    return NextResponse.json({ error: "Webhook is not configured" }, { status: 503 })
  }

  const rawBody = await request.text()

  if (!verifyRazorpayWebhookSignature(rawBody, request.headers.get("x-razorpay-signature"), secret)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 })
  }

  let event: Parameters<typeof extractCapturedPayment>[0]
  try {
    event = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 })
  }

  const captured = extractCapturedPayment(event)

  if (!captured) {
    return NextResponse.json({ ok: true, ignored: event.event ?? "unknown" })
  }

  try {
    const result = await activatePaymentFromWebhook(captured)
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    if (isApiError(error) && error.statusCode < 500) {
      console.error("Razorpay webhook could not activate payment", {
        orderId: captured.razorpayOrderId,
        code: error.code,
        message: error.message,
      })
      return NextResponse.json({ ok: false, code: error.code })
    }

    console.error("Razorpay webhook failed", { orderId: captured.razorpayOrderId, error })
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 })
  }
}
