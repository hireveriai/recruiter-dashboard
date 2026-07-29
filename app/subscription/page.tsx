"use client"

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"

import Navbar from "@/components/Navbar"
import { VerisGlobeLoader } from "@/components/system/loaders"
import { buildAuthUrl } from "@/lib/client/auth-query"
import { isSessionJsonCacheFresh, readSessionJsonCache, writeSessionJsonCache } from "@/lib/client/session-json-cache"
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

function formatPaise(value: number, currency = "INR") {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(Number(value || 0) / 100)
}

function PlanCard({ plan, featured = false }: { plan: Plan; featured?: boolean }) {
  return (
    <article className={`flex h-full flex-col rounded-[28px] border p-5 shadow-[0_18px_70px_rgba(2,6,23,0.32)] transition duration-300 hover:-translate-y-1 ${
      featured
        ? "border-cyan-300/35 bg-[linear-gradient(180deg,rgba(8,47,73,0.45),rgba(15,23,42,0.96))]"
        : "border-slate-800 bg-[#0f172a]"
    }`}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-200/70">
            {plan.planType === "SCREENING" ? "Screening Add-on" : "Hiring Workspace"}
          </p>
          <h2 className="mt-3 text-2xl font-semibold text-white">{plan.name}</h2>
        </div>
        {featured || plan.isPopular ? (
          <span className="rounded-full border border-cyan-300/30 bg-cyan-400/12 px-3 py-1 text-xs font-semibold text-cyan-100">
            Popular
          </span>
        ) : null}
      </div>

      <p className="mt-4 min-h-[72px] text-sm leading-6 text-slate-300">{plan.description}</p>
      <p className="mt-5 text-4xl font-semibold text-white">{formatPaise(plan.amountPaise, plan.currency)}</p>

      <div className="mt-5 grid grid-cols-2 gap-3">
        <div className="rounded-2xl border border-slate-800 bg-slate-950/45 p-3">
          <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Interviews</p>
          <p className="mt-2 text-xl font-semibold text-white">{plan.interviewSessions}</p>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-950/45 p-3">
          <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Screenings</p>
          <p className="mt-2 text-xl font-semibold text-white">{plan.screeningReviews}</p>
        </div>
      </div>

      <ul className="mt-5 flex-1 space-y-2 text-sm text-slate-300">
        {(plan.features?.length ? plan.features : ["Workspace upgrade", "Verified Razorpay billing", "GST-ready invoices"]).slice(0, 6).map((feature) => (
          <li key={feature} className="flex gap-3">
            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-300/80" />
            <span>{feature}</span>
          </li>
        ))}
      </ul>

      <Link
        href={`/billing/checkout?plan=${encodeURIComponent(plan.slug)}`}
        className={`mt-6 inline-flex items-center justify-center rounded-xl px-5 py-3 text-sm font-semibold transition ${
          featured
            ? "border border-cyan-200/40 bg-cyan-300/18 text-cyan-50 hover:bg-cyan-300/24"
            : "border border-slate-700 bg-slate-950/55 text-slate-100 hover:border-cyan-300/35 hover:text-cyan-50"
        }`}
      >
        Upgrade Plan
      </Link>
    </article>
  )
}

export default function SubscriptionPage() {
  const searchParams = useAuthSearchParams()
  const cacheKey = `subscription:${searchParams.toString()}`
  const [plans, setPlans] = useState<Plan[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    let active = true
    const cached = readSessionJsonCache(cacheKey) as Plan[] | null

    if (cached) {
      window.queueMicrotask(() => {
        if (active) {
          setPlans(cached)
          setLoading(false)
        }
      })
    }

    if (cached && isSessionJsonCacheFresh(cacheKey)) {
      return () => {
        active = false
      }
    }

    async function loadPlans() {
      try {
        if (!cached) {
          setLoading(true)
        }
        const response = await fetch(buildAuthUrl("/api/plans", searchParams), {
          credentials: "include",
          cache: "default",
        })
        const payload = await response.json().catch(() => null)

        if (!active) {
          return
        }

        if (!response.ok || !payload?.success) {
          throw new Error(payload?.error?.message || "Unable to load subscription plans.")
        }

        setPlans(payload.data?.plans ?? [])
        writeSessionJsonCache(cacheKey, payload.data?.plans ?? [])
        setError("")
      } catch (loadError) {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : "Unable to load subscription plans.")
        }
      } finally {
        if (active) {
          setLoading(false)
        }
      }
    }

    void loadPlans()

    return () => {
      active = false
    }
  }, [cacheKey, searchParams])

  const interviewPlans = useMemo(
    () => plans.filter((plan) => plan.planType !== "SCREENING"),
    [plans]
  )
  const screeningPlans = useMemo(
    () => plans.filter((plan) => plan.planType === "SCREENING"),
    [plans]
  )

  if (loading) {
    return (
      <main className="hv-preserve-dark min-h-screen bg-[#08111f] text-white">
        <Navbar onSendInterviewClick={() => undefined} />
        <VerisGlobeLoader
          eyebrow="Subscription"
          viewportOffset="navbar"
          steps={[
            { label: "Loading plans", detail: "Fetching active workspace and available subscription plans." },
            { label: "Checking capacity", detail: "Reading interview sessions and VERIS Screening add-ons." },
            { label: "Preparing pricing", detail: "Building the upgrade choices for checkout." },
            { label: "Plans ready", detail: "Subscription options are ready for review." },
          ]}
          activeIndex={1}
        />
      </main>
    )
  }

  return (
    <main className="hv-preserve-dark min-h-screen bg-[#08111f] text-white">
      <Navbar onSendInterviewClick={() => undefined} />
      <div className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 md:pl-28 lg:px-8 lg:pl-32">
        <section className="overflow-hidden rounded-[32px] border border-cyan-400/16 bg-[radial-gradient(circle_at_18%_0%,rgba(34,211,238,0.16),transparent_28%),linear-gradient(135deg,rgba(15,23,42,0.98),rgba(2,6,23,0.94))] p-6 shadow-[0_24px_90px_rgba(2,6,23,0.42)] sm:p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.32em] text-cyan-200/75">HireVeri Subscription</p>
          <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-end">
            <div>
              <h1 className="text-4xl font-semibold tracking-tight text-white sm:text-5xl">
                Upgrade your workspace instantly.
              </h1>
              <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-300 sm:text-base">
                Compare plans, add interview and VERIS Screening capacity, and activate your organization through a server-verified Razorpay checkout.
              </p>
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
              <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Activation Path</p>
              <div className="mt-3 space-y-2 text-sm text-slate-300">
                <p>1. Select a plan</p>
                <p>2. Verify checkout quote</p>
                <p>3. Pay securely</p>
                <p>4. Workspace credits activate instantly</p>
              </div>
            </div>
          </div>
        </section>

        {error ? (
          <div className="mt-6 rounded-2xl border border-rose-400/25 bg-rose-500/10 px-5 py-4 text-sm text-rose-100">
            {error}
          </div>
        ) : null}

        <section className="mt-8">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-500">Plans</p>
              <h2 className="mt-2 text-2xl font-semibold text-white">Interview workspace plans</h2>
            </div>
            <Link
              href="/billing"
              className="hidden rounded-xl border border-slate-700 px-4 py-2.5 text-sm font-semibold text-slate-200 transition hover:border-cyan-300/35 hover:text-white sm:inline-flex"
            >
              Billing History
            </Link>
          </div>
          <div className="mt-5 grid gap-5 lg:grid-cols-3">
            {interviewPlans.map((plan, index) => (
              <PlanCard key={plan.id} plan={plan} featured={plan.isPopular || index === 1} />
            ))}
          </div>
        </section>

        {screeningPlans.length > 0 ? (
          <section className="mt-10">
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-500">Add-ons</p>
            <h2 className="mt-2 text-2xl font-semibold text-white">VERIS Screening capacity</h2>
            <div className="mt-5 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              {screeningPlans.map((plan) => (
                <PlanCard key={plan.id} plan={plan} />
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </main>
  )
}
