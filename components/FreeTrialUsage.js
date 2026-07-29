"use client"

import { useState } from "react"

import UpgradeLimitDialog from "@/components/UpgradeLimitDialog"

const UPGRADE_MESSAGE =
  "You’ve reached your free trial limit. Upgrade your workspace to continue conducting interviews and screenings."

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

export default function FreeTrialUsage({ credits }) {
  const [upgradeOpen, setUpgradeOpen] = useState(false)
  const hasCreditSource = credits?.source === "subscription" || credits?.source === "trial"
  const isSubscription = credits?.source === "subscription"
  const hasCreditSnapshot =
    hasCreditSource &&
    Number.isFinite(Number(credits?.interviewCreditsRemaining)) &&
    Number.isFinite(Number(credits?.screeningCreditsRemaining))
  const interviewCredits = hasCreditSnapshot ? Math.max(0, Number(credits.interviewCreditsRemaining)) : null
  const screeningCredits = hasCreditSnapshot ? Math.max(0, Number(credits.screeningCreditsRemaining)) : null
  const hasReachedLimit = !isSubscription && hasCreditSnapshot && interviewCredits === 0 && screeningCredits === 0
  const eyebrow = !hasCreditSource ? "Workspace Credits" : isSubscription ? "Subscription Credits" : "Free Trial Remaining"
  const title = !hasCreditSource ? "Loading Credits" : isSubscription ? "Subscription Credits" : "Free Trial Usage"
  const syncLabel = !hasCreditSource ? "Syncing workspace credits..." : isSubscription ? "Syncing subscription usage..." : "Syncing trial usage..."
  const interviewLabel = !hasCreditSource || isSubscription ? "AI Interview Credits" : "AI Interviews Left"
  const screeningLabel = !hasCreditSource || isSubscription ? "VERIS Screening Credits" : "AI Screenings Left"

  return (
    <section className="hv-elevated-section mb-5 rounded-2xl border border-slate-800 bg-slate-900/80 p-5 shadow-[0_14px_40px_rgba(2,6,23,0.18)]">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{eyebrow}</p>
          <h2 className="mt-2 text-xl font-semibold text-white">{title}</h2>
        </div>
        {hasReachedLimit ? (
          <div className="flex flex-col gap-3 rounded-2xl border border-amber-400/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-100 sm:flex-row sm:items-center">
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
        {!hasCreditSnapshot ? (
          <div className="rounded-xl border border-slate-700 bg-slate-950/35 px-4 py-3 text-sm text-slate-300">
            {syncLabel}
          </div>
        ) : null}
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Stat label={interviewLabel} value={interviewCredits ?? "--"} depleted={interviewCredits === 0} />
        <Stat label={screeningLabel} value={screeningCredits ?? "--"} depleted={screeningCredits === 0} />
      </div>
      <UpgradeLimitDialog
        isOpen={upgradeOpen}
        onClose={() => setUpgradeOpen(false)}
        credits={credits}
        message={credits?.upgradeMessage || UPGRADE_MESSAGE}
      />
    </section>
  )
}
