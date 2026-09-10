/**
 * Request-scoped currency resolution for the recruiter app.
 *
 * The pure helpers (country mapping, header selection, validation, formatting)
 * live in lib/pricing/currency.ts so client components can use them too; this
 * module adds the parts that need a Request. Re-exported here so existing
 * server-side imports keep working from one path.
 */

import { pickGeoCountry, resolveCurrencyFromCountry, type CurrencyCode } from "@/lib/pricing/currency"

export {
  SUPPORTED_CURRENCIES,
  FALLBACK_CURRENCY,
  normalizeCurrency,
  resolveCurrencyFromCountry,
  formatMinorAmount,
  pickGeoCountry,
  type CurrencyCode,
} from "@/lib/pricing/currency"

/**
 * Header trust for this deployment. The rules themselves live in
 * pickGeoCountry, shared with the landing app so the two cannot drift.
 */
export function geoHeaderTrust() {
  return {
    trustCloudflare: process.env.TRUST_CLOUDFLARE_GEO === "true",
    allowHeaderOverride:
      process.env.NODE_ENV !== "production" || process.env.ALLOW_HEADER_COUNTRY_OVERRIDE === "true",
  }
}

/**
 * Reads the visitor's country from CDN-injected geo headers.
 *
 * Returns "" when nothing trustworthy is present, which callers treat as
 * "unknown" rather than as any particular country. Before the trust gate,
 * `x-country-code` — a header any client can set — was consulted in
 * production. It was unreachable in practice because Vercel always sets its
 * own header first, but "unreachable" is a deployment detail, not a guarantee,
 * and a spoofable header must not sit in the trust chain of a price.
 */
export function getRequestCountry(request: Request): string {
  return pickGeoCountry((name) => request.headers.get(name), geoHeaderTrust())
}

/**
 * The currency a checkout is actually transacted in.
 *
 * Derived ONLY from the edge geo headers — never from a cookie, query string
 * or request body. List prices are localized commercial prices rather than
 * conversions of one another, so letting the client choose would let anyone
 * pick whichever market is cheapest.
 *
 * An unknown country resolves to the global fallback (USD), which is the same
 * answer the landing app gives for the same request.
 */
export function resolveCheckoutCurrency(request: Request): CurrencyCode {
  return resolveCurrencyFromCountry(getRequestCountry(request))
}
