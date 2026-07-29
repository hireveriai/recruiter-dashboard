"use client"

import Link from "next/link"

const DEFAULT_UPGRADE_MESSAGE =
  "You’ve reached your free trial limit. Upgrade your workspace to continue conducting interviews and screenings."

function formatCredits(value) {
  return Math.max(0, Number(value ?? 0))
}

export default function UpgradeLimitDialog({
  isOpen,
  onClose,
  credits,
  title = "Free Trial Limit Reached",
  message = DEFAULT_UPGRADE_MESSAGE,
  ctaLabel = "View Subscription Plans",
}) {
  if (!isOpen) {
    return null
  }

  const interviewCredits = formatCredits(credits?.interviewCreditsRemaining)
  const screeningCredits = formatCredits(credits?.screeningCreditsRemaining)

  return (
    <div
      className="hv-theme-dialog-backdrop fixed inset-0 z-[90] flex items-center justify-center overflow-y-auto bg-slate-950/82 px-4 py-6 text-white backdrop-blur-xl"
      role="dialog"
      aria-modal="true"
      aria-labelledby="upgrade-limit-title"
    >
      <div className="hv-theme-modal relative w-full max-w-xl overflow-hidden rounded-[28px] border border-cyan-400/20 bg-[#07101f] shadow-[0_28px_110px_rgba(2,6,23,0.72)] transition duration-300">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_0%,rgba(34,211,238,0.16),transparent_32%),radial-gradient(circle_at_88%_16%,rgba(59,130,246,0.12),transparent_28%)]" />
        <div className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-cyan-200/80 to-transparent" />

        <div className="relative p-6 sm:p-7">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-cyan-200/75">Workspace Upgrade</p>
              <h2 id="upgrade-limit-title" className="mt-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
                {title}
              </h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm text-slate-300 transition hover:border-slate-500 hover:text-white"
              aria-label="Close upgrade dialog"
            >
              Close
            </button>
          </div>

          <p className="mt-4 text-sm leading-6 text-slate-300">{message}</p>

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-slate-800 bg-slate-950/45 p-4">
              <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">AI Interviews Left</p>
              <p className="mt-2 text-3xl font-semibold text-white">{interviewCredits}</p>
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-950/45 p-4">
              <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">AI Screenings Left</p>
              <p className="mt-2 text-3xl font-semibold text-white">{screeningCredits}</p>
            </div>
          </div>

          <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-slate-700 px-4 py-3 text-sm font-semibold text-slate-300 transition hover:border-slate-500 hover:text-white"
            >
              Cancel
            </button>
            <Link
              href="/subscription"
              className="inline-flex items-center justify-center rounded-xl border border-cyan-300/35 bg-cyan-400/15 px-5 py-3 text-sm font-semibold text-cyan-50 shadow-[0_18px_40px_rgba(34,211,238,0.12)] transition hover:border-cyan-200/70 hover:bg-cyan-400/22"
              onClick={onClose}
            >
              {ctaLabel}
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
