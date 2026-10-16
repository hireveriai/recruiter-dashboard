import assert from "node:assert/strict"
import { createHmac } from "node:crypto"
import test from "node:test"

import { extractCapturedPayment, verifyRazorpayWebhookSignature } from "@/lib/server/razorpay-webhook"

const SECRET = "webhook-test-secret"
const sign = (body: string, secret = SECRET) => createHmac("sha256", secret).update(body).digest("hex")

test("accepts only bodies signed with the webhook secret", () => {
  const body = JSON.stringify({ event: "payment.captured" })

  assert.equal(verifyRazorpayWebhookSignature(body, sign(body), SECRET), true)
  assert.equal(verifyRazorpayWebhookSignature(body, sign(body, "other-secret"), SECRET), false)
  assert.equal(verifyRazorpayWebhookSignature(body + " ", sign(body), SECRET), false, "any change to the body breaks the signature")
  assert.equal(verifyRazorpayWebhookSignature(body, null, SECRET), false)
  assert.equal(verifyRazorpayWebhookSignature(body, sign(body), ""), false)
})

test("payment.captured yields the order and payment to activate", () => {
  assert.deepEqual(
    extractCapturedPayment({
      event: "payment.captured",
      payload: { payment: { entity: { id: "pay_1", order_id: "order_1", status: "captured" } } },
    }),
    { razorpayOrderId: "order_1", razorpayPaymentId: "pay_1" }
  )
})

test("order.paid falls back to the order entity id", () => {
  assert.deepEqual(
    extractCapturedPayment({
      event: "order.paid",
      payload: { payment: { entity: { id: "pay_2" } }, order: { entity: { id: "order_2" } } },
    }),
    { razorpayOrderId: "order_2", razorpayPaymentId: "pay_2" }
  )
})

test("other events and incomplete payloads are ignored", () => {
  assert.equal(extractCapturedPayment({ event: "payment.failed", payload: { payment: { entity: { id: "p", order_id: "o" } } } }), null)
  assert.equal(extractCapturedPayment({ event: "payment.captured", payload: {} }), null)
  assert.equal(extractCapturedPayment({}), null)
})
