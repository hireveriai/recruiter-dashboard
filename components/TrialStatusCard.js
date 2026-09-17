"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import UpgradeLimitDialog from "@/components/UpgradeLimitDialog"

const UPGRADE_MESSAGE =
  "You’ve reached your free trial limit. Upgrade your workspace to continue conducting interviews and screenings."

const OFFER_LINE = "10 AI Interviews + 25 VERIS Screenings"

function Stat({ label, value, depleted }) {
  return (
    <div className={`w-[212px] shrink-0 rounded-xl border px-3 py-2.5 ${depleted ? "border-amber-400/25 bg-amber-500/10" : "border-slate-700 bg-slate-950/35"}`}>
      <p className={`whitespace-nowrap text-[10px] font-medium uppercase tracking-[0.04em] ${depleted ? "text-amber-200/75" : "text-slate-400"}`}>
        {label}
      </p>
      <p className="mt-1.5 text-2xl font-semibold text-white">{value}</p>
    </div>
  )
}

// `auto-fit`/minmax grids turned out to size tiles unpredictably across
// browsers (observed stretching to ~350px instead of the declared cap, and
// wrapping to 2+1 instead of one row). Fixed-width tiles (declared on Stat
// itself) plus `justify-items-start` so the grid cell never stretches them,
// with the column COUNT set explicitly to match how many tiles are visible
// -- this is unambiguous: N visible tiles always render as N columns in one
// row, at a fixed compact width, with no dependency on container size.
function statGridClass(count) {
  const cols = count <= 1 ? "grid-cols-1" : count === 2 ? "grid-cols-2" : "grid-cols-3"
  return `mt-4 grid gap-3 justify-items-start ${cols}`
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
export default function TrialStatusCard({ credits, entitlements = null }) {
  const showInterview = entitlements ? Boolean(entitlements.AI_INTERVIEW) : true
  const showScreening = entitlements ? Boolean(entitlements.SCREENING) : true
  const showAssessment = entitlements ? Boolean(entitlements.ASSESSMENT) : true
  const visibleStatCount = [showInterview, showScreening, showAssessment].filter(Boolean).length
  const [upgradeOpen, setUpgradeOpen] = useState(false)
  const [trialState, setTrialState] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const autoRequestedRef = useRef(false)

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

  const submitRequest = useCallback(async () => {
    if (submitting) return

    setSubmitting(true)
    setError(null)

    try {
      // The recruiter is already signed in through an OTP-verified session, so
      // the server takes the work email, name and workspace straight off the
      // profile. There is nothing left to ask them for.
      const response = await fetch("/api/trial-requests", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      })
      const payload = await response.json()

      if (!response.ok || !payload?.success) {
        setError(payload?.error?.message || "We couldn’t submit your request. Please try again.")
        return
      }

      setTrialState(payload.data)
      window.dispatchEvent(new CustomEvent("verisnova:trial-credits-updated"))
    } catch (submitError) {
      console.warn("Trial request failed", submitError)
      setError("We couldn’t submit your request. Please try again.")
    } finally {
      setSubmitting(false)
    }
  }, [submitting])

  // A signed-in recruiter never has to ask for the trial by hand: the request
  // is raised for them the first time the workspace is seen without one, and
  // then waits for a platform admin to approve it.
  useEffect(() => {
    if (isSubscription) return
    if (trialState?.status !== "NOT_REQUESTED") return
    if (autoRequestedRef.current) return

    autoRequestedRef.current = true
    void submitRequest()
  }, [isSubscription, trialState?.status, submitRequest])

  const retryRequest = useCallback(() => {
    autoRequestedRef.current = true
    void submitRequest()
  }, [submitRequest])

  // ---- Paid workspace: unchanged behaviour ---------------------------------
  if (isSubscription) {
    if (visibleStatCount === 0) {
      return null
    }

    const interviewCredits = Math.max(0, Number(credits?.interviewCreditsRemaining ?? 0))
    const screeningCredits = Math.max(0, Number(credits?.screeningCreditsRemaining ?? 0))
    const assessmentCredits = Math.max(0, Number(credits?.assessmentCreditsRemaining ?? 0))

    return (
      <Shell eyebrow="Subscription Credits" title="Subscription Credits">
        <div className={statGridClass(visibleStatCount)}>
          {showInterview ? <Stat label="AI Interview Credits" value={interviewCredits} depleted={interviewCredits === 0} /> : null}
          {showScreening ? <Stat label="VERIS Screening Credits" value={screeningCredits} depleted={screeningCredits === 0} /> : null}
          {showAssessment ? <Stat label="VERIS Assessment Credits" value={assessmentCredits} depleted={assessmentCredits === 0} /> : null}
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
    // The /api/trial-credits snapshot is refreshed separately and lags a beat
    // behind an approval, reporting a hard 0 for a workspace it still believes
    // is unapproved. Trusting that zero is what used to make a freshly granted
    // trial announce "you have reached your free trial limit", so the snapshot
    // only wins once it agrees the trial is approved.
    const snapshotIsCurrent = credits?.trialStatus === "APPROVED"
    const readCredits = (fromSnapshot, fromTrialState) =>
      Math.max(0, Number((snapshotIsCurrent ? fromSnapshot : null) ?? fromTrialState ?? fromSnapshot ?? 0))

    const interviewCredits = readCredits(credits?.interviewCreditsRemaining, trialState?.interviewCreditsRemaining)
    const screeningCredits = readCredits(credits?.screeningCreditsRemaining, trialState?.screeningCreditsRemaining)
    const assessmentCredits = readCredits(credits?.assessmentCreditsRemaining, trialState?.assessmentCreditsRemaining)
    // Credits can only be "used up" once they were actually issued.
    const granted = trialState ? Boolean(trialState.granted) : true
    const exhausted = granted && interviewCredits === 0 && screeningCredits === 0 && assessmentCredits === 0

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
        <div className={statGridClass(visibleStatCount)}>
          {showInterview ? <Stat label="AI Interviews Remaining" value={interviewCredits} depleted={interviewCredits === 0} /> : null}
          {showScreening ? <Stat label="VERIS Screenings Remaining" value={screeningCredits} depleted={screeningCredits === 0} /> : null}
          {showAssessment ? <Stat label="VERIS Assessments Remaining" value={assessmentCredits} depleted={assessmentCredits === 0} /> : null}
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
      <Shell eyebrow="Free Recruiter Trial" title="Free Trial Request Awaiting Admin Approval">
        <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">
          Your request for {OFFER_LINE} has been sent to the VerisNova admin team. Your credits are issued as soon as
          an administrator approves it, and we’ll email you the moment that happens.
        </p>
        <div className="mt-4 inline-flex items-center gap-2 rounded-xl border border-blue-400/25 bg-blue-500/10 px-4 py-2 text-sm text-blue-100">
          <span className="h-2 w-2 rounded-full bg-blue-300" />
          Usually reviewed within 24 hours
        </div>
        {trialState?.requestedAt ? (
          <p className="mt-3 text-xs text-slate-400">
            Requested on {new Date(trialState.requestedAt).toLocaleDateString()}.
          </p>
        ) : null}
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

  // ---- State 1: no request on file yet ------------------------------------
  // Reached only while the automatic request is in flight, or if it failed.
  return (
    <Shell eyebrow="Free Recruiter Trial" title="Setting Up Your Free Trial">
      <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">
        We’re raising your request for {OFFER_LINE} and sending it to the VerisNova admin team for approval. Nothing
        else is needed from you — we use the work email and workspace name already on your profile.
      </p>

      {error ? (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <p className="text-sm text-amber-300">{error}</p>
          <button
            type="button"
            onClick={retryRequest}
            disabled={submitting}
            className="inline-flex items-center justify-center rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? "Retrying..." : "Try Again"}
          </button>
        </div>
      ) : (
        <div className="mt-4 inline-flex items-center gap-2 rounded-xl border border-blue-400/25 bg-blue-500/10 px-4 py-2 text-sm text-blue-100">
          <span className="h-2 w-2 animate-pulse rounded-full bg-blue-300" />
          Submitting your request...
        </div>
      )}
    </Shell>
  )
}
