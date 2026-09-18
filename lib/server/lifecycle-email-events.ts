import { getOrganizationEntitlements } from "@/lib/server/entitlements"
import { buildEntitlementSummaryLines } from "@/lib/server/entitlement-summary"
import { claimLifecycleEmail, getOrganizationPrimaryContact, markLifecycleEmail } from "@/lib/server/lifecycle-email-log"
import {
  RECRUITER_TRIAL_AI_INTERVIEWS,
  RECRUITER_TRIAL_VERIS_SCREENINGS,
  getRecruiterTrialState,
} from "@/lib/server/services/trial-requests"
import {
  sendAddonActivatedEmail,
  sendBundleActivatedEmail,
  sendSubscriptionActivatedEmail,
  sendTrialApprovedEmail,
  sendTrialRequestReceivedEmail,
} from "@/lib/services/email.service"

/**
 * Single dispatch layer for the recruiter lifecycle emails described in the
 * product principle: signup is not a lifecycle event by itself, only these
 * five are. Each function here:
 *   1. Claims an idempotency slot (lib/server/lifecycle-email-log.ts) so a
 *      retried request/webhook/double-click cannot send twice.
 *   2. Resolves "what does this org actually have" from the real source of
 *      truth (lib/server/entitlements.ts, or numbers the caller already
 *      computed from the purchase itself) - never a hardcoded feature list.
 *   3. Calls the matching template in lib/services/email.service.ts, which
 *      only renders pre-resolved data.
 * Never throws - a mail provider outage must not fail the request that
 * triggered it (signup, trial approval, payment activation).
 */

function firstNameFrom(name?: string | null) {
  const trimmed = name?.trim()
  if (!trimmed) return null
  return trimmed.split(/\s+/)[0]
}

export async function emitTrialRequestedEmail(input: {
  organizationId: string
  requestId: string | null
  to: string
  name?: string | null
}) {
  const dedupeKey = input.requestId || `${input.organizationId}:no-request-id`

  try {
    const deliveryId = await claimLifecycleEmail({
      emailType: "TRIAL_REQUESTED",
      dedupeKey,
      organizationId: input.organizationId,
    })

    if (!deliveryId) {
      return
    }

    const entitlementLines = buildEntitlementSummaryLines([
      { code: "AI_INTERVIEW", granted: true, credits: RECRUITER_TRIAL_AI_INTERVIEWS },
      { code: "SCREENING", granted: true, credits: RECRUITER_TRIAL_VERIS_SCREENINGS },
      // Assessment is deliberately omitted: the free trial offer does not
      // include it (see lib/server/entitlements.ts's trial priority rule).
      { code: "ASSESSMENT", granted: false },
    ])

    await sendTrialRequestReceivedEmail({
      to: input.to,
      firstName: firstNameFrom(input.name),
      entitlementLines,
    })

    await markLifecycleEmail(deliveryId, "SENT")
  } catch (error) {
    console.warn("TRIAL_REQUESTED email failed", error)
  }
}

export async function emitTrialApprovedEmail(input: {
  organizationId: string
  requestId: string | null
  /** Resolved contact email - falls back to the org's primary contact if omitted. */
  to?: string | null
  name?: string | null
}) {
  const dedupeKey = input.requestId || `${input.organizationId}:no-request-id`

  try {
    const deliveryId = await claimLifecycleEmail({
      emailType: "TRIAL_APPROVED",
      dedupeKey,
      organizationId: input.organizationId,
    })

    if (!deliveryId) {
      return
    }

    const contact =
      input.to && input.name !== undefined
        ? { email: input.to, name: input.name ?? null }
        : await getOrganizationPrimaryContact(input.organizationId)

    const recipient = input.to || contact.email

    if (!recipient) {
      console.warn("TRIAL_APPROVED email skipped: no recipient email for org", input.organizationId)
      await markLifecycleEmail(deliveryId, "FAILED", "no recipient email")
      return
    }

    // Same source the Recruiter Dashboard itself reads, so the email can
    // never claim a feature the dashboard doesn't also show as granted.
    const [entitlements, trialState] = await Promise.all([
      getOrganizationEntitlements(input.organizationId),
      getRecruiterTrialState(input.organizationId),
    ])

    const entitlementLines = buildEntitlementSummaryLines([
      {
        code: "AI_INTERVIEW",
        granted: entitlements.AI_INTERVIEW,
        credits: trialState.interviewCreditsRemaining,
      },
      {
        code: "SCREENING",
        granted: entitlements.SCREENING,
        credits: trialState.screeningCreditsRemaining,
      },
      { code: "ASSESSMENT", granted: entitlements.ASSESSMENT },
    ])

    await sendTrialApprovedEmail({
      to: recipient,
      firstName: firstNameFrom(input.name ?? contact.name),
      entitlementLines,
    })

    await markLifecycleEmail(deliveryId, "SENT")
  } catch (error) {
    console.warn("TRIAL_APPROVED email failed", error)
  }
}

export type PurchaseActivationKind = "SUBSCRIPTION" | "BUNDLE" | "ADDON"

/**
 * Called once per successfully-activated payment (never on checkout-created
 * or payment-attempted). The caller (billing.ts) has already determined
 * which of the three kinds this is by diffing pre- vs post-purchase
 * entitlement flags, and passes the resulting entitlement/credit deltas -
 * this function only claims idempotency and renders.
 */
export async function emitPurchaseActivatedEmail(input: {
  kind: PurchaseActivationKind
  organizationId: string
  paymentId: string
  /** Falls back to the org's primary contact when omitted. */
  to?: string | null
  name?: string | null
  /** Entries already scoped to what THIS purchase granted (not the org's full plan). */
  entitlementEntries: Array<{
    code: "AI_INTERVIEW" | "SCREENING" | "ASSESSMENT"
    credits?: number | null
    additional?: boolean
  }>
}) {
  const emailType =
    input.kind === "SUBSCRIPTION" ? "SUBSCRIPTION_ACTIVATED" : input.kind === "BUNDLE" ? "BUNDLE_ACTIVATED" : "ADDON_ACTIVATED"

  try {
    if (input.entitlementEntries.length === 0) {
      // This purchase's plan didn't actually include a module we know how to
      // describe (shouldn't happen for a real plan, but guards against a
      // silent no-op email rather than sending an empty one).
      return
    }

    const deliveryId = await claimLifecycleEmail({
      emailType,
      dedupeKey: input.paymentId,
      organizationId: input.organizationId,
    })

    if (!deliveryId) {
      return
    }

    const contact = !input.to ? await getOrganizationPrimaryContact(input.organizationId) : null
    const recipient = input.to || contact?.email

    if (!recipient) {
      console.warn(`${emailType} email skipped: no recipient email for org`, input.organizationId)
      await markLifecycleEmail(deliveryId, "FAILED", "no recipient email")
      return
    }

    const entitlementLines = buildEntitlementSummaryLines(
      input.entitlementEntries.map((entry) => ({ ...entry, granted: true }))
    )
    const firstName = firstNameFrom(input.name ?? contact?.name)

    if (input.kind === "SUBSCRIPTION") {
      await sendSubscriptionActivatedEmail({ to: recipient, firstName, entitlementLines })
    } else if (input.kind === "BUNDLE") {
      await sendBundleActivatedEmail({ to: recipient, firstName, entitlementLines })
    } else {
      await sendAddonActivatedEmail({ to: recipient, firstName, addonNames: entitlementLines })
    }

    await markLifecycleEmail(deliveryId, "SENT")
  } catch (error) {
    console.warn(`${emailType} email failed`, error)
  }
}
