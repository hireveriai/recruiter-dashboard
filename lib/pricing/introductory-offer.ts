import type { CurrencyCode } from "@/lib/pricing/currency"

/**
 * Introductory launch pricing.
 *
 * `hireveri_plans.price_*` stays the amount actually charged. The figures here
 * are the *regular* prices the plans move to once the introductory period ends
 * — they are shown struck through so a buyer can see what the price becomes,
 * not a decorative anchor. Keep them accurate: if a plan is never sold at its
 * regular price, the strikethrough stops being a truthful claim.
 *
 * To end the offer: raise `hireveri_plans.price_*` to the regular figures and
 * delete that slug from INTRODUCTORY_PRICING below. The strikethrough then
 * disappears on its own, because a regular price that is not above the charged
 * price is never displayed.
 */

export const INTRODUCTORY_OFFER_LABEL = "Introductory price"

export const INTRODUCTORY_OFFER_NOTE =
  "Limited time offer — prices move to the regular rate when it ends."

type RegularPricing = Record<CurrencyCode, number>

/**
 * Regular prices in major units (rupees, dollars, pounds, euros) — not minor
 * units. INR is the confirmed launch decision; the other currencies carry the
 * same per-tier uplift, rounded to clean price points, so the offer reads
 * consistently whichever market a buyer is in.
 */
export const INTRODUCTORY_PRICING: Record<string, RegularPricing> = {
  starter: { INR: 19999, USD: 279, GBP: 219, EUR: 249 },
  growth: { INR: 34999, USD: 499, GBP: 399, EUR: 449 },
  scale: { INR: 59999, USD: 749, GBP: 599, EUR: 699 },
  expansion: { INR: 99999, USD: 1349, GBP: 1099, EUR: 1249 },
}

function normalize(currency: string): CurrencyCode {
  const code = currency?.trim().toUpperCase()

  return code === "USD" || code === "GBP" || code === "EUR" ? code : "INR"
}

/**
 * Regular price for a plan in minor units, or null when the plan carries no
 * introductory offer or the regular price is not above what is charged today.
 */
export function getRegularAmountPaise(
  slug: string,
  currency: string,
  chargedAmountPaise: number
): number | null {
  const regular = INTRODUCTORY_PRICING[slug]

  if (!regular) {
    return null
  }

  const regularPaise = Math.round(regular[normalize(currency)] * 100)

  // Never show a strikethrough that is not an actual reduction.
  return regularPaise > chargedAmountPaise ? regularPaise : null
}
