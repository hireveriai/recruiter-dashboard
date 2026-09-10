import assert from "node:assert/strict"
import test from "node:test"

import { normalizeCurrency, pickGeoCountry, resolveCurrencyFromCountry } from "@/lib/pricing/currency"
import type { CurrencyCode } from "@/lib/pricing/currency"
import { __billingInternals } from "@/lib/server/services/billing"

const {
  getPlanAmount,
  mapPlan,
  calculateQuote,
  resolveTaxCountry,
  assertPaymentAmountsMatch,
  assertCouponUsable,
  assertGatewayAcceptsCurrency,
} = __billingInternals

/*
 * The live commercial ladder.
 * KEEP IN SYNC with db/billing_pricing_ladder_2026_08.sql.
 */
const PLAN_ROWS = {
  starter: { price: 14999, price_inr: 14999, price_usd: 199, price_gbp: 159, price_eur: 179, interviewLimit: 50 },
  growth: { price: 24999, price_inr: 24999, price_usd: 349, price_gbp: 279, price_eur: 319, interviewLimit: 100 },
  scale: { price: 49999, price_inr: 49999, price_usd: 599, price_gbp: 479, price_eur: 549, interviewLimit: 200 },
  expansion: { price: 89999, price_inr: 89999, price_usd: 1199, price_gbp: 949, price_eur: 1099, interviewLimit: 500 },
} as const

type PlanSlug = keyof typeof PLAN_ROWS

/* Test fixtures deliberately use `any`: they stand in for database rows and
   mapped plans whose full shapes are internal to the service. */
function planRow(slug: PlanSlug): any {
  return {
    id: `${slug}-plan`,
    slug,
    name: slug,
    description: "",
    ...PLAN_ROWS[slug],
    screeningCredits: 0,
    planType: "INTERVIEW",
    order: 1,
    isActive: true,
    features: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}

function organization(overrides: Record<string, unknown> = {}): any {
  return {
    organizationId: "org-1",
    organizationName: "Acme",
    userId: "user-1",
    userName: "Rec",
    userEmail: "r@acme.com",
    billingCountryCode: "IN",
    billingCountryConfirmed: false,
    ...overrides,
  }
}

/** Builds the payment row a given quote would have produced. */
function paymentRowFor(plan: any, quote: any, overrides: Record<string, unknown> = {}): any {
  return {
    plan_id: plan.id,
    addon_plan_id: null,
    coupon_id: null,
    original_amount_paise: quote.originalAmountPaise,
    discount_amount_paise: quote.discountAmountPaise,
    discount_percentage: quote.discountPercentage,
    gst_amount_paise: quote.gstAmountPaise,
    gst_percentage: quote.gstPercentage,
    final_amount_paise: quote.finalAmountPaise,
    currency: quote.currency,
    customer_country_code: quote.customerCountryCode,
    tax_treatment: quote.taxTreatment,
    ...overrides,
  }
}

/** The markets under audit, and the currency each must reach. */
const MARKETS: Array<{ label: string; country: string; currency: CurrencyCode }> = [
  { label: "India", country: "IN", currency: "INR" },
  { label: "US", country: "US", currency: "USD" },
  { label: "UK", country: "GB", currency: "GBP" },
  { label: "EU (Germany)", country: "DE", currency: "EUR" },
  { label: "unsupported (Japan)", country: "JP", currency: "USD" },
  { label: "missing geolocation", country: "", currency: "USD" },
]

const ALL_CURRENCIES: CurrencyCode[] = ["INR", "USD", "GBP", "EUR"]

const PROD_TRUST = { trustCloudflare: false, allowHeaderOverride: false }

// ---------------------------------------------------------------------------
// 1. Country to currency, and the geo header trust chain
// ---------------------------------------------------------------------------

test("every market resolves to its intended currency", () => {
  for (const market of MARKETS) {
    assert.equal(
      resolveCurrencyFromCountry(market.country),
      market.currency,
      `${market.label} should be ${market.currency}`
    )
  }
})

test("x-country-code cannot influence currency in production", () => {
  const get = (name: string) => (name === "x-country-code" ? "IN" : null)

  const prod = pickGeoCountry(get, PROD_TRUST)
  assert.equal(prod, "", "a client-supplied x-country-code must be ignored")
  assert.equal(resolveCurrencyFromCountry(prod), "USD", "spoofing must not reach the cheaper INR market")

  // Development keeps the override so local testing still works.
  assert.equal(pickGeoCountry(get, { trustCloudflare: false, allowHeaderOverride: true }), "IN")
})

test("cf-ipcountry is only trusted when Cloudflare actually fronts the app", () => {
  const get = (name: string) => (name === "cf-ipcountry" ? "IN" : null)

  assert.equal(pickGeoCountry(get, PROD_TRUST), "")
  assert.equal(pickGeoCountry(get, { trustCloudflare: true, allowHeaderOverride: false }), "IN")
})

test("the Vercel edge header always wins over spoofable ones", () => {
  const headers: Record<string, string> = {
    "x-vercel-ip-country": "US",
    "cf-ipcountry": "IN",
    "x-country-code": "IN",
  }

  assert.equal(
    pickGeoCountry((name) => headers[name] ?? null, { trustCloudflare: true, allowHeaderOverride: true }),
    "US"
  )
})

test("placeholder country codes are not treated as countries", () => {
  for (const value of ["XX", "T1", "", "   "]) {
    const country = pickGeoCountry((name) => (name === "x-vercel-ip-country" ? value : null), PROD_TRUST)

    assert.equal(country, "", `${JSON.stringify(value)} must not be a country`)
    assert.equal(resolveCurrencyFromCountry(country), "USD")
  }
})

test("missing geolocation resolves to the global fallback, not to India", () => {
  const country = pickGeoCountry(() => null, PROD_TRUST)

  assert.equal(country, "")
  assert.equal(resolveCurrencyFromCountry(country), "USD", "must match the landing app for the same request")
})

test("a VPN moves the market but keeps display and charge in step", () => {
  // An Indian user on a US exit node. Both apps read the same header and both
  // answer USD, so the price shown is still the price charged.
  const viaUsExit = pickGeoCountry((name) => (name === "x-vercel-ip-country" ? "US" : null), PROD_TRUST)

  assert.equal(resolveCurrencyFromCountry(viaUsExit), "USD")
})

// ---------------------------------------------------------------------------
// 2. Plan amount resolution per currency
// ---------------------------------------------------------------------------

test("each plan resolves to its ladder price in every currency", () => {
  const expected: Record<CurrencyCode, Record<PlanSlug, number>> = {
    INR: { starter: 14999, growth: 24999, scale: 49999, expansion: 89999 },
    USD: { starter: 199, growth: 349, scale: 599, expansion: 1199 },
    GBP: { starter: 159, growth: 279, scale: 479, expansion: 949 },
    EUR: { starter: 179, growth: 319, scale: 549, expansion: 1099 },
  }

  for (const currency of ALL_CURRENCIES) {
    for (const slug of Object.keys(PLAN_ROWS) as PlanSlug[]) {
      assert.equal(getPlanAmount(planRow(slug), currency), expected[currency][slug], `${slug} in ${currency}`)
    }
  }
})

test("mapPlan carries the requested currency into minor units", () => {
  const plan = mapPlan(planRow("growth"), "GBP")

  assert.equal(plan.currency, "GBP")
  assert.equal(plan.amountPaise, 27900, "GBP 279 is 27900 minor units")
})

// ---------------------------------------------------------------------------
// 3. REGRESSION: GBP and EUR must survive payment verification
// ---------------------------------------------------------------------------

test("REGRESSION: stored currency round-trips instead of collapsing to INR", () => {
  for (const currency of ALL_CURRENCIES) {
    assert.equal(normalizeCurrency(currency), currency, `${currency} must survive normalization`)
  }

  // The expression this replaced, for contrast.
  const collapsed = (stored: string) => (stored === "USD" ? "USD" : "INR")

  assert.equal(collapsed("GBP"), "INR", "documents the old behaviour")
  assert.notEqual(normalizeCurrency("GBP"), collapsed("GBP"), "and that it is gone")
})

test("REGRESSION: a GBP payment reconciles against the GBP plan price", () => {
  const plan = mapPlan(planRow("growth"), "GBP")
  const quote = calculateQuote(plan, null, null, "GB")
  const payment = paymentRowFor(plan, quote)

  // Re-derive exactly as validatePendingPaymentAgainstCurrentDb now does.
  const paymentCurrency = normalizeCurrency(payment.currency)
  assert.equal(paymentCurrency, "GBP")

  const replanned = mapPlan(planRow("growth"), paymentCurrency as CurrencyCode)
  const requote = calculateQuote(replanned, null, null, payment.customer_country_code)

  assert.doesNotThrow(() =>
    assertPaymentAmountsMatch(payment, { plan: replanned, addonPlan: null, coupon: null, quote: requote })
  )
})

test("REGRESSION: the old collapse would have rejected that same GBP payment", () => {
  const plan = mapPlan(planRow("growth"), "GBP")
  const quote = calculateQuote(plan, null, null, "GB")
  const payment = paymentRowFor(plan, quote)

  // The old path: GBP became INR.
  const collapsedPlan = mapPlan(planRow("growth"), "INR")
  const collapsedQuote = calculateQuote(collapsedPlan, null, null, "GB")

  assert.throws(
    () =>
      assertPaymentAmountsMatch(payment, {
        plan: collapsedPlan,
        addonPlan: null,
        coupon: null,
        quote: collapsedQuote,
      }),
    /no longer matches/,
    "this is the bug the fix removes"
  )
})

test("every market survives quote to payment to re-validation", () => {
  for (const market of MARKETS) {
    const country = market.country || "US"
    const plan = mapPlan(planRow("expansion"), market.currency)
    const quote = calculateQuote(plan, null, null, country)
    const payment = paymentRowFor(plan, quote)

    const recovered = normalizeCurrency(payment.currency)
    assert.equal(recovered, market.currency, `${market.label}: currency must round-trip`)

    const replanned = mapPlan(planRow("expansion"), recovered as CurrencyCode)
    const requote = calculateQuote(replanned, null, null, payment.customer_country_code)

    assert.doesNotThrow(
      () => assertPaymentAmountsMatch(payment, { plan: replanned, addonPlan: null, coupon: null, quote: requote }),
      `${market.label}: activation must not be blocked`
    )
  }
})

test("an unrecognised stored currency is refused rather than re-priced", () => {
  for (const value of ["JPY", "AUD", "", "inr ", null, undefined, 42]) {
    assert.equal(normalizeCurrency(value === "inr " ? "JPY" : value), null)
  }
})

// ---------------------------------------------------------------------------
// 4. Billing and tax country
// ---------------------------------------------------------------------------

test("an unconfirmed organization is NOT treated as an Indian billing customer", () => {
  const resolved = resolveTaxCountry(organization({ billingCountryCode: "IN" }), "US")

  assert.equal(resolved.confirmed, false)
  assert.equal(resolved.countryCode, "US", "uses the geo hint for the preview, not the IN column default")
  assert.equal(resolved.suggestedCountryCode, "US")
})

test("a confirmed billing country wins over geo", () => {
  // A UK-registered company whose finance lead is browsing from India.
  const resolved = resolveTaxCountry(
    organization({ billingCountryCode: "GB", billingCountryConfirmed: true }),
    "IN"
  )

  assert.equal(resolved.confirmed, true)
  assert.equal(resolved.countryCode, "GB", "geo must never override a declared tax country")
  assert.equal(resolved.suggestedCountryCode, null)
})

test("geo is never promoted to a confirmed tax country on its own", () => {
  for (const geo of ["US", "GB", "DE", "IN", ""]) {
    const resolved = resolveTaxCountry(organization(), geo)
    assert.equal(resolved.confirmed, false, `${geo || "(none)"} must stay unconfirmed`)
  }
})

test("India keeps domestic GST once confirmed", () => {
  const plan = mapPlan(planRow("growth"), "INR")
  const resolved = resolveTaxCountry(organization({ billingCountryConfirmed: true }), "IN")
  const quote = calculateQuote(plan, null, null, resolved.countryCode)

  assert.equal(quote.taxTreatment, "DOMESTIC_GST")
  assert.equal(quote.gstPercentage, 18)
  assert.equal(quote.originalAmountPaise, 2499900)
  assert.equal(quote.gstAmountPaise, 449982)
  assert.equal(quote.finalAmountPaise, 2949882, "INR 24,999 + 18% = INR 29,498.82")
})

test("a confirmed non-Indian customer is not treated as domestic", () => {
  for (const [country, currency] of [
    ["US", "USD"],
    ["GB", "GBP"],
    ["DE", "EUR"],
  ] as Array<[string, CurrencyCode]>) {
    const plan = mapPlan(planRow("growth"), currency)
    const quote = calculateQuote(plan, null, null, country)

    assert.notEqual(quote.taxTreatment, "DOMESTIC_GST", `${country} must not be domestic`)
    assert.equal(quote.currency, currency)
    assert.equal(quote.customerCountryCode, country)
  }
})

test("export under LUT removes tax entirely for non-Indian customers", () => {
  const previous = process.env.BILLING_EXPORT_UNDER_LUT
  process.env.BILLING_EXPORT_UNDER_LUT = "true"

  try {
    const plan = mapPlan(planRow("growth"), "GBP")
    const quote = calculateQuote(plan, null, null, "GB")

    assert.equal(quote.taxTreatment, "EXPORT_UNDER_LUT")
    assert.equal(quote.gstAmountPaise, 0)
    assert.equal(quote.finalAmountPaise, quote.originalAmountPaise, "GBP 279 is charged as GBP 279")

    // India is unaffected by the export switch.
    const inrPlan = mapPlan(planRow("growth"), "INR")
    const inrQuote = calculateQuote(inrPlan, null, null, "IN")
    assert.equal(inrQuote.taxTreatment, "DOMESTIC_GST")
    assert.equal(inrQuote.gstPercentage, 18)
  } finally {
    if (previous === undefined) delete process.env.BILLING_EXPORT_UNDER_LUT
    else process.env.BILLING_EXPORT_UNDER_LUT = previous
  }
})

// ---------------------------------------------------------------------------
// 5. Gateway currency support
// ---------------------------------------------------------------------------

test("a currency the account cannot settle is refused, not silently swapped", () => {
  const previous = process.env.RAZORPAY_SUPPORTED_CURRENCIES
  process.env.RAZORPAY_SUPPORTED_CURRENCIES = "INR,USD"

  try {
    assert.doesNotThrow(() => assertGatewayAcceptsCurrency("INR"))
    assert.doesNotThrow(() => assertGatewayAcceptsCurrency("USD"))
    assert.throws(() => assertGatewayAcceptsCurrency("GBP"), /not enabled/)
    assert.throws(() => assertGatewayAcceptsCurrency("EUR"), /not enabled/)
  } finally {
    if (previous === undefined) delete process.env.RAZORPAY_SUPPORTED_CURRENCIES
    else process.env.RAZORPAY_SUPPORTED_CURRENCIES = previous
  }
})

test("all four currencies are accepted by default", () => {
  for (const currency of ALL_CURRENCIES) {
    assert.doesNotThrow(() => assertGatewayAcceptsCurrency(currency))
  }
})

// ---------------------------------------------------------------------------
// 6. Coupons
// ---------------------------------------------------------------------------

function coupon(overrides: Record<string, unknown> = {}): any {
  return {
    id: "coupon-1",
    code: "LAUNCH40",
    description: "",
    discountPercentage: 40,
    maxGlobalUses: null,
    currentGlobalUses: 0,
    isActive: true,
    startsAt: null,
    expiresAt: null,
    applicablePlanIds: [],
    minimumAmountPaise: null,
    minimumAmountCurrency: "INR",
    metadata: {},
    ...overrides,
  }
}

test("a coupon with no minimum spend applies in every currency", () => {
  for (const currency of ALL_CURRENCIES) {
    const plan = mapPlan(planRow("growth"), currency)

    assert.doesNotThrow(
      () => assertCouponUsable({ coupon: coupon(), plan, organizationAlreadyUsed: false }),
      `${currency} must be able to use a coupon with no minimum`
    )
  }
})

test("a coupon WITH a minimum spend is scoped to that minimum's currency", () => {
  const scoped = coupon({ minimumAmountPaise: 1000000, minimumAmountCurrency: "INR" })

  assert.doesNotThrow(() =>
    assertCouponUsable({ coupon: scoped, plan: mapPlan(planRow("growth"), "INR"), organizationAlreadyUsed: false })
  )
  assert.throws(
    () =>
      assertCouponUsable({ coupon: scoped, plan: mapPlan(planRow("growth"), "GBP"), organizationAlreadyUsed: false }),
    /can only be used on INR orders/
  )
})

// ---------------------------------------------------------------------------
// 7. Tampering
// ---------------------------------------------------------------------------

test("the charged amount comes from the plan row, never from the caller", () => {
  const plan = mapPlan(planRow("expansion"), "USD")
  assert.equal(plan.amountPaise, 119900, "USD 1,199 from price_usd")

  // Extra fields on the row that are not price columns change nothing.
  const forged = { ...planRow("expansion"), amountPaise: 1, price: 1, finalAmountPaise: 1 }
  assert.equal(mapPlan(forged, "USD").amountPaise, 119900)
})

test("a tampered payment amount fails reconciliation", () => {
  const plan = mapPlan(planRow("growth"), "USD")
  const quote = calculateQuote(plan, null, null, "US")
  const tampered = paymentRowFor(plan, quote, { original_amount_paise: 100, final_amount_paise: 100 })

  assert.throws(
    () => assertPaymentAmountsMatch(tampered, { plan, addonPlan: null, coupon: null, quote }),
    /no longer matches/
  )
})

test("swapping the plan on a pending payment is rejected", () => {
  const plan = mapPlan(planRow("expansion"), "USD")
  const quote = calculateQuote(plan, null, null, "US")
  const payment = paymentRowFor(plan, quote, { plan_id: "starter-plan" })

  assert.throws(
    () => assertPaymentAmountsMatch(payment, { plan, addonPlan: null, coupon: null, quote }),
    /does not match/
  )
})

test("a currency swap between order and verification is rejected", () => {
  const plan = mapPlan(planRow("growth"), "GBP")
  const quote = calculateQuote(plan, null, null, "GB")
  const payment = paymentRowFor(plan, quote, { currency: "INR" })

  assert.throws(
    () => assertPaymentAmountsMatch(payment, { plan, addonPlan: null, coupon: null, quote }),
    /no longer matches/
  )
})

test("a tax-country swap between order and verification is rejected", () => {
  const plan = mapPlan(planRow("growth"), "USD")
  const quote = calculateQuote(plan, null, null, "US")
  const payment = paymentRowFor(plan, quote, { customer_country_code: "IN" })

  assert.throws(
    () => assertPaymentAmountsMatch(payment, { plan, addonPlan: null, coupon: null, quote }),
    /no longer matches/
  )
})
