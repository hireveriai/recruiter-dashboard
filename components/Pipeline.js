"use client"

import { useEffect, useState } from "react"
import { useAuthSearchParams } from "@/lib/client/use-auth-search-params"

import { buildAuthUrl, hasAuthQuery } from "@/lib/client/auth-query"
import { MetricSkeleton } from "@/components/system/skeletons"

const FALLBACK_PIPELINE = {
  pending: 0,
  inProgress: 0,
  completed: 0,
  flagged: 0,
  reviewed: 0,
  reviewRequired: 0,
}
const DASHBOARD_INVALIDATED_EVENT = "hireveri:dashboard-data-invalidated"

export default function Pipeline({ initialPipeline, isLoading = false }) {
  const searchParams = useAuthSearchParams()
  const [pipeline, setPipeline] = useState(() => initialPipeline ?? null)
  const displayPipeline = pipeline ?? initialPipeline ?? FALLBACK_PIPELINE

  useEffect(() => {
    if (initialPipeline) {
      queueMicrotask(() => setPipeline(initialPipeline))
    }
  }, [initialPipeline])

  useEffect(() => {
    if (initialPipeline) {
      return
    }

    if (!hasAuthQuery(searchParams)) {
      return
    }

    let isMounted = true

    fetch(buildAuthUrl(`/api/dashboard/workflow?refresh=${Date.now()}`, searchParams), {
      credentials: "include",
      cache: "no-store",
    })
      .then((res) => res.json())
      .then((data) => {
        if (isMounted && data.success) {
          setPipeline(data.data?.pipeline ?? FALLBACK_PIPELINE)
        }
      })
      .catch((error) => {
        console.error("Failed to fetch interview pipeline", error)
      })

    return () => {
      isMounted = false
    }
  }, [initialPipeline, searchParams])

  useEffect(() => {
    if (!hasAuthQuery(searchParams) || typeof window === "undefined") {
      return undefined
    }

    let active = true
    let refreshTimer = null

    async function refreshPipeline() {
      try {
        const response = await fetch(buildAuthUrl(`/api/dashboard/workflow?refresh=${Date.now()}`, searchParams), {
          credentials: "include",
          cache: "no-store",
        })
        const data = await response.json().catch(() => null)

        if (active && response.ok && data?.success) {
          setPipeline(data.data?.pipeline ?? FALLBACK_PIPELINE)
        }
      } catch (error) {
        console.error("Failed to refresh interview pipeline", error)
      }
    }

    function handleDashboardInvalidated() {
      if (refreshTimer) {
        window.clearTimeout(refreshTimer)
      }

      refreshTimer = window.setTimeout(refreshPipeline, 100)
    }

    window.addEventListener(DASHBOARD_INVALIDATED_EVENT, handleDashboardInvalidated)

    return () => {
      active = false
      if (refreshTimer) {
        window.clearTimeout(refreshTimer)
      }
      window.removeEventListener(DASHBOARD_INVALIDATED_EVENT, handleDashboardInvalidated)
    }
  }, [searchParams])

  const cards = [
    { title: "Invited", count: displayPipeline.pending, color: "bg-blue-500" },
    { title: "Started", count: displayPipeline.inProgress, color: "bg-indigo-500" },
    { title: "Completed", count: displayPipeline.completed, color: "bg-green-500" },
    { title: "Reviewed", count: displayPipeline.reviewed, color: "bg-sky-400" },
    { title: "Review Required", count: displayPipeline.reviewRequired, color: "bg-amber-400" },
    { title: "Flagged", count: displayPipeline.flagged, color: "bg-red-500" },
  ]

  return (
    <div className="mt-8">
      <h2 className="text-xl font-semibold mb-4">
        Interview Pipeline
      </h2>

      {isLoading && !pipeline && !initialPipeline ? (
        <MetricSkeleton className="grid-cols-2 lg:grid-cols-3" />
      ) : (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
          {cards.map((item) => (
          <div
            key={item.title}
            className="hv-theme-panel rounded-xl border border-slate-800 bg-slate-900/75 p-5 shadow-sm"
          >
            <div className="flex justify-between items-center">
              <span className="text-gray-400 text-sm">
                {item.title}
              </span>

              <div className={`w-3 h-3 rounded-full ${item.color}`}></div>
            </div>

            <div className="text-3xl font-bold mt-3">
              {item.count}
            </div>
          </div>
          ))}
        </div>
      )}
    </div>
  )
}




