import { z } from "zod"

import { getRecruiterRequestContext } from "@/lib/server/auth-context"
import { resolveCheckoutCurrency } from "@/lib/server/pricing/currency"
import { errorResponse, successResponse } from "@/lib/server/response"
import { createRazorpayOrder } from "@/lib/server/services/billing"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const createOrderSchema = z.object({
  plan: z.string().trim().min(1),
  addon_plan: z.string().trim().optional().nullable(),
  coupon_code: z.string().trim().optional().nullable(),
})

export async function POST(request: Request) {
  try {
    const auth = await getRecruiterRequestContext(request)
    const body = await request.json()
    const input = createOrderSchema.parse(body)
    /* The schema deliberately has no currency field: the amount is resolved
       from the database using a currency derived from edge geo headers, so a
       crafted request body cannot change what is charged. */
    const order = await createRazorpayOrder({
      auth,
      planSlug: input.plan,
      addonPlanSlug: input.addon_plan,
      couponCode: input.coupon_code,
      currency: resolveCheckoutCurrency(request),
    })

    return successResponse(order)
  } catch (error) {
    return errorResponse(error)
  }
}
