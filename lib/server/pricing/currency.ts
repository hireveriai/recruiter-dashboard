/**
 * Request-scoped currency resolution for the recruiter app.
 *
 * The pure helpers (country mapping, validation, formatting) live in
 * lib/pricing/currency.ts so client components can use them too; this module
 * adds the parts that need a Request. Re-exported here so existing server-side
 * imports keep working from one path.
 */

import { resolveCurrencyFromCountry, type CurrencyCode } from "@/lib/pricing/currency"

export {
  SUPPORTED_CURRENCIES,
  FALLBACK_CURRENCY,
  normalizeCurrency,
  resolveCurrencyFromCountry,
  formatMinorAmount,
  type CurrencyCode,
} from "@/lib/pricing/currency"

/**
 * Reads the visitor's country from CDN-injected geo headers.
 *
 * These are set by the edge, not by the page, so they are the one location
 * signal a browser cannot forge by editing a cookie or a request body.
 */
export function getRequestCountry(request: Request): string {
  return (
    request.headers.get("x-vercel-ip-country") ||
    request.headers.get("cf-ipcountry") ||
    request.headers.get("x-country-code") ||
    ""
  ).toUpperCase()
}

/**
 * The currency a checkout is actually transacted in.
 *
 * Derived ONLY from the edge geo headers — never from a cookie, query string
 * or request body. List prices are localized commercial prices rather than
 * conversions of one another, so letting the client choose would let anyone
 * pick whichever market is cheapest.
 */
export function resolveCheckoutCurrency(request: Request): CurrencyCode {
  return resolveCurrencyFromCountry(getRequestCountry(request))
}
