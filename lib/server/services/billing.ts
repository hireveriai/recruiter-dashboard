import { createHmac, randomUUID, timingSafeEqual } from "crypto"

import { Prisma } from "@prisma/client"
import Razorpay from "razorpay"

import type { RecruiterRequestContext } from "@/lib/server/auth-context"
import { ApiError } from "@/lib/server/errors"
import { prisma } from "@/lib/server/prisma"
import { FALLBACK_CURRENCY, normalizeCurrency, type CurrencyCode } from "@/lib/server/pricing/currency"
import { createAndSendInvoiceForPayment } from "@/lib/server/services/invoices"

const PLAN_SLUG_REGEX = /^[a-z0-9][a-z0-9-]{1,80}$/
const RAZORPAY_MINIMUM_AMOUNT_PAISE = 100
const DEFAULT_GST_PERCENTAGE = 18
/** How long purchased credits stay usable. See the activation update below. */
const CREDIT_VALIDITY_MONTHS = 12

type QueryClient = typeof prisma | Prisma.TransactionClient

type MetadataJson = Record<string, unknown>

type PlanRow = {
  id: string
  slug: string
  name: string
  description: string | null
  price: number
  price_inr: number
  price_usd: number
  price_gbp: number | null
  price_eur: number | null
  interviewLimit: number
  screeningCredits: number
  planType: string
  order: number
  isActive: boolean
  features: unknown
  createdAt: Date
  updatedAt: Date
}

type CouponRow = {
  id: string
  code: string
  description: string | null
  discount_percentage: number
  max_global_uses: number | null
  current_global_uses: number
  is_active: boolean
  starts_at: Date | null
  expires_at: Date | null
  applicable_plan_ids: string[] | null
  minimum_amount_paise: number | null
  minimum_amount_currency: string
  metadata_json: unknown
}

type BillingOrganizationRow = {
  organization_id: string
  organization_name: string | null
  user_id: string
  full_name: string | null
  first_name: string | null
  last_name: string | null
  email: string | null
  billing_country_code: string
  billing_country_confirmed_at: Date | null
}

type PaymentRow = {
  id: string
  organization_id: string
  user_id: string
  plan_id: string
  addon_plan_id: string | null
  coupon_id: string | null
  coupon_code: string | null
  original_amount_paise: number
  discount_percentage: number
  discount_amount_paise: number
  gst_percentage: number
  gst_amount_paise: number
  final_amount_paise: number
  currency: string
  status: "pending" | "success" | "failed" | "cancelled"
  razorpay_order_id: string
  razorpay_payment_id: string | null
  subscription_id: string
  customer_country_code: string
  tax_treatment: string
}

type RazorpayPayment = {
  id?: string
  order_id?: string
  amount?: number | string
  currency?: string
  status?: string
  captured?: boolean
  [key: string]: unknown
}

type CheckoutQuote = {
  originalAmountPaise: number
  discountPercentage: number
  discountAmountPaise: number
  taxableAmountPaise: number
  gstPercentage: number
  gstAmountPaise: number
  finalAmountPaise: number
  currency: CurrencyCode
  customerCountryCode: string
  taxTreatment: "DOMESTIC_GST" | "EXPORT_WITH_IGST" | "EXPORT_UNDER_LUT"
}

type PaymentValidation = {
  plan: ReturnType<typeof mapPlan>
  addonPlan: ReturnType<typeof mapPlan> | null
  coupon: ReturnType<typeof mapCoupon> | null
  quote: CheckoutQuote
}

let razorpayClient: Razorpay | null = null

function normalizeMetadata(value: unknown): MetadataJson {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as MetadataJson
  }

  return {}
}

function toNumber(value: unknown, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function getGstPercentage() {
  const configured = toNumber(process.env.BILLING_GST_PERCENTAGE, DEFAULT_GST_PERCENTAGE)
  return Math.max(0, configured)
}

function normalizeCouponCode(value: unknown) {
  return typeof value === "string" ? value.trim().toUpperCase() : ""
}

function validatePlanSlug(slug: string) {
  const normalized = slug.trim().toLowerCase()

  if (!PLAN_SLUG_REGEX.test(normalized)) {
    throw new ApiError(400, "INVALID_PLAN", "Selected plan is invalid")
  }

  return normalized
}

function getRazorpayKeyId() {
  const keyId = process.env.RAZORPAY_KEY_ID || process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID

  if (!keyId) {
    throw new ApiError(500, "RAZORPAY_KEY_ID_MISSING", "Razorpay key id is not configured")
  }

  return keyId
}

function getRazorpayKeySecret() {
  const keySecret = process.env.RAZORPAY_KEY_SECRET

  if (!keySecret) {
    throw new ApiError(500, "RAZORPAY_KEY_SECRET_MISSING", "Razorpay key secret is not configured")
  }

  return keySecret
}

function getRazorpayClient() {
  if (!razorpayClient) {
    razorpayClient = new Razorpay({
      key_id: getRazorpayKeyId(),
      key_secret: getRazorpayKeySecret(),
    })
  }

  return razorpayClient
}

/**
 * Picks the list price column for a currency, in major units.
 *
 * Falls back to USD when a plan has no price in the requested currency, so a
 * newly added plan can never be charged at zero. The legacy `price` column is
 * the last resort only; both price_inr and price_usd are NOT NULL today, so
 * it is unreachable in practice.
 */
function getPlanAmount(plan: PlanRow, currency: CurrencyCode): number {
  const byCurrency: Record<CurrencyCode, number | null | undefined> = {
    INR: plan.price_inr,
    USD: plan.price_usd,
    GBP: plan.price_gbp,
    EUR: plan.price_eur,
  }

  const requested = byCurrency[currency]
  const resolved = requested ?? byCurrency[FALLBACK_CURRENCY] ?? plan.price

  return Number(resolved ?? 0)
}

function mapPlan(plan: PlanRow, currency: CurrencyCode = FALLBACK_CURRENCY) {
  const features = Array.isArray(plan.features)
    ? plan.features.filter((feature): feature is string => typeof feature === "string")
    : []
  // Named "paise" historically; it is simply the amount in minor units, which
  // is what Razorpay expects for every currency.
  const amountPaise = getPlanAmount(plan, currency) * 100
  const metadata = {
    features,
    plan_type: plan.planType ?? "INTERVIEW",
  }

  return {
    id: plan.id,
    slug: plan.slug,
    name: plan.name,
    description: plan.description ?? "",
    amountPaise,
    currency,
    interviewSessions: Number(plan.interviewLimit ?? 0),
    screeningReviews: Number(plan.screeningCredits ?? 0),
    planType: plan.planType ?? "INTERVIEW",
    isActive: Boolean(plan.isActive),
    isPopular: plan.slug === "growth",
    displayOrder: Number(plan.order ?? 0),
    monthlyAmountPaise: amountPaise,
    yearlyAmountPaise: null,
    metadata,
    features,
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
  }
}

function mapCoupon(coupon: CouponRow) {
  return {
    id: coupon.id,
    code: coupon.code,
    description: coupon.description ?? "",
    discountPercentage: Number(coupon.discount_percentage),
    maxGlobalUses: coupon.max_global_uses === null ? null : Number(coupon.max_global_uses),
    currentGlobalUses: Number(coupon.current_global_uses ?? 0),
    isActive: Boolean(coupon.is_active),
    startsAt: coupon.starts_at,
    expiresAt: coupon.expires_at,
    applicablePlanIds: Array.isArray(coupon.applicable_plan_ids) ? coupon.applicable_plan_ids : [],
    minimumAmountPaise: coupon.minimum_amount_paise === null ? null : Number(coupon.minimum_amount_paise),
    minimumAmountCurrency: coupon.minimum_amount_currency,
    metadata: normalizeMetadata(coupon.metadata_json),
  }
}

function buildCheckoutPlan(
  plan: ReturnType<typeof mapPlan>,
  addonPlan: ReturnType<typeof mapPlan> | null
) {
  if (!addonPlan) {
    return plan
  }

  return {
    ...plan,
    name: `${plan.name} + ${addonPlan.name}`,
    description: `${plan.description}${plan.description ? " " : ""}Includes ${addonPlan.screeningReviews} additional VERIS Screening reviews.`,
    amountPaise: plan.amountPaise + addonPlan.amountPaise,
    monthlyAmountPaise: plan.monthlyAmountPaise + addonPlan.monthlyAmountPaise,
    interviewSessions: plan.interviewSessions + addonPlan.interviewSessions,
    screeningReviews: plan.screeningReviews + addonPlan.screeningReviews,
    features: [...plan.features, ...addonPlan.features],
    metadata: {
      ...plan.metadata,
      addon_plan_id: addonPlan.id,
      addon_plan_slug: addonPlan.slug,
      addon_plan_name: addonPlan.name,
    },
  }
}

/**
 * `customerCountryCode` is required and has no default.
 *
 * It used to default to "IN", which meant any caller that forgot to pass one
 * quietly produced an Indian-GST quote. Tax treatment is too consequential to
 * be a parameter default — callers must say whose country they mean.
 */
function calculateQuote(
  plan: ReturnType<typeof mapPlan>,
  coupon: ReturnType<typeof mapCoupon> | null,
  addonPlan: ReturnType<typeof mapPlan> | null,
  customerCountryCode: string
): CheckoutQuote {
  const checkoutPlan = buildCheckoutPlan(plan, addonPlan)
  const originalAmountPaise = Number(checkoutPlan.amountPaise)
  const discountPercentage = coupon ? Number(coupon.discountPercentage) : 0
  const discountAmountPaise = coupon
    ? Math.min(originalAmountPaise, Math.round((originalAmountPaise * discountPercentage) / 100))
    : 0
  const taxableAmountPaise = Math.max(0, originalAmountPaise - discountAmountPaise)
  const normalizedCountry = customerCountryCode.trim().toUpperCase()
  const isIndia = normalizedCountry === "IN"
  const exportUnderLut = process.env.BILLING_EXPORT_UNDER_LUT === "true"
  const gstPercentage = isIndia || !exportUnderLut ? getGstPercentage() : 0
  const taxTreatment = isIndia
    ? "DOMESTIC_GST"
    : exportUnderLut
      ? "EXPORT_UNDER_LUT"
      : "EXPORT_WITH_IGST"
  const gstAmountPaise = Math.round((taxableAmountPaise * gstPercentage) / 100)
  const finalAmountPaise = taxableAmountPaise + gstAmountPaise

  return {
    originalAmountPaise,
    discountPercentage,
    discountAmountPaise,
    taxableAmountPaise,
    gstPercentage,
    gstAmountPaise,
    finalAmountPaise,
    currency: checkoutPlan.currency,
    customerCountryCode: normalizedCountry,
    taxTreatment,
  }
}

function buildPublicQuoteResponse(input: {
  plan: ReturnType<typeof mapPlan>
  addonPlan?: ReturnType<typeof mapPlan> | null
  coupon: ReturnType<typeof mapCoupon> | null
  quote: CheckoutQuote
  organization?: ReturnType<typeof mapBillingOrganization>
  billingCountryConfirmationRequired?: boolean
  suggestedBillingCountryCode?: string | null
}) {
  return {
    plan: input.plan,
    addonPlan: input.addonPlan ?? null,
    coupon: input.coupon
      ? {
          code: input.coupon.code,
          description: input.coupon.description,
          discountPercentage: input.coupon.discountPercentage,
        }
      : null,
    quote: input.quote,
    billingCountryConfirmationRequired: input.billingCountryConfirmationRequired ?? false,
    suggestedBillingCountryCode: input.suggestedBillingCountryCode ?? null,
    ...(input.organization ? { organization: input.organization } : {}),
  }
}

function mapBillingOrganization(row: BillingOrganizationRow) {
  const fallbackName = [row.first_name, row.last_name].filter(Boolean).join(" ").trim()

  return {
    organizationId: row.organization_id,
    organizationName: row.organization_name ?? "Your organization",
    userId: row.user_id,
    userName: row.full_name || fallbackName || "Recruiter",
    userEmail: row.email ?? "",
    billingCountryCode: row.billing_country_code,
    /* billing_country_code carries a 'IN' default from migration 010, so a
       value in it is not evidence anyone chose it. Only the timestamp is. */
    billingCountryConfirmed: row.billing_country_confirmed_at !== null,
  }
}

async function getPlanRows(client: QueryClient, whereClause = Prisma.empty) {
  return client.$queryRaw<PlanRow[]>(Prisma.sql`
    select
      id,
      slug,
      name,
      description,
      price,
      price_inr,
      price_usd,
      price_gbp,
      price_eur,
      "interviewLimit",
      "screeningCredits",
      "planType",
      "order",
      "isActive",
      features,
      "createdAt",
      "updatedAt"
    from public.hireveri_plans
    ${whereClause}
  `)
}

export async function getActiveBillingPlans(currency: CurrencyCode = FALLBACK_CURRENCY) {
  const rows = await getPlanRows(
    prisma,
    Prisma.sql`
      where "isActive" = true
        and "planType" in ('INTERVIEW', 'SCREENING')
      order by "planType" asc, "order" asc
    `
  )

  return rows.map((row) => mapPlan(row, currency))
}

export async function getActiveBillingPlanBySlug(slug: string, client: QueryClient = prisma, currency: CurrencyCode = FALLBACK_CURRENCY) {
  const normalizedSlug = validatePlanSlug(slug)
  const rows = await getPlanRows(
    client,
    Prisma.sql`
      where slug = ${normalizedSlug}
        and "isActive" = true
        and "planType" in ('INTERVIEW', 'SCREENING')
      limit 1
    `
  )

  return rows[0] ? mapPlan(rows[0], currency) : null
}

async function getOptionalAddonPlanBySlug(slug: string | null | undefined, client: QueryClient = prisma, currency: CurrencyCode = FALLBACK_CURRENCY) {
  const normalizedSlug = typeof slug === "string" && slug.trim() ? slug.trim().toLowerCase() : ""

  if (!normalizedSlug) {
    return null
  }

  const addonPlan = await getActiveBillingPlanBySlug(normalizedSlug, client, currency)

  if (!addonPlan) {
    throw new ApiError(404, "ADDON_PLAN_NOT_FOUND", "Selected screening add-on was not found")
  }

  if (addonPlan.planType !== "SCREENING") {
    throw new ApiError(400, "INVALID_ADDON_PLAN", "Selected add-on must be an active VERIS Screening plan")
  }

  return addonPlan
}

function assertPlanBundleAllowed(
  plan: ReturnType<typeof mapPlan>,
  addonPlan: ReturnType<typeof mapPlan> | null
) {
  if (!addonPlan) {
    return
  }

  if (plan.planType === "SCREENING") {
    throw new ApiError(400, "ADDON_NOT_ALLOWED", "Screening add-ons can only be attached to hiring workflow plans")
  }

  if (addonPlan.interviewSessions > 0 || addonPlan.screeningReviews <= 0) {
    throw new ApiError(400, "INVALID_ADDON_PLAN", "Selected add-on is not a valid VERIS Screening capacity plan")
  }
}

async function getActiveBillingPlanById(planId: string, client: QueryClient = prisma, currency: CurrencyCode = FALLBACK_CURRENCY) {
  const rows = await getPlanRows(
    client,
    Prisma.sql`
      where id = ${planId}
        and "isActive" = true
        and "planType" in ('INTERVIEW', 'SCREENING')
      limit 1
    `
  )

  return rows[0] ? mapPlan(rows[0], currency) : null
}

async function getCouponByCode(code: string, client: QueryClient = prisma, lock = false) {
  const couponCode = normalizeCouponCode(code)

  if (!couponCode) {
    return null
  }

  const lockClause = lock ? Prisma.sql`for update` : Prisma.empty
  const rows = await client.$queryRaw<CouponRow[]>(Prisma.sql`
    select
      id::text,
      code,
      description,
      discount_percentage::float8 as discount_percentage,
      max_global_uses,
      current_global_uses,
      is_active,
      starts_at,
      expires_at,
      applicable_plan_ids::text[] as applicable_plan_ids,
      minimum_amount_paise,
      minimum_amount_currency,
      metadata_json
    from public.coupons
    where upper(code) = ${couponCode}
    limit 1
    ${lockClause}
  `)

  return rows[0] ? mapCoupon(rows[0]) : null
}

async function getCouponById(couponId: string, client: QueryClient = prisma, lock = false) {
  const lockClause = lock ? Prisma.sql`for update` : Prisma.empty
  const rows = await client.$queryRaw<CouponRow[]>(Prisma.sql`
    select
      id::text,
      code,
      description,
      discount_percentage::float8 as discount_percentage,
      max_global_uses,
      current_global_uses,
      is_active,
      starts_at,
      expires_at,
      applicable_plan_ids::text[] as applicable_plan_ids,
      minimum_amount_paise,
      minimum_amount_currency,
      metadata_json
    from public.coupons
    where id = ${couponId}::uuid
    limit 1
    ${lockClause}
  `)

  return rows[0] ? mapCoupon(rows[0]) : null
}

async function hasOrganizationUsedCoupon(client: QueryClient, couponId: string, organizationId: string) {
  const rows = await client.$queryRaw<Array<{ exists: boolean }>>(Prisma.sql`
    select exists(
      select 1
      from public.coupon_usages
      where coupon_id = ${couponId}::uuid
        and organization_id = ${organizationId}::uuid
    ) as exists
  `)

  return Boolean(rows[0]?.exists)
}

function assertCouponUsable(input: {
  coupon: ReturnType<typeof mapCoupon>
  plan: ReturnType<typeof mapPlan>
  organizationAlreadyUsed: boolean
  now?: Date
}) {
  const { coupon, plan, organizationAlreadyUsed } = input
  const now = input.now ?? new Date()

  if (!coupon.isActive) {
    throw new ApiError(400, "COUPON_INACTIVE", "Coupon is not active")
  }

  if (coupon.startsAt && coupon.startsAt > now) {
    throw new ApiError(400, "COUPON_NOT_STARTED", "Coupon is not active yet")
  }

  if (coupon.expiresAt && coupon.expiresAt <= now) {
    throw new ApiError(400, "COUPON_EXPIRED", "Coupon has expired")
  }

  if (coupon.maxGlobalUses !== null && coupon.currentGlobalUses >= coupon.maxGlobalUses) {
    throw new ApiError(400, "COUPON_LIMIT_REACHED", "Coupon usage limit has been reached")
  }

  if (organizationAlreadyUsed) {
    throw new ApiError(409, "COUPON_ALREADY_USED", "This organization has already used this coupon")
  }

  /* Only coupons that carry a minimum spend are currency-scoped, and they have
     to be: a "minimum ₹10,000" threshold is meaningless against a USD total.
     A coupon with no minimum — which is every coupon defined today — applies
     in all four currencies. */
  if (coupon.minimumAmountPaise !== null) {
    if (coupon.minimumAmountCurrency !== plan.currency) {
      throw new ApiError(
        400,
        "COUPON_CURRENCY_NOT_APPLICABLE",
        `${coupon.code} can only be used on ${coupon.minimumAmountCurrency} orders, and this order is in ${plan.currency}`
      )
    }

    if (plan.amountPaise < coupon.minimumAmountPaise) {
      throw new ApiError(400, "COUPON_MINIMUM_AMOUNT", "Coupon is not applicable to this plan")
    }
  }

  if (coupon.applicablePlanIds.length > 0 && !coupon.applicablePlanIds.includes(plan.id)) {
    throw new ApiError(400, "COUPON_PLAN_NOT_APPLICABLE", "Coupon is not applicable to this plan")
  }
}

async function resolveCouponForPlan(input: {
  client?: QueryClient
  plan: ReturnType<typeof mapPlan>
  couponCode?: string | null
  couponId?: string | null
  organizationId: string
  lock?: boolean
}) {
  const client = input.client ?? prisma
  const coupon = input.couponId
    ? await getCouponById(input.couponId, client, input.lock)
    : await getCouponByCode(input.couponCode ?? "", client, input.lock)

  if (!coupon) {
    if (input.couponCode || input.couponId) {
      throw new ApiError(404, "COUPON_NOT_FOUND", "Coupon was not found")
    }

    return null
  }

  const organizationAlreadyUsed = await hasOrganizationUsedCoupon(client, coupon.id, input.organizationId)
  assertCouponUsable({
    coupon,
    plan: input.plan,
    organizationAlreadyUsed,
  })

  return coupon
}

/**
 * The country used to calculate tax, and whether it can be trusted.
 *
 * A confirmed billing country is the organization's own assertion of where it
 * is established, and is the only thing tax is ever charged against. When it
 * is unconfirmed we fall back to the request's geo country PURELY so the quote
 * on screen is a plausible preview rather than a wrong Indian-GST one — and
 * mark it provisional. `createRazorpayOrder` refuses to charge in that state.
 *
 * Geo is explicitly NOT treated as a legal or tax country. A VPN, a business
 * trip or a foreign-hosted proxy all move it, and where a request comes from
 * is not where a company is registered. It only ever seeds a suggestion the
 * customer then confirms or corrects.
 */
function resolveTaxCountry(
  organization: ReturnType<typeof mapBillingOrganization>,
  geoCountryCode: string
) {
  if (organization.billingCountryConfirmed) {
    return {
      countryCode: organization.billingCountryCode.trim().toUpperCase(),
      confirmed: true,
      /* Nothing to suggest — they already told us. */
      suggestedCountryCode: null as string | null,
    }
  }

  const suggestion = geoCountryCode.trim().toUpperCase()

  /* Deliberately does NOT fall back to organization.billingCountryCode when
     there is no geo signal. That column still holds migration 010's 'IN'
     default, and using it here would put an Indian-GST figure back on screen
     for a customer we know nothing about — a quieter version of the bug this
     whole path exists to remove. An empty country produces the neutral
     non-domestic treatment instead, and the order is refused either way. */
  return {
    countryCode: suggestion,
    confirmed: false,
    suggestedCountryCode: suggestion || null,
  }
}

/**
 * Currencies this Razorpay account is configured to accept and settle.
 *
 * Razorpay international acceptance is a per-account setting that cannot be
 * read from the SDK, so it is declared here instead of assumed. If the account
 * is not enabled for a currency, an order in it is rejected by the gateway —
 * this turns that into a clear, early refusal rather than a 502 mid-checkout.
 *
 * Defaults to all four so behaviour matches the current intent; narrow it with
 * RAZORPAY_SUPPORTED_CURRENCIES=INR,USD if the account is domestic-only.
 */
function getGatewaySupportedCurrencies(): CurrencyCode[] {
  const configured = (process.env.RAZORPAY_SUPPORTED_CURRENCIES || "INR,USD,GBP,EUR")
    .split(",")
    .map((value) => normalizeCurrency(value))
    .filter((value): value is CurrencyCode => value !== null)

  return configured.length > 0 ? configured : ["INR"]
}

function assertGatewayAcceptsCurrency(currency: CurrencyCode) {
  if (!getGatewaySupportedCurrencies().includes(currency)) {
    /* Deliberately a hard stop, not a silent switch to another currency. The
       whole point of the localized ladder is that the price shown is the price
       charged; quietly billing a UK buyer in USD would break exactly that. */
    throw new ApiError(
      503,
      "CURRENCY_NOT_ACCEPTED",
      `${currency} payments are not enabled on this account. Contact support to complete this purchase.`
    )
  }
}

export async function getBillingOrganization(auth: RecruiterRequestContext) {
  const rows = await prisma.$queryRaw<BillingOrganizationRow[]>(Prisma.sql`
    select
      o.organization_id::text,
      o.organization_name,
      u.user_id::text,
      u.full_name,
      u.first_name,
      u.last_name,
      u.email,
      o.billing_country_code,
      o.billing_country_confirmed_at
    from public.organizations o
    inner join public.users u
      on u.organization_id = o.organization_id
    where o.organization_id = ${auth.organizationId}::uuid
      and u.user_id = ${auth.userId}::uuid
      and o.is_active = true
      and u.is_active = true
      and u.role in ('RECRUITER', 'ADMIN', 'ORG_OWNER')
    limit 1
  `)

  if (!rows[0]) {
    throw new ApiError(403, "ORGANIZATION_ACCESS_DENIED", "Authenticated recruiter is not active in this organization")
  }

  return mapBillingOrganization(rows[0])
}

export async function getCheckoutQuote(input: {
  auth: RecruiterRequestContext
  planSlug: string
  addonPlanSlug?: string | null
  couponCode?: string | null
  /**
   * Transaction currency, resolved server-side from the request's edge geo
   * headers (see resolveCheckoutCurrency). Never taken from the request body,
   * so the browser cannot pick a cheaper market.
   *
   * Required. It used to fall back to `billingCountryCode === "IN" ? "INR" :
   * "USD"`, a path that could never produce GBP or EUR — a trap for the next
   * caller that forgot to pass one.
   */
  currency: CurrencyCode
  /** Request geo country, used only to SUGGEST an unconfirmed billing country. */
  geoCountryCode: string
}) {
  const organization = await getBillingOrganization(input.auth)
  const currency = input.currency
  const plan = await getActiveBillingPlanBySlug(input.planSlug, prisma, currency)

  if (!plan) {
    throw new ApiError(404, "PLAN_NOT_FOUND", "Selected plan was not found")
  }

  const addonPlan = await getOptionalAddonPlanBySlug(input.addonPlanSlug, prisma, currency)
  assertPlanBundleAllowed(plan, addonPlan)
  const checkoutPlan = buildCheckoutPlan(plan, addonPlan)
  const coupon = await resolveCouponForPlan({
    plan: checkoutPlan,
    couponCode: input.couponCode,
    organizationId: organization.organizationId,
  })
  const taxCountry = resolveTaxCountry(organization, input.geoCountryCode)
  const quote = calculateQuote(plan, coupon, addonPlan, taxCountry.countryCode)

  return buildPublicQuoteResponse({
    plan,
    addonPlan,
    coupon,
    quote,
    organization,
    /* The quote is a preview until the organization confirms where it is
       billed. The client shows the confirmation step off this flag; the server
       enforces it independently in createRazorpayOrder. */
    billingCountryConfirmationRequired: !taxCountry.confirmed,
    suggestedBillingCountryCode: taxCountry.suggestedCountryCode,
  })
}

function ensureRazorpayPayableAmount(amountPaise: number) {
  if (amountPaise < RAZORPAY_MINIMUM_AMOUNT_PAISE) {
    throw new ApiError(400, "AMOUNT_BELOW_RAZORPAY_MINIMUM", "Payable amount is below Razorpay minimum")
  }
}

function buildReceiptId() {
  return `hv_${randomUUID().replace(/-/g, "").slice(0, 24)}`
}

export async function createRazorpayOrder(input: {
  auth: RecruiterRequestContext
  planSlug: string
  addonPlanSlug?: string | null
  couponCode?: string | null
  /** See getCheckoutQuote: server-resolved from edge geo headers only. */
  currency: CurrencyCode
  /** Request geo country. Never used as a tax country — see resolveTaxCountry. */
  geoCountryCode: string
}) {
  const organization = await getBillingOrganization(input.auth)
  const currency = input.currency

  /* Refuse before the gateway is touched if this account cannot settle the
     currency the customer was quoted in. Failing here is recoverable; failing
     after Razorpay has taken money is not. */
  assertGatewayAcceptsCurrency(currency)

  const taxCountry = resolveTaxCountry(organization, input.geoCountryCode)

  /* No charge is ever calculated against an assumed tax country. An
     organization that has not asserted where it is billed is asked once, at
     checkout, before any money moves — rather than being silently treated as
     Indian because migration 010 defaulted the column to 'IN'. */
  if (!taxCountry.confirmed) {
    throw new ApiError(
      409,
      "BILLING_COUNTRY_REQUIRED",
      "Confirm your organization's billing country before paying"
    )
  }

  const plan = await getActiveBillingPlanBySlug(input.planSlug, prisma, currency)

  if (!plan) {
    throw new ApiError(404, "PLAN_NOT_FOUND", "Selected plan was not found")
  }

  const addonPlan = await getOptionalAddonPlanBySlug(input.addonPlanSlug, prisma, currency)
  assertPlanBundleAllowed(plan, addonPlan)
  const checkoutPlan = buildCheckoutPlan(plan, addonPlan)
  const coupon = await resolveCouponForPlan({
    plan: checkoutPlan,
    couponCode: input.couponCode,
    organizationId: organization.organizationId,
  })
  const quote = calculateQuote(plan, coupon, addonPlan, taxCountry.countryCode)

  ensureRazorpayPayableAmount(quote.finalAmountPaise)

  const razorpay = getRazorpayClient()
  const receipt = buildReceiptId()
  let order: { id?: string; amount?: number | string; currency?: string }

  try {
    order = (await razorpay.orders.create({
      amount: quote.finalAmountPaise,
      currency: quote.currency,
      receipt,
      notes: {
        organization_id: organization.organizationId,
        user_id: organization.userId,
        plan_id: plan.id,
        plan_slug: plan.slug,
        addon_plan_id: addonPlan?.id ?? "",
        addon_plan_slug: addonPlan?.slug ?? "",
        coupon_code: coupon?.code ?? "",
      },
    })) as { id?: string; amount?: number | string; currency?: string }
  } catch (error) {
    console.error("Razorpay order creation failed", error)

    /* An account that is not enabled for international acceptance rejects the
       order on currency. Surfacing that distinctly is the difference between
       "our gateway is down" and "this account cannot take GBP yet", which are
       very different things to see in logs on launch day. */
    const message = error instanceof Error ? error.message : String(error)

    if (/currency/i.test(message)) {
      throw new ApiError(
        503,
        "CURRENCY_NOT_ACCEPTED",
        `${quote.currency} payments were rejected by the payment gateway. Contact support to complete this purchase.`
      )
    }

    throw new ApiError(502, "RAZORPAY_ORDER_FAILED", "Unable to create Razorpay order")
  }

  if (!order.id) {
    throw new ApiError(502, "RAZORPAY_ORDER_INVALID", "Razorpay did not return an order id")
  }

  if (Number(order.amount) !== quote.finalAmountPaise || String(order.currency || "").toUpperCase() !== quote.currency) {
    throw new ApiError(502, "RAZORPAY_ORDER_AMOUNT_MISMATCH", "Razorpay order amount did not match the billing quote")
  }

  const subscriptionRows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    insert into public.hireveri_user_subscriptions (
      id,
      "userId",
      "organizationId",
      "planId",
      "totalCredits",
      "usedCredits",
      "screeningCredits",
      status,
      "amountPaid",
      currency,
      "startedAt",
      "updatedAt"
    )
    values (
      ${randomUUID()},
      ${organization.userId},
      ${organization.organizationId}::uuid,
      ${plan.id},
      0,
      0,
      0,
      'pending',
      0,
      ${quote.currency},
      now(),
      now()
    )
    on conflict ("organizationId") do update set
      "userId" = excluded."userId",
      "updatedAt" = now()
    returning id
  `)
  const subscriptionId = subscriptionRows[0]?.id

  if (!subscriptionId) {
    throw new ApiError(500, "SUBSCRIPTION_RECORD_FAILED", "Unable to prepare organization subscription")
  }

  await prisma.$executeRaw(Prisma.sql`
    insert into public.hireveri_payments (
      id,
      "userId",
      "subscriptionId",
      amount,
      status,
      "paymentRef",
      "createdAt",
      "updatedAt",
      "organizationId",
      "planId",
      "addonPlanId",
      "couponId",
      "couponCode",
      "originalAmountPaise",
      "discountPercentage",
      "discountAmountPaise",
      "gstPercentage",
      "gstAmountPaise",
      "finalAmountPaise",
      currency,
      customer_country_code,
      tax_treatment,
      "razorpayOrderId"
    )
    values (
      ${randomUUID()},
      ${organization.userId},
      ${subscriptionId},
      ${quote.finalAmountPaise},
      'pending'::"PaymentStatus",
      null,
      now(),
      now(),
      ${organization.organizationId}::uuid,
      ${plan.id},
      ${addonPlan?.id ?? null},
      ${coupon?.id ?? null}::uuid,
      ${coupon?.code ?? null},
      ${quote.originalAmountPaise},
      ${quote.discountPercentage},
      ${quote.discountAmountPaise},
      ${quote.gstPercentage},
      ${quote.gstAmountPaise},
      ${quote.finalAmountPaise},
      ${quote.currency},
      ${quote.customerCountryCode},
      ${quote.taxTreatment},
      ${order.id}
    )
  `)

  return {
    order_id: order.id,
    amount: quote.finalAmountPaise,
    currency: quote.currency,
    keyId: getRazorpayKeyId(),
    ...buildPublicQuoteResponse({
      plan,
      addonPlan,
      coupon,
      quote,
      organization,
    }),
  }
}

function verifyRazorpaySignature(input: {
  orderId: string
  paymentId: string
  signature: string
}) {
  const expected = createHmac("sha256", getRazorpayKeySecret())
    .update(`${input.orderId}|${input.paymentId}`)
    .digest("hex")
  const received = input.signature.trim()

  if (expected.length !== received.length) {
    return false
  }

  return timingSafeEqual(Buffer.from(expected), Buffer.from(received))
}

async function getPaymentByOrderForAuth(input: {
  orderId: string
  auth: RecruiterRequestContext
  client?: QueryClient
  lock?: boolean
}) {
  const client = input.client ?? prisma
  const lockClause = input.lock ? Prisma.sql`for update` : Prisma.empty
  const rows = await client.$queryRaw<PaymentRow[]>(Prisma.sql`
    select
      id,
      "organizationId"::text as organization_id,
      "userId" as user_id,
      "planId" as plan_id,
      "addonPlanId" as addon_plan_id,
      "couponId"::text as coupon_id,
      "couponCode" as coupon_code,
      "originalAmountPaise" as original_amount_paise,
      "discountPercentage"::float8 as discount_percentage,
      "discountAmountPaise" as discount_amount_paise,
      "gstPercentage"::float8 as gst_percentage,
      "gstAmountPaise" as gst_amount_paise,
      "finalAmountPaise" as final_amount_paise,
      currency,
      customer_country_code,
      tax_treatment,
      status::text as status,
      "razorpayOrderId" as razorpay_order_id,
      "razorpayPaymentId" as razorpay_payment_id,
      "subscriptionId" as subscription_id
    from public.hireveri_payments
    where "razorpayOrderId" = ${input.orderId}
      and "organizationId" = ${input.auth.organizationId}::uuid
      and "userId" = ${input.auth.userId}
    limit 1
    ${lockClause}
  `)

  return rows[0] ?? null
}

function assertPaymentAmountsMatch(payment: PaymentRow, validation: PaymentValidation) {
  const { quote, plan, addonPlan, coupon } = validation

  if (plan.id !== payment.plan_id) {
    throw new ApiError(400, "PLAN_MISMATCH", "Pending payment does not match the selected plan")
  }

  if ((addonPlan?.id ?? null) !== payment.addon_plan_id) {
    throw new ApiError(400, "ADDON_PLAN_MISMATCH", "Pending payment add-on state changed")
  }

  if ((coupon?.id ?? null) !== payment.coupon_id) {
    throw new ApiError(400, "COUPON_MISMATCH", "Pending payment coupon state changed")
  }

  if (
    payment.original_amount_paise !== quote.originalAmountPaise ||
    payment.discount_amount_paise !== quote.discountAmountPaise ||
    Number(payment.discount_percentage) !== Number(quote.discountPercentage) ||
    payment.gst_amount_paise !== quote.gstAmountPaise ||
    Number(payment.gst_percentage) !== Number(quote.gstPercentage) ||
    payment.final_amount_paise !== quote.finalAmountPaise ||
    payment.currency !== quote.currency ||
    payment.customer_country_code !== quote.customerCountryCode ||
    payment.tax_treatment !== quote.taxTreatment
  ) {
    throw new ApiError(400, "AMOUNT_MISMATCH", "Payment amount no longer matches current billing data")
  }
}

async function validatePendingPaymentAgainstCurrentDb(
  payment: PaymentRow,
  client: QueryClient = prisma,
  lockCoupon = false
): Promise<PaymentValidation> {
  /* The currency the order was actually placed in, re-read from the stored
     payment row rather than re-derived from anything request-scoped.

     This used to read `payment.currency === "USD" ? "USD" : "INR"`, which
     collapsed GBP and EUR to INR. A £279 order was then re-priced against
     price_inr (₹24,999) and assertPaymentAmountsMatch rejected it on
     `payment.currency !== quote.currency` — so every UK and eurozone payment
     failed verification AFTER Razorpay had taken the money, leaving the
     customer charged and the subscription unactivated. */
  const paymentCurrency = normalizeCurrency(payment.currency)

  if (!paymentCurrency) {
    /* Refuse rather than guess. Re-pricing a payment in a currency we do not
       recognise is exactly how the bug above silently charged the wrong
       amount; an unknown code means the row is corrupt and needs a human. */
    throw new ApiError(
      500,
      "PAYMENT_CURRENCY_UNSUPPORTED",
      "Stored payment currency is not a supported billing currency"
    )
  }

  const plan = await getActiveBillingPlanById(payment.plan_id, client, paymentCurrency)

  if (!plan) {
    throw new ApiError(400, "PLAN_INACTIVE", "Selected plan is no longer active")
  }

  const addonPlan = payment.addon_plan_id ? await getActiveBillingPlanById(payment.addon_plan_id, client, paymentCurrency) : null

  if (payment.addon_plan_id && !addonPlan) {
    throw new ApiError(400, "ADDON_PLAN_INACTIVE", "Selected screening add-on is no longer active")
  }

  assertPlanBundleAllowed(plan, addonPlan)
  const checkoutPlan = buildCheckoutPlan(plan, addonPlan)
  const coupon = await resolveCouponForPlan({
    client,
    plan: checkoutPlan,
    couponId: payment.coupon_id,
    couponCode: payment.coupon_code,
    organizationId: payment.organization_id,
    lock: lockCoupon,
  })
  const quote = calculateQuote(plan, coupon, addonPlan, payment.customer_country_code)
  const validation = { plan, addonPlan, coupon, quote }

  assertPaymentAmountsMatch(payment, validation)
  ensureRazorpayPayableAmount(quote.finalAmountPaise)

  return validation
}

function sanitizeRazorpayPaymentPayload(payment: RazorpayPayment) {
  return JSON.stringify(payment)
}

async function fetchAndCaptureRazorpayPayment(payment: PaymentRow, razorpayPaymentId: string) {
  const razorpay = getRazorpayClient()
  let razorpayPayment: RazorpayPayment

  try {
    razorpayPayment = (await razorpay.payments.fetch(razorpayPaymentId)) as unknown as RazorpayPayment
  } catch (error) {
    console.error("Razorpay payment fetch failed", error)
    throw new ApiError(502, "RAZORPAY_PAYMENT_FETCH_FAILED", "Unable to fetch Razorpay payment")
  }

  if (razorpayPayment.order_id !== payment.razorpay_order_id) {
    throw new ApiError(400, "RAZORPAY_ORDER_MISMATCH", "Razorpay payment does not belong to this order")
  }

  if (Number(razorpayPayment.amount) !== payment.final_amount_paise) {
    throw new ApiError(400, "RAZORPAY_AMOUNT_MISMATCH", "Razorpay payment amount does not match the order")
  }

  if (razorpayPayment.currency !== payment.currency) {
    throw new ApiError(400, "RAZORPAY_CURRENCY_MISMATCH", "Razorpay payment currency does not match the order")
  }

  if (razorpayPayment.status === "authorized") {
    try {
      razorpayPayment = (await razorpay.payments.capture(
        razorpayPaymentId,
        payment.final_amount_paise,
        payment.currency
      )) as unknown as RazorpayPayment
    } catch (error) {
      console.error("Razorpay payment capture failed", error)
      throw new ApiError(502, "RAZORPAY_CAPTURE_FAILED", "Unable to capture Razorpay payment")
    }
  }

  if (razorpayPayment.status !== "captured" && razorpayPayment.captured !== true) {
    throw new ApiError(400, "RAZORPAY_PAYMENT_NOT_CAPTURED", "Payment is not captured")
  }

  return razorpayPayment
}

export async function verifyAndActivatePayment(input: {
  auth: RecruiterRequestContext
  razorpayOrderId: string
  razorpayPaymentId: string
  razorpaySignature: string
}) {
  if (!input.razorpayOrderId || !input.razorpayPaymentId || !input.razorpaySignature) {
    throw new ApiError(400, "RAZORPAY_FIELDS_MISSING", "Razorpay verification fields are required")
  }

  const payment = await getPaymentByOrderForAuth({
    orderId: input.razorpayOrderId,
    auth: input.auth,
  })

  if (!payment) {
    throw new ApiError(404, "PAYMENT_NOT_FOUND", "Pending payment was not found")
  }

  if (payment.status === "success") {
    if (payment.razorpay_payment_id && payment.razorpay_payment_id !== input.razorpayPaymentId) {
      throw new ApiError(409, "PAYMENT_ALREADY_PAID", "Payment has already been verified")
    }

    let invoice = null
    try {
      invoice = await createAndSendInvoiceForPayment({
        paymentId: payment.id,
      })
    } catch (error) {
      console.error("Billing invoice generation failed", error)
    }

    return {
      alreadyVerified: true,
      paymentId: payment.id,
      plan: null,
      subscription: null,
      invoice,
    }
  }

  if (payment.status !== "pending") {
    throw new ApiError(409, "PAYMENT_NOT_PENDING", "Payment is not pending")
  }

  if (
    !verifyRazorpaySignature({
      orderId: input.razorpayOrderId,
      paymentId: input.razorpayPaymentId,
      signature: input.razorpaySignature,
    })
  ) {
    await markPaymentTerminal({
      auth: input.auth,
      razorpayOrderId: input.razorpayOrderId,
      status: "failed",
      reason: "Signature verification failed",
    })
    throw new ApiError(400, "INVALID_RAZORPAY_SIGNATURE", "Invalid Razorpay payment signature")
  }

  await validatePendingPaymentAgainstCurrentDb(payment)
  const razorpayPayment = await fetchAndCaptureRazorpayPayment(payment, input.razorpayPaymentId)

  const activationResult = await prisma.$transaction(async (tx) => {
    const lockedPayment = await getPaymentByOrderForAuth({
      orderId: input.razorpayOrderId,
      auth: input.auth,
      client: tx,
      lock: true,
    })

    if (!lockedPayment) {
      throw new ApiError(404, "PAYMENT_NOT_FOUND", "Pending payment was not found")
    }

    if (lockedPayment.status === "success") {
      let invoice = null
      try {
        invoice = await createAndSendInvoiceForPayment({
          paymentId: lockedPayment.id,
        })
      } catch (error) {
        console.error("Billing invoice generation failed", error)
      }

      return {
        alreadyVerified: true,
        paymentId: lockedPayment.id,
        plan: null,
        subscription: null,
        invoice,
      }
    }

    if (lockedPayment.status !== "pending") {
      throw new ApiError(409, "PAYMENT_NOT_PENDING", "Payment is not pending")
    }

    const validation = await validatePendingPaymentAgainstCurrentDb(lockedPayment, tx, true)

    if (validation.coupon) {
      await tx.$executeRaw(Prisma.sql`
        update public.coupons
        set current_global_uses = current_global_uses + 1,
            updated_at = now()
        where id = ${validation.coupon.id}::uuid
      `)

      try {
        await tx.$executeRaw(Prisma.sql`
          insert into public.coupon_usages (
            id,
            coupon_id,
            organization_id,
            payment_id,
            used_at
          )
          values (
            ${randomUUID()}::uuid,
            ${validation.coupon.id}::uuid,
            ${lockedPayment.organization_id}::uuid,
            ${lockedPayment.id},
            now()
          )
        `)
      } catch (error) {
        const postgresCode = (error as { code?: string } | null)?.code
        if (postgresCode === "23505") {
          throw new ApiError(409, "COUPON_ALREADY_USED", "This organization has already used this coupon")
        }

        throw error
      }
    }

    await tx.$executeRaw(Prisma.sql`
      update public.hireveri_payments
      set status = 'success'::"PaymentStatus",
          "paymentRef" = ${input.razorpayPaymentId},
          "razorpayPaymentId" = ${input.razorpayPaymentId},
          "razorpaySignature" = ${input.razorpaySignature},
          "razorpayPaymentStatus" = ${String(razorpayPayment.status ?? "captured")},
          "razorpayPaymentPayload" = ${sanitizeRazorpayPaymentPayload(razorpayPayment)}::jsonb,
          "failureReason" = null,
          "updatedAt" = now()
      where id = ${lockedPayment.id}
    `)

    const activatedPlan = buildCheckoutPlan(validation.plan, validation.addonPlan)
    const subscriptionRows = await tx.$queryRaw<
      Array<{
        id: string
        organization_id: string
        plan_id: string
        status: string
        interview_credits: number
        screening_credits: number
        amount_paid: number
        currency: string
        activated_at: Date
        expires_at: Date | null
      }>
    >(Prisma.sql`
      update public.hireveri_user_subscriptions
      set
        "planId" = ${validation.plan.id},
        status = 'active',
        "totalCredits" = "totalCredits" + ${activatedPlan.interviewSessions},
        "screeningCredits" = "screeningCredits" + ${activatedPlan.screeningReviews},
        "amountPaid" = "amountPaid" + ${lockedPayment.final_amount_paise},
        currency = ${lockedPayment.currency},
        "razorpayOrderId" = ${lockedPayment.razorpay_order_id},
        "razorpayPaymentId" = ${input.razorpayPaymentId},
        "activatedAt" = now(),
        -- Credits are valid for a fixed window rather than forever. Perpetual
        -- credits make a later price change unenforceable: an organization
        -- acquired at launch pricing would keep drawing down that rate
        -- indefinitely, with no renewal moment at which new pricing applies.
        -- A top-up extends the existing window rather than resetting it, so an
        -- active customer is never cut short by buying more.
        "expiresAt" =
          greatest(coalesce("expiresAt", now()), now())
          + make_interval(months => ${CREDIT_VALIDITY_MONTHS}),
        "updatedAt" = now()
      where id = ${lockedPayment.subscription_id}
      returning
        id,
        "organizationId"::text as organization_id,
        "planId" as plan_id,
        status,
        "totalCredits" as interview_credits,
        "screeningCredits" as screening_credits,
        "amountPaid" as amount_paid,
        currency,
        "activatedAt" as activated_at,
        "expiresAt" as expires_at
    `)

    const subscription = subscriptionRows[0]

    return {
      alreadyVerified: false,
      paymentId: lockedPayment.id,
      plan: validation.plan,
      addonPlan: validation.addonPlan,
      subscription: subscription
        ? {
            id: subscription.id,
            organizationId: subscription.organization_id,
            planId: subscription.plan_id,
            status: subscription.status,
            interviewCredits: Number(subscription.interview_credits),
            screeningCredits: Number(subscription.screening_credits),
            amountPaid: Number(subscription.amount_paid),
            currency: subscription.currency,
            activatedAt: subscription.activated_at,
            expiresAt: subscription.expires_at,
          }
        : null,
    }
  })

  if (!activationResult.alreadyVerified) {
    try {
      const invoice = await createAndSendInvoiceForPayment({
        paymentId: activationResult.paymentId,
      })

      return {
        ...activationResult,
        invoice,
      }
    } catch (error) {
      console.error("Billing invoice generation failed", error)
    }
  }

  return activationResult
}

export async function markPaymentTerminal(input: {
  auth: RecruiterRequestContext
  razorpayOrderId: string
  status: "failed" | "cancelled"
  reason?: string | null
}) {
  if (!input.razorpayOrderId) {
    throw new ApiError(400, "RAZORPAY_ORDER_ID_MISSING", "Razorpay order id is required")
  }

  await prisma.$executeRaw(Prisma.sql`
    update public.hireveri_payments
    set status = ${input.status}::"PaymentStatus",
        "failureReason" = ${input.reason ?? null},
        "updatedAt" = now()
    where "razorpayOrderId" = ${input.razorpayOrderId}
      and "organizationId" = ${input.auth.organizationId}::uuid
      and "userId" = ${input.auth.userId}
      and status = 'pending'::"PaymentStatus"
  `)

  return { status: input.status }
}

/**
 * Pure decision logic, exposed for tests.
 *
 * Everything here is deterministic and takes plain data — no database, no
 * gateway. It is grouped behind one export rather than making each function
 * public so the module's real surface stays what it was.
 *
 * See lib/server/services/billing.test.ts, which drives the full
 * quote -> order -> verification -> activation sequence through these.
 */
export const __billingInternals = {
  getPlanAmount,
  mapPlan,
  calculateQuote,
  resolveTaxCountry,
  assertPaymentAmountsMatch,
  assertCouponUsable,
  buildCheckoutPlan,
  getGatewaySupportedCurrencies,
  assertGatewayAcceptsCurrency,
  ensureRazorpayPayableAmount,
}
