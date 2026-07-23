"use client"

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"

import BackToDashboardLink from "@/components/BackToDashboardLink"
import Navbar from "@/components/Navbar"
import { VerisGlobeLoader } from "@/components/system/loaders"
import { buildAuthUrl } from "@/lib/client/auth-query"
import { isSessionJsonCacheFresh, readSessionJsonCache, writeSessionJsonCache } from "@/lib/client/session-json-cache"
import { useAuthSearchParams } from "@/lib/client/use-auth-search-params"

type Invoice = {
  id: string
  invoiceNumber: string
  invoiceDate: string
  planName: string
  finalAmountPaise: number
  currency: string
  couponCode: string | null
  razorpayOrderId: string | null
  razorpayPaymentId: string | null
  emailSentAt: string | null
}

type Payment = {
  id: string
  planId: string | null
  planName: string | null
  invoiceNumber: string | null
  invoiceId: string | null
  couponCode: string | null
  taxableAmountPaise: number
  gstAmountPaise: number
  discountAmountPaise: number
  amount: number
  currency: string
  status: string
  razorpayOrderId: string | null
  razorpayPaymentId: string | null
  createdAt: string
}

type Subscription = {
  id: string
  planName: string | null
  planId: string
  status: string
  totalCredits: number
  usedCredits: number
  screeningCredits: number
  usedScreeningCredits: number
  amountPaid: number
  currency: string
  activatedAt: string | null
  expiresAt: string | null
}

type BillingData = {
  organization: {
    organizationId: string
    organizationName: string
    gstNumber: string | null
    billingAddress: string | null
    financeEmail: string | null
    invoiceRecipientEmail: string | null
  } | null
  invoices: Invoice[]
  payments: Payment[]
  subscriptions: Subscription[]
}

function formatPaise(value: number, currency = "INR") {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(Number(value || 0) / 100)
}

function formatDate(value: string | null) {
  if (!value) {
    return "-"
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return "-"
  }

  return new Intl.DateTimeFormat("en-IN", {
    year: "numeric",
    month: "short",
    day: "2-digit",
  }).format(date)
}

function CompactReference({ value, maxWidth = "max-w-[150px]" }: { value: string | null; maxWidth?: string }) {
  if (!value) {
    return <span>-</span>
  }

  return (
    <span title={value} className={`block truncate font-mono text-[11px] text-slate-400 ${maxWidth}`}>
      {value}
    </span>
  )
}

function StatusBadge({ status }: { status: string }) {
  const normalized = status.toLowerCase()
  const tone =
    normalized === "success" || normalized === "active"
      ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-100"
      : normalized === "pending"
        ? "border-amber-500/25 bg-amber-500/10 text-amber-100"
        : "border-slate-700 bg-slate-900 text-slate-300"

  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold capitalize ${tone}`}>
      {status}
    </span>
  )
}

function CreditUsageCard({
  title,
  total,
  used,
  accent = "blue",
}: {
  title: string
  total: number
  used: number
  accent?: "blue" | "cyan"
}) {
  const safeTotal = Math.max(0, Number(total || 0))
  const safeUsed = Math.min(safeTotal, Math.max(0, Number(used || 0)))
  const remaining = Math.max(0, safeTotal - safeUsed)
  const percentage = safeTotal > 0 ? Math.round((safeUsed / safeTotal) * 100) : 0
  const usedDegrees = percentage * 3.6
  const accentColor = accent === "cyan" ? "#22d3ee" : "#3b82f6"
  const accentGlow = accent === "cyan" ? "rgba(34,211,238,0.28)" : "rgba(59,130,246,0.28)"
  const accentText = accent === "cyan" ? "text-cyan-200" : "text-blue-200"
  const accentBorder = accent === "cyan" ? "border-cyan-300/20" : "border-blue-300/20"
  const accentBg = accent === "cyan" ? "bg-cyan-400/10" : "bg-blue-500/10"

  return (
    <div className="relative overflow-hidden rounded-2xl border border-slate-800 bg-slate-950/35 p-5">
      <div aria-hidden="true" className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(34,211,238,0.08),transparent_34%),radial-gradient(circle_at_bottom_left,rgba(59,130,246,0.08),transparent_38%)]" />
      <div className="relative flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-white">{title}</p>
          <p className="mt-1 text-xs text-slate-500">Purchased, used, and remaining credits</p>
        </div>
        <span className={`rounded-full border ${accentBorder} ${accentBg} px-2.5 py-1 text-xs font-semibold ${accentText}`}>
          {percentage}% used
        </span>
      </div>

      <div className="relative mt-5 grid gap-5 sm:grid-cols-[148px_1fr] sm:items-center">
        <div
          aria-label={`${title}: ${percentage}% used`}
          className="relative mx-auto flex h-36 w-36 items-center justify-center rounded-full border border-slate-700/80 shadow-[0_0_34px_rgba(15,23,42,0.7)] sm:mx-0"
          role="img"
          style={{
            background: `conic-gradient(${accentColor} 0deg ${usedDegrees}deg, rgba(30,41,59,0.95) ${usedDegrees}deg 360deg)`,
            boxShadow: `0 0 34px ${accentGlow}, inset 0 0 24px rgba(2,6,23,0.7)`,
          }}
        >
          <div className="absolute inset-3 rounded-full border border-slate-800 bg-slate-950" />
          <div className="absolute inset-6 rounded-full border border-slate-800/80 bg-[radial-gradient(circle_at_50%_20%,rgba(255,255,255,0.08),transparent_42%),#08111f]" />
          <div className="relative text-center">
            <p className="text-3xl font-semibold tracking-tight text-white">{percentage}%</p>
            <p className={`mt-1 text-[10px] font-semibold uppercase tracking-[0.18em] ${accentText}`}>Used</p>
          </div>
        </div>

        <div className="min-w-0">
          <div className="grid grid-cols-3 gap-3 text-sm">
            <div>
              <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Purchased</p>
              <p className="mt-2 text-xl font-semibold text-white">{safeTotal}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Used</p>
              <p className="mt-2 text-xl font-semibold text-white">{safeUsed}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Remaining</p>
              <p className="mt-2 text-xl font-semibold text-white">{remaining}</p>
            </div>
          </div>
          <div className="mt-5 grid gap-2 text-xs text-slate-400 sm:grid-cols-2">
            <div className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/50 px-3 py-2">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: accentColor }} />
              <span>Used credits</span>
            </div>
            <div className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/50 px-3 py-2">
              <span className="h-2.5 w-2.5 rounded-full bg-slate-700" />
              <span>Remaining credits</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function BillingPage() {
  const searchParams = useAuthSearchParams()
  const cacheKey = `billing:${searchParams.toString()}`
  const initialData = readSessionJsonCache(cacheKey) as BillingData | null
  const [data, setData] = useState<BillingData>(() => initialData ?? { organization: null, invoices: [], payments: [], subscriptions: [] })
  const [settings, setSettings] = useState(() => ({
    gstNumber: initialData?.organization?.gstNumber ?? "",
    billingAddress: initialData?.organization?.billingAddress ?? "",
    financeEmail: initialData?.organization?.financeEmail ?? "",
    invoiceRecipientEmail: initialData?.organization?.invoiceRecipientEmail ?? "",
  }))
  const [loading, setLoading] = useState(() => !initialData)
  const [savingSettings, setSavingSettings] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [paymentFilters, setPaymentFilters] = useState({
    status: "all",
    query: "",
    startDate: "",
    endDate: "",
  })
  const activeSubscription = useMemo(
    () => data.subscriptions.find((subscription) => subscription.status === "active") ?? data.subscriptions[0] ?? null,
    [data.subscriptions]
  )
  const lastSuccessfulPayment = useMemo(
    () => data.payments.find((payment) => payment.status === "success") ?? data.payments[0] ?? null,
    [data.payments]
  )
  const paymentStatuses = useMemo(
    () => Array.from(new Set(data.payments.map((payment) => payment.status).filter(Boolean))).sort(),
    [data.payments]
  )
  const filteredPayments = useMemo(() => {
    const query = paymentFilters.query.trim().toLowerCase()
    const startTime = paymentFilters.startDate ? new Date(`${paymentFilters.startDate}T00:00:00`).getTime() : null
    const endTime = paymentFilters.endDate ? new Date(`${paymentFilters.endDate}T23:59:59`).getTime() : null

    return data.payments.filter((payment) => {
      const createdTime = new Date(payment.createdAt).getTime()
      const matchesStatus = paymentFilters.status === "all" || payment.status === paymentFilters.status
      const matchesStart = startTime === null || createdTime >= startTime
      const matchesEnd = endTime === null || createdTime <= endTime
      const searchable = [
        payment.invoiceNumber,
        payment.planName,
        payment.planId,
        payment.couponCode,
        payment.razorpayPaymentId,
        payment.razorpayOrderId,
        payment.status,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()

      return matchesStatus && matchesStart && matchesEnd && (!query || searchable.includes(query))
    })
  }, [data.payments, paymentFilters])
  const filtersApplied = paymentFilters.status !== "all" || paymentFilters.query.trim() || paymentFilters.startDate || paymentFilters.endDate

  useEffect(() => {
    let active = true
    const cached = readSessionJsonCache(cacheKey) as BillingData | null

    if (cached) {
      window.queueMicrotask(() => {
        if (!active) {
          return
        }

        setData(cached)
        setSettings({
          gstNumber: cached.organization?.gstNumber ?? "",
          billingAddress: cached.organization?.billingAddress ?? "",
          financeEmail: cached.organization?.financeEmail ?? "",
          invoiceRecipientEmail: cached.organization?.invoiceRecipientEmail ?? "",
        })
        setLoading(false)
      })
    }

    if (cached && isSessionJsonCacheFresh(cacheKey)) {
      return () => {
        active = false
      }
    }

    async function loadBilling() {
      try {
        const response = await fetch(buildAuthUrl("/api/billing/overview", searchParams), {
          credentials: "include",
          cache: "default",
        })
        const payload = await response.json()

        if (!active) {
          return
        }

        if (!response.ok || !payload?.success) {
          throw new Error(payload?.error?.message || "Unable to load billing history.")
        }

        setData(payload.data)
        writeSessionJsonCache(cacheKey, payload.data)
        setSettings({
          gstNumber: payload.data.organization?.gstNumber ?? "",
          billingAddress: payload.data.organization?.billingAddress ?? "",
          financeEmail: payload.data.organization?.financeEmail ?? "",
          invoiceRecipientEmail: payload.data.organization?.invoiceRecipientEmail ?? "",
        })
        setError("")
      } catch (loadError) {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : "Unable to load billing history.")
        }
      } finally {
        if (active) {
          setLoading(false)
        }
      }
    }

    loadBilling()

    return () => {
      active = false
    }
  }, [cacheKey, searchParams])

  async function saveBillingSettings() {
    setSavingSettings(true)
    setError("")
    setNotice("")

    try {
      const response = await fetch(buildAuthUrl("/api/billing/invoices", searchParams), {
        method: "PATCH",
        credentials: "include",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      })
      const payload = await response.json()

      if (!response.ok || !payload?.success) {
        throw new Error(payload?.error?.message || "Unable to save billing settings.")
      }

      setData((current) => {
        const nextData = {
          ...current,
          organization: payload.data.organization,
        }
        writeSessionJsonCache(cacheKey, nextData)
        return nextData
      })
      setNotice("Billing settings updated for future invoices.")
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save billing settings.")
    } finally {
      setSavingSettings(false)
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-950 text-white">
        <Navbar onSendInterviewClick={() => undefined} />
        <VerisGlobeLoader
          eyebrow="Billing"
          viewportOffset="navbar"
          steps={[
            { label: "Loading billing", detail: "Fetching organization billing profile and subscription status." },
            { label: "Reading invoices", detail: "Collecting GST invoices, payments, and Razorpay references." },
            { label: "Checking credits", detail: "Preparing interview and VERIS Screening credit usage." },
            { label: "Billing ready", detail: "Payment history is ready for finance review." },
          ]}
          activeIndex={1}
        />
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <Navbar onSendInterviewClick={() => undefined} />
      <div className="px-6 py-12 sm:px-8 md:pl-28 lg:px-10 lg:pl-32">
      <div className="mx-auto max-w-[1400px]">
        <BackToDashboardLink className="inline-flex w-fit items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-950/50 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:border-blue-400/40 hover:bg-slate-900 hover:text-white" />

        <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-900/80 p-8 shadow-[0_14px_44px_rgba(2,6,23,0.22)]">
          <p className="text-xs uppercase tracking-[0.3em] text-blue-300/80">Organization Billing</p>
          <div className="mt-3 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h1 className="text-4xl font-semibold tracking-tight text-white">Invoices and payment history</h1>
              <p className="mt-4 max-w-3xl text-base leading-7 text-slate-300">
                Download GST-ready invoices, review payment references, and reconcile subscription activity for procurement and finance workflows.
              </p>
            </div>
            <Link
              href="/billing/checkout"
              className="inline-flex items-center justify-center rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-blue-500"
            >
              Purchase Plan
            </Link>
          </div>

          {error ? (
            <div className="mt-6 rounded-xl border border-rose-400/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
              {error}
            </div>
          ) : null}

          {notice ? (
            <div className="mt-6 rounded-xl border border-emerald-400/25 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
              {notice}
            </div>
          ) : null}

          <section className="mt-8 rounded-2xl border border-slate-800 bg-slate-950/35 p-6">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Active Subscription</p>
                <h2 className="mt-3 text-3xl font-semibold text-white">
                  {activeSubscription?.planName || activeSubscription?.planId || "No active plan"}
                </h2>
                <p className="mt-2 text-sm text-slate-400">
                  {data.organization?.organizationName || "Organization billing"} · {activeSubscription?.activatedAt ? `Activated ${formatDate(activeSubscription.activatedAt)}` : "Activation pending"}
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:min-w-[420px]">
                <div className="rounded-xl border border-slate-800 bg-slate-950/35 p-4">
                  <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Status</p>
                  <div className="mt-3">{activeSubscription ? <StatusBadge status={activeSubscription.status} /> : "-"}</div>
                </div>
                <div className="rounded-xl border border-slate-800 bg-slate-950/35 p-4">
                  <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Last Payment</p>
                  <p className="mt-3 text-lg font-semibold text-white">
                    {formatPaise(lastSuccessfulPayment?.amount ?? activeSubscription?.amountPaid ?? 0, lastSuccessfulPayment?.currency ?? activeSubscription?.currency ?? "INR")}
                  </p>
                </div>
                <div className="rounded-xl border border-slate-800 bg-slate-950/35 p-4">
                  <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Credit validity</p>
                  <p className="mt-3 text-sm font-semibold text-white">No expiry</p>
                </div>
                <div className="rounded-xl border border-slate-800 bg-slate-950/35 p-4">
                  <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Razorpay</p>
                  <p className="mt-3 truncate text-xs font-semibold text-slate-300">
                    {lastSuccessfulPayment?.razorpayPaymentId || lastSuccessfulPayment?.razorpayOrderId || "-"}
                  </p>
                </div>
              </div>
            </div>
          </section>

          <section id="usage" className="mt-6 grid gap-4 lg:grid-cols-2">
            <CreditUsageCard
              title="Interview Credits"
              total={activeSubscription?.totalCredits ?? 0}
              used={activeSubscription?.usedCredits ?? 0}
              accent="blue"
            />
            <CreditUsageCard
              title="VERIS Screening Credits"
              total={activeSubscription?.screeningCredits ?? 0}
              used={activeSubscription?.usedScreeningCredits ?? 0}
              accent="cyan"
            />
          </section>

          <div className="mt-6 grid gap-4 md:grid-cols-4">
            <div className="rounded-xl border border-slate-800 bg-slate-950/35 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-500">GSTIN</p>
              <p className="mt-3 truncate text-sm font-semibold text-white">{data.organization?.gstNumber || "Not configured"}</p>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-950/35 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Finance Email</p>
              <p className="mt-3 truncate text-sm font-semibold text-white">{data.organization?.financeEmail || "Not configured"}</p>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-950/35 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Invoices</p>
              <p className="mt-3 text-2xl font-semibold text-white">{data.invoices.length}</p>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-950/35 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Paid Total</p>
              <p className="mt-3 text-xl font-semibold text-white">
                {formatPaise(activeSubscription?.amountPaid ?? 0, activeSubscription?.currency ?? "INR")}
              </p>
            </div>
          </div>

          <section className="mt-8 rounded-2xl border border-slate-800 bg-slate-950/35">
            <div className="border-b border-slate-800 px-5 py-4">
              <h2 className="text-lg font-semibold text-white">Invoices</h2>
            </div>
            {data.invoices.length === 0 ? (
              <p className="px-5 py-8 text-sm text-slate-400">No invoices generated yet. Invoices appear after verified Razorpay payments.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-[1080px] table-fixed text-left text-sm">
                  <thead className="text-[11px] uppercase tracking-[0.12em] text-slate-500">
                    <tr>
                      <th className="w-[160px] px-4 py-3 font-medium">Invoice</th>
                      <th className="w-[120px] px-4 py-3 font-medium">Date</th>
                      <th className="w-[170px] px-4 py-3 font-medium">Plan</th>
                      <th className="w-[130px] px-4 py-3 font-medium">Coupon</th>
                      <th className="w-[135px] px-4 py-3 text-right font-medium">Amount</th>
                      <th className="w-[95px] px-4 py-3 font-medium">Email</th>
                      <th className="w-[220px] px-4 py-3 font-medium">Razorpay</th>
                      <th className="w-[110px] px-4 py-3 text-right font-medium">PDF</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {data.invoices.map((invoice) => (
                      <tr key={invoice.id} className="text-slate-300">
                        <td className="whitespace-nowrap px-4 py-4 font-semibold text-white">{invoice.invoiceNumber}</td>
                        <td className="whitespace-nowrap px-4 py-4">{formatDate(invoice.invoiceDate)}</td>
                        <td className="px-4 py-4"><span className="block truncate" title={invoice.planName}>{invoice.planName}</span></td>
                        <td className="whitespace-nowrap px-4 py-4">{invoice.couponCode || "-"}</td>
                        <td className="whitespace-nowrap px-4 py-4 text-right tabular-nums">{formatPaise(invoice.finalAmountPaise, invoice.currency)}</td>
                        <td className="whitespace-nowrap px-4 py-4">{invoice.emailSentAt ? "Sent" : "Pending"}</td>
                        <td className="px-4 py-4">
                          <CompactReference value={invoice.razorpayPaymentId || invoice.razorpayOrderId} maxWidth="max-w-[190px]" />
                        </td>
                        <td className="px-4 py-4 text-right">
                          <a
                            href={`/api/billing/invoices/${invoice.id}/download`}
                            className="rounded-lg border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-100 transition hover:border-blue-400/60 hover:bg-slate-900"
                          >
                            Download
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="mt-6 rounded-2xl border border-slate-800 bg-slate-950/35">
            <div className="border-b border-slate-800 px-5 py-4">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-white">Payment History & Billing Details</h2>
                  <p className="mt-1 text-sm text-slate-500">Filter by status, date range, invoice, coupon, plan, or Razorpay reference.</p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 xl:min-w-[840px]">
                  <label className="block">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Search</span>
                    <input
                      value={paymentFilters.query}
                      onChange={(event) => setPaymentFilters((current) => ({ ...current, query: event.target.value }))}
                      placeholder="Invoice, coupon, Razorpay"
                      className="mt-2 h-10 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-blue-400"
                    />
                  </label>
                  <label className="block">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Status</span>
                    <select
                      value={paymentFilters.status}
                      onChange={(event) => setPaymentFilters((current) => ({ ...current, status: event.target.value }))}
                      className="mt-2 h-10 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm text-white outline-none transition focus:border-blue-400"
                    >
                      <option value="all">All status</option>
                      {paymentStatuses.map((status) => (
                        <option key={status} value={status}>{status}</option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">From</span>
                    <input
                      type="date"
                      value={paymentFilters.startDate}
                      max={paymentFilters.endDate || undefined}
                      onChange={(event) => setPaymentFilters((current) => ({ ...current, startDate: event.target.value }))}
                      className="mt-2 h-10 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm text-white outline-none transition focus:border-blue-400"
                    />
                  </label>
                  <label className="block">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">To</span>
                    <input
                      type="date"
                      value={paymentFilters.endDate}
                      min={paymentFilters.startDate || undefined}
                      onChange={(event) => setPaymentFilters((current) => ({ ...current, endDate: event.target.value }))}
                      className="mt-2 h-10 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm text-white outline-none transition focus:border-blue-400"
                    />
                  </label>
                  <div className="flex items-end">
                    <button
                      type="button"
                      onClick={() => setPaymentFilters({ status: "all", query: "", startDate: "", endDate: "" })}
                      disabled={!filtersApplied}
                      className="h-10 w-full rounded-lg border border-slate-700 px-3 text-sm font-semibold text-slate-200 transition hover:border-blue-400/60 hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      Clear
                    </button>
                  </div>
                </div>
              </div>
            </div>
            {data.payments.length === 0 ? (
              <p className="px-5 py-8 text-sm text-slate-400">No payment attempts recorded yet.</p>
            ) : filteredPayments.length === 0 ? (
              <p className="px-5 py-8 text-sm text-slate-400">No payment records match the selected filters.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-[1280px] table-fixed text-left text-sm">
                  <thead className="text-[11px] uppercase tracking-[0.12em] text-slate-500">
                    <tr>
                      <th className="w-[118px] px-3 py-3 font-medium">Date</th>
                      <th className="w-[138px] px-3 py-3 font-medium">Invoice</th>
                      <th className="w-[145px] px-3 py-3 font-medium">Plan</th>
                      <th className="w-[118px] px-3 py-3 font-medium">Status</th>
                      <th className="w-[115px] px-3 py-3 font-medium">Coupon</th>
                      <th className="w-[130px] px-3 py-3 text-right font-medium">Taxable</th>
                      <th className="w-[118px] px-3 py-3 text-right font-medium">GST</th>
                      <th className="w-[118px] px-3 py-3 text-right font-medium">Discount</th>
                      <th className="w-[130px] px-3 py-3 text-right font-medium">Amount</th>
                      <th className="w-[180px] px-3 py-3 font-medium">Razorpay</th>
                      <th className="w-[70px] px-3 py-3 text-right font-medium">PDF</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {filteredPayments.map((payment) => (
                      <tr key={payment.id} className="text-slate-300">
                        <td className="whitespace-nowrap px-3 py-4">{formatDate(payment.createdAt)}</td>
                        <td className="px-3 py-4 font-semibold text-white">
                          <span className="block truncate" title={payment.invoiceNumber || "-"}>{payment.invoiceNumber || "-"}</span>
                        </td>
                        <td className="px-3 py-4">
                          <span className="block truncate" title={payment.planName || payment.planId || "-"}>{payment.planName || payment.planId || "-"}</span>
                        </td>
                        <td className="whitespace-nowrap px-3 py-4"><StatusBadge status={payment.status} /></td>
                        <td className="whitespace-nowrap px-3 py-4">{payment.couponCode || "-"}</td>
                        <td className="whitespace-nowrap px-3 py-4 text-right tabular-nums">{formatPaise(payment.taxableAmountPaise, payment.currency)}</td>
                        <td className="whitespace-nowrap px-3 py-4 text-right tabular-nums">{formatPaise(payment.gstAmountPaise, payment.currency)}</td>
                        <td className="whitespace-nowrap px-3 py-4 text-right tabular-nums">{formatPaise(payment.discountAmountPaise, payment.currency)}</td>
                        <td className="whitespace-nowrap px-3 py-4 text-right tabular-nums">{formatPaise(payment.amount, payment.currency)}</td>
                        <td className="px-3 py-4">
                          <CompactReference value={payment.razorpayPaymentId || payment.razorpayOrderId} maxWidth="max-w-[155px]" />
                        </td>
                        <td className="px-3 py-4 text-right">
                          {payment.invoiceId ? (
                            <a
                              href={`/api/billing/invoices/${payment.invoiceId}/download`}
                              className="rounded-lg border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-100 transition hover:border-blue-400/60 hover:bg-slate-900"
                            >
                              PDF
                            </a>
                          ) : "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="mt-6 rounded-2xl border border-slate-800 bg-slate-950/35 p-5">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-white">Billing Settings</h2>
                <p className="mt-1 text-sm text-slate-400">Used for future GST invoices, finance routing, and procurement records.</p>
              </div>
            </div>

            <div className="mt-5 grid gap-4 lg:grid-cols-2">
              <label className="block">
                <span className="text-sm font-medium text-slate-300">GSTIN</span>
                <input
                  value={settings.gstNumber}
                  onChange={(event) => setSettings((current) => ({ ...current, gstNumber: event.target.value.toUpperCase() }))}
                  placeholder="22AAAAA0000A1Z5"
                  className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-blue-400"
                />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-slate-300">Finance email</span>
                <input
                  value={settings.financeEmail}
                  onChange={(event) => setSettings((current) => ({ ...current, financeEmail: event.target.value }))}
                  placeholder="finance@company.com"
                  className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-blue-400"
                />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-slate-300">Invoice recipient email</span>
                <input
                  value={settings.invoiceRecipientEmail}
                  onChange={(event) => setSettings((current) => ({ ...current, invoiceRecipientEmail: event.target.value }))}
                  placeholder="accounts-payable@company.com"
                  className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-blue-400"
                />
              </label>
              <label className="block lg:row-span-2">
                <span className="text-sm font-medium text-slate-300">Billing address</span>
                <textarea
                  value={settings.billingAddress}
                  onChange={(event) => setSettings((current) => ({ ...current, billingAddress: event.target.value }))}
                  placeholder="Registered company billing address"
                  rows={5}
                  className="mt-2 w-full resize-none rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-blue-400"
                />
              </label>
            </div>

            <button
              type="button"
              onClick={() => void saveBillingSettings()}
              disabled={savingSettings}
              className="mt-5 rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {savingSettings ? "Saving..." : "Save Billing Settings"}
            </button>
          </section>
        </div>
      </div>
      </div>
    </main>
  )
}
