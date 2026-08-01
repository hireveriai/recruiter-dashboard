import { NextResponse } from "next/server"

import { errorResponse } from "@/lib/server/response"
import { getActiveBillingPlans } from "@/lib/server/services/billing"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const selectedPlanSlug = searchParams.get("plan")?.trim().toLowerCase() || null
    const country = (request.headers.get("x-vercel-ip-country") || request.headers.get("cf-ipcountry") || "IN").toUpperCase()
    const plans = await getActiveBillingPlans(country === "IN" ? "INR" : "USD")
    const selectedPlan = selectedPlanSlug ? plans.find((plan) => plan.slug === selectedPlanSlug) ?? null : null
    const response = NextResponse.json({
      success: true,
      data: {
        plans,
        selectedPlan,
      },
    })

    response.headers.set("Cache-Control", "public, max-age=300, stale-while-revalidate=3600")
    return response
  } catch (error) {
    return errorResponse(error)
  }
}
