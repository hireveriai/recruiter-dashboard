/**
 * Pure currency helpers — no request, no server-only imports, safe in client
 * components.
 *
 * Mirrors the landing app's resolver so both surfaces agree on which country
 * maps to which currency and on how an amount is displayed. Request-scoped
 * resolution lives in lib/server/pricing/currency.ts.
 */

export const SUPPORTED_CURRENCIES = ["INR", "USD", "GBP", "EUR"] as const

export type CurrencyCode = (typeof SUPPORTED_CURRENCIES)[number]

export const FALLBACK_CURRENCY: CurrencyCode = "USD"

const EUROZONE_COUNTRIES = new Set([
  "AT", "BE", "HR", "CY", "EE", "FI", "FR", "DE", "GR", "IE",
  "IT", "LV", "LT", "LU", "MT", "NL", "PT", "SK", "SI", "ES",
])

const GBP_COUNTRIES = new Set(["GB", "UK"])

export function resolveCurrencyFromCountry(country: string | null | undefined): CurrencyCode {
  const normalized = (country ?? "").trim().toUpperCase()

  if (normalized === "IN") return "INR"
  if (GBP_COUNTRIES.has(normalized)) return "GBP"
  if (EUROZONE_COUNTRIES.has(normalized)) return "EUR"
  if (normalized === "US") return "USD"

  return FALLBACK_CURRENCY
}

export function normalizeCurrency(value: unknown): CurrencyCode | null {
  if (typeof value !== "string") return null

  const normalized = value.trim().toUpperCase()

  return (SUPPORTED_CURRENCIES as readonly string[]).includes(normalized)
    ? (normalized as CurrencyCode)
    : null
}

/**
 * Locale per currency, matching the landing app so a price reads identically
 * on the pricing page and at checkout.
 *
 * en-IE for EUR because the German convention ("1.099 €") puts the symbol
 * last; en-IN only for INR, since Indian lakh grouping applied to USD/GBP/EUR
 * would render "$1,29,999".
 */
const CURRENCY_LOCALES: Record<CurrencyCode, string> = {
  INR: "en-IN",
  USD: "en-US",
  GBP: "en-GB",
  EUR: "en-IE",
}

/**
 * Formats an amount held in minor units (paise/cents).
 *
 * Whole amounts render without decimals so a plan price matches the pricing
 * page exactly (£159, not £159.00); tax lines carrying fractions still show
 * them. Pass maximumFractionDigits: 0 to round derived figures — per-unit
 * costs, for instance — to whole currency units.
 */
export function formatMinorAmount(
  minorUnits: number,
  currency: string,
  options: { minimumFractionDigits?: number; maximumFractionDigits?: number } = {}
): string {
  const code = normalizeCurrency(currency) ?? FALLBACK_CURRENCY
  const amount = Number(minorUnits || 0) / 100
  const maximumFractionDigits = options.maximumFractionDigits ?? 2
  const minimumFractionDigits = Math.min(options.minimumFractionDigits ?? 0, maximumFractionDigits)

  try {
    return new Intl.NumberFormat(CURRENCY_LOCALES[code], {
      style: "currency",
      currency: code,
      minimumFractionDigits,
      maximumFractionDigits,
    }).format(amount)
  } catch {
    return `${code} ${amount.toFixed(maximumFractionDigits)}`
  }
}
