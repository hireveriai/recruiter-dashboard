"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"

import PlanComparison from "@/components/billing/plan-comparison"
import { VerisGlobeLoader } from "@/components/system/loaders"
import { buildAuthUrl } from "@/lib/client/auth-query"
import { formatMinorAmount } from "@/lib/pricing/currency"
import { INTRODUCTORY_OFFER_LABEL, getRegularAmountPaise } from "@/lib/pricing/introductory-offer"
import { useAuthSearchParams } from "@/lib/client/use-auth-search-params"

type Plan = {
  id: string
  slug: string
  name: string
  description: string
  amountPaise: number
  currency: string
  interviewSessions: number
  screeningReviews: number
  assessmentCredits: number
  planType: string
  isPopular: boolean
  displayOrder: number
  features: string[]
}

type Quote = {
  originalAmountPaise: number
  discountPercentage: number
  discountAmountPaise: number
  taxableAmountPaise: number
  gstPercentage: number
  gstAmountPaise: number
  finalAmountPaise: number
  currency: string
  customerCountryCode: string
  taxTreatment: "DOMESTIC_GST" | "EXPORT_WITH_IGST" | "EXPORT_UNDER_LUT"
}

type Organization = {
  organizationId: string
  organizationName: string
  userName: string
  userEmail: string
  billingCountryCode: string
  billingCountryConfirmed: boolean
}

type CheckoutSummary = {
  plan: Plan
  addonPlan: Plan | null
  coupon: {
    code: string
    description: string
    discountPercentage: number
  } | null
  quote: Quote
  organization: Organization
  /* True until the organization has asserted where it is billed. Tax on the
     quote is a provisional preview while this is set, and the server refuses
     to create an order. */
  billingCountryConfirmationRequired: boolean
  /* Geo-derived hint used only to prefill the field. Never auto-submitted:
     where a request comes from is not where a company is registered. */
  suggestedBillingCountryCode: string | null
}

type ApiResponse<T> = {
  success: boolean
  data?: T
  error?: {
    code: string
    message: string
  }
}

type PlansResponse = {
  plans: Plan[]
  selectedPlan: Plan | null
}

type RazorpaySuccessResponse = {
  razorpay_payment_id: string
  razorpay_order_id: string
  razorpay_signature: string
}

type RazorpayFailureResponse = {
  error?: {
    code?: string
    description?: string
    source?: string
    step?: string
    reason?: string
    metadata?: {
      order_id?: string
      payment_id?: string
    }
  }
}

type RazorpayInstance = {
  open: () => void
  on: (event: "payment.failed", handler: (response: RazorpayFailureResponse) => void) => void
}

type RazorpayConstructor = new (options: Record<string, unknown>) => RazorpayInstance

declare global {
  interface Window {
    Razorpay?: RazorpayConstructor
  }
}

const RAZORPAY_SCRIPT_URL = "https://checkout.razorpay.com/v1/checkout.js"
const TRUST_INDICATORS = ["Tax invoice", "Razorpay secured", "Organization billing", "Audit-ready records"]

/** Only statements the existing implementation actually supports - no
 * invented refund/rollover/cancellation/expiry policy. */
const HOW_BILLING_WORKS_STEPS = [
  { title: "Choose your plan", body: "Select the VerisNova capability and plan that fits your hiring needs." },
  { title: "Complete secure payment", body: "Complete payment through the existing secure Razorpay checkout." },
  { title: "Credits are added automatically", body: "Purchased credits are added to the workspace after confirmed payment." },
]

const GOOD_TO_KNOW_ITEMS = [
  "Prices are shown in your current billing currency.",
  "GST/taxes appear in the payment summary where applicable.",
  "Coupons follow existing eligibility rules.",
  "Purchased credits are added after confirmed payment.",
]

/**
 * Product-first grouping for the checkout page. Maps 1:1 onto the existing
 * `planType` values already returned by /api/plans (see SELLABLE_PLAN_TYPES
 * in lib/server/services/billing.ts) - this is a presentation grouping only,
 * never a second source of truth for pricing or product identity.
 */
type ProductKey = "INTERVIEW" | "ASSESSMENT" | "SCREENING" | "BUNDLE"

const PRODUCT_DEFS: Array<{ key: ProductKey; label: string; tagline: string }> = [
  { key: "BUNDLE", label: "Hiring Suite", tagline: "All three capabilities" },
  { key: "INTERVIEW", label: "VERIS AI Interview", tagline: "AI-powered structured interviews" },
  { key: "ASSESSMENT", label: "VERIS Assessment", tagline: "Scored candidate assessments" },
  { key: "SCREENING", label: "VERIS Screening", tagline: "Resume-to-role evaluation" },
]

/** The DB has no "is the flagship tier" flag for every product family (only
 * the original Interview `growth` plan sets isPopular) - this reproduces the
 * same "second tier of four is the recommended one" convention by slug
 * across the Assessment/Screening/Bundle families, which all followed the
 * same starter/growth/scale/(expansion|enterprise) naming when seeded. Pure
 * presentation; never used for price or eligibility. */
function isFlagshipTierSlug(slug: string) {
  return slug === "growth" || slug.endsWith("-growth")
}

function planQuantityLines(plan: Plan): string[] {
  switch (plan.planType) {
    case "ASSESSMENT":
      return [`${plan.assessmentCredits.toLocaleString()} Assessment Credits`]
    case "SCREENING":
      return [`${plan.screeningReviews.toLocaleString()} Screening Reviews`]
    case "BUNDLE":
      return [
        `${plan.interviewSessions.toLocaleString()} Interview Sessions`,
        `${plan.screeningReviews.toLocaleString()} Screening Reviews`,
        `${plan.assessmentCredits.toLocaleString()} Assessment Credits`,
      ]
    default:
      return [`${plan.interviewSessions.toLocaleString()} Interview Sessions`]
  }
}

/**
 * Delegates to the shared formatter so a price reads the same here as on the
 * pricing page. This used to hardcode the en-IN locale for every currency,
 * which applied Indian lakh grouping to USD/GBP/EUR and always forced two
 * decimals ("£159.00" against the pricing page's "£159").
 */
function formatPaise(value: number, currency = "INR") {
  return formatMinorAmount(value, currency)
}

/** Derived per-unit figures read as round numbers, matching the comparison table. */
function formatUnitPaise(value: number, currency = "INR") {
  const whole = value >= 1000

  return formatMinorAmount(value, currency, {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  })
}

function getErrorMessage(payload: ApiResponse<unknown> | null, fallback: string) {
  return payload?.error?.message || fallback
}

function loadRazorpayScript() {
  return new Promise<boolean>((resolve) => {
    if (typeof window === "undefined") {
      resolve(false)
      return
    }

    if (window.Razorpay) {
      resolve(true)
      return
    }

    const existingScript = document.querySelector<HTMLScriptElement>(`script[src="${RAZORPAY_SCRIPT_URL}"]`)

    if (existingScript) {
      existingScript.addEventListener("load", () => resolve(true), { once: true })
      existingScript.addEventListener("error", () => resolve(false), { once: true })
      return
    }

    const script = document.createElement("script")
    script.src = RAZORPAY_SCRIPT_URL
    script.async = true
    script.onload = () => resolve(true)
    script.onerror = () => resolve(false)
    document.body.appendChild(script)
  })
}

export default function BillingCheckoutPage() {
  const router = useRouter()
  const routeSearchParams = useSearchParams()
  const authSearchParams = useAuthSearchParams()
  const initialPlanSlug = routeSearchParams.get("plan")?.trim().toLowerCase() || ""
  const initialAddonPlanSlug = routeSearchParams.get("addon")?.trim().toLowerCase() || routeSearchParams.get("addon_plan")?.trim().toLowerCase() || ""
  const [selectedPlanSlug, setSelectedPlanSlug] = useState(initialPlanSlug)
  const [selectedAddonPlanSlug, setSelectedAddonPlanSlug] = useState(initialAddonPlanSlug)
  const [plans, setPlans] = useState<Plan[]>([])
  const [plansLoading, setPlansLoading] = useState(true)
  const [summary, setSummary] = useState<CheckoutSummary | null>(null)
  const [couponInput, setCouponInput] = useState("")
  const [appliedCouponCode, setAppliedCouponCode] = useState("")
  const [status, setStatus] = useState<"idle" | "loading" | "applying" | "paying" | "verifying" | "success">("loading")
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [activeOrderId, setActiveOrderId] = useState("")
  const [billingCountryInput, setBillingCountryInput] = useState("")
  const [confirmingBillingCountry, setConfirmingBillingCountry] = useState(false)

  const billingCountryRequired = Boolean(summary?.billingCountryConfirmationRequired)

  const isBusy = status === "loading" || status === "applying" || status === "paying" || status === "verifying"
  const appliedCoupon = useMemo(() => appliedCouponCode.trim().toUpperCase(), [appliedCouponCode])

  /**
   * What this exact order would cost at the regular (post-introductory) price,
   * tax included, so the struck-through total is comparable like for like with
   * the final payable figure beneath it.
   */
  const regularOrderTotalPaise = useMemo(() => {
    if (!summary) {
      return null
    }

    const planRegularPaise = getRegularAmountPaise(
      summary.plan.slug,
      summary.quote.currency,
      summary.plan.amountPaise
    )

    if (planRegularPaise === null) {
      return null
    }

    const regularBeforeTax = planRegularPaise + (summary.addonPlan?.amountPaise ?? 0)

    return (
      regularBeforeTax + Math.round((regularBeforeTax * summary.quote.gstPercentage) / 100)
    )
  }, [summary])

  /** Regular price of the selected plan alone, for the headline price display. */
  const selectedPlanRegularPaise = useMemo(() => {
    if (!summary) {
      return null
    }

    return getRegularAmountPaise(
      summary.plan.slug,
      summary.quote.currency,
      summary.plan.amountPaise
    )
  }, [summary])

  /* Introductory saving and any coupon saving, as one number the buyer sees. */
  const totalSavingPaise = useMemo(() => {
    if (!summary) {
      return 0
    }

    if (regularOrderTotalPaise !== null) {
      return Math.max(0, regularOrderTotalPaise - summary.quote.finalAmountPaise)
    }

    return summary.quote.discountAmountPaise
  }, [summary, regularOrderTotalPaise])
  const screeningPlans = useMemo(
    () => plans.filter((plan) => plan.planType === "SCREENING"),
    [plans]
  )
  const selectedPlan = useMemo(
    () => plans.find((plan) => plan.slug === selectedPlanSlug) ?? null,
    [plans, selectedPlanSlug]
  )

  // Product-first tab state. Defaults to the Hiring Suite (the flagship,
  // all-in-one option); if the page opened via a pricing-page deep link
  // (?plan=assessment-growth etc.), it switches once to whichever product
  // that plan actually belongs to, so an existing CTA still lands on the
  // right tab with that plan already selected.
  const [activeProduct, setActiveProduct] = useState<ProductKey>("BUNDLE")
  const didInitProductFromPlan = useRef(false)

  useEffect(() => {
    if (didInitProductFromPlan.current || !plans.length || !selectedPlanSlug) {
      return
    }

    didInitProductFromPlan.current = true
    const matchedPlan = plans.find((plan) => plan.slug === selectedPlanSlug)

    if (matchedPlan && PRODUCT_DEFS.some((product) => product.key === matchedPlan.planType)) {
      setActiveProduct(matchedPlan.planType as ProductKey)
    }
  }, [plans, selectedPlanSlug])

  const activeProductPlans = useMemo(
    () => plans.filter((plan) => plan.planType === activeProduct),
    [plans, activeProduct]
  )

  const [showComparison, setShowComparison] = useState(false)

  const requestJson = useCallback(
    async <T,>(path: string, body: Record<string, unknown>) => {
      const response = await fetch(buildAuthUrl(path, authSearchParams), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        cache: "no-store",
        body: JSON.stringify(body),
      })
      const payload = (await response.json().catch(() => null)) as ApiResponse<T> | null

      if (!response.ok || !payload?.success || !payload.data) {
        throw new Error(getErrorMessage(payload, "Request failed"))
      }

      return payload.data
    },
    [authSearchParams]
  )

  const loadSummary = useCallback(
    async (couponCode?: string | null) => {
      if (!selectedPlanSlug) {
        setStatus("idle")
        setSummary(null)
        setError("")
        return
      }

      setStatus(couponCode ? "applying" : "loading")
      setError("")
      setNotice("")

      try {
        const data = await requestJson<CheckoutSummary>("/api/validate-coupon", {
          plan: selectedPlanSlug,
          addon_plan: selectedAddonPlanSlug || null,
          coupon_code: couponCode || null,
        })

        setSummary(data)
        /* Prefill only. The customer still has to press Confirm, because a geo
           country is a guess at where they are, not a statement of where they
           are registered for tax. */
        setBillingCountryInput((current) =>
          current || data.suggestedBillingCountryCode || data.organization.billingCountryCode || ""
        )
        setAppliedCouponCode(data.coupon?.code ?? "")
        setNotice(data.coupon ? `${data.coupon.code} applied successfully.` : "")
        setStatus("idle")
      } catch (requestError) {
        setStatus("idle")
        setError(requestError instanceof Error ? requestError.message : "Unable to load checkout.")
        if (couponCode) {
          setAppliedCouponCode("")
        }
      }
    },
    [requestJson, selectedAddonPlanSlug, selectedPlanSlug]
  )

  useEffect(() => {
    let active = true

    async function loadPlans() {
      setPlansLoading(true)

      try {
        const response = await fetch(buildAuthUrl("/api/plans", authSearchParams), {
          credentials: "include",
          cache: "no-store",
        })
        const payload = (await response.json().catch(() => null)) as ApiResponse<PlansResponse> | null

        if (!active) {
          return
        }

        if (!response.ok || !payload?.success || !payload.data) {
          throw new Error(getErrorMessage(payload, "Unable to load billing plans."))
        }

        setPlans(payload.data.plans ?? [])
      } catch (plansError) {
        if (active) {
          setError(plansError instanceof Error ? plansError.message : "Unable to load billing plans.")
        }
      } finally {
        if (active) {
          setPlansLoading(false)
        }
      }
    }

    loadPlans()

    return () => {
      active = false
    }
  }, [authSearchParams])

  useEffect(() => {
    loadSummary(null)
  }, [loadSummary])

  useEffect(() => {
    if (status === "idle" && summary) {
      void loadRazorpayScript()
    }
  }, [status, summary])

  async function markOrderTerminal(orderId: string, terminalStatus: "failed" | "cancelled", reason: string) {
    try {
      await requestJson("/api/payment-failed", {
        razorpay_order_id: orderId,
        status: terminalStatus,
        reason,
      })
    } catch {
      // Best-effort state sync; verification still remains the activation gate.
    }
  }

  async function handleApplyCoupon() {
    const couponCode = couponInput.trim().toUpperCase()

    if (!couponCode) {
      setError("Enter a coupon code to apply.")
      return
    }

    await loadSummary(couponCode)
  }

  async function handleRemoveCoupon() {
    setCouponInput("")
    setAppliedCouponCode("")
    await loadSummary(null)
  }

  async function verifyPayment(response: RazorpaySuccessResponse) {
    setStatus("verifying")
    setError("")
    setNotice("Verifying Razorpay signature and activating your organization subscription.")

    const result = await requestJson<{
      alreadyVerified: boolean
      plan: Plan | null
      subscription: {
        status: string
        interviewCredits: number
        screeningCredits: number
        assessmentCredits: number
      } | null
      addonPlan: Plan | null
    }>("/api/verify-payment", {
      razorpay_order_id: response.razorpay_order_id,
      razorpay_payment_id: response.razorpay_payment_id,
      razorpay_signature: response.razorpay_signature,
    })

    const activatedPlanName = result.plan?.name || summary?.plan.name || "selected plan"

    try {
      window.sessionStorage.setItem(
        "verisnova-billing-success",
        JSON.stringify({
          title: "Subscription activated",
          message: `${activatedPlanName} is live for ${summary?.organization.organizationName || "your organization"}.`,
        })
      )
      window.sessionStorage.removeItem("verisnova-overview")
    } catch {
      // Non-critical; dashboard still redirects correctly.
    }

    setStatus("success")
    setNotice("Payment verified. Redirecting to recruiter dashboard.")
    router.replace("/")
  }

  async function handleConfirmBillingCountry() {
    const countryCode = billingCountryInput.trim().toUpperCase()

    if (!/^[A-Z]{2}$/.test(countryCode) || confirmingBillingCountry || isBusy) {
      return
    }

    setConfirmingBillingCountry(true)
    setError("")

    try {
      await requestJson<{ organization: { billingCountryCode: string } }>("/api/billing/country", {
        billing_country_code: countryCode,
      })
      /* Reload the quote rather than patching it locally: tax treatment is
         recalculated server-side and the total can legitimately change. */
      await loadSummary(appliedCoupon || null)
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : "Unable to save billing country."
      )
    } finally {
      setConfirmingBillingCountry(false)
    }
  }

  async function handleProceedToPayment() {
    if (!summary || isBusy) {
      return
    }

    setStatus("paying")
    setError("")
    setNotice("Creating a secure Razorpay order.")

    try {
      const scriptLoaded = await loadRazorpayScript()

      if (!scriptLoaded || !window.Razorpay) {
        throw new Error("Unable to load Razorpay checkout. Please try again.")
      }

      const order = await requestJson<
        CheckoutSummary & {
          order_id: string
          amount: number
          currency: string
          keyId: string
        }
      >("/api/create-order", {
        plan: selectedPlanSlug,
        addon_plan: selectedAddonPlanSlug || null,
        coupon_code: appliedCoupon || null,
      })

      setSummary({
        plan: order.plan,
        addonPlan: order.addonPlan,
        coupon: order.coupon,
        quote: order.quote,
        organization: order.organization,
        /* An order only exists once the server accepted the billing country,
           so by definition it is no longer outstanding here. */
        billingCountryConfirmationRequired: false,
        suggestedBillingCountryCode: null,
      })
      setActiveOrderId(order.order_id)
      setNotice("Opening Razorpay secure checkout.")

      let handledBySuccess = false
      const checkout = new window.Razorpay({
        key: order.keyId,
        amount: order.amount,
        currency: order.currency,
        name: "VerisNova",
        description: `${order.plan.name} plan for ${order.organization.organizationName}`,
        order_id: order.order_id,
        prefill: {
          name: order.organization.userName,
          email: order.organization.userEmail,
        },
        notes: {
          organization_id: order.organization.organizationId,
          plan: order.plan.slug,
          addon_plan: order.addonPlan?.slug ?? "",
          coupon: order.coupon?.code ?? "",
        },
        theme: {
          color: "#2563eb",
        },
        modal: {
          ondismiss: async () => {
            if (handledBySuccess) {
              return
            }

            setStatus("idle")
            setNotice("")
            setError("Payment was cancelled before completion.")
            await markOrderTerminal(order.order_id, "cancelled", "Razorpay modal dismissed")
          },
        },
        handler: async (response: RazorpaySuccessResponse) => {
          handledBySuccess = true
          try {
            await verifyPayment(response)
          } catch (verificationError) {
            setStatus("idle")
            setNotice("")
            setError(
              verificationError instanceof Error
                ? verificationError.message
                : "Payment verification failed. Your subscription was not activated."
            )
          }
        },
      })

      checkout.on("payment.failed", (response) => {
        const reason =
          response.error?.description ||
          response.error?.reason ||
          response.error?.code ||
          "Razorpay payment failed"

        setStatus("idle")
        setNotice("")
        setError(reason)
      })

      checkout.open()
    } catch (paymentError) {
      setStatus("idle")
      setNotice("")
      setError(paymentError instanceof Error ? paymentError.message : "Unable to start Razorpay checkout.")
    }
  }

  /**
   * Prefer real history so Back returns wherever the buyer actually came from
   * (pricing page, subscription page, a campaign link). Falls back to the plan
   * list when checkout was opened directly, so the button is never a dead end.
   */
  function handleGoBack() {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back()
      return
    }

    router.push(buildAuthUrl("/subscription", authSearchParams))
  }

  function updateCheckoutSelection(nextPlanSlug: string, nextAddonPlanSlug = "") {
    setSelectedPlanSlug(nextPlanSlug)
    setSelectedAddonPlanSlug(nextAddonPlanSlug)
    setCouponInput("")
    setAppliedCouponCode("")
    setSummary(null)
    setError("")
    setNotice("")

    if (typeof window !== "undefined") {
      const url = new URL(window.location.href)
      url.searchParams.set("plan", nextPlanSlug)
      if (nextAddonPlanSlug) {
        url.searchParams.set("addon", nextAddonPlanSlug)
      } else {
        url.searchParams.delete("addon")
        url.searchParams.delete("addon_plan")
      }
      window.history.replaceState(null, "", url.toString())
    }
  }

  if (plansLoading || (status === "loading" && !summary)) {
    return (
      <main className="min-h-screen bg-slate-950 text-slate-100">
        <VerisGlobeLoader
          eyebrow="Billing Checkout"
          steps={[
            { label: "Loading checkout", detail: "Fetching workspace billing context and selected plan." },
            { label: "Reading plans", detail: "Preparing subscription choices and VERIS Screening add-ons." },
            { label: "Building quote", detail: "Calculating billing summary, credits, tax, and checkout state." },
            { label: "Checkout ready", detail: "Secure payment details are ready for review." },
          ]}
          activeIndex={1}
        />
      </main>
    )
  }

  return (
    <main className="min-h-screen overflow-hidden bg-slate-950 px-4 py-8 text-slate-100 sm:px-6 lg:px-8">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(37,99,235,0.06),transparent_38%)]" />

      <section className="relative mx-auto grid w-full max-w-6xl gap-6 lg:grid-cols-[minmax(0,1.65fr)_minmax(320px,0.85fr)]">
        <div className="flex flex-col gap-6">
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-[0_18px_44px_rgba(15,23,42,0.10)] sm:p-8">
          <div className="flex items-center justify-between gap-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-blue-200">
              Enterprise Billing Checkout
            </p>
            <button
              type="button"
              onClick={handleGoBack}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-950 px-3 py-1.5 text-xs font-semibold text-slate-300 transition hover:border-slate-600 hover:text-slate-100"
            >
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M19 12H5" />
                <path d="m12 19-7-7 7-7" />
              </svg>
              Back
            </button>
          </div>
          <h1 className="mt-2 max-w-2xl text-2xl font-semibold leading-tight tracking-tight text-slate-100 sm:text-[28px]">
            Activate VerisNova for your organization
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
            Server-verified billing with country-aware tax records and controlled subscription activation.
          </p>

          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="flex h-full flex-col justify-between rounded-xl border border-slate-800 bg-slate-950 p-3.5">
              <p className="truncate text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Bill to</p>
              <p className="mt-2 truncate text-sm font-semibold text-slate-100">
                {summary?.organization.organizationName || "Select a plan"}
              </p>
            </div>
            <div className="flex h-full flex-col justify-between rounded-xl border border-slate-800 bg-slate-950 p-3.5">
              <p className="truncate text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Interview credits</p>
              <p className="mt-2 text-2xl font-semibold leading-none text-slate-100">
                {summary?.plan.interviewSessions ?? "--"}
              </p>
            </div>
            <div className="flex h-full flex-col justify-between rounded-xl border border-slate-800 bg-slate-950 p-3.5">
              <p className="truncate text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Screening reviews</p>
              <p className="mt-2 text-2xl font-semibold leading-none text-slate-100">
                {summary ? summary.plan.screeningReviews + (summary.addonPlan?.screeningReviews ?? 0) : "--"}
              </p>
            </div>
            <div className="flex h-full flex-col justify-between rounded-xl border border-slate-800 bg-slate-950 p-3.5">
              <p className="truncate text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Assessment credits</p>
              <p className="mt-2 text-2xl font-semibold leading-none text-slate-100">
                {summary ? summary.plan.assessmentCredits + (summary.addonPlan?.assessmentCredits ?? 0) : "--"}
              </p>
            </div>
          </div>

          {/* Equal-width grid rather than flex: every box is the same size and
              the four sit on one line, which free-flowing chips could not do. */}
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {TRUST_INDICATORS.map((indicator) => (
              <div
                key={indicator}
                className="flex items-center justify-center rounded-xl border border-slate-800 bg-slate-950 px-2 py-2 text-center text-[11px] font-medium leading-4 text-slate-400"
              >
                {indicator}
              </div>
            ))}
          </div>

          <div className="mt-8 rounded-2xl border border-slate-800 bg-slate-950 p-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-blue-200">Selected plan</p>
                <h2 className="mt-2 text-3xl font-semibold text-slate-100">{summary?.plan.name || selectedPlan?.name || "Choose a plan"}</h2>
                {/* The plan's price belongs beside its name: the payment summary
                    is a tax breakdown, and the comparison table sits far below
                    the fold on a laptop. */}
                {summary ? (
                  <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    {selectedPlanRegularPaise !== null ? (
                      <span className="text-lg font-medium text-slate-500 line-through">
                        {formatPaise(selectedPlanRegularPaise, summary.quote.currency)}
                      </span>
                    ) : null}
                    <span className="text-3xl font-semibold text-slate-100">
                      {formatPaise(summary.plan.amountPaise, summary.quote.currency)}
                    </span>
                    {summary.plan.interviewSessions > 0 ? (
                      <span className="text-sm text-slate-400">
                        &middot;{" "}
                        {formatUnitPaise(
                          Math.round(summary.plan.amountPaise / summary.plan.interviewSessions),
                          summary.quote.currency
                        )}{" "}
                        per interview
                      </span>
                    ) : null}
                    {selectedPlanRegularPaise !== null ? (
                      <span className="inline-flex rounded-full border border-emerald-400/30 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-emerald-100">
                        {INTRODUCTORY_OFFER_LABEL}
                      </span>
                    ) : null}
                  </div>
                ) : null}

                <p className="mt-2 max-w-xl text-sm leading-6 text-slate-300">
                  {summary?.plan.description || selectedPlan?.description || "Choose a plan that fits your hiring workflow."}
                </p>
                {summary?.addonPlan ? (
                  <p className="mt-3 inline-flex rounded-full border border-blue-400/25 bg-blue-500/10 px-3 py-1 text-xs font-semibold text-blue-100">
                    Add-on selected: {summary.addonPlan.name}
                  </p>
                ) : null}
              </div>
              {summary?.plan.isPopular ? (
                <span className="inline-flex rounded-full border border-blue-400/25 bg-blue-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-blue-100">
                  Standard procurement plan
                </span>
              ) : null}
            </div>

            {summary?.plan.features?.length ? (
              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                {summary.plan.features.map((feature) => (
                  <div key={feature} className="flex items-start gap-3 rounded-xl border border-slate-800 bg-slate-950/35 px-4 py-3 text-sm text-slate-300">
                    <span className="mt-2 h-1.5 w-1.5 rounded-full bg-slate-500" />
                    <span>{feature}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-950/35 p-5">
            <p className="text-lg font-semibold tracking-tight text-slate-100">Choose your VerisNova plan</p>
            <p className="mt-1.5 max-w-xl text-sm leading-6 text-slate-400">
              Get the complete Hiring Suite or choose the capability you need. AI Interview, Assessment, and Screening
              are available independently.
            </p>

            {/* Product selector - four premium tabs, not a form. Switching tabs
                only changes which product's plans are shown; it never clears
                a plan already selected on another tab. */}
            <div
              role="tablist"
              aria-label="VerisNova products"
              className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4"
            >
              {PRODUCT_DEFS.map((product) => {
                const isActive = product.key === activeProduct
                return (
                  <button
                    key={product.key}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    onClick={() => setActiveProduct(product.key)}
                    className={`rounded-xl border px-3 py-3 text-left transition ${
                      isActive
                        ? "border-blue-400/50 bg-blue-500/10 shadow-[0_0_0_1px_rgba(96,165,250,0.25)]"
                        : "border-slate-800 bg-slate-950 hover:border-slate-600"
                    }`}
                  >
                    <span className={`block text-[11px] font-bold uppercase tracking-[0.1em] ${isActive ? "text-blue-100" : "text-slate-200"}`}>
                      {product.label}
                    </span>
                    <span className="mt-1 block text-[11px] leading-4 text-slate-500">{product.tagline}</span>
                  </button>
                )
              })}
            </div>

            {activeProduct === "BUNDLE" ? (
              <div className="mt-5">
                <p className="text-base font-semibold text-slate-100">Hiring Suite</p>
                <p className="mt-0.5 text-sm text-blue-200">All three capabilities. One plan.</p>
                <p className="mt-2 max-w-xl text-xs leading-5 text-slate-400">
                  All three capabilities in one plan. Each capability is also available independently.
                </p>
              </div>
            ) : null}

            {/* Plan card grid - the primary interface. Every price/quantity
                below comes straight from the plan objects returned by
                /api/plans, which are themselves backed by the authoritative
                billing catalog; nothing here is computed or hardcoded. */}
            {activeProductPlans.length > 0 ? (
              <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {activeProductPlans.map((plan) => (
                  <PlanCard
                    key={plan.id}
                    plan={plan}
                    isSelected={selectedPlanSlug === plan.slug}
                    isFlagship={isFlagshipTierSlug(plan.slug)}
                    disabled={isBusy}
                    onSelect={() => updateCheckoutSelection(plan.slug, "")}
                  />
                ))}
              </div>
            ) : !plansLoading ? (
              <p className="mt-5 rounded-xl border border-amber-400/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                No active {PRODUCT_DEFS.find((product) => product.key === activeProduct)?.label} plans are available
                right now. Please contact VerisNova support.
              </p>
            ) : null}

            {activeProduct === "INTERVIEW" && screeningPlans.length > 0 ? (
              <p className="mt-4 text-xs leading-5 text-slate-500">
                Want to combine an interview plan with extra VERIS Screening capacity? Use{" "}
                <button
                  type="button"
                  onClick={() => setShowComparison(true)}
                  className="font-semibold text-blue-300 underline-offset-2 hover:underline"
                >
                  Compare VERIS AI Interview plans
                </button>{" "}
                below - it includes a &ldquo;With VERIS Screening&rdquo; option.
              </p>
            ) : null}

            {/* Optional, secondary, product-specific comparison - collapsed by
                default so plan cards are the first thing a customer sees, per
                the product-first redesign. Never mixes other product types
                in: only the active tab's own plans are passed in. */}
            {activeProductPlans.length > 1 ? (
              <div className="mt-5 border-t border-slate-800 pt-4">
                <button
                  type="button"
                  onClick={() => setShowComparison((current) => !current)}
                  aria-expanded={showComparison}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-300 hover:text-slate-100"
                >
                  <svg
                    viewBox="0 0 24 24"
                    className={`h-3.5 w-3.5 transition-transform ${showComparison ? "rotate-90" : ""}`}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="m9 18 6-6-6-6" />
                  </svg>
                  Compare {PRODUCT_DEFS.find((product) => product.key === activeProduct)?.label} plans
                </button>

                {showComparison ? (
                  <PlanComparison
                    interviewPlans={activeProductPlans}
                    screeningPlans={activeProduct === "INTERVIEW" ? screeningPlans : []}
                    selectedPlanSlug={selectedPlanSlug}
                    selectedAddonPlanSlug={selectedAddonPlanSlug}
                    onSelectPlan={updateCheckoutSelection}
                    disabled={isBusy}
                    // Server-verified discount only. The struck-through price is
                    // the plan's real list price, never a decorative anchor.
                    discountPercentage={summary?.quote.discountPercentage ?? 0}
                    offerLabel={summary?.coupon?.description || INTRODUCTORY_OFFER_LABEL}
                  />
                ) : null}
              </div>
            ) : null}

            {!plansLoading && plans.length === 0 ? (
              <p className="mt-4 rounded-xl border border-amber-400/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                No active billing plans are available. Please contact VerisNova support.
              </p>
            ) : null}
          </div>
        </div>

        {/* Capability comparison sits directly below the plan cards - still
            part of the purchase decision, not a bottom-of-page afterthought -
            while the payment summary stays sticky in the right column
            regardless of how tall this section is. */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 sm:p-7">
          <p className="text-lg font-semibold tracking-tight text-slate-100">Compare VerisNova capabilities</p>
          <p className="mt-1.5 max-w-xl text-sm leading-6 text-slate-400">
            See what each VerisNova capability and the complete Hiring Suite provide for your recruiting workflow.
          </p>
          <ProductComparisonTable plans={plans} />
        </div>
        </div>

        <div className="flex flex-col gap-6">
        <aside className="h-fit rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-[0_18px_44px_rgba(15,23,42,0.10)] sm:p-7 lg:sticky lg:top-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Payment Summary</p>
              <p className="mt-3 text-sm text-slate-300">Server-verified billing quote</p>
            </div>
            <div className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-semibold text-slate-300">
              Razorpay secured
            </div>
          </div>

          <div className="mt-6 space-y-3 rounded-2xl border border-slate-800 bg-slate-950/45 p-4">
            <div className="flex items-center justify-between gap-4 text-sm">
              <span className="text-slate-400">Plan amount</span>
              <span className="font-medium text-slate-100">
                {summary ? formatPaise(summary.quote.originalAmountPaise, summary.quote.currency) : "--"}
              </span>
            </div>
            {summary?.addonPlan ? (
              <div className="flex items-center justify-between gap-4 text-sm">
                <span className="text-slate-400">Included add-on</span>
                <span className="text-right font-medium text-slate-100">{summary.addonPlan.name}</span>
              </div>
            ) : null}
            <div className="flex items-center justify-between gap-4 text-sm">
              <span className="text-slate-400">Coupon discount</span>
              <span className="font-medium text-emerald-200">
                {summary ? `-${formatPaise(summary.quote.discountAmountPaise, summary.quote.currency)}` : "--"}
              </span>
            </div>
            <div className="flex items-center justify-between gap-4 text-sm">
              <span className="text-slate-400">Taxable amount</span>
              <span className="font-medium text-slate-100">
                {summary ? formatPaise(summary.quote.taxableAmountPaise, summary.quote.currency) : "--"}
              </span>
            </div>
            <div className="flex items-center justify-between gap-4 text-sm">
              <span className="text-slate-400">
                {summary?.quote.taxTreatment === "EXPORT_UNDER_LUT" ? "Export under LUT (zero-rated)" : `GST ${summary ? `${summary.quote.gstPercentage}%` : ""}`}
              </span>
              <span className="font-medium text-slate-100">
                {summary ? formatPaise(summary.quote.gstAmountPaise, summary.quote.currency) : "--"}
              </span>
            </div>
            <div className="border-t border-slate-800 pt-4">
              <div className="flex items-end justify-between gap-4">
                <span className="text-sm font-semibold text-slate-200">Final payable</span>
                <div className="text-right">
                  {/* Struck figure = what this order costs at the regular price
                      the plan moves to once the introductory period ends. */}
                  {regularOrderTotalPaise !== null ? (
                    <span className="block text-sm font-medium text-slate-500 line-through">
                      {formatPaise(regularOrderTotalPaise, summary!.quote.currency)}
                    </span>
                  ) : null}
                  <span className="block text-3xl font-semibold text-slate-100">
                    {summary ? formatPaise(summary.quote.finalAmountPaise, summary.quote.currency) : "--"}
                  </span>
                </div>
              </div>

              {summary && totalSavingPaise > 0 ? (
                <p className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-400/25 bg-emerald-500/10 px-3 py-2 text-sm font-semibold text-emerald-100">
                  <span>{summary.coupon?.description || INTRODUCTORY_OFFER_LABEL}</span>
                  <span className="shrink-0">
                    You save {formatPaise(totalSavingPaise, summary.quote.currency)}
                  </span>
                </p>
              ) : null}
            </div>
          </div>

          <div className="mt-5 rounded-2xl border border-slate-800 bg-slate-950/30 p-4">
            <label htmlFor="coupon" className="text-sm font-semibold text-slate-100">
              Coupon code
            </label>
            <div className="mt-3 flex gap-2">
              <input
                id="coupon"
                value={couponInput}
                onChange={(event) => {
                  setCouponInput(event.target.value.toUpperCase())
                  if (error) {
                    setError("")
                  }
                }}
                disabled={isBusy}
                placeholder="WELCOME10"
                className="min-w-0 flex-1 rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-blue-400 disabled:opacity-60"
              />
              <button
                type="button"
                onClick={handleApplyCoupon}
                disabled={isBusy || !couponInput.trim()}
                className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-sm font-semibold text-slate-100 transition hover:border-blue-500/60 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Apply
              </button>
            </div>

            {appliedCoupon ? (
              <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-100">
                <span>{appliedCoupon} active</span>
                <button type="button" onClick={handleRemoveCoupon} disabled={isBusy} className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-100/80 hover:text-emerald-50">
                  Remove
                </button>
              </div>
            ) : null}
          </div>

          {notice ? (
            <div className="mt-4 rounded-xl border border-blue-500/20 bg-blue-500/10 px-4 py-3 text-sm leading-6 text-blue-100">
              {notice}
            </div>
          ) : null}

          {error ? (
            <div className="mt-4 rounded-xl border border-rose-400/25 bg-rose-500/10 px-4 py-3 text-sm leading-6 text-rose-100">
              {error}
            </div>
          ) : null}

          {billingCountryRequired ? (
            <div className="mt-4 rounded-xl border border-amber-400/25 bg-amber-500/10 px-4 py-3">
              <p className="text-sm font-semibold text-amber-100">Confirm your billing country</p>
              <p className="mt-1 text-xs leading-5 text-amber-100/80">
                Tax on this order depends on where your organization is registered. The tax shown
                above is an estimate until you confirm it.
              </p>
              <div className="mt-3 flex gap-2">
                <input
                  value={billingCountryInput}
                  onChange={(event) =>
                    setBillingCountryInput(event.target.value.toUpperCase().slice(0, 2))
                  }
                  placeholder="IN"
                  maxLength={2}
                  aria-label="Billing country ISO code"
                  className="w-24 rounded-lg border border-amber-400/30 bg-slate-950 px-3 py-2 text-sm uppercase text-white outline-none transition placeholder:text-slate-600 focus:border-amber-300"
                />
                <button
                  type="button"
                  onClick={handleConfirmBillingCountry}
                  disabled={
                    confirmingBillingCountry ||
                    isBusy ||
                    !/^[A-Za-z]{2}$/.test(billingCountryInput.trim())
                  }
                  className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-55"
                >
                  {confirmingBillingCountry ? "Saving..." : "Confirm"}
                </button>
              </div>
            </div>
          ) : null}

          <button
            type="button"
            onClick={handleProceedToPayment}
            disabled={!summary || isBusy || billingCountryRequired || status === "success"}
            className="hv-solid-action mt-6 w-full rounded-xl bg-blue-600 px-5 py-4 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-55"
          >
            {billingCountryRequired
              ? "Confirm billing country to continue"
              : status === "paying"
              ? "Opening Razorpay..."
              : status === "verifying"
                ? "Verifying payment..."
                : status === "success"
                  ? "Payment verified"
                  : "Proceed to Secure Payment"}
          </button>

          <p className="mt-4 text-center text-xs leading-5 text-slate-500">
            Secured by Razorpay. Your credits are added to the workspace as soon as payment is
            confirmed, and a tax invoice is issued automatically.
          </p>

          {activeOrderId ? (
            <p className="mt-3 truncate text-center text-[11px] uppercase tracking-[0.18em] text-slate-600">
              Order {activeOrderId}
            </p>
          ) : null}
        </aside>

        <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 sm:p-7">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">How billing works</p>
          <ol className="mt-4 space-y-4">
            {HOW_BILLING_WORKS_STEPS.map((step, index) => (
              <li key={step.title} className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-slate-700 bg-slate-950 text-[11px] font-bold text-slate-300">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div>
                  <p className="text-sm font-semibold text-slate-100">{step.title}</p>
                  <p className="mt-0.5 text-xs leading-5 text-slate-400">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>

          <div className="mt-6 border-t border-slate-800 pt-5">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Good to know</p>
            <ul className="mt-3 space-y-2">
              {GOOD_TO_KNOW_ITEMS.map((item) => (
                <li key={item} className="flex items-start gap-2 text-xs leading-5 text-slate-400">
                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-slate-600" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>
        </div>
      </section>
    </main>
  )
}

/**
 * One plan within the active product's card grid. Every figure it renders
 * (name, price, quantity, features) is read directly off the `plan` object
 * from /api/plans - which is itself backed by the authoritative billing
 * catalog (see getActiveBillingPlans in lib/server/services/billing.ts) -
 * never computed or hardcoded here.
 */
type ComparisonCellValue = "yes" | "no" | "addon"
type ComparisonRowDef = { label: string; values: Record<ProductKey, ComparisonCellValue> }

/**
 * Secondary, product-vs-product capability matrix - "what's the difference",
 * not "how much does each tier cost" (pricing lives in the plan cards only).
 *
 * Grouped into two sections:
 *  - Candidate Evaluation: cells are derived from the real `plans` data (does
 *    any plan of this product type actually carry this quantity/capability?)
 *    plus code-verified capabilities (Interview Intelligence, Integrity Risk
 *    Signals, Recordings/Replay - see app/recordings/[recordingId] and the
 *    interview/assessment integrity-signal pipelines). VERIS Screening never
 *    gets integrity signals or recordings - it is a resume-to-role match, not
 *    a monitored candidate session.
 *  - Recruiter Workspace: these are workspace-level dashboard capabilities
 *    gated by user role (see lib/client/permissions.js), not by which product
 *    a plan sells - any active paid organization gets them regardless of
 *    which product tab it purchased, so every column is truthfully "yes".
 */
function ProductComparisonTable({ plans }: { plans: Plan[] }) {
  const plansByType = useMemo(() => {
    const map = new Map<ProductKey, Plan[]>()
    for (const product of PRODUCT_DEFS) {
      map.set(product.key, plans.filter((plan) => plan.planType === product.key))
    }
    return map
  }, [plans])

  const hasAny = (key: ProductKey, pick: (plan: Plan) => number) =>
    (plansByType.get(key) ?? []).some((plan) => pick(plan) > 0)
  const hasScreeningAddon = (plansByType.get("SCREENING") ?? []).length > 0

  const candidateEvaluationRows: ComparisonRowDef[] = [
    {
      label: "AI Interview",
      values: {
        BUNDLE: hasAny("BUNDLE", (p) => p.interviewSessions) ? "yes" : "no",
        INTERVIEW: hasAny("INTERVIEW", (p) => p.interviewSessions) ? "yes" : "no",
        ASSESSMENT: "no",
        SCREENING: "no",
      },
    },
    {
      label: "VERIS Assessment",
      values: {
        BUNDLE: hasAny("BUNDLE", (p) => p.assessmentCredits) ? "yes" : "no",
        INTERVIEW: "no",
        ASSESSMENT: hasAny("ASSESSMENT", (p) => p.assessmentCredits) ? "yes" : "no",
        SCREENING: "no",
      },
    },
    {
      label: "VERIS Screening",
      values: {
        BUNDLE: hasAny("BUNDLE", (p) => p.screeningReviews) ? "yes" : "no",
        // Interview plans themselves carry 0 screening reviews, but the
        // existing "With VERIS Screening" add-on (see PlanComparison) lets a
        // recruiter attach real screening capacity to an Interview plan -
        // a verified capability, not an invented one.
        INTERVIEW: hasScreeningAddon ? "addon" : "no",
        ASSESSMENT: "no",
        SCREENING: hasAny("SCREENING", (p) => p.screeningReviews) ? "yes" : "no",
      },
    },
    {
      label: "Interview Intelligence",
      values: { BUNDLE: "yes", INTERVIEW: "yes", ASSESSMENT: "no", SCREENING: "no" },
    },
    {
      label: "Integrity Risk Signals",
      values: { BUNDLE: "yes", INTERVIEW: "yes", ASSESSMENT: "yes", SCREENING: "no" },
    },
    {
      // Non-negotiable per product design: Assessment and Screening never
      // include recordings/replay - only the AI Interview capability does.
      label: "Recordings / Replay",
      values: { BUNDLE: "yes", INTERVIEW: "yes", ASSESSMENT: "no", SCREENING: "no" },
    },
  ]

  // Workspace features are role-gated, not product-gated (see
  // lib/client/permissions.js) - every paid organization gets the same
  // dashboard regardless of which product it buys, so every column is "yes".
  const workspaceIncluded: Record<ProductKey, ComparisonCellValue> = {
    BUNDLE: "yes",
    INTERVIEW: "yes",
    ASSESSMENT: "yes",
    SCREENING: "yes",
  }
  const recruiterWorkspaceRows: ComparisonRowDef[] = [
    "Create & Manage Jobs",
    "Candidate Management",
    "Interview Queue",
    "Review Flags",
    "Reports & Insights",
    "VERIS AI",
    "Universal Search",
    "Manage Teams",
    "Alerts",
  ].map((label) => ({ label, values: workspaceIncluded }))

  const hasAddonRow = candidateEvaluationRows.some((row) => Object.values(row.values).includes("addon"))

  return (
    <div className="mt-5 -mx-1 overflow-x-auto px-1">
      <table className="min-w-[560px] w-full table-fixed border-collapse text-left text-sm">
        <colgroup>
          <col className="w-[34%]" />
          {PRODUCT_DEFS.map((product) => (
            <col key={product.key} className="w-[16.5%]" />
          ))}
        </colgroup>
        <thead>
          <tr>
            <th scope="col" className="pb-3 pr-2 align-bottom text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-500">
              &nbsp;
            </th>
            {PRODUCT_DEFS.map((product) => (
              <th
                key={product.key}
                scope="col"
                className="pb-3 px-1.5 text-center text-[10px] font-bold uppercase leading-tight tracking-[0.06em] text-slate-300"
              >
                {product.label}
              </th>
            ))}
          </tr>
        </thead>
        <ComparisonGroup title="Candidate Evaluation" rows={candidateEvaluationRows} />
        <ComparisonGroup title="Recruiter Workspace" rows={recruiterWorkspaceRows} />
      </table>
      {hasAddonRow ? (
        <p className="mt-3 text-[11px] leading-5 text-slate-500">
          * VERIS Screening can be added to an AI Interview plan as an optional add-on.
        </p>
      ) : null}
    </div>
  )
}

function ComparisonGroup({ title, rows }: { title: string; rows: ComparisonRowDef[] }) {
  return (
    <tbody>
      <tr className="border-t border-slate-800">
        <th
          colSpan={PRODUCT_DEFS.length + 1}
          scope="colgroup"
          className="pb-1.5 pt-4 text-left text-[10px] font-bold uppercase tracking-[0.14em] text-blue-300/80"
        >
          {title}
        </th>
      </tr>
      {rows.map((row) => (
        <tr key={row.label} className="border-t border-slate-800/70">
          <th scope="row" className="py-3 pr-2 text-xs font-medium text-slate-300">
            {row.label}
          </th>
          {PRODUCT_DEFS.map((product) => (
            <td key={product.key} className="py-3 px-1.5 text-center">
              <ComparisonCell value={row.values[product.key]} />
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  )
}

function ComparisonCell({ value }: { value: "yes" | "no" | "addon" }) {
  if (value === "yes") {
    return <CheckGlyph className="mx-auto h-4 w-4 text-emerald-400" />
  }
  if (value === "addon") {
    return <span className="text-xs font-semibold text-blue-300">Add-on*</span>
  }
  return <span className="text-slate-700">&mdash;</span>
}

function PlanCard({
  plan,
  isSelected,
  isFlagship,
  disabled,
  onSelect,
}: {
  plan: Plan
  isSelected: boolean
  isFlagship: boolean
  disabled: boolean
  onSelect: () => void
}) {
  const regularPaise = getRegularAmountPaise(plan.slug, plan.currency, plan.amountPaise)
  const discounted = regularPaise !== null && regularPaise > plan.amountPaise

  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      aria-pressed={isSelected}
      className={`flex h-full flex-col rounded-2xl border p-4 text-left transition disabled:cursor-not-allowed disabled:opacity-60 ${
        isSelected
          ? "border-blue-400 bg-blue-500/10 ring-1 ring-blue-400/40"
          : isFlagship
            ? "border-violet-400/40 bg-violet-500/[0.06] hover:border-violet-300/60"
            : "border-slate-800 bg-slate-950 hover:border-slate-600"
      }`}
    >
      <div className="flex h-[18px] items-center">
        {isFlagship ? (
          <span className="whitespace-nowrap rounded-full bg-[#7c3aed] px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.08em] text-white">
            Most popular
          </span>
        ) : null}
      </div>

      <span className="mt-1.5 block text-sm font-bold uppercase tracking-[0.04em] text-slate-100">{plan.name}</span>

      <span className="mt-3 flex flex-wrap items-baseline gap-x-2">
        {discounted ? (
          <span className="text-sm font-medium text-slate-500 line-through">
            {formatPaise(regularPaise, plan.currency)}
          </span>
        ) : null}
        <span className="text-2xl font-semibold text-slate-100">{formatPaise(plan.amountPaise, plan.currency)}</span>
      </span>

      {/* Primary purchased quantities - the thing being bought - get the
          bigger check treatment. Secondary "included capabilities" below use
          the same check icon at a visibly smaller weight so the hierarchy
          (what you get vs. what's included) is unambiguous at a glance. */}
      <ul className="mt-3 space-y-1.5">
        {planQuantityLines(plan).map((line) => (
          <li key={line} className="flex items-center gap-2 text-sm font-bold text-slate-100">
            <CheckGlyph className="h-4 w-4 shrink-0 text-emerald-400" />
            <span>{line}</span>
          </li>
        ))}
      </ul>

      {plan.features?.length ? (
        <div className="mt-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Includes</p>
          <ul className="mt-2 space-y-1.5">
            {plan.features.slice(0, 4).map((feature) => (
              <li key={feature} className="flex items-start gap-2 text-xs leading-5 text-slate-400">
                <CheckGlyph className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400/80" />
                <span>{feature}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <span
        className={`mt-4 block rounded-lg px-3 py-2 text-center text-xs font-semibold ${
          isSelected ? "bg-blue-500 text-white" : "border border-slate-700 bg-slate-900 text-slate-200"
        }`}
      >
        {isSelected
          ? "Selected"
          : plan.planType === "BUNDLE"
            ? "Get the Hiring Suite"
            : "Select Plan"}
      </span>
    </button>
  )
}

function CheckGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  )
}
