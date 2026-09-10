import { z } from "zod"

import { getRecruiterRequestContext } from "@/lib/server/auth-context"
import { errorResponse, successResponse } from "@/lib/server/response"
import { confirmOrganizationBillingCountry } from "@/lib/server/services/invoices"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const billingCountrySchema = z.object({
  billing_country_code: z
    .string()
    .trim()
    .length(2)
    .regex(/^[A-Za-z]{2}$/, "Billing country must be a two-letter ISO country code")
    .transform((value) => value.toUpperCase()),
})

/**
 * Records where an organization is billed, so tax can be calculated from
 * something it actually asserted rather than from the 'IN' column default.
 *
 * Note what this endpoint deliberately does NOT accept: a currency, an amount,
 * a price or a plan. Those stay server-derived. Billing country moves tax
 * treatment only, within the rules that already existed.
 */
export async function POST(request: Request) {
  try {
    const auth = await getRecruiterRequestContext(request)
    const body = await request.json()
    const input = billingCountrySchema.parse(body)
    const organization = await confirmOrganizationBillingCountry({
      auth,
      billingCountryCode: input.billing_country_code,
    })

    return successResponse({ organization })
  } catch (error) {
    return errorResponse(error)
  }
}
