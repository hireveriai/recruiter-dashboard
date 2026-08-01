import { z } from "zod"

import { getRecruiterRequestContext } from "@/lib/server/auth-context"
import { errorResponse, successResponse } from "@/lib/server/response"
import { getOrganizationBillingHistory, updateOrganizationBillingSettings } from "@/lib/server/services/invoices"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function GET(request: Request) {
  try {
    const auth = await getRecruiterRequestContext(request)
    const billing = await getOrganizationBillingHistory(auth)

    return successResponse(billing)
  } catch (error) {
    return errorResponse(error)
  }
}

const billingSettingsSchema = z.object({
  gstNumber: z.string().trim().max(32).optional().nullable(),
  billingAddress: z.string().trim().max(1000).optional().nullable(),
  financeEmail: z.string().trim().email().optional().nullable().or(z.literal("")),
  invoiceRecipientEmail: z.string().trim().email().optional().nullable().or(z.literal("")),
  billingCountryCode: z.string().trim().length(2).transform((value) => value.toUpperCase()),
})

export async function PATCH(request: Request) {
  try {
    const auth = await getRecruiterRequestContext(request)
    const body = await request.json()
    const input = billingSettingsSchema.parse(body)
    const organization = await updateOrganizationBillingSettings({
      auth,
      gstNumber: input.gstNumber,
      billingAddress: input.billingAddress,
      financeEmail: input.financeEmail,
      invoiceRecipientEmail: input.invoiceRecipientEmail,
      billingCountryCode: input.billingCountryCode,
    })

    return successResponse({ organization })
  } catch (error) {
    return errorResponse(error)
  }
}
