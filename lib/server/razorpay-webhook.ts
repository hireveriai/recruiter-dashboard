import { createHmac, timingSafeEqual } from "crypto"

/** Razorpay signs the raw request body with the webhook secret (HMAC-SHA256, hex). */
export function verifyRazorpayWebhookSignature(rawBody: string, signature: string | null, secret: string) {
  if (!signature || !secret) {
    return false
  }

  const expected = Buffer.from(createHmac("sha256", secret).update(rawBody).digest("hex"))
  const received = Buffer.from(signature.trim())

  return expected.length === received.length && timingSafeEqual(expected, received)
}

const PAYMENT_SUCCESS_EVENTS = new Set(["payment.captured", "order.paid"])

type RazorpayWebhookEvent = {
  event?: string
  payload?: {
    payment?: { entity?: { id?: string; order_id?: string; status?: string } }
    order?: { entity?: { id?: string } }
  }
}

/** The order and payment to activate, or null for events this app does not act on. */
export function extractCapturedPayment(event: RazorpayWebhookEvent) {
  if (!event.event || !PAYMENT_SUCCESS_EVENTS.has(event.event)) {
    return null
  }

  const payment = event.payload?.payment?.entity
  const orderId = payment?.order_id || event.payload?.order?.entity?.id
  const paymentId = payment?.id

  return orderId && paymentId ? { razorpayOrderId: orderId, razorpayPaymentId: paymentId } : null
}
