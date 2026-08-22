"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { usePathname } from "next/navigation"

import { VerisGlobeLoader } from "@/components/system/loaders"
import { hasSessionJsonCache } from "@/lib/client/session-json-cache"

type LoadingReason = "navigation" | "dashboard" | "candidates" | "interviews" | "reports" | "veris" | "analytics"

type AmbientLoadingOptions = {
  message?: string
  reason?: LoadingReason
}

type AmbientLoadingContextValue = {
  startLoading: (options?: AmbientLoadingOptions) => void
  finishLoading: () => void
}

const AmbientLoadingContext = createContext<AmbientLoadingContextValue | null>(null)

const routeMessages: Array<[RegExp, string]> = [
  [/^\/ai-screening/, "VERIS Screening"],
  [/^\/veris-insights/, "VERIS Insights"],
  [/^\/candidates/, "Candidates"],
  [/^\/interviews/, "Interviews"],
  [/^\/reports/, "Reports"],
  [/^\/jobs/, "Jobs"],
  [/^\/manage-team/, "Team"],
  [/^\/billing/, "Billing"],
  [/^\/subscription/, "Subscription"],
  [/^\/settings/, "Settings"],
  [/^\//, "Dashboard"],
]

const DASHBOARD_CACHE_KEY = "verisnova-overview"
const DASHBOARD_INVALIDATED_KEY = "verisnova-overview-invalidated"

const screenCacheRules: Array<[RegExp, (search: string) => string]> = [
  [/^\/candidates/, (search) => `candidates:${search}`],
  [/^\/interviews/, (search) => `interviews:${search}`],
  [/^\/reports/, (search) => `reports:${search}`],
  [/^\/jobs/, (search) => `jobs:${search}`],
  [/^\/manage-team/, (search) => `manage-team:${search}`],
  [/^\/billing$/, (search) => `billing:${search}`],
  [/^\/settings/, (search) => `settings:${search}`],
  [/^\/veris-insights/, (search) => `veris-insights:${search}`],
  [/^\/subscription/, (search) => `subscription:${search}`],
]

function getRouteMessage(pathname: string) {
  return routeMessages.find(([pattern]) => pattern.test(pathname))?.[1] ?? "Preparing recruiter insights..."
}

function getGlobeSteps(message: string) {
  return [
    {
      label: "Opening screen",
      detail: "Securing recruiter session and route context.",
    },
    {
      label: message.replace(/\.+$/, ""),
      detail: "Loading data for this recruiter screen.",
    },
    {
      label: "Building view",
      detail: "Organizing records so the screen appears with complete data.",
    },
    {
      label: "Screen ready",
      detail: "The recruiter workspace is ready for review.",
    },
  ]
}

function getAnchorFromEventTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) {
    return null
  }

  return target.closest("a")
}

function hasReusableDashboardCache(pathname: string) {
  if (pathname !== "/" || typeof window === "undefined") {
    return false
  }

  try {
    return Boolean(
      window.sessionStorage.getItem(DASHBOARD_CACHE_KEY) &&
        window.sessionStorage.getItem(DASHBOARD_INVALIDATED_KEY) !== "1"
    )
  } catch {
    return false
  }
}

function getEffectiveCacheSearch(search: string) {
  if (typeof window === "undefined") {
    return search.replace(/^\?/, "")
  }

  const params = new URLSearchParams(search)
  if (params.get("userId") && params.get("organizationId")) {
    return params.toString()
  }

  try {
    const storedAuth = window.sessionStorage.getItem("verisnova-auth")
    const parsedAuth = storedAuth ? JSON.parse(storedAuth) : null

    if (parsedAuth?.userId && parsedAuth?.organizationId) {
      params.set("userId", parsedAuth.userId)
      params.set("organizationId", parsedAuth.organizationId)
      return params.toString()
    }
  } catch {
    // Cache lookup only; fall through to overview fallback.
  }

  try {
    const cachedOverview = window.sessionStorage.getItem(DASHBOARD_CACHE_KEY)
    const parsedOverview = cachedOverview ? JSON.parse(cachedOverview) : null
    const profile = parsedOverview?.profile

    if (profile?.userId && profile?.organizationId) {
      params.set("userId", profile.userId)
      params.set("organizationId", profile.organizationId)
      return params.toString()
    }
  } catch {
    // Cache lookup only; fall through to raw search.
  }

  return params.toString()
}

function hasReusableScreenCache(pathname: string, search: string) {
  if (typeof window === "undefined") {
    return false
  }

  if (hasReusableDashboardCache(pathname)) {
    return true
  }

  const rule = screenCacheRules.find(([pattern]) => pattern.test(pathname))
  if (!rule) {
    return false
  }

  return hasSessionJsonCache(rule[1](getEffectiveCacheSearch(search)))
}

export function useAmbientLoading() {
  const context = useContext(AmbientLoadingContext)

  if (!context) {
    throw new Error("useAmbientLoading must be used inside AmbientLoadingProvider")
  }

  return context
}

export default function AmbientLoadingProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const [visible, setVisible] = useState(false)
  const [showDetails, setShowDetails] = useState(false)
  const [message, setMessage] = useState("Preparing recruiter insights...")
  const timers = useRef<number[]>([])
  const lastLocation = useRef("")

  const clearTimers = useCallback(() => {
    timers.current.forEach((timer) => window.clearTimeout(timer))
    timers.current = []
  }, [])

  const finishLoading = useCallback(() => {
    clearTimers()
    setShowDetails(false)
    const fadeTimer = window.setTimeout(() => setVisible(false), 280)
    timers.current.push(fadeTimer)
  }, [clearTimers])

  const startLoading = useCallback((options: AmbientLoadingOptions = {}) => {
    clearTimers()
    setMessage(options.message || getRouteMessage(window.location.pathname))
    setShowDetails(false)

    const barTimer = window.setTimeout(() => setVisible(true), 180)
    const detailTimer = window.setTimeout(() => setShowDetails(true), 2000)
    const safetyTimer = window.setTimeout(() => finishLoading(), 8000)
    timers.current.push(barTimer, detailTimer, safetyTimer)
  }, [clearTimers, finishLoading])

  useEffect(() => {
    const nextLocation = pathname

    if (!lastLocation.current) {
      lastLocation.current = nextLocation
      return
    }

    if (lastLocation.current !== nextLocation) {
      lastLocation.current = nextLocation
      const finishTimer = window.setTimeout(() => finishLoading(), 0)
      return () => window.clearTimeout(finishTimer)
    }
  }, [finishLoading, pathname])

  useEffect(() => {
    function handleClick(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return
      }

      const anchor = getAnchorFromEventTarget(event.target)
      if (!anchor || anchor.target || anchor.hasAttribute("download")) {
        return
      }

      const href = anchor.getAttribute("href")
      if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) {
        return
      }

      const nextUrl = new URL(anchor.href, window.location.href)
      const currentUrl = new URL(window.location.href)

      if (nextUrl.origin !== currentUrl.origin) {
        return
      }

      if (nextUrl.pathname === currentUrl.pathname && nextUrl.search === currentUrl.search) {
        return
      }

      if (hasReusableScreenCache(nextUrl.pathname, nextUrl.search)) {
        finishLoading()
        return
      }

      startLoading({ message: getRouteMessage(nextUrl.pathname), reason: "navigation" })
    }

    function handlePageShow() {
      finishLoading()
    }

    document.addEventListener("click", handleClick, true)
    window.addEventListener("pageshow", handlePageShow)

    return () => {
      document.removeEventListener("click", handleClick, true)
      window.removeEventListener("pageshow", handlePageShow)
      clearTimers()
    }
  }, [clearTimers, finishLoading, startLoading])

  const value = useMemo(() => ({ startLoading, finishLoading }), [finishLoading, startLoading])

  return (
    <AmbientLoadingContext.Provider value={value}>
      {visible ? (
        <div className="fixed inset-0 z-[130]">
          <VerisGlobeLoader
            eyebrow="VerisNova"
            steps={getGlobeSteps(message)}
            activeIndex={showDetails ? 2 : 1}
            fullscreen
          />
        </div>
      ) : null}
      <div className="hv-route-continuity">{children}</div>
    </AmbientLoadingContext.Provider>
  )
}
