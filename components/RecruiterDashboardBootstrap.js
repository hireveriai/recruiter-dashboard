"use client"

import { useEffect, useRef, useState } from "react"

import { buildAuthUrl } from "@/lib/client/auth-query"
import { clearVerisnovaSessionCookie, getRecruiterLoginUrl } from "@/lib/client/auth-session"
import { ACTION_FEEDBACK_EVENT } from "@/lib/client/action-feedback"
import { connectDashboardRealtime } from "@/lib/client/dashboard-realtime"
import { useAuthSearchParams } from "@/lib/client/use-auth-search-params"
import { useOrgTimezone } from "@/components/OrgTimezoneProvider"

const DASHBOARD_AUTO_REFRESH_MS = 60000
const DASHBOARD_CACHE_KEY = "verisnova-overview"
const DASHBOARD_INVALIDATED_EVENT = "verisnova:dashboard-data-invalidated"
const DASHBOARD_INVALIDATED_KEY = "verisnova-overview-invalidated"

function withoutVolatileOverviewFields(overview) {
  return overview ?? null
}

function getOverviewSignature(overview) {
  if (!overview) {
    return ""
  }

  return JSON.stringify({
    profile: overview.profile,
    pipeline: overview.pipeline,
    workflowMetrics: overview.workflowMetrics,
    pendingInterviewsTotal: overview.pendingInterviewsTotal,
    pendingInterviews: overview.pendingInterviews,
    candidates: overview.candidates,
    alerts: overview.alerts,
  })
}

function readCachedOverview() {
  if (typeof window === "undefined") {
    return null
  }

  try {
    const cached = window.sessionStorage.getItem(DASHBOARD_CACHE_KEY)
    return cached ? withoutVolatileOverviewFields(JSON.parse(cached)) : null
  } catch (error) {
    console.warn("Failed to read cached recruiter overview", error)
    return null
  }
}

function writeCachedOverview(overview) {
  if (typeof window === "undefined" || !overview) {
    return
  }

  try {
    window.sessionStorage.setItem(DASHBOARD_CACHE_KEY, JSON.stringify(withoutVolatileOverviewFields(overview)))
  } catch (error) {
    console.warn("Failed to cache recruiter overview", error)
  }
}

/**
 * Sends the recruiter to the auth app's recruiter login, carrying the page they
 * were on as `next` (same contract as middleware.ts). Used whenever the session
 * is gone — expired outright, or idled out past the 12h inactivity window — so
 * an ended session lands on the login screen instead of an interstitial the
 * recruiter has to click through.
 */
function redirectToRecruiterLogin() {
  if (typeof window === "undefined") {
    return
  }

  try {
    const loginUrl = new URL(getRecruiterLoginUrl())
    loginUrl.searchParams.set("next", window.location.href)
    window.location.replace(loginUrl.toString())
  } catch {
    window.location.replace(getRecruiterLoginUrl())
  }
}

function WorkspaceShell({ tone = "loading", title, message, ctaLabel, onCtaClick }) {
  const isError = tone === "error"

  return (
    <div className="hv-preserve-dark relative flex min-h-screen items-center justify-center overflow-hidden bg-[#07101d] px-6 text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_18%,rgba(34,211,238,0.16),transparent_22%),radial-gradient(circle_at_82%_22%,rgba(59,130,246,0.12),transparent_20%),radial-gradient(circle_at_50%_100%,rgba(14,165,233,0.08),transparent_28%)]" />
      <div className="pointer-events-none absolute inset-0 opacity-40 [background-image:linear-gradient(rgba(148,163,184,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.08)_1px,transparent_1px)] [background-size:88px_88px]" />

      <div className="relative w-full max-w-3xl overflow-hidden rounded-[34px] border border-cyan-400/18 bg-[linear-gradient(180deg,rgba(8,15,30,0.96),rgba(9,17,33,0.92))] shadow-[0_0_120px_rgba(34,211,238,0.10)]">
        <div className="absolute inset-x-16 top-0 h-px bg-gradient-to-r from-transparent via-cyan-300/80 to-transparent" />
        <div className="absolute -left-12 top-16 h-32 w-32 rounded-full bg-cyan-400/10 blur-3xl" />
        <div className="absolute -right-10 bottom-12 h-36 w-36 rounded-full bg-blue-500/10 blur-3xl" />

        <div className="relative grid gap-10 px-8 py-10 md:grid-cols-[1.15fr_0.85fr] md:px-12 md:py-12">
          <div>
            <p className="text-[11px] uppercase tracking-[0.45em] text-cyan-300/80">
              Recruiter Workspace
            </p>
            <h1 className="mt-5 max-w-xl text-4xl font-semibold leading-tight text-white md:text-5xl">
              {title}
            </h1>
            <p className={`mt-5 max-w-xl text-base leading-7 ${isError ? "text-amber-100/90" : "text-slate-300"}`}>
              {message}
            </p>

            {isError ? (
              <button
                type="button"
                className="mt-8 rounded-2xl border border-slate-700 bg-white px-5 py-3 text-sm font-semibold text-slate-900 transition hover:bg-slate-100"
                onClick={onCtaClick}
              >
                {ctaLabel}
              </button>
            ) : (
              <div className="mt-8 flex items-center gap-3 text-sm text-slate-400">
                <span className="inline-flex h-2.5 w-2.5 animate-pulse rounded-full bg-cyan-300 shadow-[0_0_20px_rgba(34,211,238,0.9)]" />
                Authenticating recruiter context and preparing interview operations.
              </div>
            )}
          </div>

          <div className="rounded-[28px] border border-white/10 bg-white/[0.03] p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
            <div className="flex items-center justify-between border-b border-white/10 pb-4">
              <div>
                <p className="text-xs uppercase tracking-[0.35em] text-slate-500">Status</p>
                <p className="mt-2 text-lg font-medium text-white">
                  {isError ? "Access Interrupted" : "Secure Handshake"}
                </p>
              </div>
              <div className={`flex h-16 w-16 items-center justify-center rounded-2xl border ${isError ? "border-amber-400/20 bg-amber-500/10 text-amber-200" : "border-cyan-400/20 bg-cyan-400/10 text-cyan-200"}`}>
                <span className="text-xl font-semibold">{isError ? "!" : "HR"}</span>
              </div>
            </div>

            <div className="mt-6 space-y-4">
              {[
                isError ? "Session validation blocked" : "Identity confirmed",
                isError ? "Workspace bootstrap halted" : "Organization scope attached",
                isError ? "Manual re-entry required" : "Dashboard services warming up",
              ].map((item, index) => (
                <div key={item} className="flex items-center gap-3 rounded-2xl border border-white/8 bg-slate-950/35 px-4 py-3 text-sm text-slate-300">
                  <span className={`inline-flex h-7 w-7 items-center justify-center rounded-full border text-xs ${isError ? "border-amber-400/20 bg-amber-500/10 text-amber-200" : "border-cyan-400/20 bg-cyan-400/10 text-cyan-200"}`}>
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function RecruiterDashboardBootstrap({ children }) {
  const searchParams = useAuthSearchParams()
  const { setTimezoneState } = useOrgTimezone()
  const overviewSignatureRef = useRef("")
  const overviewPartialRef = useRef(false)
  const [state, setState] = useState({
    status: "loading",
    profile: null,
    overview: null,
    message: "",
  })

  useEffect(() => {
    let active = true
    let cachedOverview = readCachedOverview()
    const dashboardWasInvalidated =
      typeof window !== "undefined" && window.sessionStorage.getItem(DASHBOARD_INVALIDATED_KEY) === "1"

    if (cachedOverview) {
      window.queueMicrotask(() => {
        if (!active) {
          return
        }

        overviewSignatureRef.current = getOverviewSignature(cachedOverview)
        overviewPartialRef.current = Boolean(cachedOverview?.partial)
        setTimezoneState({
          timezone: cachedOverview?.profile?.timezone,
          timezoneLabel: cachedOverview?.profile?.timezoneLabel,
        })
        setState((current) => ({
          status: "ready",
          profile: cachedOverview?.profile ?? current.profile,
          overview: cachedOverview,
          message: "",
        }))
      })
    }

    async function bootstrap({ forceRefresh = false, silent = false } = {}) {
      if (!cachedOverview && !silent) {
        setState((current) => ({
          status: "loading",
          profile: current.profile,
          overview: current.overview,
          message: "",
        }))
      }

      try {
        const overviewPath = forceRefresh
          ? `/api/dashboard/overview?refresh=${Date.now()}&full=1`
          : silent
            ? "/api/dashboard/overview?full=1"
            : "/api/dashboard/overview"
        const overviewResponse = await fetch(buildAuthUrl(overviewPath, searchParams), {
          credentials: "include",
          cache: forceRefresh ? "no-store" : "default",
        })
        const overviewData = await overviewResponse.json().catch(() => null)

        if (!active) {
          return
        }

        if (overviewResponse.status === 401) {
          // The session is over — signed out elsewhere, expired, or idle past
          // the 12h inactivity window. There is nothing for the recruiter to
          // decide here, so go straight to the login screen rather than parking
          // them on a "workspace access blocked" card with a single button.
          active = false
          clearVerisnovaSessionCookie()
          if (typeof window !== "undefined") {
            window.sessionStorage.removeItem(DASHBOARD_CACHE_KEY)
            window.sessionStorage.removeItem(DASHBOARD_INVALIDATED_KEY)
          }
          setState({
            status: "redirecting",
            profile: null,
            overview: null,
            message: "",
          })
          redirectToRecruiterLogin()
          return
        }

        if (!overviewResponse.ok || !overviewData?.success) {
          if (cachedOverview || silent) {
            console.warn("Dashboard overview refresh skipped", overviewData?.error?.message || overviewData?.message)
            return
          }

          setState({
            status: "error",
            profile: null,
            overview: null,
            message: overviewData?.error?.message || overviewData?.message || "Unable to load recruiter workspace.",
          })
          if (typeof window !== "undefined") {
            window.sessionStorage.removeItem(DASHBOARD_CACHE_KEY)
          }
          return
        }

        const overview = overviewData.data ?? null
        const profile = overview?.profile ?? null
        const nextSignature = getOverviewSignature(overview)
        writeCachedOverview(overview)
        overviewSignatureRef.current = nextSignature
        if (!overview?.partial && typeof window !== "undefined") {
          window.sessionStorage.removeItem(DASHBOARD_INVALIDATED_KEY)
        }
        overviewPartialRef.current = Boolean(overview?.partial)

        setState({
          status: "ready",
          profile: overview?.profile ?? profile,
          overview,
          message: "",
        })
        setTimezoneState({
          timezone: overview?.profile?.timezone ?? profile?.timezone,
          timezoneLabel: overview?.profile?.timezoneLabel ?? profile?.timezoneLabel,
        })

        if (overview?.partial && !forceRefresh) {
          const refreshFullOverview = () => bootstrap({ forceRefresh: true, silent: true })

          if (typeof window.requestIdleCallback === "function") {
            window.requestIdleCallback(refreshFullOverview, { timeout: 2500 })
          } else {
            window.setTimeout(refreshFullOverview, 1000)
          }
        }
      } catch (error) {
        if (!active) {
          return
        }

        if (cachedOverview || silent) {
          console.warn("Dashboard overview refresh failed", error)
          return
        }

        setState({
          status: "error",
          profile: null,
          overview: null,
          message: "Unable to connect to the recruiter workspace.",
        })
      }
    }

    if (cachedOverview && !dashboardWasInvalidated) {
      const refreshCachedOverview = () => bootstrap({ forceRefresh: false, silent: true })

      if (typeof window.requestIdleCallback === "function") {
        window.requestIdleCallback(refreshCachedOverview, { timeout: 3500 })
      } else {
        window.setTimeout(refreshCachedOverview, 1500)
      }
    } else {
      bootstrap({ forceRefresh: dashboardWasInvalidated, silent: Boolean(cachedOverview) })
    }

    let refreshInFlight = false
    const refreshTimer = window.setInterval(() => {
      if (refreshInFlight) {
        return
      }

      refreshInFlight = true
      bootstrap({ forceRefresh: false, silent: true }).finally(() => {
        refreshInFlight = false
      })
    }, DASHBOARD_AUTO_REFRESH_MS)

    function handlePageShow(event) {
      if (!event.persisted) {
        return
      }

      bootstrap({ forceRefresh: false, silent: true })
    }

    function handleDashboardInvalidated() {
      cachedOverview = null
      overviewSignatureRef.current = ""
      overviewPartialRef.current = false

      if (typeof window !== "undefined") {
        window.sessionStorage.removeItem(DASHBOARD_CACHE_KEY)
        window.sessionStorage.setItem(DASHBOARD_INVALIDATED_KEY, "1")
      }

      bootstrap({ forceRefresh: true, silent: true })
    }

    if (typeof window !== "undefined") {
      window.addEventListener("pageshow", handlePageShow)
      window.addEventListener(DASHBOARD_INVALIDATED_EVENT, handleDashboardInvalidated)
    }

    return () => {
      active = false
      window.clearInterval(refreshTimer)
      if (typeof window !== "undefined") {
        window.removeEventListener("pageshow", handlePageShow)
        window.removeEventListener(DASHBOARD_INVALIDATED_EVENT, handleDashboardInvalidated)
      }
    }
  }, [searchParams, setTimezoneState])

  useEffect(() => {
    const organizationId = state.profile?.organizationId ?? state.overview?.profile?.organizationId

    if (state.status !== "ready" || !organizationId || typeof window === "undefined") {
      return undefined
    }

    let refreshTimer = null
    const disconnect = connectDashboardRealtime({
      organizationId,
      onChange: () => {
        if (refreshTimer) {
          window.clearTimeout(refreshTimer)
        }

        refreshTimer = window.setTimeout(() => {
          window.sessionStorage.setItem(DASHBOARD_INVALIDATED_KEY, "1")
          window.dispatchEvent(new CustomEvent(DASHBOARD_INVALIDATED_EVENT, {
            detail: { source: "realtime" },
          }))
        }, 250)
      },
      onStatus: (status) => {
        if (status === "error") {
          console.warn("Dashboard realtime socket reported an error")
        }
      },
    })

    return () => {
      if (refreshTimer) {
        window.clearTimeout(refreshTimer)
      }
      disconnect()
    }
  }, [state.overview?.profile?.organizationId, state.profile?.organizationId, state.status])

  useEffect(() => {
    if (state.status !== "ready" || typeof window === "undefined") {
      return
    }

    let payload = null

    try {
      const rawPayload = window.sessionStorage.getItem("verisnova-billing-success")
      payload = rawPayload ? JSON.parse(rawPayload) : null
      window.sessionStorage.removeItem("verisnova-billing-success")
    } catch {
      window.sessionStorage.removeItem("verisnova-billing-success")
    }

    if (!payload) {
      return
    }

    const timer = window.setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent(ACTION_FEEDBACK_EVENT, {
          detail: {
            title: payload.title || "Subscription activated",
            message: payload.message || "Your organization subscription is active.",
            tone: "success",
          },
        })
      )
    }, 250)

    return () => window.clearTimeout(timer)
  }, [state.status])

  // Session gone: the browser is already navigating to the recruiter login.
  // Hold the loading shell so nothing flashes during the handoff.
  if (state.status === "redirecting") {
    return (
      <WorkspaceShell
        tone="loading"
        title="Signing you back in"
        message="Your session has ended. Taking you to the recruiter login…"
      />
    )
  }

  // Reserved for genuine workspace failures (server errors, unreachable API).
  // Session problems never land here — they redirect above.
  if (state.status === "error") {
    return (
      <WorkspaceShell
        tone="error"
        title="Workspace access blocked"
        message={state.message}
        ctaLabel="Go to Recruiter Login"
        onCtaClick={redirectToRecruiterLogin}
      />
    )
  }

  if (state.status === "loading" && !state.overview && !state.profile) {
    return children({
      profile: null,
      overview: null,
      restoreStatus: state.status,
      showRestoreOverlay: false,
    })
  }

  return children({
    profile: state.profile,
    overview: state.overview,
    restoreStatus: state.status,
    showRestoreOverlay: false,
  })
}

