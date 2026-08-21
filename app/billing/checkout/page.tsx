"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"

import { VerisGlobeLoader } from "@/components/system/loaders"
import { buildAuthUrl } from "@/lib/client/auth-query"
import { formatMinorAmount } from "@/lib/pricing/currency"
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
const TRUST_INDICATORS = [
  "Tax Invoice Available",
  "Secure Razorpay Processing",
  "Organization Billing",
  "Audit-ready payment records",
]

/**
 * Delegates to the shared formatter so a price reads the same here as on the
 * pricing page. This used to hardcode the en-IN locale for every currency,
 * which applied Indian lakh grouping to USD/GBP/EUR and always forced two
 * decimals ("£159.00" against the pricing page's "£159").
 */
function formatPaise(value: number, currency = "INR") {
  return formatMinorAmount(value, currency)
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

  const isBusy = status === "loading" || status === "applying" || status === "paying" || status === "verifying"
  const appliedCoupon = useMemo(() => appliedCouponCode.trim().toUpperCase(), [appliedCouponCode])
  const interviewPlans = useMemo(
    () => plans.filter((plan) => plan.planType !== "SCREENING"),
    [plans]
  )
  const screeningPlans = useMemo(
    () => plans.filter((plan) => plan.planType === "SCREENING"),
    [plans]
  )
  const selectedPlan = useMemo(
    () => plans.find((plan) => plan.slug === selectedPlanSlug) ?? null,
    [plans, selectedPlanSlug]
  )

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
        "hireveri-billing-success",
        JSON.stringify({
          title: "Subscription activated",
          message: `${activatedPlanName} is live for ${summary?.organization.organizationName || "your organization"}.`,
        })
      )
      window.sessionStorage.removeItem("hireveri-overview")
    } catch {
      // Non-critical; dashboard still redirects correctly.
    }

    setStatus("success")
    setNotice("Payment verified. Redirecting to recruiter dashboard.")
    router.replace("/")
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
      })
      setActiveOrderId(order.order_id)
      setNotice("Opening Razorpay secure checkout.")

      let handledBySuccess = false
      const checkout = new window.Razorpay({
        key: order.keyId,
        amount: order.amount,
        currency: order.currency,
        name: "HireVeri",
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
      <main className="hv-preserve-dark min-h-screen bg-[#08111f] text-slate-100">
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
    <main className="hv-preserve-dark min-h-screen overflow-hidden bg-[#08111f] px-4 py-8 text-slate-100 sm:px-6 lg:px-8">
      <div className="pointer-events-none fixed inset-0 bg-[linear-gradient(180deg,rgba(15,23,42,0.92),rgba(7,12,22,0.98)),radial-gradient(circle_at_50%_0%,rgba(37,99,235,0.12),transparent_34%)]" />

      <section className="relative mx-auto grid w-full max-w-6xl gap-6 lg:grid-cols-[minmax(0,0.95fr)_minmax(360px,0.7fr)]">
        <div className="rounded-2xl border border-slate-800 bg-[#0b1220]/95 p-6 shadow-[0_24px_80px_rgba(2,6,23,0.34)] sm:p-8">
          <p className="text-[11px] font-semibold uppercase tracking-[0.32em] text-blue-200/75">
            Enterprise Billing Checkout
          </p>
          <h1 className="mt-5 max-w-2xl text-3xl font-semibold leading-tight text-slate-50 sm:text-5xl">
            Activate HireVeri for your organization
          </h1>
          <p className="mt-5 max-w-2xl text-sm leading-7 text-slate-300 sm:text-base">
            A server-verified procurement flow for organization billing, country-aware tax records, and controlled subscription activation.
          </p>

          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            <div className="rounded-xl border border-slate-800 bg-slate-950/35 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Bill to</p>
              <p className="mt-3 truncate text-sm font-semibold text-slate-50">
                {summary?.organization.organizationName || "Select a plan"}
              </p>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-950/35 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Interview Credits</p>
              <p className="mt-3 text-2xl font-semibold text-slate-100">
                {summary?.plan.interviewSessions ?? "--"}
              </p>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-950/35 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Screening Reviews</p>
              <p className="mt-3 text-2xl font-semibold text-slate-100">
                {summary ? summary.plan.screeningReviews + (summary.addonPlan?.screeningReviews ?? 0) : "--"}
              </p>
            </div>
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            {TRUST_INDICATORS.map((indicator) => (
              <div key={indicator} className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-950/30 px-4 py-3 text-sm text-slate-300">
                <span className="h-1.5 w-1.5 rounded-full bg-blue-400/80" />
                <span>{indicator}</span>
              </div>
            ))}
          </div>

          <div className="mt-8 rounded-2xl border border-slate-800 bg-[#0f172a]/82 p-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-blue-200">Selected plan</p>
                <h2 className="mt-2 text-3xl font-semibold text-slate-50">{summary?.plan.name || selectedPlan?.name || "Choose a plan"}</h2>
                <p className="mt-2 max-w-xl text-sm leading-6 text-slate-300">
                  {summary?.plan.description || selectedPlan?.description || "Select a database-priced HireVeri plan to generate a secure billing quote."}
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
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-slate-100">Available plans</p>
                <p className="mt-1 text-xs text-slate-500">Plans are loaded from HireVeri billing records.</p>
              </div>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {interviewPlans.map((plan) => {
                const isSelected = selectedPlanSlug === plan.slug
                return (
                  <button
                    key={plan.id}
                    type="button"
                    onClick={() => updateCheckoutSelection(plan.slug, "")}
                    className={`rounded-xl border p-4 text-left transition ${
                      isSelected
                        ? "border-blue-400/45 bg-blue-500/10"
                        : "border-slate-800 bg-[#0b1220] hover:border-slate-600"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-white">{plan.name}</p>
                        <p className="mt-1 text-xs leading-5 text-slate-400">{plan.description}</p>
                      </div>
                      <p className="shrink-0 text-sm font-semibold text-slate-100">{formatPaise(plan.amountPaise, plan.currency)}</p>
                    </div>
                    <p className="mt-3 text-xs text-slate-500">
                      {plan.interviewSessions} interviews · {plan.screeningReviews} screening reviews
                    </p>
                  </button>
                )
              })}
            </div>

            {screeningPlans.length > 0 ? (
              <div className="mt-5 border-t border-slate-800 pt-5">
                <p className="text-sm font-semibold text-slate-100">Standalone VERIS Screening</p>
                <p className="mt-1 text-xs text-slate-500">Buy screening capacity independently without changing interview credits.</p>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  {screeningPlans.map((plan) => {
                    const isSelected = selectedPlanSlug === plan.slug
                    return (
                      <button
                        key={plan.id}
                        type="button"
                        onClick={() => updateCheckoutSelection(plan.slug, "")}
                        className={`rounded-xl border p-4 text-left transition ${
                          isSelected
                            ? "border-blue-400/45 bg-blue-500/10"
                            : "border-slate-800 bg-[#0b1220] hover:border-slate-600"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-white">{plan.name}</p>
                            <p className="mt-1 text-xs text-slate-400">{plan.screeningReviews} screening reviews</p>
                          </div>
                          <p className="shrink-0 text-sm font-semibold text-slate-100">{formatPaise(plan.amountPaise, plan.currency)}</p>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>
            ) : null}

            {selectedPlan && selectedPlan.planType !== "SCREENING" && screeningPlans.length > 0 ? (
              <div className="mt-5 border-t border-slate-800 pt-5">
                <p className="text-sm font-semibold text-slate-100">Optional VERIS Screening add-on</p>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => updateCheckoutSelection(selectedPlan.slug, "")}
                    className={`rounded-xl border p-4 text-left text-sm transition ${
                      !selectedAddonPlanSlug
                        ? "border-blue-400/45 bg-blue-500/10 text-white"
                        : "border-slate-800 bg-[#0b1220] text-slate-300 hover:border-slate-600"
                    }`}
                  >
                    No add-on
                  </button>
                  {screeningPlans.map((plan) => (
                    <button
                      key={plan.id}
                      type="button"
                      onClick={() => updateCheckoutSelection(selectedPlan.slug, plan.slug)}
                      className={`rounded-xl border p-4 text-left transition ${
                        selectedAddonPlanSlug === plan.slug
                          ? "border-blue-400/45 bg-blue-500/10"
                          : "border-slate-800 bg-[#0b1220] hover:border-slate-600"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-white">{plan.name}</p>
                          <p className="mt-1 text-xs text-slate-400">+{plan.screeningReviews} screening reviews</p>
                        </div>
                        <p className="shrink-0 text-sm font-semibold text-slate-100">{formatPaise(plan.amountPaise, plan.currency)}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {!plansLoading && plans.length === 0 ? (
              <p className="mt-4 rounded-xl border border-amber-400/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                No active billing plans are available. Please contact HireVeri support.
              </p>
            ) : null}
          </div>
        </div>

        <aside className="rounded-2xl border border-slate-800 bg-[linear-gradient(180deg,rgba(15,23,42,0.96),rgba(10,17,31,0.98))] p-6 shadow-[0_24px_80px_rgba(2,6,23,0.38)] sm:p-7">
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
                <span className="text-3xl font-semibold text-slate-50">
                  {summary ? formatPaise(summary.quote.finalAmountPaise, summary.quote.currency) : "--"}
                </span>
              </div>
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
                <button type="button" onClick={handleRemoveCoupon} disabled={isBusy} className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-100/80 hover:text-white">
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

          <button
            type="button"
            onClick={handleProceedToPayment}
            disabled={!summary || isBusy || status === "success"}
            className="mt-6 w-full rounded-xl bg-blue-600 px-5 py-4 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-55"
          >
            {status === "paying"
              ? "Opening Razorpay..."
              : status === "verifying"
                ? "Verifying payment..."
                : status === "success"
                  ? "Payment verified"
                  : "Proceed to Secure Payment"}
          </button>

          <p className="mt-4 text-center text-xs leading-5 text-slate-500">
            Subscription activates only after backend signature, order, amount, coupon, and organization verification.
          </p>

          {activeOrderId ? (
            <p className="mt-3 truncate text-center text-[11px] uppercase tracking-[0.18em] text-slate-600">
              Order {activeOrderId}
            </p>
          ) : null}
        </aside>
      </section>
    </main>
  )
}
