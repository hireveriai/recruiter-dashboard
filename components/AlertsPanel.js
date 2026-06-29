"use client"

import { useEffect, useState } from "react"

import { buildAuthUrl, hasAuthQuery } from "@/lib/client/auth-query"
import { useAuthSearchParams } from "@/lib/client/use-auth-search-params"
import { TimelineSkeleton } from "@/components/system/skeletons"

const ALERTS_READ_EVENT = "hireveri:alerts-read"

function getToneClass(tone) {
  if (tone === "success") {
    return "border-emerald-400/20 bg-emerald-500/10 text-emerald-100"
  }

  if (tone === "warning") {
    return "border-amber-400/20 bg-amber-500/10 text-amber-100"
  }

  if (tone === "danger") {
    return "border-rose-400/20 bg-rose-500/10 text-rose-100"
  }

  return "border-cyan-400/20 bg-cyan-500/10 text-cyan-100"
}

function formatAlertTime(value) {
  if (!value) {
    return ""
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return ""
  }

  return date.toLocaleString(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export default function AlertsPanel({ initialAlerts, isLoading = false }) {
  const searchParams = useAuthSearchParams()
  const [alerts, setAlerts] = useState(() => initialAlerts ?? [])
  const displayAlerts = alerts

  useEffect(() => {
    if (initialAlerts !== undefined) {
      queueMicrotask(() => setAlerts(initialAlerts ?? []))
    }
  }, [initialAlerts])

  useEffect(() => {
    if (initialAlerts !== undefined || !hasAuthQuery(searchParams)) {
      return
    }

    let active = true

    fetch(buildAuthUrl("/api/dashboard/alerts", searchParams), {
      credentials: "include",
      cache: "no-store",
    })
      .then((response) => response.json())
      .then((payload) => {
        if (active && payload?.success) {
          setAlerts(payload.data ?? [])
        }
      })
      .catch((error) => {
        console.error("Failed to fetch dashboard alerts", error)
      })

    return () => {
      active = false
    }
  }, [initialAlerts, searchParams])

  useEffect(() => {
    function handleAlertsRead(event) {
      const alertIds = Array.isArray(event.detail?.alertIds) ? event.detail.alertIds : []
      if (alertIds.length === 0) {
        return
      }

      setAlerts((current) => current.filter((alert) => !alertIds.includes(alert.id)))
    }

    window.addEventListener(ALERTS_READ_EVENT, handleAlertsRead)

    return () => {
      window.removeEventListener(ALERTS_READ_EVENT, handleAlertsRead)
    }
  }, [])

  return (
    <div className="mt-10 rounded-[24px] border border-slate-800 bg-[#0f172a] p-5 shadow-[0_18px_60px_rgba(2,6,23,0.22)]">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-white">Alerts</h2>
          <p className="mt-1 text-xs uppercase tracking-[0.22em] text-slate-500">Interview activity</p>
        </div>
        {displayAlerts.length > 0 ? (
          <span className="rounded-full border border-cyan-400/20 bg-cyan-500/10 px-3 py-1 text-xs font-semibold text-cyan-100">
            {displayAlerts.length}
          </span>
        ) : null}
      </div>
      {isLoading ? (
        <TimelineSkeleton count={3} className="mt-4" />
      ) : displayAlerts.length === 0 ? (
        <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-950/30 px-4 py-5 text-sm text-slate-400">
          No interview activity alerts yet.
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {displayAlerts.map((alert) => (
            <article key={alert.id} className={`rounded-2xl border px-4 py-3 ${getToneClass(alert.tone)}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-white">{alert.title}</p>
                  <p className="mt-1 text-sm leading-6 text-slate-200">{alert.message}</p>
                </div>
                <span className="shrink-0 text-[11px] uppercase tracking-[0.16em] text-slate-300">
                  {formatAlertTime(alert.occurredAt)}
                </span>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  )
}
