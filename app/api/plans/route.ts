import { NextResponse } from "next/server"

import { errorResponse } from "@/lib/server/response"
import { resolveCheckoutCurrency } from "@/lib/server/pricing/currency"
import { getActiveBillingPlans } from "@/lib/server/services/billing"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const selectedPlanSlug = searchParams.get("plan")?.trim().toLowerCase() || null
    const plans = await getActiveBillingPlans(resolveCheckoutCurrency(request))
    const selectedPlan = selectedPlanSlug ? plans.find((plan) => plan.slug === selectedPlanSlug) ?? null : null
    const response = NextResponse.json({
      success: true,
      data: {
        plans,
        selectedPlan,
      },
    })

    // The response varies by visitor country. Do not let a shared CDN cache serve
    // the first visitor's currency to users in other countries.
    response.headers.set("Cache-Control", "private, no-store")
    response.headers.set("Vary", "x-vercel-ip-country, cf-ipcountry")
    return response
  } catch (error) {
    return errorResponse(error)
  }
}
