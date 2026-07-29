"use client"

import { useEffect, useState } from "react"
import { useAuthSearchParams } from "@/lib/client/use-auth-search-params"

import { buildAuthUrl } from "@/lib/client/auth-query"
import { CardSkeleton, TimelineSkeleton } from "@/components/system/skeletons"

const DASHBOARD_SUMMARY_LIMIT = 4
const DASHBOARD_INVALIDATED_EVENT = "hireveri:dashboard-data-invalidated"

function getRecommendationColor(value) {
  const normalized = String(value ?? "").toUpperCase()

  if (normalized === "STRONG HIRE" || normalized === "HIRE") {
    return "text-green-400"
  }

  if (normalized === "HOLD" || normalized === "REVIEW REQUIRED") {
    return "text-yellow-400"
  }

  return "text-red-400"
}

function getRiskColor(value) {
  const normalized = String(value ?? "").toUpperCase()

  if (normalized === "LOW") {
    return "text-green-400"
  }

  if (normalized === "MEDIUM") {
    return "text-yellow-400"
  }

  return "text-red-400"
}

function getInsightSummary(item) {
  const reason = String(item.recommendationReason ?? "").trim()
  const behavioralFlags = String(item.behavioralFlagsShort ?? "").trim()
  const strengths = String(item.strengthsShort ?? "").trim()

  if (reason) return reason
  if (behavioralFlags && !/^none$/i.test(behavioralFlags)) return behavioralFlags
  if (strengths) return strengths

  return "Review evidence and pipeline signals before final decision."
}

function VerisInsightCard({ item, expanded, onToggle }) {
  return (
    <div className="hv-theme-panel rounded-lg bg-[#111a2e] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-base font-semibold text-white">
            {item.candidateName}
          </div>

          <div className="mt-0.5 truncate text-sm text-gray-400">
            {item.jobTitle}
          </div>
        </div>

        <div className="shrink-0 text-right">
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Risk Level</div>
          <div className={`mt-1 text-sm font-semibold ${getRiskColor(item.riskLevel)}`}>{item.riskLevel}</div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-slate-400">Recommendation</span>
        <span className={`font-semibold ${getRecommendationColor(item.recommendation)}`}>
          {item.recommendation}
        </span>
      </div>

      <p className="mt-2 line-clamp-2 min-h-[38px] text-sm leading-5 text-slate-300">
        {getInsightSummary(item)}
      </p>

      <button
        type="button"
        onClick={onToggle}
        className="mt-3 text-xs font-semibold text-cyan-200 transition hover:text-cyan-100"
      >
        {expanded ? "Hide details" : "View evidence details"}
      </button>

      {expanded ? (
        <div className="mt-3 rounded-lg border border-slate-800 bg-slate-950/25 p-3">
          <div className="grid gap-2 text-sm text-slate-300">
            <div>
              Score: <span className="text-blue-400">{item.scoreLabel ?? "-"}</span>
            </div>

            <div>
              Strengths: <span className="text-slate-100">{item.strengthsShort}</span>
            </div>

            <div>
              Weaknesses: <span className="text-slate-100">{item.weaknessesShort}</span>
            </div>

            <div>
              Behavioral Flags: <span className="text-slate-100">{item.behavioralFlagsShort}</span>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function VerisInsightsModal({ isOpen, onClose, summaries, expandedSummaryIds, onToggle, isLoading }) {
  if (!isOpen) {
    return null
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[#020817]/80 px-4 py-4 backdrop-blur-md sm:py-6" role="dialog" aria-modal="true">
      <div className="relative w-full max-w-6xl overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/95 shadow-[0_18px_60px_rgba(2,6,23,0.28)]">
        <div className="absolute inset-x-0 top-0 h-px bg-slate-700/70" />

        <div className="flex items-center justify-between border-b border-white/10 px-8 py-6">
          <div>
            <h3 className="text-2xl font-semibold text-white">All VERIS Insights</h3>
            <p className="mt-2 text-sm text-slate-400">
              Complete candidate evidence cards with recommendation, risk level, strengths, weaknesses, and behavioral flags.
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-cyan-400/25 bg-cyan-400/10 px-4 py-2 text-sm text-cyan-100 transition hover:bg-cyan-400/20"
          >
            Close
          </button>
        </div>

        <div className="max-h-[75vh] overflow-auto px-8 py-6">
          {isLoading ? (
            <CardSkeleton count={4} className="grid-cols-1 lg:grid-cols-2" />
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {summaries.length === 0 ? (
                <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-6 text-center text-slate-400 lg:col-span-2">
                  No VERIS summaries available
                </div>
              ) : (
                summaries.map((item) => (
                  <VerisInsightCard
                    key={item.attemptId}
                    item={item}
                    expanded={expandedSummaryIds.has(item.attemptId)}
                    onToggle={() => onToggle(item.attemptId)}
                  />
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function VerisSummary({ initialSummaries, isLoading = false }) {
  const searchParams = useAuthSearchParams()
  const [summaries, setSummaries] = useState(() => initialSummaries ?? [])
  const [isFetching, setIsFetching] = useState(initialSummaries === undefined)
  const [expandedSummaryIds, setExpandedSummaryIds] = useState(() => new Set())
  const [allSummaries, setAllSummaries] = useState(() => initialSummaries ?? [])
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isLoadingAll, setIsLoadingAll] = useState(false)
  const baseSummaries = summaries
  const displaySummaries = baseSummaries.slice(0, DASHBOARD_SUMMARY_LIMIT)
  const canViewAll = baseSummaries.length > 0
  const isBusy = isLoading || isFetching

  useEffect(() => {
    if (initialSummaries !== undefined) {
      setSummaries(initialSummaries ?? [])
      setIsFetching(false)
      return
    }

    let isMounted = true
    let cancelScheduled = () => {}
    let loaderCeilingTimer = null

    setIsFetching(true)
    loaderCeilingTimer = window.setTimeout(() => {
      if (isMounted) {
        setIsFetching(false)
      }
    }, 1200)

    const fetchSummaries = () => {
      fetch(buildAuthUrl(`/api/dashboard/veris?refresh=${Date.now()}`, searchParams), {
        credentials: "include",
        cache: "no-store",
      })
        .then((res) => res.json())
        .then((data) => {
          if (isMounted && data.success) {
            setSummaries(data.data ?? [])
            setAllSummaries(data.data ?? [])
          }
        })
        .catch((error) => {
          console.error("Failed to fetch VERIS summaries", error)
        })
        .finally(() => {
          if (loaderCeilingTimer) {
            window.clearTimeout(loaderCeilingTimer)
          }
          if (isMounted) {
            setIsFetching(false)
          }
        })
    }

    if (typeof window !== "undefined") {
      const timeoutId = window.setTimeout(fetchSummaries, 160)
      cancelScheduled = () => window.clearTimeout(timeoutId)
    } else {
      fetchSummaries()
    }

    return () => {
      isMounted = false
      if (loaderCeilingTimer) {
        window.clearTimeout(loaderCeilingTimer)
      }
      cancelScheduled()
    }
  }, [initialSummaries, searchParams])

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined
    }

    let refreshTimer = null

    function refreshSummaries() {
      fetch(buildAuthUrl(`/api/dashboard/veris?limit=${DASHBOARD_SUMMARY_LIMIT}&fast=1&refresh=${Date.now()}`, searchParams), {
        credentials: "include",
        cache: "no-store",
      })
        .then((res) => res.json())
        .then((data) => {
          if (data.success) {
            setSummaries(data.data ?? [])
            setAllSummaries((current) => current.length > data.data?.length ? current : (data.data ?? []))
          }
        })
        .catch((error) => {
          console.error("Failed to refresh VERIS summaries", error)
        })
    }

    function handleDashboardInvalidated() {
      if (refreshTimer) {
        window.clearTimeout(refreshTimer)
      }

      refreshTimer = window.setTimeout(refreshSummaries, 225)
    }

    window.addEventListener(DASHBOARD_INVALIDATED_EVENT, handleDashboardInvalidated)

    return () => {
      if (refreshTimer) {
        window.clearTimeout(refreshTimer)
      }
      window.removeEventListener(DASHBOARD_INVALIDATED_EVENT, handleDashboardInvalidated)
    }
  }, [searchParams])

  function toggleSummaryDetails(attemptId) {
    setExpandedSummaryIds((current) => {
      const next = new Set(current)

      if (next.has(attemptId)) {
        next.delete(attemptId)
      } else {
        next.add(attemptId)
      }

      return next
    })
  }

  async function handleOpenAllSummaries() {
    setIsModalOpen(true)

    try {
      setIsLoadingAll(true)
      const response = await fetch(buildAuthUrl(`/api/dashboard/veris?limit=all&refresh=${Date.now()}`, searchParams), {
        credentials: "include",
        cache: "no-store",
      })
      const data = await response.json()

      if (!response.ok || !data.success) {
        throw new Error(data?.error?.message || data?.message || "Failed to fetch VERIS summaries")
      }

      setAllSummaries(data.data ?? [])
    } catch (error) {
      console.error("Failed to fetch all VERIS summaries", error)
      setAllSummaries((current) => current.length ? current : baseSummaries)
    } finally {
      setIsLoadingAll(false)
    }
  }

  return (
    <>
      <div className="mt-8">
        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold">
            VERIS Insights
            <span className="ml-2 inline-flex rounded-full border border-cyan-400/20 bg-cyan-400/10 px-2.5 py-1 align-middle text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-200">
              Recent
            </span>
          </h2>
          {!isBusy ? (
            <p className="mt-1 text-sm text-slate-500">
              Showing {displaySummaries.length} of {baseSummaries.length} summaries
            </p>
          ) : null}
        </div>

        {canViewAll ? (
          <button
            type="button"
            onClick={handleOpenAllSummaries}
            className="self-start rounded-xl border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-300 transition hover:border-cyan-400/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-60 sm:self-auto"
          >
            {isLoadingAll ? "Loading..." : "View all"}
          </button>
        ) : null}
      </div>

      {isBusy ? (
        <div className="grid gap-4 lg:grid-cols-[0.85fr_1.15fr]">
          <TimelineSkeleton
            messages={[
              "Loading behavioral telemetry...",
              "Preparing competency analysis...",
              "Building evidence timeline...",
            ]}
          />
          <CardSkeleton count={2} className="grid-cols-1" />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {displaySummaries.length === 0 ? (
        <div className="hv-theme-panel col-span-2 rounded-lg bg-[#111a2e] p-5 text-center text-gray-400">
            No VERIS summaries available
          </div>
        ) : (
          displaySummaries.map((item) => {
            const isExpanded = expandedSummaryIds.has(item.attemptId)

            return (
              <VerisInsightCard
                key={item.attemptId}
                item={item}
                expanded={isExpanded}
                onToggle={() => toggleSummaryDetails(item.attemptId)}
              />
            )
          })
        )}
        </div>
      )}
      </div>

      <VerisInsightsModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        summaries={allSummaries}
        expandedSummaryIds={expandedSummaryIds}
        onToggle={toggleSummaryDetails}
        isLoading={isLoadingAll}
      />
    </>
  )
}




