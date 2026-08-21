"use client"

import { useCallback, useEffect, useMemo, useState } from "react"

import UpgradeLimitDialog from "@/components/UpgradeLimitDialog"

const UPGRADE_MESSAGE =
  "You’ve reached your free trial limit. Upgrade your workspace to continue conducting interviews and screenings."

const OFFER_LINE = "10 AI Interviews + 25 VERIS Screenings"

function Stat({ label, value, depleted }) {
  return (
    <div className={`rounded-xl border px-4 py-3 ${depleted ? "border-amber-400/25 bg-amber-500/10" : "border-slate-700 bg-slate-950/35"}`}>
      <p className={`text-xs font-medium uppercase tracking-[0.12em] ${depleted ? "text-amber-200/75" : "text-slate-400"}`}>
        {label}
      </p>
      <p className="mt-2 text-3xl font-semibold text-white">{value}</p>
    </div>
  )
}

function Shell({ eyebrow, title, children }) {
  return (
    <section className="hv-elevated-section mb-5 rounded-2xl border border-slate-800 bg-slate-900/80 p-5 shadow-[0_14px_40px_rgba(2,6,23,0.18)]">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{eyebrow}</p>
          <h2 className="mt-2 text-xl font-semibold text-white">{title}</h2>
        </div>
      </div>
      {children}
    </section>
  )
}

/**
 * Renders the workspace's free-trial lifecycle.
 *
 * Before approval the card deliberately does NOT show "10 AI Interviews
 * remaining" — those credits do not exist yet, and the backend will reject any
 * attempt to spend them.
 */
export default function TrialStatusCard({ credits }) {
  const [upgradeOpen, setUpgradeOpen] = useState(false)
  const [trialState, setTrialState] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [website, setWebsite] = useState("")
  const [error, setError] = useState(null)

  const isSubscription = credits?.source === "subscription"
  const hasCreditSource = credits?.source === "subscription" || credits?.source === "trial"

  const status = useMemo(() => {
    if (isSubscription) return "SUBSCRIPTION"
    return trialState?.status || credits?.trialStatus || null
  }, [isSubscription, trialState?.status, credits?.trialStatus])

  const loadTrialState = useCallback(async () => {
    try {
      const response = await fetch("/api/trial-requests", { credentials: "include", cache: "no-store" })
      if (!response.ok) return
      const payload = await response.json()
      if (payload?.success) setTrialState(payload.data)
    } catch (loadError) {
      console.warn("Trial state load failed", loadError)
    }
  }, [])

  useEffect(() => {
    if (isSubscription) return
    loadTrialState()
  }, [isSubscription, loadTrialState])

  const submitRequest = useCallback(
    async (event) => {
      event?.preventDefault?.()
      if (submitting) return

      setSubmitting(true)
      setError(null)

      try {
        const response = await fetch("/api/trial-requests", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ companyWebsite: website.trim() || null }),
        })
        const payload = await response.json()

        if (!response.ok || !payload?.success) {
          setError(payload?.error?.message || "We couldn’t submit your request. Please try again.")
          return
        }

        setTrialState(payload.data)
        setFormOpen(false)
        window.dispatchEvent(new CustomEvent("hireveri:trial-credits-updated"))
      } catch (submitError) {
        console.warn("Trial request failed", submitError)
        setError("We couldn’t submit your request. Please try again.")
      } finally {
        setSubmitting(false)
      }
    },
    [submitting, website]
  )

  // ---- Paid workspace: unchanged behaviour ---------------------------------
  if (isSubscription) {
    const interviewCredits = Math.max(0, Number(credits?.interviewCreditsRemaining ?? 0))
    const screeningCredits = Math.max(0, Number(credits?.screeningCreditsRemaining ?? 0))

    return (
      <Shell eyebrow="Subscription Credits" title="Subscription Credits">
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Stat label="AI Interview Credits" value={interviewCredits} depleted={interviewCredits === 0} />
          <Stat label="VERIS Screening Credits" value={screeningCredits} depleted={screeningCredits === 0} />
        </div>
      </Shell>
    )
  }

  // ---- Still loading -------------------------------------------------------
  if (!hasCreditSource && !status) {
    return (
      <Shell eyebrow="Workspace Credits" title="Loading Credits">
        <div className="mt-4 rounded-xl border border-slate-700 bg-slate-950/35 px-4 py-3 text-sm text-slate-300">
          Syncing workspace credits...
        </div>
      </Shell>
    )
  }

  // ---- State 3: approved / active -----------------------------------------
  if (status === "APPROVED") {
    const interviewCredits = Math.max(0, Number(credits?.interviewCreditsRemaining ?? trialState?.interviewCreditsRemaining ?? 0))
    const screeningCredits = Math.max(0, Number(credits?.screeningCreditsRemaining ?? trialState?.screeningCreditsRemaining ?? 0))
    const exhausted = interviewCredits === 0 && screeningCredits === 0

    return (
      <Shell eyebrow="Free Recruiter Trial" title="Free Recruiter Trial">
        {exhausted ? (
          <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-amber-400/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-100 sm:flex-row sm:items-center">
            <span>{credits?.upgradeMessage || UPGRADE_MESSAGE}</span>
            <button
              type="button"
              onClick={() => setUpgradeOpen(true)}
              className="inline-flex shrink-0 items-center justify-center rounded-xl border border-amber-200/35 bg-amber-300/12 px-4 py-2 text-sm font-semibold text-amber-50 transition hover:border-amber-100/60 hover:bg-amber-300/18"
            >
              View Subscription Plans
            </button>
          </div>
        ) : null}
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Stat label="AI Interviews Remaining" value={interviewCredits} depleted={interviewCredits === 0} />
          <Stat label="VERIS Screenings Remaining" value={screeningCredits} depleted={screeningCredits === 0} />
        </div>
        {trialState?.expiresAt ? (
          <p className="mt-3 text-xs text-slate-400">
            Trial active until {new Date(trialState.expiresAt).toLocaleDateString()}.
          </p>
        ) : (
          <p className="mt-3 text-xs text-slate-400">Trial active. Credits do not expire.</p>
        )}
        <UpgradeLimitDialog
          isOpen={upgradeOpen}
          onClose={() => setUpgradeOpen(false)}
          credits={credits}
          message={credits?.upgradeMessage || UPGRADE_MESSAGE}
        />
      </Shell>
    )
  }

  // ---- State 2: pending review --------------------------------------------
  if (status === "PENDING_REVIEW") {
    return (
      <Shell eyebrow="Free Recruiter Trial" title="Free Trial Request Under Review">
        <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">
          We’re verifying your company details. Your free trial will be activated once your request is approved.
        </p>
        <div className="mt-4 inline-flex items-center gap-2 rounded-xl border border-blue-400/25 bg-blue-500/10 px-4 py-2 text-sm text-blue-100">
          <span className="h-2 w-2 rounded-full bg-blue-300" />
          Usually reviewed within 24 hours
        </div>
      </Shell>
    )
  }

  // ---- State 4: rejected ---------------------------------------------------
  if (status === "REJECTED") {
    return (
      <Shell eyebrow="Free Recruiter Trial" title="Trial Request Not Approved">
        <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">
          We weren’t able to activate a free trial for this workspace. This usually happens when we can’t confirm the
          company details from a work email and website. You can still explore the workspace, or pick a plan to start
          interviewing straight away.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => setUpgradeOpen(true)}
            className="inline-flex items-center justify-center rounded-xl border border-slate-600 bg-slate-800/60 px-4 py-2 text-sm font-semibold text-slate-100 transition hover:border-slate-500"
          >
            View Plans
          </button>
          <a
            href="/contact-us"
            className="inline-flex items-center justify-center rounded-xl border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-300 transition hover:border-slate-500 hover:text-white"
          >
            Contact Support
          </a>
        </div>
        <UpgradeLimitDialog
          isOpen={upgradeOpen}
          onClose={() => setUpgradeOpen(false)}
          credits={credits}
          message={credits?.upgradeMessage || UPGRADE_MESSAGE}
        />
      </Shell>
    )
  }

  // ---- State 1: not requested ---------------------------------------------
  return (
    <Shell eyebrow="Free Recruiter Trial" title="Start Your Free Trial">
      <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">
        Get {OFFER_LINE} to experience the complete VerisNova hiring workflow.
      </p>
      <ul className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-xs text-slate-400">
        <li>No credit card required</li>
        <li>We check your work email</li>
        <li>Usually reviewed within 24 hours</li>
      </ul>

      {formOpen ? (
        <form onSubmit={submitRequest} className="mt-5 max-w-xl">
          <label htmlFor="trial-company-website" className="block text-xs font-medium uppercase tracking-[0.12em] text-slate-400">
            Company website
          </label>
          <p className="mt-1 text-xs text-slate-500">
            We use your work email and workspace name from your profile. Adding your website helps us verify faster.
          </p>
          <input
            id="trial-company-website"
            type="text"
            inputMode="url"
            value={website}
            onChange={(event) => setWebsite(event.target.value)}
            placeholder="acme.com"
            className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950/50 px-4 py-2.5 text-sm text-white outline-none transition focus:border-blue-500"
          />
          {error ? <p className="mt-2 text-sm text-amber-300">{error}</p> : null}
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center justify-center rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? "Submitting..." : "Submit Request"}
            </button>
            <button
              type="button"
              onClick={() => setFormOpen(false)}
              className="inline-flex items-center justify-center rounded-xl border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-300 transition hover:border-slate-500"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="mt-5">
          <button
            type="button"
            onClick={() => setFormOpen(true)}
            className="inline-flex items-center justify-center rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-500"
          >
            Start Free Trial
          </button>
          {error ? <p className="mt-2 text-sm text-amber-300">{error}</p> : null}
        </div>
      )}
    </Shell>
  )
}
